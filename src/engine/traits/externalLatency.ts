import type { ComponentType } from '../core/types'
import { admitWithinRate } from './rateWindow'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const EXTERNAL_LATENCY_COMPONENT_TYPES = [
  'third-party-api-connector',
  'payment-gateway',
  'third-party-auth',
  'webhook-gateway',
  // A push-notification service is itself a call out to an external provider
  // (APNs / FCM) the caller does not control — so it carries the same
  // external-dependency latency + error blast-radius as any other integration.
  'push-notification-service'
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
 * auth, webhook target, generic API, or a push provider like APNs / FCM) costs a
 * latency the caller does not control. Combined with the retry-backoff trait these
 * nodes already carry, this makes "a slow external dependency" a real blast-radius
 * lesson instead of a free hop.
 */
export const externalLatencyTrait: NodeBehaviourTrait = {
  name: 'integration.external-latency',
  beforeArrival: ({ node, request, clock, state }) => {
    // A provider answers a limited number of requests per second; past its limit it answers 429 (a
    // retryable failure), so a caller that retries without backoff makes the overload worse.
    const rateLimitRps = asNonNegativeNumber(node.config?.['rateLimitRps'])
    if (
      rateLimitRps !== null &&
      rateLimitRps > 0 &&
      !admitWithinRate(state, 'external.rateLog', clock, rateLimitRps)
    ) {
      return {
        action: 'rejected',
        reason: 'provider_rate_limited',
        payload: { metricCounters: { providerRateLimited: 1 } }
      }
    }
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
          },
          {
            path: 'sim.rateLimitRps',
            type: 'input',
            inputType: 'number',
            label: 'Provider rate limit',
            unit: 'req/s',
            min: 0,
            altitude: 'advanced',
            why: 'Requests per second the provider accepts; past it calls fail as provider_rate_limited (a 429), which a retry policy will retry. Empty means no limit.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['externalCalls', 'providerRateLimited'],
    rejectionReasons: ['provider_rate_limited']
  },
  honesty: {
    simulates: [
      'a per-request latency penalty for an external provider call',
      'a provider rate limit (rateLimitRps) that answers past it with a retryable provider_rate_limited'
    ],
    notModeled: ['provider outages beyond faults (use retries and a circuit breaker for those)']
  }
}
