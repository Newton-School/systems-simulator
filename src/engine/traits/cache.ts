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
  beforeArrival: ({ node, random }) => {
    const hitRate = asProbability(node.config?.['cacheHitRate']) ?? 0
    const hitLatencyMs =
      asPositiveNumber(node.config?.['cacheHitLatencyMs']) ?? defaultCacheHitLatencyMs(node.type)

    if (hitRate <= 0) {
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
        note: 'Empty cache hit rate means this node behaves as a pass-through cache. Cache hit latency only applies to hits. TTL is shown for topology intent, but the current simulator does not model expiry over time.',
        fields: [
          {
            path: 'sim.cacheHitRate',
            type: 'input',
            label: 'Cache hit rate',
            step: 0.01,
            unit: 'ratio',
            placeholder: defaultCacheHitRatePlaceholder,
            why: 'Controls how much traffic this node serves locally instead of forwarding. Leave empty to disable cache hits.'
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
    simulates: ['hit/miss decisions and faster hit latency'],
    notModeled: ['eviction pressure, origin shield behavior, stale reads']
  }
}
