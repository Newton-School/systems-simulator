import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait } from './types'

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
