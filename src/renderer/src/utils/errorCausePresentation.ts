import type { TimeToErrorSummary } from '../../../engine/metrics'
import type { ErrorCause } from '../../../engine/metrics/windowedLatencyAggregator'

export const ERROR_CAUSE_LABELS: Record<ErrorCause, string> = {
  queue_full: 'Queue Full',
  node_failed: 'Node Failed',
  network_error: 'Network Error',
  timeout: 'Timed Out',
  connection_reset: 'Connection Reset',
  rejected: 'Rejected (policy)'
}

export function dominantTimeToErrorCause(
  timeToErrorByCause?: Partial<TimeToErrorSummary> | null
): ErrorCause | null {
  let best: ErrorCause | null = null
  let bestCount = 0

  for (const cause of Object.keys(ERROR_CAUSE_LABELS) as ErrorCause[]) {
    const count = timeToErrorByCause?.[cause]?.count ?? 0
    if (count > bestCount) {
      bestCount = count
      best = cause
    }
  }

  return best
}
