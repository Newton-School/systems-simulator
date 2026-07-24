import { NodeMetricCell } from './NodeMetricCell'

type RuntimeNodeMetricsProps = {
  arrived?: number
  completed?: number
  rejected?: number
  timedOut?: number
  className?: string
}

function fmtCount(value?: number): string {
  return Math.max(0, Math.round(value ?? 0)).toLocaleString()
}

export function RuntimeNodeMetrics({
  arrived,
  completed,
  rejected,
  timedOut,
  className = 'grid grid-cols-2 gap-4'
}: RuntimeNodeMetricsProps) {
  const hasFailures = (rejected ?? 0) > 0 || (timedOut ?? 0) > 0

  return (
    <div className={className}>
      <NodeMetricCell
        label="Completed / Received"
        value={`${fmtCount(completed)} / ${fmtCount(arrived)}`}
      />
      <NodeMetricCell
        label="Rejected / Timed Out"
        value={`${fmtCount(rejected)} / ${fmtCount(timedOut)}`}
        tone={hasFailures ? 'text-nss-danger' : 'text-nss-success'}
      />
    </div>
  )
}
