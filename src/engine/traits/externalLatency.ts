import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const EXTERNAL_LATENCY_COMPONENT_TYPES = [
  'third-party-api-connector',
  'payment-gateway',
  'third-party-auth',
  'webhook-gateway'
] as const satisfies readonly ComponentType[]

const DEFAULT_EXTERNAL_LATENCY_MS = 120

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function addPenalty(request: { metadata: Record<string, unknown> }, ms: number): void {
  const existing =
    typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
      ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
      : 0
  request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existing + ms
}

/**
 * Third-party dependency latency. A call out to an external provider (payment,
 * auth, webhook target, generic API) costs a latency the caller does not
 * control. Combined with the retry-backoff trait these nodes already carry, this
 * makes "a slow external dependency" a real blast-radius lesson instead of a
 * free hop.
 */
export const externalLatencyTrait: NodeBehaviourTrait = {
  name: 'integration.external-latency',
  beforeArrival: ({ node, request }) => {
    const externalLatencyMs = asNonNegativeNumber(node.config?.['externalLatencyMs'])
    if (externalLatencyMs === null || externalLatencyMs === 0) {
      return { action: 'continue' }
    }
    addPenalty(request, externalLatencyMs)
    return {
      action: 'continue',
      payload: { externalLatencyMs, metricCounters: { externalCalls: 1 } }
    }
  }
}

export const externalLatencyCapabilityModule: NodeCapabilityModule = {
  name: 'integration.external-latency',
  appliesTo: EXTERNAL_LATENCY_COMPONENT_TYPES,
  hooks: externalLatencyTrait,
  config: {
    sections: [
      {
        id: 'external-latency',
        title: 'External Dependency',
        note: 'Adds the latency of calling an external provider you do not control. Pair with retries to show how a slow dependency amplifies latency across callers.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.externalLatencyMs',
            type: 'input',
            inputType: 'number',
            label: 'External call latency',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_EXTERNAL_LATENCY_MS}ms`,
            why: 'Round-trip time to the third-party provider for each request.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['externalCalls'] },
  honesty: {
    simulates: ['a per-request latency penalty for an external provider call'],
    notModeled: [
      'provider-side rate limits, quota exhaustion, or provider outages (use retries/circuit breaker for those)'
    ]
  }
}
