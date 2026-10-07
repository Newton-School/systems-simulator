/**
 * Static anti-pattern detection.
 *
 * Scans a TopologyJSON (no simulation run needed) for well-known architectural
 * mistakes and returns plain-English warnings, each naming the nodes/edges
 * involved so the UI can point at them on the canvas.
 *
 * Every rule here is deliberately conservative: it fires only when the shape it
 * matches is wrong for *this* engine's semantics (how it routes, what it
 * models), never as a speculative style nudge. A clean, well-architected
 * topology returns an empty array.
 *
 * Rules from the original ticket that are NOT implemented, and why:
 * - "No circuit breaker" keyed off `dependencies.critical`: the engine never
 *   reads `dependencies`, and circuit breakers only exist on mesh / sidecar /
 *   circuit-breaker-controller nodes, so the warning would fire on nearly every
 *   service with no fix available on the flagged node.
 * - "Missing timeout": `processing.timeout` is a required field that is always
 *   filled, so there is no "no timeout" state to detect.
 * - "No queue capacity (unlimited)": the validator requires `queue.capacity >= 1`;
 *   there is no unbounded queue in this engine.
 */

import { HEALTH_AWARE_COMPONENT_TYPES } from '../traits/healthAwareRouting'
import { RETRY_BACKOFF_COMPONENT_TYPES } from '../traits/retryBackoff'
import { EXTERNAL_LATENCY_COMPONENT_TYPES } from '../traits/externalLatency'
import { isAsyncBoundaryComponentType } from '../traits/asyncOnly'
import { inferStructuralRole } from '../catalog/componentSpecs'
import type {
  ComponentNode,
  ComponentType,
  DistributionConfig,
  EdgeDefinition,
  TopologyJSON
} from '../core/types'
import { detectSinglePointsOfFailure, sourceNodeIds } from './singlePointOfFailure'

export type AntiPatternSeverity = 'warning' | 'critical'

export type AntiPatternRuleId =
  | 'single-point-of-failure'
  | 'sync-call-to-slow-dependency'
  | 'shared-database'
  | 'missing-load-balancer'
  | 'cache-in-front-of-load-balancer'
  | 'queue-without-consumer'
  | 'excessive-retries'

export interface AntiPatternWarning {
  /** Stable, unique id for this finding (rule + the elements involved). */
  id: string
  rule: AntiPatternRuleId
  /** Short pattern name, e.g. "Shared database". */
  title: string
  severity: AntiPatternSeverity
  /** What is wrong, in terms of this topology. */
  message: string
  /** How to fix it. */
  recommendation: string
  /** Offending node ids (first is the primary node to select). */
  nodeIds: string[]
  /** Offending edge ids, when the problem is a specific connection. */
  edgeIds: string[]
}

/** A storage node with at least this many distinct services writing/reading it is "shared". */
export const SHARED_DATABASE_MIN_SERVICES = 4
/** A blocking call on the request path to a dependency slower than this (ms, median) is flagged. */
export const SLOW_DEPENDENCY_THRESHOLD_MS = 5000
/** Retry policies above this many total attempts amplify load into a retry storm. */
export const MAX_REASONABLE_RETRY_ATTEMPTS = 10
/** A SPOF with more than this many distinct upstream callers escalates to critical. */
export const CRITICAL_SPOF_UPSTREAM_COUNT = 3

const DATABASE_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'relational-db',
  'nosql-db',
  'kv-store',
  'time-series-db',
  'columnar-db',
  'graph-db',
  'vector-db'
])

const APPLICATION_CACHE_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'in-memory-cache'
])

const MESSAGING_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'queue',
  'pub-sub',
  'message-broker',
  'event-bus',
  'stream'
])

const HEALTH_AWARE: ReadonlySet<string> = new Set(HEALTH_AWARE_COMPONENT_TYPES)
const RETRY_CAPABLE: ReadonlySet<string> = new Set(RETRY_BACKOFF_COMPONENT_TYPES)
const EXTERNAL: ReadonlySet<string> = new Set(EXTERNAL_LATENCY_COMPONENT_TYPES)

const SEVERITY_ORDER: Record<AntiPatternSeverity, number> = { critical: 0, warning: 1 }
const RULE_ORDER: AntiPatternRuleId[] = [
  'single-point-of-failure',
  'sync-call-to-slow-dependency',
  'shared-database',
  'missing-load-balancer',
  'cache-in-front-of-load-balancer',
  'queue-without-consumer',
  'excessive-retries'
]

function resolvedRole(node: ComponentNode): string | undefined {
  return node.role ?? inferStructuralRole(node.type)
}

function isService(node: ComponentNode): boolean {
  return resolvedRole(node) === 'processor'
}

function label(node: ComponentNode | undefined, fallback: string): string {
  return node?.label || fallback
}

/**
 * An edge the caller waits on. Mirrors the router: asynchronous edges fan out
 * fire-and-forget, and any edge into an async-boundary component (queues,
 * brokers, telemetry) is coerced to asynchronous.
 */
function isBlockingEdge(edge: EdgeDefinition, target: ComponentNode | undefined): boolean {
  if (edge.mode === 'asynchronous') return false
  if (target && isAsyncBoundaryComponentType(target.type)) return false
  return true
}

/**
 * Median of a distribution in its own unit (ms for service times). Returns
 * `null` when there is no simple closed form, so the caller skips the node
 * instead of guessing.
 */
export function distributionMedian(dist: DistributionConfig | undefined): number | null {
  if (!dist) return null
  switch (dist.type) {
    case 'constant':
    case 'deterministic':
      return dist.value
    case 'normal':
      return dist.mean
    case 'uniform':
      return (dist.min + dist.max) / 2
    case 'log-normal':
      return Math.exp(dist.mu)
    case 'exponential':
      return dist.lambda > 0 ? Math.LN2 / dist.lambda : null
    case 'weibull':
      return dist.shape > 0 ? dist.scale * Math.LN2 ** (1 / dist.shape) : null
    case 'pareto':
      return dist.shape > 0 ? dist.scale * 2 ** (1 / dist.shape) : null
    case 'empirical': {
      if (dist.samples.length === 0) return null
      const sorted = [...dist.samples].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
    default:
      return null
  }
}

/** Typical (median) time a node holds a request, including a configured external-call penalty. */
function typicalServiceMs(node: ComponentNode): number | null {
  const median = distributionMedian(node.processing?.distribution)
  const external =
    EXTERNAL.has(node.type) && typeof node.config?.['externalLatencyMs'] === 'number'
      ? Math.max(0, node.config['externalLatencyMs'] as number)
      : 0
  if (median === null) return external > 0 ? external : null
  return median + external
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s` : `${Math.round(ms)}ms`
}

/** Nodes reachable from the traffic source(s) along any edge. */
function reachableFromSources(
  topology: TopologyJSON,
  edgeFilter: (edge: EdgeDefinition) => boolean = () => true
): Set<string> {
  const outgoing = new Map<string, string[]>()
  for (const edge of topology.edges) {
    if (!edgeFilter(edge)) continue
    const list = outgoing.get(edge.source)
    if (list) list.push(edge.target)
    else outgoing.set(edge.source, [edge.target])
  }
  const visited = new Set<string>()
  const queue = sourceNodeIds(topology)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    if (visited.has(id)) continue
    visited.add(id)
    for (const next of outgoing.get(id) ?? []) if (!visited.has(next)) queue.push(next)
  }
  return visited
}

function spofRule(topology: TopologyJSON): AntiPatternWarning[] {
  const findings = detectSinglePointsOfFailure(topology)
  if (findings.length === 0) return []
  const worst = findings[0]
  // Critical when a SPOF is also a hub many components depend on directly.
  const upstream = new Map<string, Set<string>>()
  for (const edge of topology.edges) {
    if (edge.source === edge.target) continue
    const set = upstream.get(edge.target) ?? new Set<string>()
    set.add(edge.source)
    upstream.set(edge.target, set)
  }
  const severity: AntiPatternSeverity = findings.some(
    (f) => (upstream.get(f.nodeId)?.size ?? 0) > CRITICAL_SPOF_UPSTREAM_COUNT
  )
    ? 'critical'
    : 'warning'
  const lead =
    worst.orphansIfLost.length > 0
      ? `${worst.nodeLabel} runs a single instance and is the only path to ` +
        `${worst.orphansIfLost.join(', ')}. If it fails, ` +
        `${worst.orphansIfLost.length === 1 ? 'that component becomes' : 'those components become'} unreachable.`
      : `${worst.nodeLabel} is the only ${worst.nodeType} in the design and runs a single instance. ` +
        `If it fails, that capability is gone.`
  const others = findings.slice(1).map((f) => f.nodeLabel)
  const message =
    others.length > 0
      ? `${lead} Also single-instance with no fallback: ${others.join(', ')}.`
      : lead
  return [
    {
      id: `single-point-of-failure:${findings.map((f) => f.nodeId).join('+')}`,
      rule: 'single-point-of-failure',
      title: 'Single point of failure',
      severity,
      message,
      recommendation:
        'Run at least 2 instances of each critical component, or add a redundant peer on an alternate path.',
      nodeIds: findings.map((f) => f.nodeId),
      edgeIds: []
    }
  ]
}

function slowSyncRule(
  topology: TopologyJSON,
  nodeById: Map<string, ComponentNode>
): AntiPatternWarning[] {
  // The request path: everything a user request reaches while the caller is
  // still waiting (async hops end it).
  const requestPath = reachableFromSources(topology, (edge) =>
    isBlockingEdge(edge, nodeById.get(edge.target))
  )
  const warnings: AntiPatternWarning[] = []
  for (const edge of topology.edges) {
    const target = nodeById.get(edge.target)
    if (!target || !requestPath.has(edge.source)) continue
    if (!isBlockingEdge(edge, target)) continue
    const ms = typicalServiceMs(target)
    if (ms === null || ms <= SLOW_DEPENDENCY_THRESHOLD_MS) continue
    const source = nodeById.get(edge.source)
    warnings.push({
      id: `sync-call-to-slow-dependency:${edge.id}`,
      rule: 'sync-call-to-slow-dependency',
      title: 'Synchronous call to a slow dependency',
      severity: 'critical',
      message:
        `${label(source, edge.source)} calls ${label(target, edge.target)} synchronously on the request path, ` +
        `and ${label(target, edge.target)} typically takes ${formatMs(ms)}. Every request on this path waits ` +
        `that long before the user gets a response.`,
      recommendation:
        'Move the slow work off the request path: enqueue it (queue + worker) and respond immediately, or cache its result.',
      nodeIds: [target.id, ...(source ? [source.id] : [])],
      edgeIds: [edge.id]
    })
  }
  return warnings
}

function sharedDatabaseRule(
  topology: TopologyJSON,
  nodeById: Map<string, ComponentNode>
): AntiPatternWarning[] {
  const servicesByDb = new Map<string, Set<string>>()
  const edgesByDb = new Map<string, string[]>()
  for (const edge of topology.edges) {
    const target = nodeById.get(edge.target)
    const source = nodeById.get(edge.source)
    if (!target || !source || !DATABASE_TYPES.has(target.type) || !isService(source)) continue
    if (source.id === target.id) continue
    let services = servicesByDb.get(target.id)
    if (!services) {
      services = new Set()
      servicesByDb.set(target.id, services)
    }
    services.add(source.id)
    edgesByDb.set(target.id, [...(edgesByDb.get(target.id) ?? []), edge.id])
  }
  const warnings: AntiPatternWarning[] = []
  for (const [dbId, services] of servicesByDb) {
    if (services.size < SHARED_DATABASE_MIN_SERVICES) continue
    const db = nodeById.get(dbId)!
    const serviceIds = [...services].sort()
    warnings.push({
      id: `shared-database:${dbId}`,
      rule: 'shared-database',
      title: 'Shared database',
      severity: 'warning',
      message:
        `${services.size} services read and write ${label(db, dbId)} directly ` +
        `(${serviceIds.map((id) => label(nodeById.get(id), id)).join(', ')}). ` +
        `They contend for the same connections and capacity, and any one of them can slow down the rest.`,
      recommendation:
        'Give each service its own datastore (database per service), or put one owning service in front of it and have the others call that service.',
      nodeIds: [dbId, ...serviceIds],
      edgeIds: edgesByDb.get(dbId) ?? []
    })
  }
  return warnings
}

function missingLoadBalancerRule(
  topology: TopologyJSON,
  nodeById: Map<string, ComponentNode>
): AntiPatternWarning[] {
  const warnings: AntiPatternWarning[] = []
  // Group each caller's synchronous edges by target component type.
  const groups = new Map<string, { callerId: string; edgeIds: string[]; targetIds: Set<string> }>()
  for (const edge of topology.edges) {
    if (edge.mode !== 'synchronous') continue
    const caller = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!caller || !target || caller.id === target.id) continue
    if (HEALTH_AWARE.has(caller.type)) continue
    if (caller.config?.['routingStrategy'] === 'broadcast') continue
    if (target.category !== 'compute' || !isService(target)) continue
    if (isAsyncBoundaryComponentType(target.type)) continue
    const key = `${caller.id}::${target.type}`
    let group = groups.get(key)
    if (!group) {
      group = { callerId: caller.id, edgeIds: [], targetIds: new Set() }
      groups.set(key, group)
    }
    group.edgeIds.push(edge.id)
    group.targetIds.add(target.id)
  }
  for (const [key, group] of groups) {
    if (group.targetIds.size < 2) continue
    const caller = nodeById.get(group.callerId)!
    const targetIds = [...group.targetIds].sort()
    const names = targetIds.map((id) => label(nodeById.get(id), id))
    warnings.push({
      id: `missing-load-balancer:${key}`,
      rule: 'missing-load-balancer',
      title: 'Replicas without a load balancer',
      severity: 'warning',
      message:
        `${label(caller, caller.id)} spreads traffic across ${targetIds.length} replicas (${names.join(', ')}) ` +
        `on its own, with no health checks. If one replica fails, its share of requests keeps being sent to it and fails.`,
      recommendation:
        'Put a load balancer in front of the replicas so failed instances are taken out of rotation.',
      nodeIds: [caller.id, ...targetIds],
      edgeIds: group.edgeIds
    })
  }
  return warnings
}

function cacheBeforeLoadBalancerRule(
  topology: TopologyJSON,
  nodeById: Map<string, ComponentNode>
): AntiPatternWarning[] {
  const warnings: AntiPatternWarning[] = []
  for (const edge of topology.edges) {
    const cache = nodeById.get(edge.source)
    const router = nodeById.get(edge.target)
    if (!cache || !router) continue
    if (!APPLICATION_CACHE_TYPES.has(cache.type) || !HEALTH_AWARE.has(router.type)) continue
    warnings.push({
      id: `cache-in-front-of-load-balancer:${edge.id}`,
      rule: 'cache-in-front-of-load-balancer',
      title: 'Cache in front of the load balancer',
      severity: 'warning',
      message:
        `${label(cache, cache.id)} forwards traffic to ${label(router, router.id)}. An application cache ` +
        `in front of the load balancer becomes an extra hop and a single choke point for every request, ` +
        `and the services behind the load balancer cannot use it for their own lookups.`,
      recommendation:
        'Place the cache behind the service tier (cache-aside: services check the cache, then the database). Use a CDN if you need caching at the edge.',
      nodeIds: [cache.id, router.id],
      edgeIds: [edge.id]
    })
  }
  return warnings
}

function queueWithoutConsumerRule(
  topology: TopologyJSON,
  nodeById: Map<string, ComponentNode>
): AntiPatternWarning[] {
  const reachable = reachableFromSources(topology)
  const hasOutgoing = new Set(topology.edges.map((edge) => edge.source))
  const incoming = new Map<string, string[]>()
  for (const edge of topology.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.id])
  }
  const warnings: AntiPatternWarning[] = []
  for (const node of topology.nodes) {
    if (!MESSAGING_TYPES.has(node.type)) continue
    if (!reachable.has(node.id) || hasOutgoing.has(node.id)) continue
    if (!incoming.has(node.id)) continue
    warnings.push({
      id: `queue-without-consumer:${node.id}`,
      rule: 'queue-without-consumer',
      title: 'Messages with no consumer',
      severity: 'warning',
      message:
        `Producers publish to ${label(nodeById.get(node.id), node.id)}, but nothing consumes from it. ` +
        `Those messages are accepted and then never processed, so the work silently never happens.`,
      recommendation: `Connect ${label(node, node.id)} to the worker(s) that should process its messages, or remove it.`,
      nodeIds: [node.id],
      edgeIds: incoming.get(node.id) ?? []
    })
  }
  return warnings
}

function excessiveRetriesRule(topology: TopologyJSON): AntiPatternWarning[] {
  const warnings: AntiPatternWarning[] = []
  for (const node of topology.nodes) {
    if (!RETRY_CAPABLE.has(node.type)) continue
    const attempts = node.resilience?.retry?.maxAttempts
    if (typeof attempts !== 'number' || !Number.isFinite(attempts)) continue
    if (attempts <= MAX_REASONABLE_RETRY_ATTEMPTS) continue
    warnings.push({
      id: `excessive-retries:${node.id}`,
      rule: 'excessive-retries',
      title: 'Excessive retries',
      severity: 'warning',
      message:
        `${label(node, node.id)} retries a failed call up to ${Math.round(attempts)} times. When a dependency ` +
        `is struggling, each failing request turns into ${Math.round(attempts)} requests, which keeps it down (a retry storm).`,
      recommendation: `Cap retries at ${MAX_REASONABLE_RETRY_ATTEMPTS} or fewer (2-3 is typical), with exponential backoff and jitter.`,
      nodeIds: [node.id],
      edgeIds: []
    })
  }
  return warnings
}

/**
 * Detect architectural anti-patterns in a topology. Pure and cheap: safe to run
 * on every canvas edit. Ordered critical first, then by rule, then by id.
 */
export function detectAntiPatterns(topology: TopologyJSON): AntiPatternWarning[] {
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]))
  const warnings = [
    ...spofRule(topology),
    ...slowSyncRule(topology, nodeById),
    ...sharedDatabaseRule(topology, nodeById),
    ...missingLoadBalancerRule(topology, nodeById),
    ...cacheBeforeLoadBalancerRule(topology, nodeById),
    ...queueWithoutConsumerRule(topology, nodeById),
    ...excessiveRetriesRule(topology)
  ]
  return warnings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
      a.id.localeCompare(b.id)
  )
}
