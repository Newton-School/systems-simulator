import type { ComponentType } from '../core/types'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

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
  beforeArrival: ({ node, request, random, state }) => {
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

        // Miss: admit the key, evicting the least-recently-used entry if full.
        cache.entries.set(key, true)
        if (cache.entries.size > capacity) {
          const lruKey = cache.entries.keys().next().value
          if (lruKey !== undefined) cache.entries.delete(lruKey)
        }
        if (request.metadata.__cacheOutcome === undefined) request.metadata.__cacheOutcome = 'miss'
        return {
          action: 'continue',
          payload: {
            cacheOutcome: 'miss',
            metricCounters: { cacheMisses: 1 },
            cacheModel: 'derived-lru',
            cacheCapacityItems: capacity,
            cacheHitLatencyMs: hitLatencyMs
          }
        }
      }
      // Opted into derived-lru but inputs incomplete → fall through to declared.
    }

    const hitRate = asProbability(node.config?.['cacheHitRate']) ?? 0

    if (hitRate <= 0) {
      if (request.metadata.__cacheOutcome === undefined) request.metadata.__cacheOutcome = 'miss'
      return {
        action: 'continue',
        payload: {
          cacheOutcome: 'miss',
          metricCounters: { cacheMisses: 1 },
          hitRate,
          cacheHitLatencyMs: hitLatencyMs
        }
      }
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

    if (request.metadata.__cacheOutcome === undefined) request.metadata.__cacheOutcome = 'miss'
    return {
      action: 'continue',
      payload: {
        cacheOutcome: 'miss',
        metricCounters: { cacheMisses: 1 },
        hitRate,
        cacheHitLatencyMs: hitLatencyMs
      }
    }
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
        note: 'Two hit/miss models. "Declared rate" uses the hit rate you set directly. "Derived (LRU)" simulates a real bounded cache of C = RAM ÷ value size items keyed on the request\'s entity key — hit rate then emerges from the workload\'s access pattern (set keyspace.skew on the source) plus capacity, including cold-start warming and LRU eviction. TTL remains topology intent only.',
        fields: [
          {
            path: 'sim.cacheModel',
            type: 'select',
            label: 'Hit/miss model',
            options: ['declared-rate', 'derived-lru'],
            why: 'Declared rate consumes the hit rate you type. Derived (LRU) measures hit rate from a real bounded cache (RAM ÷ value size items) against the request key stream — capacity and access skew then actually matter.'
          },
          {
            path: 'sim.cacheRamMb',
            type: 'input',
            label: 'Cache memory',
            step: 1,
            unit: 'MB',
            visible: (data) => data.sim?.cacheModel === 'derived-lru',
            placeholder: 'Required for derived model',
            why: 'Total cache memory. With value size, sets item capacity C = RAM ÷ value size — the number of distinct keys the cache can hold before evicting.'
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
            why: 'Declared model only. Controls how much traffic this node serves locally instead of forwarding — e.g. 0.9 serves 90% from cache. Leave empty to disable cache hits. Ignored when the derived (LRU) model is selected.'
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
    counters: ['cacheHits', 'cacheMisses']
  },
  honesty: {
    simulates: [
      'hit/miss decisions and faster hit latency',
      'derived (LRU) model: real bounded cache of RAM ÷ value-size items keyed on the request entity — measured hit rate, cold-start warming, and LRU eviction'
    ],
    notModeled: [
      'declared model: eviction pressure, origin shield behavior, stale reads',
      'derived model: TTL expiry, sharding/consistent hashing across cache nodes, per-key value-size variation'
    ]
  }
}
