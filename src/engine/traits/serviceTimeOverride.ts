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
/**
 * Extra on-core work a trait adds to one request (e.g. writing a pushed message
 * to every held connection). Unlike the latency penalty (external wait), this
 * work runs on the node's CPU, so it stretches under core contention.
 */
export const SERVICE_TIME_CPU_WORK_MS_KEY = 'serviceTimeCpuWorkMs'

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

/**
 * Absolute simulation time (microseconds, as a number) the request must wait
 * for before its service can finish - e.g. a replica read that must wait for
 * replication to catch up to a version (read-your-writes, strong follower
 * reads). The node adds `max(0, waitUntil - serviceStart)` to the service time
 * as external wait (not CPU work), so the wait is measured against the real
 * service-start clock, after any queueing, and holds the worker like a blocked
 * connection would. The node records the wait it actually applied under
 * `SERVICE_TIME_WAIT_APPLIED_MS_KEY`.
 */
export const SERVICE_TIME_WAIT_UNTIL_US_KEY = 'serviceTimeWaitUntilUs'
export const SERVICE_TIME_WAIT_APPLIED_MS_KEY = 'serviceTimeWaitAppliedMs'

export function readServiceTimeWaitMs(request: Request, serviceStartUs: bigint): number {
  const raw = request.metadata?.[SERVICE_TIME_WAIT_UNTIL_US_KEY]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  const waitUs = raw - Number(serviceStartUs)
  return waitUs > 0 ? waitUs / 1000 : 0
}

export function readServiceTimeCpuWorkMs(request: Request): number {
  const raw = request.metadata?.[SERVICE_TIME_CPU_WORK_MS_KEY]
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0
}
