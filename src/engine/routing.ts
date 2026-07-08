import type { Request } from './core/events'
import type { ComponentNode, EdgeDefinition, RandomGenerator } from './core/types'

/**
 * Normalized output for a single routing choice.
 */
export interface ResolveRoute {
  /**
   * Destination node chosen for the current hop.
   */
  targetNodeId: string

  /**
   * Concrete edge metadata that was selected.
   */
  edge: EdgeDefinition
}

export type RouteRejectionReason = 'no_healthy_targets'

export interface ResolveTargetOptions {
  isTargetHealthy?: (nodeId: string) => boolean
  isEdgeHealthy?: (edge: EdgeDefinition) => boolean
}

export interface ResolveTargetResult {
  routes: ResolveRoute[]
  rejectionReason?: RouteRejectionReason
}

const HEALTH_AWARE_ROUTER_TYPES = new Set<ComponentNode['type']>([
  'load-balancer',
  'load-balancer-l4',
  'load-balancer-l7'
])

/**
 * Maintains pre-indexed outgoing edges and source-specific cursors used by
 * routing strategies (for example: weighted and round-robin).
 */
export class RoutingTable {
  /**
   * Adjacency list keyed by source node ID for fast edge lookup.
   */
  private readonly outgoingBySource = new Map<string, EdgeDefinition[]>()

  /**
   * Per-source bounded cursor used to rotate choices in round-robin mode.
   * Always stored modulo the active candidate count to avoid unsafe-integer drift.
   */
  private readonly roundRobinIndexBySource = new Map<string, number>()

  /**
   * Set of node IDs that should use round-robin routing, derived from node
   * config metadata. Only populated when node definitions are provided.
   */
  private readonly roundRobinSourceIds: Set<string>
  private readonly healthAwareSourceIds: Set<string>

  /**
   * @param edges Topology edges used to build routing lookup tables.
   * @param rng   RNG dependency used for probabilistic routing decisions.
   * @param nodes Optional node definitions used to identify round-robin sources
   *              by explicit routing strategy rather than by type heuristic.
   */
  constructor(
    edges: EdgeDefinition[],
    private readonly rng: RandomGenerator,
    nodes: ComponentNode[] = []
  ) {
    for (const edge of edges) {
      const list = this.outgoingBySource.get(edge.source)
      if (list) {
        list.push(edge)
      } else {
        this.outgoingBySource.set(edge.source, [edge])
      }
    }

    this.roundRobinSourceIds = new Set(
      nodes
        .filter(
          (node) =>
            node.config?.['routingStrategy'] === 'round-robin' ||
            HEALTH_AWARE_ROUTER_TYPES.has(node.type)
        )
        .map((node) => node.id)
    )

    this.healthAwareSourceIds = new Set(
      nodes.filter((node) => HEALTH_AWARE_ROUTER_TYPES.has(node.type)).map((node) => node.id)
    )
  }

  /**
   * Returns all edges that originate from the provided source node.
   */
  getOutgoingEdges(sourceNodeId: string): EdgeDefinition[] {
    const edges = this.outgoingBySource.get(sourceNodeId)
    return edges ? [...edges] : []
  }

  /**
   * Resolves the next route(s) for a request based on source edges,
   * edge mode, edge conditions, and selection strategy.
   *
   * Async edges always fan-out: every eligible async edge produces a route.
   * Sync/streaming/conditional edges compete: exactly one is selected via
   * round-robin, weighted, or uniform random selection.
   * Both groups are evaluated independently, so a mixed topology fans out
   * to all async targets while still picking one sync target.
   */
  resolveTarget(
    sourceNodeId: string,
    request: Request,
    options: ResolveTargetOptions = {}
  ): ResolveRoute[] {
    return this.resolveTargetResult(sourceNodeId, request, options).routes
  }

  resolveTargetResult(
    sourceNodeId: string,
    request: Request,
    options: ResolveTargetOptions = {}
  ): ResolveTargetResult {
    const outgoing = this.outgoingBySource.get(sourceNodeId)
    if (!outgoing || outgoing.length === 0) {
      return { routes: [] }
    }

    const eligible = outgoing.filter((edge) => this.matchesCondition(edge, request))
    if (eligible.length === 0) {
      return { routes: [] }
    }

    const healthEligible = this.filterHealthyTargets(sourceNodeId, eligible, options)
    if (healthEligible.length === 0) {
      return { routes: [], rejectionReason: 'no_healthy_targets' }
    }

    const asyncEdges = healthEligible.filter((edge) => edge.mode === 'asynchronous')
    const syncEdges = healthEligible.filter((edge) => edge.mode !== 'asynchronous')

    const results: ResolveRoute[] = asyncEdges.map((edge) => this.toResolved(edge))

    if (syncEdges.length === 1) {
      results.push(this.toResolved(syncEdges[0]))
    } else if (syncEdges.length > 1) {
      results.push(this.toResolved(this.pickSyncRoute(sourceNodeId, syncEdges)))
    }

    return { routes: results }
  }

  /**
   * Selects one edge from synchronous candidates using round-robin,
   * weighted, or uniform random strategy.
   */
  private pickSyncRoute(sourceNodeId: string, edges: EdgeDefinition[]): EdgeDefinition {
    if (this.isRoundRobinSource(sourceNodeId)) {
      const current = this.roundRobinIndexBySource.get(sourceNodeId) ?? 0
      const safeIndex = current % edges.length
      const edge = edges[safeIndex]
      this.roundRobinIndexBySource.set(sourceNodeId, (safeIndex + 1) % edges.length)
      return edge
    }

    if (edges.some((edge) => edge.weight !== undefined)) {
      return this.pickByWeight(edges)
    }

    return edges[this.rng.integer(0, edges.length - 1)]
  }

  /**
   * Evaluates whether an edge is eligible for routing given the request context.
   *
   * Supported condition formats:
   *   - No condition / empty string: always eligible (unless mode is 'conditional')
   *   - `request.type === "X"` / `request.type == "X"`
   *   - `request.type !== "X"` / `request.type != "X"`
   *
   * Edges with mode 'conditional' must have a non-empty condition string;
   * they are treated as ineligible if the condition is absent or empty.
   */
  private matchesCondition(edge: EdgeDefinition, request: Request): boolean {
    const { condition, mode } = edge

    if (mode === 'conditional' && (!condition || condition.trim().length === 0)) {
      return false
    }

    if (!condition || condition.trim().length === 0) {
      return true
    }

    const normalized = condition.replace(/\s/g, ' ').trim()

    const typeExpr = normalized.match(/^request\.type\s*(===|==|!==|!=)\s*["']([^"']+)["']$/)
    if (typeExpr) {
      const operator = typeExpr[1]
      const expectedType = typeExpr[2]
      switch (operator) {
        case '===':
        case '==':
          return request.type === expectedType
        case '!==':
        case '!=':
          return request.type !== expectedType
        default:
          return false
      }
    }

    return false
  }

  /**
   * Picks one edge from a candidate set using relative weight values.
   */
  private pickByWeight(edges: EdgeDefinition[]): EdgeDefinition {
    let total = 0
    const weights: number[] = []

    for (const edge of edges) {
      const weight = edge.weight ?? 1
      const normalized = Number.isFinite(weight) && weight > 0 ? weight : 0
      weights.push(normalized)
      total += normalized
    }

    // If configured weights are unusable, fall back to uniform random
    if (total <= 0) {
      return edges[this.rng.integer(0, edges.length - 1)]
    }

    const target = this.rng.next() * total
    let cumulative = 0

    for (let i = 0; i < edges.length; i++) {
      cumulative += weights[i]
      if (target < cumulative) {
        return edges[i]
      }
    }

    return edges[edges.length - 1]
  }

  private filterHealthyTargets(
    sourceNodeId: string,
    edges: EdgeDefinition[],
    options: ResolveTargetOptions
  ): EdgeDefinition[] {
    if (!this.isHealthAwareSource(sourceNodeId)) {
      return edges
    }

    return edges.filter((edge) => {
      const targetHealthy = options.isTargetHealthy?.(edge.target) ?? true
      const edgeHealthy = options.isEdgeHealthy?.(edge) ?? true
      return targetHealthy && edgeHealthy
    })
  }

  /**
   * Returns true if the source node should use round-robin routing.
   * Uses explicit node config when available. Falls back to an ID substring
   * heuristic for legacy topology JSON that predates routingStrategy.
   */
  private isRoundRobinSource(sourceNodeId: string): boolean {
    if (this.roundRobinSourceIds.size > 0) {
      return this.roundRobinSourceIds.has(sourceNodeId)
    }
    const id = sourceNodeId.toLowerCase()
    return (
      id.includes('load-balancer') ||
      id.includes('lb') ||
      id.includes('ingress') ||
      id.includes('reverse-proxy')
    )
  }

  private isHealthAwareSource(sourceNodeId: string): boolean {
    if (this.healthAwareSourceIds.size > 0) {
      return this.healthAwareSourceIds.has(sourceNodeId)
    }

    const id = sourceNodeId.toLowerCase()
    return id.includes('load-balancer') || id.includes('lb')
  }

  /**
   * Converts a selected edge into the stable `ResolveRoute` shape.
   */
  private toResolved(edge: EdgeDefinition): ResolveRoute {
    return { targetNodeId: edge.target, edge }
  }
}
