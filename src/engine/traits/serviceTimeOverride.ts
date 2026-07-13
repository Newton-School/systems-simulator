import type { DistributionConfig } from '../core/types'
import type { Request } from '../core/events'

/**
 * Well-known request.metadata key traits use to override the service-time
 * distribution GGcKNode samples for a single request (e.g. ReadWriteSplitTrait
 * picking readLatency vs writeLatency). Lives outside GGcKNode so the queue
 * model stays untouched by any specific trait's config shape — it only knows
 * "read an optional override off the request," never why one exists.
 */
export const SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY = 'serviceTimeDistributionOverride'
export const SERVICE_TIME_LATENCY_PENALTY_MS_KEY = 'serviceTimeLatencyPenaltyMs'

const KNOWN_DISTRIBUTION_TYPES = new Set([
  'constant',
  'deterministic',
  'log-normal',
  'exponential',
  'normal',
  'uniform',
  'weibull',
  'poisson',
  'binomial',
  'gamma',
  'beta',
  'pareto',
  'empirical',
  'mixture'
])

export function asDistributionConfig(value: unknown): DistributionConfig | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && KNOWN_DISTRIBUTION_TYPES.has(type)
    ? (value as DistributionConfig)
    : null
}

export function readServiceTimeDistributionOverride(request: Request): DistributionConfig | null {
  return asDistributionConfig(request.metadata?.[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY])
}

export function readServiceTimeLatencyPenaltyMs(request: Request): number {
  const raw = request.metadata?.[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0
}
