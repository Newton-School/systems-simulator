import type { EdgeLatencyBreakdown } from '../../../../engine/metrics'
import {
  EDGE_LATENCY_COMPONENTS,
  type EdgeLatencyComponent
} from '../../../../engine/network/linkTransmission'

// One row per component the engine applies to an edge transit. Jitter has no
// row of its own: it is the spread of the sampled propagation distribution.
const COMPONENT_META: Record<EdgeLatencyComponent, { label: string; color: string; why: string }> =
  {
    propagationMs: {
      label: 'Propagation',
      color: '#60a5fa',
      why: 'Sampled from the path-type or configured latency distribution (jitter lives here).'
    },
    congestionMs: {
      label: 'Congestion',
      color: '#f59e0b',
      why: 'Propagation inflated by 1 / (1 - in-flight / max concurrent) as the edge fills up.'
    },
    transmissionMs: {
      label: 'Transmission',
      color: '#a78bfa',
      why: 'Request bytes / bandwidth: time the payload holds the link.'
    },
    linkQueueMs: {
      label: 'Link queue',
      color: '#f87171',
      why: 'Waiting for earlier transfers to finish on the link (bandwidth contention).'
    },
    protocolOverheadMs: {
      label: 'Protocol overhead',
      color: '#34d399',
      why: 'Fixed per-request protocol cost; reduced on streaming links.'
    },
    retransmissionMs: {
      label: 'Retransmission',
      color: '#fb923c',
      why: 'A second transit after packet loss on a reliable protocol.'
    }
  }

function fmtMs(value: number): string {
  if (value === 0) return '0 ms'
  if (value < 0.01) return `${(value * 1000).toFixed(1)} µs`
  if (value < 10) return `${value.toFixed(2)} ms`
  return `${value.toFixed(1)} ms`
}

export function EdgeLatencyBreakdownView({
  breakdown,
  linkUtilization
}: {
  breakdown: EdgeLatencyBreakdown
  linkUtilization?: number
}) {
  const total = breakdown.meanTotalMs
  const rows = EDGE_LATENCY_COMPONENTS.map((key) => ({
    key,
    value: breakdown.meanMs[key],
    ...COMPONENT_META[key]
  }))

  return (
    <div className="space-y-3" data-testid="edge-latency-breakdown">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-nss-muted">Mean transit</span>
        <span className="font-semibold tabular-nums text-nss-text">{fmtMs(total)}</span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-nss-border"
        role="img"
        aria-label="Edge latency split by component"
      >
        {total > 0 &&
          rows
            .filter((row) => row.value > 0)
            .map((row) => (
              <div
                key={row.key}
                title={`${row.label}: ${fmtMs(row.value)}`}
                style={{ width: `${(row.value / total) * 100}%`, backgroundColor: row.color }}
              />
            ))}
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`flex items-center justify-between gap-3 text-xs ${
              row.value > 0 ? '' : 'opacity-50'
            }`}
            title={row.why}
          >
            <span className="flex items-center gap-2 text-nss-muted">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: row.color }}
              />
              {row.label}
            </span>
            <span className="tabular-nums text-nss-text">
              {fmtMs(row.value)}
              {total > 0 && row.value > 0 ? (
                <span className="ml-1.5 text-nss-muted">
                  {Math.round((row.value / total) * 100)}%
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-nss-muted">
        {linkUtilization !== undefined ? (
          <span>
            Link utilization{' '}
            <span className="tabular-nums text-nss-text">
              {(linkUtilization * 100).toFixed(linkUtilization < 0.1 ? 2 : 1)}%
            </span>
          </span>
        ) : null}
        {breakdown.maxLinkQueueMs > 0 ? (
          <span>
            Longest link wait{' '}
            <span className="tabular-nums text-nss-text">{fmtMs(breakdown.maxLinkQueueMs)}</span>
          </span>
        ) : null}
      </div>
      <p className="text-[11px] leading-relaxed text-nss-muted">
        Means over {breakdown.samples.toLocaleString()} successful post-warmup transits; the parts
        add up to the mean transit. Jitter is the spread of the propagation sample, and only request
        payloads cross edges (response sizes are not modeled).
      </p>
    </div>
  )
}
