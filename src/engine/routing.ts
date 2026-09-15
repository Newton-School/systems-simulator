import type { Request } from './core/events'
import { pickOnHashRing } from './core/hashRing'
import type { ComponentNode, EdgeDefinition, RandomGenerator } from './core/types'
import { isAsyncBoundaryComponentType } from './traits/asyncOnly'
import { resolveTraits } from './traits/resolveTraits'
import type {
  FilterRoutesDecision,
  NodeBehaviourTrait,
  TraitResolver,
  TraitStateStore
} from './traits/types'

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

export type RouteRejectionReason =
  | 'no_healthy_targets'
  | 'trait_invalid_reroute'
  | 'broker_unavailable'

export interface ResolveTargetOptions {
  clock?: bigint
  isTargetHealthy?: (nodeId: string) => boolean
  isEdgeHealthy?: (edge: EdgeDefinition) => boolean
  /**
   * Live in-flight (queued + in-service) count for a target node, used by the
   * `least-conn` strategy. The engine supplies this from each node's runtime
   * state; when absent, least-conn degrades to round-robin so it still spreads.
   */
  getInFlight?: (nodeId: string) => number
  /**
   * Cumulative mean service time (ms) for a target node, used by the
   * `least-response-time` strategy. When absent, that strategy degrades to
   * `least-conn` (and thence round-robin).
   */
  getResponseTimeMs?: (nodeId: string) => number
  estimateRouteLatencyMs?: (edge: EdgeDefinition, request: Request) => number
  sharedState?: TraitStateStore
  onTraitDecision?: (decision: {
    traitName: string
    nodeId: string
    hook: 'filterRoutes'
    decision: string
    payload?: Record<string, unknown>
  }) => void
}

export interface ResolveTargetResult {
  routes: ResolveRoute[]
  rejectionReason?: RouteRejectionReason
}

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
   * Per-source rotating cursor used to break ties in `least-conn` when several
   * targets share the smallest in-flight count, mirroring the routing preview.
   */
  private readonly leastConnTieIndexBySource = new Map<string, number>()

  /**
   * Effective routing strategy per source node, resolved once from explicit
   * config (`routingStrategy`) with a trait hint fallback. Drives `pickSyncRoute`
   * so the selector the user picks is what the engine actually runs.
   */
  private readonly strategyBySourceId = new Map<string, string>()
  private readonly nodeById = new Map<string, ComponentNode>()
  private readonly traitsBySourceId = new Map<string, readonly NodeBehaviourTrait[]>()
  private readonly traitStateBySourceId = new Map<string, Map<string, unknown>>()

  /**
   * @param edges Topology edges used to build routing lookup tables.
   * @param rng   RNG dependency used for probabilistic routing decisions.
   * @param nodes Optional node definitions used to identify round-robin sources
   *              by explicit routing strategy rather than by type heuristic.
   */
  constructor(
    edges: EdgeDefinition[],
    private readonly rng: RandomGenerator,
    nodes: ComponentNode[] = [],
    traitResolver: TraitResolver = resolveTraits
  ) {
    for (const node of nodes) {
      this.nodeById.set(node.id, node)
      this.traitsBySourceId.set(node.id, traitResolver(node))
    }

    for (const edge of edges) {
      const targetType = this.nodeById.get(edge.target)?.type
      const resolvedEdge =
        targetType && isAsyncBoundaryComponentType(targetType) && edge.mode !== 'asynchronous'
          ? { ...edge, mode: 'asynchronous' as const }
          : edge

      const list = this.outgoingBySource.get(edge.source)
      if (list) {
        list.push(resolvedEdge)
      } else {
        this.outgoingBySource.set(edge.source, [resolvedEdge])
      }
    }

    for (const node of nodes) {
      const configured = node.config?.['routingStrategy']
      const traitHint = (this.traitsBySourceId.get(node.id) ?? []).find(
        (trait) => trait.routingStrategyHint !== undefined
      )?.routingStrategyHint
      const strategy = typeof configured === 'string' ? configured : traitHint
      if (strategy) {
        this.strategyBySourceId.set(node.id, strategy)
      }
    }
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

    const traitFiltered = this.applyTraitRouteFilters(
      sourceNodeId,
      eligible.map((edge) => this.toResolved(edge)),
      request,
      options
    )

    if (traitFiltered.rejectionReason) {
      return { routes: [], rejectionReason: traitFiltered.rejectionReason }
    }

    if (traitFiltered.routes.length === 0) {
      return { routes: [] }
    }

    const asyncRoutes = traitFiltered.routes.filter((route) => route.edge.mode === 'asynchronous')
    const syncRoutes = traitFiltered.routes.filter((route) => route.edge.mode !== 'asynchronous')

    // Sync route goes first so it inherits the original request ID when the
    // engine forks branches — the real continuation should never lose its
    // identity to a side-effect async branch (e.g. telemetry) just because
    // that branch happened to resolve first.
    const results: ResolveRoute[] = []

    if (syncRoutes.length === 1) {
      results.push(syncRoutes[0])
    } else if (syncRoutes.length > 1) {
      if (this.strategyBySourceId.get(sourceNodeId) === 'broadcast') {
        results.push(...syncRoutes)
      } else {
        results.push(
          this.pickSyncRoute(
            sourceNodeId,
            syncRoutes,
            request,
            options.getInFlight,
            options.getResponseTimeMs
          )
        )
      }
    }

    results.push(...asyncRoutes)

    return { routes: results }
  }

  /**
   * Selects one edge from synchronous candidates. The node's configured routing
   * strategy is authoritative: whatever the user picks (and the preview animates)
   * is what runs here. A source with no explicit strategy honours edge weights
   * when present and otherwise spreads uniformly at random.
   */
  private pickSyncRoute(
    sourceNodeId: string,
    routes: ResolveRoute[],
    request: Request,
    getInFlight?: (nodeId: string) => number,
    getResponseTimeMs?: (nodeId: string) => number
  ): ResolveRoute {
    switch (this.strategyBySourceId.get(sourceNodeId)) {
      case 'round-robin':
        return this.pickRoundRobin(sourceNodeId, routes)
      case 'least-conn':
        return this.pickLeastConnected(sourceNodeId, routes, getInFlight)
      case 'least-response-time':
        return this.pickLeastResponseTime(sourceNodeId, routes, getInFlight, getResponseTimeMs)
      case 'p2c':
        return this.pickPowerOfTwoChoices(sourceNodeId, routes, getInFlight)
      case 'weighted':
        return this.pickByWeight(routes)
      case 'sticky':
        return this.pickSticky(sourceNodeId, routes, request, 'sticky')
      case 'ip-hash':
        return this.pickSticky(sourceNodeId, routes, request, 'ip-hash')
      case 'passthrough':
        // No balancing: forward to the first eligible target, matching the preview.
        return routes[0]
      case 'random':
        return routes[this.rng.integer(0, routes.length - 1)]
      default:
        if (routes.some((route) => route.edge.weight !== undefined)) {
          return this.pickByWeight(routes)
        }
        return routes[this.rng.integer(0, routes.length - 1)]
    }
  }

  private pickRoundRobin(sourceNodeId: string, routes: ResolveRoute[]): ResolveRoute {
    const current = this.roundRobinIndexBySource.get(sourceNodeId) ?? 0
    const safeIndex = current % routes.length
    const route = routes[safeIndex]
    this.roundRobinIndexBySource.set(sourceNodeId, (safeIndex + 1) % routes.length)
    return route
  }

  /**
   * Session-affinity routing: hashes a stable per-client key to a fixed backend
   * so every request from the same client/session lands on the same target.
   * `sticky` hashes the session key (the node's `stickyKeyField`, else
   * `sessionId`, else the canonical `__key`); `ip-hash` hashes `clientIp`.
   *
   * Placement uses a **consistent-hash ring** (not `hash(key) % n`): each target
   * gets several virtual points on a 2^32 ring, and a key maps to the first target
   * clockwise from `hash(key)`. Adding or ejecting one backend then reassigns only
   * that backend's share of keys (~1/N), instead of remapping almost everything —
   * the property that makes affinity survive pool changes. When no affinity key is
   * present there is nothing to be sticky about, so this degrades to round-robin
   * (it still spreads) — matching how `least-conn` degrades.
   */
  private pickSticky(
    sourceNodeId: string,
    routes: ResolveRoute[],
    request: Request,
    mode: 'sticky' | 'ip-hash'
  ): ResolveRoute {
    const key = this.resolveAffinityKey(sourceNodeId, request, mode)
    if (key === undefined) {
      return this.pickRoundRobin(sourceNodeId, routes)
    }
    return pickOnHashRing(routes, key)
  }

  /**
   * Least-response-time: picks the target minimizing expected wait, scored as
   * `(in-flight + 1) × mean service time`. Falls back to `least-conn` when no
   * response-time signal exists yet (e.g. before any completion), which itself
   * degrades to round-robin without an in-flight signal.
   */
  private pickLeastResponseTime(
    sourceNodeId: string,
    routes: ResolveRoute[],
    getInFlight?: (nodeId: string) => number,
    getResponseTimeMs?: (nodeId: string) => number
  ): ResolveRoute {
    if (!getResponseTimeMs) {
      return this.pickLeastConnected(sourceNodeId, routes, getInFlight)
    }
    const score = (route: ResolveRoute): number => {
      const serviceMs = getResponseTimeMs(route.targetNodeId)
      const inFlight = getInFlight?.(route.targetNodeId) ?? 0
      return (inFlight + 1) * serviceMs
    }
    // If no target has recorded a service time yet, there is nothing to compare.
    if (routes.every((route) => getResponseTimeMs(route.targetNodeId) <= 0)) {
      return this.pickLeastConnected(sourceNodeId, routes, getInFlight)
    }
    const scores = routes.map(score)
    const min = Math.min(...scores)
    const tied = routes.filter((_, index) => scores[index] === min)
    if (tied.length === 1) {
      return tied[0]
    }
    const tieIndex = this.leastConnTieIndexBySource.get(sourceNodeId) ?? 0
    const chosen = tied[tieIndex % tied.length]
    this.leastConnTieIndexBySource.set(sourceNodeId, (tieIndex + 1) % tied.length)
    return chosen
  }

  /**
   * Power-of-two-choices: sample two distinct candidates at random and route to
   * the less-loaded of the two. Near-optimal load spreading at O(1) cost and far
   * less herd behaviour than global least-conn. Degrades to round-robin without an
   * in-flight signal.
   */
  private pickPowerOfTwoChoices(
    sourceNodeId: string,
    routes: ResolveRoute[],
    getInFlight?: (nodeId: string) => number
  ): ResolveRoute {
    if (!getInFlight || routes.length === 1) {
      return this.pickRoundRobin(sourceNodeId, routes)
    }
    const first = this.rng.integer(0, routes.length - 1)
    let second = this.rng.integer(0, routes.length - 2)
    if (second >= first) second += 1 // pick a distinct second index
    const a = routes[first]!
    const b = routes[second]!
    return getInFlight(a.targetNodeId) <= getInFlight(b.targetNodeId) ? a : b
  }

  private resolveAffinityKey(
    sourceNodeId: string,
    request: Request,
    mode: 'sticky' | 'ip-hash'
  ): string | undefined {
    const asKey = (value: unknown): string | undefined =>
      typeof value === 'string' && value.length > 0 ? value : undefined

    if (mode === 'ip-hash') {
      return asKey(request.metadata.clientIp) ?? asKey(request.metadata.__key)
    }

    const field = this.nodeById.get(sourceNodeId)?.config?.['stickyKeyField']
    const configured = typeof field === 'string' && field.length > 0 ? field : undefined
    return (
      (configured ? asKey(request.metadata[configured]) : undefined) ??
      asKey(request.metadata.sessionId) ??
      asKey(request.metadata.__key)
    )
  }

  /**
   * Picks the candidate whose target currently has the fewest in-flight requests.
   * Ties rotate through the tied set via a per-source cursor, matching the routing
   * preview's tie-break. Without a live in-flight signal, degrades to round-robin.
   */
  private pickLeastConnected(
    sourceNodeId: string,
    routes: ResolveRoute[],
    getInFlight?: (nodeId: string) => number
  ): ResolveRoute {
    if (!getInFlight) {
      return this.pickRoundRobin(sourceNodeId, routes)
    }

    const loads = routes.map((route) => getInFlight(route.targetNodeId))
    const minLoad = Math.min(...loads)
    const tied = routes.filter((_, index) => loads[index] === minLoad)

    if (tied.length === 1) {
      return tied[0]
    }

    const tieIndex = this.leastConnTieIndexBySource.get(sourceNodeId) ?? 0
    const chosen = tied[tieIndex % tied.length]
    this.leastConnTieIndexBySource.set(sourceNodeId, (tieIndex + 1) % tied.length)
    return chosen
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

    const metadataExpr = normalized.match(
      /^request\.metadata\.([A-Za-z0-9_]+)\s*(===|==|!==|!=)\s*["']([^"']+)["']$/
    )
    if (metadataExpr) {
      const field = metadataExpr[1]
      const operator = metadataExpr[2]
      const expectedValue = metadataExpr[3]
      const actualValue = request.metadata[field]
      const normalizedActual =
        typeof actualValue === 'string' || typeof actualValue === 'number'
          ? String(actualValue)
          : undefined

      switch (operator) {
        case '===':
        case '==':
          return normalizedActual === expectedValue
        case '!==':
        case '!=':
          return normalizedActual !== expectedValue
        default:
          return false
      }
    }

    return false
  }

  /**
   * Picks one edge from a candidate set using relative weight values.
   */
  private pickByWeight(routes: ResolveRoute[]): ResolveRoute {
    let total = 0
    const weights: number[] = []

    for (const route of routes) {
      const weight = route.edge.weight ?? 1
      const normalized = Number.isFinite(weight) && weight > 0 ? weight : 0
      weights.push(normalized)
      total += normalized
    }

    // If configured weights are unusable, fall back to uniform random
    if (total <= 0) {
      return routes[this.rng.integer(0, routes.length - 1)]
    }

    const target = this.rng.next() * total
    let cumulative = 0

    for (let i = 0; i < routes.length; i++) {
      cumulative += weights[i]
      if (target < cumulative) {
        return routes[i]
      }
    }

    return routes[routes.length - 1]
  }

  private getTraitStateStore(sourceNodeId: string): TraitStateStore {
    let store = this.traitStateBySourceId.get(sourceNodeId)
    if (!store) {
      store = new Map<string, unknown>()
      this.traitStateBySourceId.set(sourceNodeId, store)
    }
    return {
      get: <T>(key: string) => store!.get(key) as T | undefined,
      set: <T>(key: string, value: T) => {
        store!.set(key, value)
      }
    }
  }

  /**
   * Converts a selected edge into the stable `ResolveRoute` shape.
   */
  private toResolved(edge: EdgeDefinition): ResolveRoute {
    return { targetNodeId: edge.target, edge }
  }

  private applyTraitRouteFilters(
    sourceNodeId: string,
    candidates: ResolveRoute[],
    request: Request,
    options: ResolveTargetOptions
  ): {
    routes: ResolveRoute[]
    rejectionReason?: RouteRejectionReason
  } {
    const node = this.nodeById.get(sourceNodeId)
    if (!node) {
      return { routes: candidates }
    }

    let filtered = candidates
    let rejectionReason: RouteRejectionReason | undefined
    for (const trait of this.traitsBySourceId.get(sourceNodeId) ?? []) {
      if (!trait.filterRoutes) {
        continue
      }

      const result = trait.filterRoutes({
        node,
        request,
        clock: options.clock ?? 0n,
        random: this.rng.next,
        candidates: filtered,
        getNode: (nodeId) => this.nodeById.get(nodeId),
        isTargetHealthy: options.isTargetHealthy,
        isEdgeHealthy: options.isEdgeHealthy,
        estimateRouteLatencyMs: options.estimateRouteLatencyMs,
        state: this.getTraitStateStore(sourceNodeId),
        sharedState: options.sharedState
      })
      const normalized = this.normalizeFilterRoutesDecision(filtered, result)
      options.onTraitDecision?.({
        traitName: trait.name,
        nodeId: sourceNodeId,
        hook: 'filterRoutes',
        decision: normalized.decision,
        payload: normalized.payload
      })
      filtered = normalized.routes
      rejectionReason = normalized.rejectionReason

      if (rejectionReason) {
        break
      }
    }

    return { routes: filtered, rejectionReason }
  }

  private normalizeFilterRoutesDecision(
    previousRoutes: ResolveRoute[],
    decision: FilterRoutesDecision
  ): {
    routes: ResolveRoute[]
    decision: string
    rejectionReason?: RouteRejectionReason
    payload: Record<string, unknown>
  } {
    if (Array.isArray(decision)) {
      return {
        routes: decision,
        decision: decision.length === previousRoutes.length ? 'continue' : 'filtered',
        payload: {
          beforeCandidateCount: previousRoutes.length,
          afterCandidateCount: decision.length
        }
      }
    }

    return {
      routes: decision.routes,
      decision:
        decision.decision ??
        (decision.routes.length === previousRoutes.length ? 'continue' : 'filtered'),
      rejectionReason:
        decision.rejectionReason === 'no_healthy_targets'
          ? 'no_healthy_targets'
          : decision.rejectionReason === 'trait_invalid_reroute'
            ? 'trait_invalid_reroute'
            : decision.rejectionReason === 'broker_unavailable'
              ? 'broker_unavailable'
              : undefined,
      payload: {
        beforeCandidateCount: previousRoutes.length,
        afterCandidateCount: decision.routes.length,
        ...(decision.payload ?? {})
      }
    }
  }
}
