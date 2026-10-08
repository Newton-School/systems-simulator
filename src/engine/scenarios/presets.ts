/**
 * Built-in chaos experiment presets (#66): cache stampede, database failover and
 * traffic spike. Each is a function from a topology (plus optional overrides) to
 * a ready-to-run {@link ChaosExperimentDefinition}. Targets are picked from the
 * topology when not given; when the topology lacks what a preset needs, it
 * throws {@link PresetUnavailableError} with a plain explanation.
 *
 * Every preset carries `notes` stating what the engine does and does not model
 * for that experiment, so a pass or fail is never read as more than it is.
 */

import type { ComponentNode, TopologyJSON } from '../core/types'
import { DATABASE_TYPES } from '../defaults/edgeDefaults'
import { CACHE_COMPONENT_TYPES } from '../traits/cache'
import { HEALTH_AWARE_COMPONENT_TYPES } from '../traits/healthAwareRouting'
import type { ChaosExperimentDefinition, ExperimentAssertion } from './types'

export class PresetUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresetUnavailableError'
  }
}

export type ChaosPresetId = 'cache-stampede' | 'db-failover' | 'traffic-spike'

/** Thresholds shared by all presets; defaults are typical web-service SLOs. */
export interface SteadyStateOptions {
  /** Steady-state error-rate ceiling, as a fraction. Default 0.01 (1%). */
  maxErrorRate?: number
  /** Steady-state p99 ceiling in ms. Default 500. */
  maxP99Ms?: number
}

const CACHE_TYPES = new Set<string>(CACHE_COMPONENT_TYPES)
const HEALTH_AWARE = new Set<string>(HEALTH_AWARE_COMPONENT_TYPES)

function isDatabase(node: ComponentNode): boolean {
  return DATABASE_TYPES.has(node.type)
}

function steadyState(options: SteadyStateOptions): ExperimentAssertion[] {
  return [
    { metric: 'error_rate', operator: '<', value: options.maxErrorRate ?? 0.01 },
    { metric: 'latency_p99', operator: '<', value: options.maxP99Ms ?? 500 }
  ]
}

function labelOf(topology: TopologyJSON, id: string): string {
  return topology.nodes.find((node) => node.id === id)?.label ?? id
}

function downstreamOf(topology: TopologyJSON, id: string): string[] {
  return topology.edges.filter((edge) => edge.source === id).map((edge) => edge.target)
}

function upstreamOf(topology: TopologyJSON, id: string): string[] {
  return topology.edges.filter((edge) => edge.target === id).map((edge) => edge.source)
}

function requireNode(topology: TopologyJSON, id: string, what: string): ComponentNode {
  const node = topology.nodes.find((candidate) => candidate.id === id)
  if (!node) throw new PresetUnavailableError(`The ${what} "${id}" is not in this topology.`)
  return node
}

// ─── Cache stampede ──────────────────────────────────────────────────────────

type CacheHitModel = 'declared-rate' | 'derived-lru' | 'none'

function cacheHitModel(node: ComponentNode): CacheHitModel {
  const config = node.config ?? {}
  if (
    config['cacheModel'] === 'derived-lru' &&
    Number(config['cacheRamMb']) > 0 &&
    Number(config['valueSizeBytes']) > 0
  ) {
    return 'derived-lru'
  }
  const rate = config['cacheHitRate']
  return typeof rate === 'number' && rate > 0 ? 'declared-rate' : 'none'
}

/** Cache nodes that actually serve hits (a hit model is on) and have an origin behind them. */
export function cacheStampedeCandidates(topology: TopologyJSON): ComponentNode[] {
  return topology.nodes.filter(
    (node) =>
      CACHE_TYPES.has(node.type) &&
      cacheHitModel(node) !== 'none' &&
      downstreamOf(topology, node.id).length > 0
  )
}

export interface CacheStampedeOptions extends SteadyStateOptions {
  cacheNodeId?: string
  originNodeId?: string
  /** Declared-rate caches: how long every request misses after the flush. Default 5000. */
  coldForMs?: number
}

export function createCacheStampedeExperiment(
  topology: TopologyJSON,
  options: CacheStampedeOptions = {}
): ChaosExperimentDefinition {
  const cache = options.cacheNodeId
    ? requireNode(topology, options.cacheNodeId, 'cache')
    : cacheStampedeCandidates(topology)[0]
  if (!cache) {
    const anyCache = topology.nodes.find((node) => CACHE_TYPES.has(node.type))
    throw new PresetUnavailableError(
      anyCache
        ? `${anyCache.label} has no hit/miss model turned on, so there are no cached hits to lose. Set its cache hit rate, or switch it to Derived (LRU). A cache-aside split made with typed READ_HIT / READ_MISS requests is fixed by the request mix, so flushing it changes nothing.`
        : 'A cache stampede needs a cache component (in-memory cache, CDN or reverse proxy) with an origin behind it.'
    )
  }
  const model = cacheHitModel(cache)
  if (model === 'none') {
    throw new PresetUnavailableError(
      `${cache.label} has no hit/miss model turned on, so there are no cached hits to lose.`
    )
  }
  const downstream = downstreamOf(topology, cache.id)
  const originId =
    options.originNodeId ??
    downstream.find((id) => {
      const node = topology.nodes.find((candidate) => candidate.id === id)
      return node ? isDatabase(node) : false
    }) ??
    downstream[0]
  if (!originId) {
    throw new PresetUnavailableError(
      `${cache.label} has nothing behind it, so its misses have no origin to stampede.`
    )
  }
  requireNode(topology, originId, 'origin')
  const coldForMs = options.coldForMs ?? 5_000
  const originLoad: ExperimentAssertion = {
    metric: 'throughput',
    nodeId: originId,
    label: `Load on ${labelOf(topology, originId)}`
  }

  return {
    id: 'cache-stampede',
    name: 'Cache stampede',
    description: `Empty ${cache.label} and check that ${labelOf(topology, originId)} can absorb the misses while it re-warms.`,
    warmupMs: 2_000,
    baselineMs: 5_000,
    steadyState: [...steadyState(options), originLoad],
    steps: [
      {
        type: 'inject',
        fault: { targetId: cache.id, kind: 'cache-flush', durationMs: coldForMs },
        label: `Flush ${cache.label}`
      },
      { type: 'wait', durationMs: 5_000, label: 'Let the misses reach the origin' },
      {
        type: 'verify',
        label: 'Origin absorbs the stampede',
        assertions: [
          { metric: 'error_rate', operator: '<', value: 0.1 },
          {
            metric: 'error_rate',
            operator: '<',
            value: 0.1,
            nodeId: originId
          },
          originLoad
        ]
      },
      { type: 'wait', durationMs: 5_000, label: 'Let the cache re-warm' }
    ],
    finalCheckMs: 5_000,
    notes: [
      'A stampede here is a cold cache: the engine has no request coalescing (single-flight), so every miss goes to the origin on its own, as it would in a real stampede without coalescing.',
      model === 'derived-lru'
        ? `${cache.label} uses the Derived (LRU) model: its contents are wiped at the flush and re-warm from live traffic, so the miss burst and its decay are measured.`
        : `${cache.label} uses a declared hit rate, which has no contents to lose. The flush is approximated as every request missing for ${coldForMs / 1000}s, then the declared rate returns at once (no warming curve). Switch it to Derived (LRU) for a measured re-warm.`,
      `Origin load is reported as successful completions per second at ${labelOf(topology, originId)}; queue depth is not checked because the run does not keep it per time window.`
    ]
  }
}

// ─── Database failover ───────────────────────────────────────────────────────

function replicationRole(node: ComponentNode): string | undefined {
  const role = node.config?.['replicationRole']
  return typeof role === 'string' ? role : undefined
}

export interface DbFailoverOptions extends SteadyStateOptions {
  primaryNodeId?: string
  replicaNodeId?: string
}

export function dbFailoverCandidates(topology: TopologyJSON): {
  primaries: ComponentNode[]
  replicas: ComponentNode[]
} {
  const databases = topology.nodes.filter(isDatabase)
  const primaries = [
    ...databases.filter((node) => replicationRole(node) === 'primary'),
    ...databases.filter((node) => replicationRole(node) !== 'primary')
  ]
  const replicas = [
    ...databases.filter((node) => ['replica', 'follower'].includes(replicationRole(node) ?? '')),
    ...databases.filter((node) => !['replica', 'follower'].includes(replicationRole(node) ?? ''))
  ]
  return { primaries, replicas }
}

export function createDbFailoverExperiment(
  topology: TopologyJSON,
  options: DbFailoverOptions = {}
): ChaosExperimentDefinition {
  const databases = topology.nodes.filter(isDatabase)
  const { primaries, replicas } = dbFailoverCandidates(topology)
  const primary = options.primaryNodeId
    ? requireNode(topology, options.primaryNodeId, 'primary database')
    : primaries[0]
  if (!primary) {
    throw new PresetUnavailableError(
      'A database failover needs a primary database to fail. This topology has no database component.'
    )
  }
  const replica = options.replicaNodeId
    ? requireNode(topology, options.replicaNodeId, 'replica database')
    : replicas.find((node) => node.id !== primary.id)
  if (!replica || replica.id === primary.id) {
    throw new PresetUnavailableError(
      `A database failover needs a replica to take over from ${primary.label}. This topology has ${databases.length} database component${databases.length === 1 ? '' : 's'} - add a second one as the replica.`
    )
  }

  const notes = [
    'The engine has no replica-promotion action. Failover here means whatever routes to the primary stops sending to it and the replica absorbs its traffic. Load balancers in the engine see a failed node at once; there is no detection delay unless a health-check manager is configured.',
    'Replica behaviour (read-only writes, replication lag) applies only where it is configured on the replica.'
  ]
  const sharedRouters = upstreamOf(topology, primary.id).filter((id) =>
    upstreamOf(topology, replica.id).includes(id)
  )
  const healthAware = sharedRouters.filter((id) =>
    HEALTH_AWARE.has(topology.nodes.find((node) => node.id === id)?.type ?? '')
  )
  if (sharedRouters.length === 0) {
    notes.unshift(
      `Nothing routes to both ${primary.label} and ${replica.label}, so traffic for the primary has no other path - expect the during-failure check to fail.`
    )
  } else if (healthAware.length === 0) {
    notes.unshift(
      `${labelOf(topology, sharedRouters[0])} routes to both databases but is not a health-aware router (load balancer, gateway, ingress or reverse proxy), so it keeps sending part of the traffic to the failed primary.`
    )
  }

  return {
    id: 'db-failover',
    name: 'Database failover',
    description: `Crash ${primary.label} and check that ${replica.label} keeps requests succeeding.`,
    warmupMs: 2_000,
    baselineMs: 5_000,
    steadyState: steadyState(options),
    steps: [
      {
        type: 'inject',
        fault: { targetId: primary.id, mode: 'blackhole' },
        label: `Crash ${primary.label}`
      },
      { type: 'wait', durationMs: 3_000, label: 'Let in-flight requests resolve' },
      { type: 'wait', durationMs: 10_000, label: 'Run on the replica' },
      {
        type: 'verify',
        label: 'Requests keep succeeding on the replica',
        windowMs: 10_000,
        assertions: [
          { metric: 'error_rate', operator: '<', value: 0.05 },
          { metric: 'throughput', operator: '>', value: 0, label: 'Requests are being served' },
          {
            metric: 'throughput',
            nodeId: replica.id,
            label: `Load on ${replica.label}`
          }
        ]
      },
      { type: 'restore', targetId: primary.id, label: `Bring ${primary.label} back` }
    ],
    finalCheckMs: 5_000,
    notes
  }
}

// ─── Traffic spike ───────────────────────────────────────────────────────────

export interface TrafficSpikeOptions extends SteadyStateOptions {
  /** Multiple of the base RPS during the spike. Default 10. */
  multiplier?: number
  /** Spike length in whole seconds. Default 10. */
  spikeSeconds?: number
}

export function createTrafficSpikeExperiment(
  topology: TopologyJSON,
  options: TrafficSpikeOptions = {}
): ChaosExperimentDefinition {
  const workload = topology.workload
  if (!workload) {
    throw new PresetUnavailableError('A traffic spike needs a traffic source with a workload.')
  }
  if (!['constant', 'poisson', 'spike'].includes(workload.pattern)) {
    throw new PresetUnavailableError(
      `A traffic spike needs a steady base workload. The source uses the ${workload.pattern} pattern - switch it to constant or Poisson.`
    )
  }
  const multiplier = options.multiplier ?? 10
  if (!(multiplier > 1)) {
    throw new PresetUnavailableError('The spike multiplier must be greater than 1.')
  }
  const spikeMs = Math.max(1, Math.round(options.spikeSeconds ?? 10)) * 1_000
  const autoscaled = topology.nodes.filter(
    (node) => Number(node.config?.['autoscaleMaxInstances']) > 0
  )

  return {
    id: 'traffic-spike',
    name: 'Traffic spike',
    description: `Send ${multiplier}x the base traffic (${Math.round(workload.baseRps * multiplier)} req/s) for ${spikeMs / 1000}s and check the system degrades gracefully and recovers.`,
    warmupMs: 2_000,
    baselineMs: 5_000,
    steadyState: steadyState(options),
    steps: [
      { type: 'traffic', multiplier, durationMs: spikeMs, label: `Traffic x${multiplier}` },
      { type: 'wait', durationMs: spikeMs, label: 'Ride out the spike' },
      {
        type: 'verify',
        label: 'Degrades gracefully during the spike',
        assertions: [{ metric: 'error_rate', operator: '<', value: 0.1 }, { metric: 'throughput' }]
      },
      { type: 'wait', durationMs: 10_000, label: 'Let queues drain' }
    ],
    finalCheckMs: 5_000,
    notes: [
      autoscaled.length > 0
        ? `Autoscaling is on for ${autoscaled.map((node) => node.label).join(', ')}; it reacts once per cooldown, so capacity lags the spike.`
        : 'No component has autoscaling turned on, so capacity stays fixed through the spike.',
      'The spike is a step change in arrival rate; the engine does not model clients backing off on their own.'
    ]
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

export interface ChaosPresetDescriptor {
  id: ChaosPresetId
  name: string
  summary: string
  build: (topology: TopologyJSON, options?: Record<string, unknown>) => ChaosExperimentDefinition
}

export const CHAOS_PRESETS: readonly ChaosPresetDescriptor[] = [
  {
    id: 'cache-stampede',
    name: 'Cache stampede',
    summary: 'Empty a cache and check its origin absorbs the misses.',
    build: (topology, options) =>
      createCacheStampedeExperiment(topology, (options ?? {}) as CacheStampedeOptions)
  },
  {
    id: 'db-failover',
    name: 'Database failover',
    summary: 'Crash the primary database and check the replica keeps requests succeeding.',
    build: (topology, options) =>
      createDbFailoverExperiment(topology, (options ?? {}) as DbFailoverOptions)
  },
  {
    id: 'traffic-spike',
    name: 'Traffic spike',
    summary: 'Multiply incoming traffic and check the system degrades gracefully and recovers.',
    build: (topology, options) =>
      createTrafficSpikeExperiment(topology, (options ?? {}) as TrafficSpikeOptions)
  }
]

export function getChaosPreset(id: string): ChaosPresetDescriptor | undefined {
  return CHAOS_PRESETS.find((preset) => preset.id === id)
}

/** Build a preset, or explain why it does not apply to this topology. */
export function tryBuildPreset(
  topology: TopologyJSON,
  id: string,
  options?: Record<string, unknown>
): { ok: true; definition: ChaosExperimentDefinition } | { ok: false; reason: string } {
  const preset = getChaosPreset(id)
  if (!preset) return { ok: false, reason: `Unknown experiment preset "${id}".` }
  try {
    return { ok: true, definition: preset.build(topology, options) }
  } catch (error) {
    if (error instanceof PresetUnavailableError) return { ok: false, reason: error.message }
    throw error
  }
}
