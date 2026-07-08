import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait } from './types'

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
