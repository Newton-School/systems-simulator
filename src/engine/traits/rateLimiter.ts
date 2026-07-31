import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const RATE_LIMITER_COMPONENT_TYPES = [
  'api-gateway',
  'third-party-api-connector'
] as const satisfies readonly ComponentType[]

interface TokenBucketState {
  tokens: number
  lastRefillUs: bigint
}

const STATE_KEY = 'rateLimiter.bucket'
const US_PER_SECOND = 1_000_000

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export const rateLimiterTrait: NodeBehaviourTrait = {
  name: 'rate-limiter',
  beforeArrival: ({ node, clock, state }) => {
    const maxTokens = asPositiveNumber(node.config?.['maxTokens'])
    const refillRatePerSecond = asNonNegativeNumber(node.config?.['refillRatePerSecond'])

    if (maxTokens === null || refillRatePerSecond === null) {
      return { action: 'continue' }
    }

    const previous = state?.get<TokenBucketState>(STATE_KEY) ?? {
      tokens: maxTokens,
      lastRefillUs: clock
    }

    const elapsedSeconds = Number(clock - previous.lastRefillUs) / US_PER_SECOND
    const available = Math.min(
      maxTokens,
      previous.tokens + Math.max(0, elapsedSeconds) * refillRatePerSecond
    )

    if (available < 1) {
      state?.set(STATE_KEY, { tokens: available, lastRefillUs: clock })
      return {
        action: 'rejected',
        reason: 'rate_limited',
        payload: { tokensAvailable: available, maxTokens, refillRatePerSecond }
      }
    }

    state?.set(STATE_KEY, { tokens: available - 1, lastRefillUs: clock })
    return {
      action: 'continue',
      payload: { tokensAvailable: available - 1, maxTokens, refillRatePerSecond }
    }
  }
}

export const rateLimiterCapabilityModule: NodeCapabilityModule = {
  name: 'rate-limiter',
  appliesTo: RATE_LIMITER_COMPONENT_TYPES,
  hooks: rateLimiterTrait,
  config: {
    sections: [
      {
        id: 'rate-limiting',
        title: 'Rate Limiting',
        fields: [
          {
            path: 'sim.maxTokens',
            type: 'input',
            label: 'Bucket size',
            step: 1,
            unit: 'tokens',
            why: 'Sets the burst size this node allows before it starts rejecting requests.'
          },
          {
            path: 'sim.refillRatePerSecond',
            type: 'input',
            label: 'Refill rate',
            step: 1,
            unit: 'tokens/s',
            why: 'Sets the steady-state request rate the bucket replenishes.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    rejectionReasons: ['rate_limited']
  },
  honesty: {
    simulates: ['token-bucket admission control'],
    notModeled: ['per-tenant quotas, distributed bucket coordination']
  }
}
