import type { ComponentNode, ComponentType } from '../core/types'
import type { NodeCapabilityModule } from './types'

export interface RetryBackoffConfig {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  multiplier: number
  jitter: boolean
}

export const DEFAULT_RETRY_BASE_DELAY_MS = 100
export const DEFAULT_RETRY_MAX_DELAY_MS = 5_000
export const DEFAULT_RETRY_MULTIPLIER = 2

export const RETRY_BACKOFF_COMPONENT_TYPES = [
  'microservice',
  'serverless-function',
  'batch-worker',
  'service-mesh',
  'sidecar',
  'auth-service',
  'search-service',
  'task-queue',
  'payment-gateway',
  'webhook-gateway',
  'third-party-api-connector',
  'agent-orchestrator',
  'llm-gateway'
] as const satisfies readonly ComponentType[]

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function readRetryBackoffConfig(
  node: Pick<ComponentNode, 'resilience'>
): RetryBackoffConfig | null {
  const configured = node.resilience?.retry
  const maxAttempts = asPositiveInt(configured?.maxAttempts)
  if (maxAttempts === null) {
    return null
  }

  const baseDelayMs = asPositiveNumber(configured?.baseDelay) ?? DEFAULT_RETRY_BASE_DELAY_MS
  const maxDelayMs = Math.max(
    baseDelayMs,
    asPositiveNumber(configured?.maxDelay) ?? DEFAULT_RETRY_MAX_DELAY_MS
  )
  const multiplier = asPositiveNumber(configured?.multiplier) ?? DEFAULT_RETRY_MULTIPLIER

  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    multiplier,
    jitter: configured?.jitter === true
  }
}

/**
 * `retryOrdinal` is zero-based: 0 = first retry after the original attempt
 * failed, 1 = second retry, etc.
 */
export function computeRetryDelayMs(
  retryOrdinal: number,
  config: RetryBackoffConfig,
  random: () => number
): number {
  const exponent = Math.max(0, retryOrdinal)
  const cappedDelay = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * config.multiplier ** exponent
  )

  if (!config.jitter) {
    return cappedDelay
  }

  const sample = random()
  const clamped = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5
  return cappedDelay * clamped
}

export const retryBackoffCapabilityModule: NodeCapabilityModule = {
  name: 'resilience.retry-backoff',
  appliesTo: RETRY_BACKOFF_COMPONENT_TYPES,
  config: {
    sections: [
      {
        id: 'retry-policy',
        title: 'Retry Policy',
        note: 'Retries re-enter this caller node after a backoff delay, so they consume real queue/worker capacity and can amplify load. Leaving Max attempts blank preserves the legacy no-retry behavior.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.retry.maxAttempts',
            type: 'input',
            label: 'Max attempts',
            step: 1,
            optional: true,
            placeholder: 'Blank = disabled',
            why: 'Total end-to-end tries for this caller, including the original attempt.'
          },
          {
            path: 'sim.retry.baseDelay',
            type: 'input',
            label: 'Base delay',
            unit: 'ms',
            step: 1,
            optional: true,
            placeholder: `${DEFAULT_RETRY_BASE_DELAY_MS}`,
            why: 'Delay before the first retry after a retryable downstream failure.'
          },
          {
            path: 'sim.retry.maxDelay',
            type: 'input',
            label: 'Max delay',
            unit: 'ms',
            step: 1,
            optional: true,
            placeholder: `${DEFAULT_RETRY_MAX_DELAY_MS}`,
            why: 'Caps exponential backoff so retries do not grow without bound.'
          },
          {
            path: 'sim.retry.multiplier',
            type: 'input',
            label: 'Multiplier',
            step: 0.1,
            optional: true,
            placeholder: `${DEFAULT_RETRY_MULTIPLIER}`,
            why: 'Controls how aggressively retry delay grows after each failure.'
          },
          {
            path: 'sim.retry.jitter',
            type: 'boolean',
            label: 'Full jitter',
            optional: true,
            why: 'Randomizes retry delay between 0 and the capped backoff to avoid retry synchronization.'
          }
        ]
      }
    ]
  },
  metrics: {
    counters: ['retryAttempts', 'retryBudgetExhausted']
  },
  honesty: {
    simulates: [
      'caller-owned retry budget with exponential backoff',
      'jittered re-entry into the caller queue after retryable downstream failures'
    ],
    notModeled: [
      'error-class-specific retry allowlists',
      'hedged requests or concurrent speculative retries',
      'cross-request retry budgets shared across callers'
    ]
  }
}
