import type { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import {
  ERROR_CAUSE_LABELS,
  dominantTimeToErrorCause
} from '@renderer/utils/errorCausePresentation'
import { MetricItem } from './MetricItem'

type NodeMetrics = ReturnType<typeof useNodeMetrics>

interface NodeMetricsDetailProps {
  metrics: NodeMetrics
}

function latencyMetricItem(value: number | null | undefined): {
  value?: string | number
  unit?: string
} {
  if (value === undefined) return {}
  if (value === null) return { value: 'N/A' }
  return { value, unit: 'ms' }
}

function fmtRatioPercent(value?: number): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">{title}</h3>
      <div className="rounded-lg border border-nss-border bg-nss-surface px-4 py-3">{children}</div>
    </section>
  )
}

/**
 * The second altitude (C3): everything the Nodes table shows for this node,
 * plus trait-specific detail (cache ratio, rejection reasons) the table
 * never had room for. This is what "click for detail" on the canvas card
 * links to - nothing here duplicates onto the card itself.
 */
export const NodeMetricsDetail = ({ metrics }: NodeMetricsDetailProps) => {
  const rejectionEntries = Object.entries(metrics.rejectionsByReason ?? {}).sort(
    (a, b) => b[1] - a[1]
  )
  const traitCounterEntries = Object.entries(metrics.traitCounters ?? {}).filter(
    ([key]) => key !== 'cacheHits' && key !== 'cacheMisses'
  )
  const hasCacheData =
    metrics.cacheHitRatio !== undefined &&
    ((metrics.cacheHits ?? 0) > 0 || (metrics.cacheMisses ?? 0) > 0)
  const inFlightColour =
    (metrics.postWarmupInFlight ?? 0) > 0 ? 'text-nss-warning' : 'text-nss-text'
  const successLatencySamples = metrics.successLatencySamples ?? 0
  const latencyWindowErrorRate = metrics.latencyWindowErrorRate ?? 0
  const dominantFailure = dominantTimeToErrorCause(metrics.timeToErrorByCause)
  const latencyNote =
    successLatencySamples === 0 && latencyWindowErrorRate > 0
      ? `No successful requests in this window. Success latency is unavailable; ${fmtRatioPercent(
          latencyWindowErrorRate
        )} failed${dominantFailure ? `, mostly ${ERROR_CAUSE_LABELS[dominantFailure]}` : ''}.`
      : latencyWindowErrorRate >= 0.5
        ? `Latency is over ${successLatencySamples.toLocaleString()} successful requests only; ${fmtRatioPercent(
            latencyWindowErrorRate
          )} failed${dominantFailure ? `, mostly ${ERROR_CAUSE_LABELS[dominantFailure]}` : ''}.`
        : latencyWindowErrorRate > 0.05
          ? `Read latency together with failures: ${fmtRatioPercent(
              latencyWindowErrorRate
            )} failed${dominantFailure ? `, mostly ${ERROR_CAUSE_LABELS[dominantFailure]}` : ''}.`
          : null
  const latencyNoteClass =
    successLatencySamples === 0 && latencyWindowErrorRate > 0
      ? 'text-nss-danger'
      : latencyWindowErrorRate >= 0.5
        ? 'text-nss-danger'
        : 'text-nss-warning'
  const p50Metric = latencyMetricItem(metrics.latencyNodeLocal?.p50)
  const p95Metric = latencyMetricItem(metrics.latencyNodeLocal?.p95)
  const p99Metric = latencyMetricItem(metrics.latencyNodeLocal?.p99)

  return (
    <div className="space-y-6">
      <Section title="Throughput">
        <div className="grid grid-cols-2 gap-4">
          <MetricItem label="Throughput" value={metrics.throughput} unit="req/s" />
          <MetricItem label="Utilization" value={metrics.utilization} unit="%" />
          <MetricItem label="Arrived" value={metrics.postWarmupArrived} unit="req" />
          <MetricItem label="Completed" value={metrics.postWarmupProcessed} unit="req" />
          <MetricItem
            label="In Flight"
            value={metrics.postWarmupInFlight}
            unit="req"
            textColor={inFlightColour}
          />
          <MetricItem
            label="Rejected"
            value={metrics.postWarmupRejected}
            unit="req"
            textColor="text-nss-warning"
          />
          <MetricItem
            label="Timed Out"
            value={metrics.postWarmupTimedOut}
            unit="req"
            textColor="text-nss-danger"
          />
        </div>
      </Section>

      <Section title="Latency">
        <div className="grid grid-cols-3 gap-4">
          <MetricItem label="p50" value={p50Metric.value} unit={p50Metric.unit} />
          <MetricItem label="p95" value={p95Metric.value} unit={p95Metric.unit} />
          <MetricItem label="p99" value={p99Metric.value} unit={p99Metric.unit} />
        </div>
        {latencyNote && <div className={`mt-3 text-xs ${latencyNoteClass}`}>{latencyNote}</div>}
      </Section>

      <Section title="Availability">
        <div className="grid grid-cols-2 gap-4">
          <MetricItem label="Availability" value={metrics.availability} unit="%" />
          <MetricItem
            label="Error Rate"
            value={metrics.errorRate}
            unit="%"
            textColor="text-nss-danger"
          />
        </div>
      </Section>

      {rejectionEntries.length > 0 && (
        <Section title="Rejections by Reason">
          <div className="space-y-1.5">
            {rejectionEntries.map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between text-xs">
                <span className="text-nss-muted">{reason}</span>
                <span className="font-semibold text-nss-warning tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {hasCacheData && (
        <Section title="Cache">
          <div className="grid grid-cols-3 gap-4">
            <MetricItem label="Hit Ratio" value={metrics.cacheHitRatio} unit="%" />
            <MetricItem label="Hits" value={metrics.cacheHits} />
            <MetricItem label="Misses" value={metrics.cacheMisses} />
          </div>
        </Section>
      )}

      {traitCounterEntries.length > 0 && (
        <Section title="Trait Counters">
          <div className="space-y-1.5">
            {traitCounterEntries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-nss-muted">{key}</span>
                <span className="font-semibold text-nss-text tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
