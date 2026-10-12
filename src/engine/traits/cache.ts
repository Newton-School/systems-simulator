import type { ComponentType } from '../core/types'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type {
  BeforeArrivalDecision,
  NodeBehaviourTrait,
  NodeCapabilityModule,
  TraitContext,
  TraitStateStore
} from './types'

export const CACHE_COMPONENT_TYPES = [
  'cdn',
  'in-memory-cache',
  'reverse-proxy'
] as const satisfies readonly ComponentType[]

function asProbability(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Per-node state key for the derived-LRU cache contents. */
const LRU_STATE_KEY = 'cache.lru'
/** Per-node map: request id of a miss in flight to the backing store → its key. */
const MISS_KEYS_STATE_KEY = 'cache.missKeys'
/** Per-node map: key → request id of the collapse leader currently fetching it. */
const IN_FLIGHT_STATE_KEY = 'cache.inFlight'

function stateMap<V>(state: TraitStateStore, key: string): Map<string, V> {
  let map = state.get<Map<string, V>>(key)
  if (!map) {
    map = new Map()
    state.set(key, map)
  }
  return map
}

/** Request collapsing (single-flight) is opt-in per cache node. */
export function requestCollapsingEnabled(config: Record<string, unknown> | undefined): boolean {
  return config?.['requestCollapsing'] === true
}

/**
 * Shared miss path for both hit/miss models. The miss is remembered so the key
 * can be filled into the LRU when the backing-store response returns (see
 * afterTerminal). With request collapsing on, a miss for a key that already has
 * a fetch in flight parks behind that leader instead of calling downstream.
 */
function missDecision(
  context: TraitContext,
  key: string | null,
  basePayload: Record<string, unknown>,
  extraCounters: Record<string, number> = {}
): BeforeArrivalDecision {
  const { node, request, state } = context
  if (request.metadata.__cacheOutcome === undefined) request.metadata.__cacheOutcome = 'miss'
  const collapsing = requestCollapsingEnabled(node.config)

  if (key === null || !state) {
    return {
      action: 'continue',
      payload: {
        ...basePayload,
        cacheOutcome: 'miss',
        ...(collapsing ? { collapse: 'no-key' } : {}),
        metricCounters: {
          ...extraCounters,
          ...(collapsing ? { cacheMisses: 1, collapseNoKey: 1 } : { cacheMisses: 1 })
        }
      }
    }
  }

  if (collapsing) {
    const inFlight = stateMap<string>(state, IN_FLIGHT_STATE_KEY)
    const leaderId = inFlight.get(key)
    if (leaderId !== undefined && leaderId !== request.id) {
      return {
        action: 'parked',
        leaderRequestId: leaderId,
        payload: {
          ...basePayload,
          cacheOutcome: 'miss',
          collapse: 'follower',
          collapseLeaderId: leaderId,
          metricCounters: { ...extraCounters, cacheMisses: 1, collapsedMisses: 1 }
        }
      }
    }
    const isRetryOfLeader = leaderId === request.id
    inFlight.set(key, request.id)
    stateMap<string>(state, MISS_KEYS_STATE_KEY).set(request.id, key)
    return {
      action: 'continue',
      payload: {
        ...basePayload,
        cacheOutcome: 'miss',
        collapse: 'leader',
        metricCounters: isRetryOfLeader
          ? { ...extraCounters, cacheMisses: 1 }
          : { ...extraCounters, cacheMisses: 1, collapseLeaders: 1 }
      }
    }
  }

  // Only the derived LRU needs to hear back about this miss (to fill the key).
  if (node.config?.['cacheModel'] === 'derived-lru') {
    stateMap<string>(state, MISS_KEYS_STATE_KEY).set(request.id, key)
  }
  return {
    action: 'continue',
    payload: {
      ...basePayload,
      cacheOutcome: 'miss',
      metricCounters: { ...extraCounters, cacheMisses: 1 }
    }
  }
}

function requestKey(context: TraitContext): string | null {
  const key = context.request.metadata.__key
  return typeof key === 'string' ? key : null
}

function admitToLru(cache: LruCacheState, key: string): void {
  cache.entries.delete(key)
  cache.entries.set(key, true)
  if (cache.entries.size > cache.capacity) {
    const lruKey = cache.entries.keys().next().value
    if (lruKey !== undefined) cache.entries.delete(lruKey)
  }
}

/** `FaultSpec.faultType` that empties a cache instead of failing the node. */
export const CACHE_FLUSH_FAULT_TYPE = 'cache-flush'

/** Declared-rate caches miss on every arrival for this long after a flush (no `durationMs`). */
export const DEFAULT_CACHE_FLUSH_REWARM_MS = 5_000

/** Per-node state key for scheduled cache flushes (chaos `cache-flush` faults). */
export const CACHE_FLUSH_STATE_KEY = 'cache.flushes'

/**
 * A scheduled loss of cache contents, in simulation microseconds.
 * - Derived-LRU caches drop every entry at `atUs` and re-warm from live traffic,
 *   so the miss burst and its decay are a measured consequence.
 * - Declared-rate caches hold no contents to lose, so the flush is approximated
 *   as "every arrival misses" from `atUs` until `untilUs`, then the declared rate
 *   returns at once (that model has no warming curve).
 */
export interface CacheFlushWindow {
  atUs: bigint
  untilUs: bigint
  /** Set once the derived-LRU contents have been cleared for this flush. */
  applied?: boolean
}

/** Register a flush on a cache node's trait state (called by the engine at setup). */
export function scheduleCacheFlush(
  state: { get<T>(key: string): T | undefined; set<T>(key: string, value: T): void },
  window: CacheFlushWindow
): void {
  const existing = state.get<CacheFlushWindow[]>(CACHE_FLUSH_STATE_KEY) ?? []
  state.set(
    CACHE_FLUSH_STATE_KEY,
    [...existing, { ...window, applied: false }].sort((a, b) =>
      a.atUs < b.atUs ? -1 : a.atUs > b.atUs ? 1 : 0
    )
  )
}

function flushesFor(state: { get<T>(key: string): T | undefined } | undefined): CacheFlushWindow[] {
  return state?.get<CacheFlushWindow[]>(CACHE_FLUSH_STATE_KEY) ?? []
}

interface LruCacheState {
  /** Fixed item capacity derived from RAM ÷ value size. */
  capacity: number
  /** Recency-ordered key set: JS Map iteration order is insertion order, so the
   *  first key is the least-recently-used and the last is most-recently-used. */
  entries: Map<string, true>
}

/**
 * Derives the cache's item capacity `C = RAM ÷ value size` from config, or `null`
 * when the inputs are absent (→ the node falls back to the declared hit-rate
 * model). Both `cacheRamMb` and `valueSizeBytes` must be positive.
 */
function deriveCapacityItems(config: Record<string, unknown> | undefined): number | null {
  const ramMb = asPositiveNumber(config?.['cacheRamMb'])
  const valueSizeBytes = asPositiveNumber(config?.['valueSizeBytes'])
  if (ramMb === null || valueSizeBytes === null) {
    return null
  }
  return Math.max(1, Math.floor((ramMb * 1_000_000) / valueSizeBytes))
}

function defaultCacheHitLatencyMs(type: ComponentType): number {
  switch (type) {
    case 'cdn':
      return 1
    case 'in-memory-cache':
      return 0.1
    case 'reverse-proxy':
      return 1
    default:
      return 1
  }
}

function defaultCacheHitRatePlaceholder(data: CanvasNodeDataV2): string {
  const configured = asProbability(data.sim?.cacheHitRate)
  const rate = configured ?? 0
  return `Default: ${rate.toFixed(2)} (${rate === 0 ? 'cache disabled when empty' : 'hit probability'})`
}

function defaultCacheHitLatencyPlaceholder(data: CanvasNodeDataV2): string {
  const configured = asPositiveNumber(data.sim?.cacheHitLatencyMs)
  const latency = configured ?? defaultCacheHitLatencyMs(data.componentType)
  return `Default cache-hit latency: ${latency.toFixed(1)}ms`
}

export const cacheTrait: NodeBehaviourTrait = {
  name: 'cache',
  beforeArrival: (context) => {
    const { node, request, random, state, clock } = context
    const flushes = flushesFor(state)
    const hitLatencyMs =
      asPositiveNumber(node.config?.['cacheHitLatencyMs']) ?? defaultCacheHitLatencyMs(node.type)

    // Derived-LRU model: hit rate is a *measured consequence* of capacity and the
    // request's access pattern, not a declared dial. Active only when the node
    // opts in, the capacity inputs resolve, the request carries a key, and a
    // per-node state store exists. Otherwise fall through to the declared model.
    if (node.config?.['cacheModel'] === 'derived-lru') {
      const capacity = deriveCapacityItems(node.config)
      const key = request.metadata.__key
      if (capacity !== null && typeof key === 'string' && state) {
        let cache = state.get<LruCacheState>(LRU_STATE_KEY)
        if (!cache || cache.capacity !== capacity) {
          cache = { capacity, entries: new Map() }
          state.set(LRU_STATE_KEY, cache)
        }
        // A due flush wipes the contents once; the cache then re-warms from traffic.
        for (const flush of flushes) {
          if (!flush.applied && clock >= flush.atUs) {
            flush.applied = true
            cache.entries.clear()
          }
        }

        if (cache.entries.has(key)) {
          // Hit: refresh recency (delete + re-insert moves it to the MRU end).
          cache.entries.delete(key)
          cache.entries.set(key, true)
          request.metadata.__cacheOutcome = 'hit'
          request.metadata.__cacheNodeId = node.id
          return {
            action: 'handled',
            latencyUs: BigInt(Math.round(hitLatencyMs * 1000)),
            payload: {
              cacheOutcome: 'hit',
              metricCounters: { cacheHits: 1 },
              cacheModel: 'derived-lru',
              cacheCapacityItems: capacity,
              cacheHitLatencyMs: hitLatencyMs,
              servedFromCache: true
            }
          }
        }

        // Miss: the key is filled when the backing-store response returns
        // (afterTerminal), not now - so concurrent misses for the same key during
        // that in-flight window also miss (the stampede request collapsing fixes).
        return missDecision(context, key, {
          cacheModel: 'derived-lru',
          cacheCapacityItems: capacity,
          cacheHitLatencyMs: hitLatencyMs
        })
      }
      // Opted into derived-lru but inputs incomplete → fall through to declared.
    }

    const hitRate = asProbability(node.config?.['cacheHitRate']) ?? 0
    const flushedNow = flushes.some((flush) => clock >= flush.atUs && clock < flush.untilUs)

    if (hitRate > 0 && flushedNow) {
      // A flushed declared-rate cache misses every arrival; with collapsing on,
      // concurrent misses for one key still share a single fetch.
      return missDecision(
        context,
        requestKey(context),
        { hitRate, cacheFlushed: true, cacheHitLatencyMs: hitLatencyMs },
        { cacheFlushMisses: 1 }
      )
    }

    if (hitRate <= 0) {
      return missDecision(context, requestKey(context), {
        hitRate,
        cacheHitLatencyMs: hitLatencyMs
      })
    }

    const normalized = random?.() ?? 1

    if (normalized < hitRate) {
      request.metadata.__cacheOutcome = 'hit'
      request.metadata.__cacheNodeId = node.id
      return {
        action: 'handled',
        latencyUs: BigInt(Math.round(hitLatencyMs * 1000)),
        payload: {
          cacheOutcome: 'hit',
          metricCounters: { cacheHits: 1 },
          hitRate,
          cacheHitLatencyMs: hitLatencyMs,
          servedFromCache: true
        }
      }
    }

    return missDecision(context, requestKey(context), { hitRate, cacheHitLatencyMs: hitLatencyMs })
  },
  afterTerminal: ({ node, request, state, status }) => {
    if (!state) return
    const missKeys = state.get<Map<string, string>>(MISS_KEYS_STATE_KEY)
    const key = missKeys?.get(request.id)
    if (!missKeys || key === undefined) return
    missKeys.delete(request.id)

    // The fetch for this key is over: release collapse leadership so the next
    // miss for the key (if any) becomes a new leader.
    const inFlight = state.get<Map<string, string>>(IN_FLIGHT_STATE_KEY)
    if (inFlight?.get(key) === request.id) inFlight.delete(key)

    // Fill on response: only a miss that actually got its value back populates
    // the derived LRU. A failed or timed-out fetch leaves the key uncached.
    if (status !== 'success' || node.config?.['cacheModel'] !== 'derived-lru') return
    const cache = state.get<LruCacheState>(LRU_STATE_KEY)
    if (cache) admitToLru(cache, key)
  }
}

export const cacheCapabilityModule: NodeCapabilityModule = {
  name: 'cache',
  appliesTo: CACHE_COMPONENT_TYPES,
  hooks: cacheTrait,
  config: {
    sections: [
      {
        id: 'caching',
        title: 'Caching',
        note: (data) =>
          'Two hit/miss models. "Declared rate" uses the hit rate you set directly. "Derived (LRU)" simulates a real bounded cache of C = RAM ÷ value size items keyed on the request\'s entity key - hit rate then emerges from the workload\'s access pattern (set keyspace.skew on the source) plus capacity, including cold-start warming and LRU eviction. A miss fills its key only when the backing-store response returns, so a cold hot key under load misses repeatedly until the first fetch lands (a thundering herd). TTL remains topology intent only.' +
          (data.sim?.requestCollapsing === true
            ? ' Request collapsing is on: concurrent misses for the same key wait for one fetch. It only groups requests that carry a key (source keyspace); keyless requests pass through uncollapsed.'
            : ''),
        fields: [
          {
            path: 'sim.cacheModel',
            type: 'select',
            label: 'Hit/miss model',
            options: ['declared-rate', 'derived-lru'],
            why: 'Declared rate consumes the hit rate you type. Derived (LRU) measures hit rate from a real bounded cache (RAM ÷ value size items) against the request key stream - capacity and access skew then actually matter.'
          },
          {
            path: 'sim.cacheRamMb',
            type: 'input',
            label: 'Cache memory',
            step: 1,
            unit: 'MB',
            visible: (data) => data.sim?.cacheModel === 'derived-lru',
            placeholder: 'Required for derived model',
            why: 'Total cache memory. With value size, sets item capacity C = RAM ÷ value size - the number of distinct keys the cache can hold before evicting.'
          },
          {
            path: 'sim.valueSizeBytes',
            type: 'input',
            label: 'Mean value size',
            step: 1,
            unit: 'bytes',
            visible: (data) => data.sim?.cacheModel === 'derived-lru',
            placeholder: 'Required for derived model',
            why: 'Average bytes per cached entry. Larger values fit fewer items in the same RAM, lowering the hit rate for a given working set.'
          },
          {
            path: 'sim.requestCollapsing',
            type: 'boolean',
            label: 'Request collapsing',
            defaultValue: false,
            why: 'Single-flight for misses: while a miss for key K is fetching from the backing store, later misses for K wait at the cache for that one result instead of each calling downstream. N simultaneous misses become one downstream call. It does not raise the hit rate - it removes duplicate miss traffic. Needs request keys: set a keyspace on the source request mix; requests without a key have nothing to group and are not collapsed.'
          },
          {
            path: 'sim.cacheEngine',
            type: 'select',
            label: 'Cache engine',
            options: ['redis', 'memcached'],
            visible: (data) => data.componentType === 'in-memory-cache',
            why: 'Redis supports richer data structures and replication; Memcached trades those features for simpler client-side horizontal scaling.'
          },
          {
            path: 'sim.cacheStrategy',
            type: 'select',
            label: 'Cache strategy',
            options: ['cache-aside', 'read-through', 'write-through', 'write-behind'],
            visible: (data) => data.componentType === 'in-memory-cache',
            altitude: 'advanced',
            accuracy: 'not-simulated',
            why: 'Documents the consistency and write-path strategy. Hit/miss behavior is modeled independently.'
          },
          {
            path: 'sim.provider',
            type: 'input',
            inputType: 'text',
            label: 'Provider',
            placeholder: 'e.g. Cloudflare, CloudFront, Fastly',
            visible: (data) => data.componentType === 'cdn',
            accuracy: 'not-simulated',
            why: 'Labels the generic CDN with a vendor without changing its cache behavior.'
          },
          {
            path: 'sim.cacheHitRate',
            type: 'input',
            label: 'Cache hit rate',
            step: 0.01,
            unit: 'ratio',
            visible: (data) => data.sim?.cacheModel !== 'derived-lru',
            placeholder: defaultCacheHitRatePlaceholder,
            why: 'Declared model only. Controls how much traffic this node serves locally instead of forwarding - e.g. 0.9 serves 90% from cache. Leave empty to disable cache hits. Ignored when the derived (LRU) model is selected.'
          },
          {
            path: 'sim.cacheHitLatencyMs',
            type: 'input',
            label: 'Cache hit latency',
            step: 0.1,
            unit: 'ms',
            placeholder: defaultCacheHitLatencyPlaceholder,
            why: 'Sets the latency cost of a cache hit. Leave empty to use the component default.'
          },
          {
            path: 'sim.ttlSeconds',
            type: 'input',
            label: 'TTL',
            step: 1,
            unit: 's',
            placeholder: 'Not simulated when empty',
            accuracy: 'not-simulated',
            why: 'Documents cache expiry intent. The current simulator does not use TTL to change hit or miss behavior.'
          }
        ]
      }
    ]
  },
  defaults: (componentType) => {
    if (componentType === 'cdn') {
      return [
        {
          path: 'sim.cacheHitRate',
          value: 0.9,
          rationale: 'CDNs are primarily edge caches, so most requests should hit.'
        },
        {
          path: 'sim.cacheHitLatencyMs',
          value: 1,
          rationale: 'Edge cache hits should be much faster than origin fetches.'
        }
      ]
    }

    if (componentType === 'in-memory-cache') {
      return [
        {
          path: 'sim.cacheHitRate',
          value: 0.8,
          rationale: 'A warm in-memory cache should absorb most repeat reads.'
        },
        {
          path: 'sim.cacheHitLatencyMs',
          value: 0.1,
          rationale: 'In-memory hits should be near-immediate relative to a backing store.'
        }
      ]
    }

    if (componentType === 'reverse-proxy') {
      return [
        {
          path: 'sim.cacheHitRate',
          value: 0,
          rationale: 'Reverse-proxy caching is optional, so it starts effectively off.'
        },
        {
          path: 'sim.cacheHitLatencyMs',
          value: 1,
          rationale: 'When enabled, proxy cache hits should still be much cheaper than origin work.'
        }
      ]
    }

    return []
  },
  metrics: {
    counters: [
      'cacheHits',
      'cacheMisses',
      'collapseLeaders',
      'collapsedMisses',
      'collapsedFollowersServed',
      'collapsedFollowersFailed',
      'collapseNoKey'
    ]
  },
  honesty: {
    simulates: [
      'hit/miss decisions and faster hit latency',
      'derived (LRU) model: real bounded cache of RAM ÷ value-size items keyed on the request entity - measured hit rate, cold-start warming, and LRU eviction',
      'derived (LRU) model: fill on response - a miss populates its key only when the backing-store fetch succeeds, so concurrent misses for a cold hot key all miss (thundering herd)',
      'request collapsing (opt-in): concurrent misses for the same request key park at the cache behind one in-flight leader fetch, holding no worker or queue slot and making no downstream call; on leader success each follower completes at that moment (latency includes its wait), on leader failure each follower fails with the same cause (a leader timeout surfaces as collapsed_leader_timeout); a follower whose own deadline passes first times out on its own'
    ],
    notModeled: [
      'declared model: eviction pressure, origin shield behavior, stale reads',
      'derived model: TTL expiry, sharding/consistent hashing across cache nodes, per-key value-size variation',
      'request collapsing: requests without a key (no source keyspace) are never collapsed; no cap on waiters per key and no lock timeout that lets waiters fall through to the origin (e.g. nginx proxy_cache_lock_timeout); stale-while-revalidate and probabilistic early refresh; collapsing across separate cache nodes; the analytic (fluid) evaluation tier ignores per-request cache behaviour, so collapsing only applies in discrete-event runs'
    ]
  }
}
