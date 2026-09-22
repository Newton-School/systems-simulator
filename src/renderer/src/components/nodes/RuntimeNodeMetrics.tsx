import { NodeMetricCell } from './NodeMetricCell'

type RuntimeNodeMetricsProps = {
  arrived?: number
  completed?: number
  rejected?: number
  timedOut?: number
  className?: string
  /** Broadcast broker: "completed" is subscriber deliveries (fan-out), not requests. */
  isBroadcastFanout?: boolean
  /** Axis-D node-effect markers (cache short-circuit, retries, replication, …). */
  effects?: string[]
}

/**
 * Compact count for the node card: large values are abbreviated (55,000,000 →
 * "55M", 4,230,769 → "4.2M") so a busy node's numbers can't overflow their grid
 * column and overlap the neighbouring cell. Values below 100k stay fully spelled
 * out with separators; the exact figure is always available via {@link fmtExact}
 * in the cell's hover title.
 */
function fmtCount(value?: number): string {
  const n = Math.max(0, Math.round(value ?? 0))
  if (n >= 100_000) {
    return n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
  }
  return n.toLocaleString()
}

/** Full, comma-separated value for the hover title (never abbreviated). */
function fmtExact(value?: number): string {
  return Math.max(0, Math.round(value ?? 0)).toLocaleString()
}

export function RuntimeNodeMetrics({
  arrived,
  completed,
  rejected,
  timedOut,
  className = 'grid grid-cols-2 gap-4',
  isBroadcastFanout = false,
  effects = []
}: RuntimeNodeMetricsProps) {
  const hasFailures = (rejected ?? 0) > 0 || (timedOut ?? 0) > 0

  return (
    <div className="space-y-2">
      <div className={className}>
        <NodeMetricCell
          label={isBroadcastFanout ? 'Deliveries / Received' : 'Completed / Received'}
          value={`${fmtCount(completed)} / ${fmtCount(arrived)}`}
          title={`${fmtExact(completed)} / ${fmtExact(arrived)}`}
        />
        <NodeMetricCell
          label="Rejected / Timed Out"
          value={`${fmtCount(rejected)} / ${fmtCount(timedOut)}`}
          title={`${fmtExact(rejected)} / ${fmtExact(timedOut)}`}
          tone={hasFailures ? 'text-nss-danger' : 'text-nss-success'}
        />
      </div>
      {effects.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {effects.map((effect) => (
            <span
              key={effect}
              className="rounded border border-nss-border bg-nss-panel px-1.5 py-0.5 text-[9px] font-medium text-nss-muted"
            >
              {effect}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
