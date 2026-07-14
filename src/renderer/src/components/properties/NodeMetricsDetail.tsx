import type { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import { MetricItem } from './MetricItem'

type NodeMetrics = ReturnType<typeof useNodeMetrics>

interface NodeMetricsDetailProps {
  metrics: NodeMetrics
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
          <MetricItem label="p50" value={metrics.latencyP50} unit="ms" />
          <MetricItem label="p95" value={metrics.latencyP95} unit="ms" />
          <MetricItem label="p99" value={metrics.latencyP99} unit="ms" />
        </div>
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
                <span className="font-mono text-nss-muted">{reason}</span>
                <span className="font-mono font-semibold text-nss-warning">{count}</span>
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
                <span className="font-mono text-nss-muted">{key}</span>
                <span className="font-mono font-semibold text-nss-text">{value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
