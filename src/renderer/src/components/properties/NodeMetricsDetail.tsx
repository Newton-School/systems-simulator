import type { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import type {
  ClusterProjection,
  WorkloadProjection
} from '../../../../engine/cluster/clusterScheduler'
import {
  ERROR_CAUSE_LABELS,
  dominantTimeToErrorCause
} from '@renderer/utils/errorCausePresentation'
import { MetricItem } from './MetricItem'

type NodeMetrics = ReturnType<typeof useNodeMetrics>

export type ClusterSchedulingView =
  | { kind: 'cluster'; cluster: ClusterProjection }
  | { kind: 'workload'; cluster: ClusterProjection; workload: WorkloadProjection }

interface NodeMetricsDetailProps {
  metrics: NodeMetrics
  /**
   * The node-level cache trait's configured hit rate (`sim.cacheHitRate`).
   * The Cache panel below reports hit/miss counters that only mean anything when
   * this trait is actually enabled. When it's absent or 0 the node is a plain
   * datastore that happens to be a cache *type* (e.g. a Redis node fed by
   * routing-level cache-aside), and the trait counts every arrival as a "miss" -
   * producing a misleading 0% hit ratio. Gate the panel on this so we never
   * surface phantom misses.
   */
  configuredCacheHitRate?: number
  /**
   * How this node's outbound traffic was split across its downstream targets,
   * highest share first. Present only for nodes that fan out to more than one
   * target. This is the honest source of truth for routing-level behaviour
   * (cache-aside hit/miss, DNS weighting, sharding) - the split you'd otherwise
   * have to infer from a per-node cache panel.
   */
  downstreamSplit?: { targetLabel: string; count: number; share: number }[]
  /**
   * True when this node is a broadcast fan-out broker (pub/sub, event bus, message
   * broker) rather than a load balancer. For fan-out, one received message is
   * *replicated* to every subscriber, so "Completed" counts subscriber deliveries
   * (not unique requests) and the downstream split is 100%-per-subscriber
   * replication, not a routing share. Relabels the panel accordingly so deliveries
   * are never conflated with unique messages.
   */
  isBroadcastFanout?: boolean
  /** Cluster bin-packing result for a cluster node or a workload scheduled on one. */
  clusterScheduling?: ClusterSchedulingView
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

// LOGIC: Request counts are integers by definition. The fluid/analytic model
// produces them as rate × duration products (e.g. 142857.142…), so round to
// whole requests and group thousands before display. Rates and latencies stay
// fractional and are not passed through here.
function fmtCount(value?: number | null): string | undefined {
  if (value === undefined || value === null) return undefined
  return Math.round(value).toLocaleString()
}

const TRAIT_COUNTER_LABELS: Record<string, string> = {
  memoryPressureEvents: 'Requests under memory pressure',
  workingSetPressureEvents: 'Requests with working-set spill',
  gcPressureEvents: 'Requests with GC pressure',
  collapseLeaders: 'Collapse leaders (downstream fetches)',
  collapsedMisses: 'Collapsed misses (waited, no downstream call)',
  collapsedFollowersServed: 'Collapsed misses served by leader',
  collapsedFollowersFailed: 'Collapsed misses failed with leader',
  collapseNoKey: 'Misses not collapsed (no request key)',
  podsScheduled: 'Pods placed',
  podsUnplaced: 'Pods that could not be placed (pending)',
  podsLost: 'Pods lost to machine failure',
  podsEvicted: 'Pods evicted and recreated',
  noReadyReplicaRejects: 'Refused: no ready replica',
  clusterPodsScheduled: 'Pods placed',
  clusterPodsUnplaced: 'Pods that could not be placed (pending)',
  clusterMachineFailures: 'Machines failed',
  clusterPodsLost: 'Pods lost to machine failure',
  clusterPodsEvicted: 'Pods evicted and recreated',
  clusterMachinesProvisioned: 'Machines added by cluster autoscaling',
  telemetryOffered: 'Events offered (after sampling)',
  telemetryIngested: 'Events ingested',
  telemetryDropped: 'Events dropped',
  telemetryDroppedOverIngest: 'Dropped: over ingest ceiling',
  telemetryDroppedBufferFull: 'Dropped: collector buffer full',
  telemetrySampledOut: 'Not exported (sampled out)',
  changeEventsCaptured: 'Change events numbered',
  changeEventsApplied: 'Change events applied by consumers',
  changeOrderViolations: 'Ordering violations (older change applied after newer)',
  changeEventsWaitedForOrder: 'Deliveries held for ordering',
  changeEventsFailed: 'Change deliveries that failed',
  changeEventsNoKey: 'Change events without an entity key',
  connectionsHeld: 'Connections held',
  connectionsRefused: 'Connections refused (over limit or RAM)',
  pushMessages: 'Messages pushed',
  pushDeliveries: 'Socket writes (recipients reached)',
  pushUndeliverable: 'Recipients not connected (undeliverable)'
}

function fmtNumber(value: number, digits = 1): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(digits)
}

function ClusterSchedulingSection({ view }: { view: ClusterSchedulingView }) {
  const { cluster } = view
  const rows: Array<[string, string]> =
    view.kind === 'workload'
      ? [
          ['Desired replicas (avg)', fmtNumber(view.workload.avgDesiredReplicas, 2)],
          ['Ready replicas (avg)', fmtNumber(view.workload.avgReadyReplicas, 2)],
          ['Ready / desired at end', `${view.workload.readyFinal} / ${view.workload.desiredFinal}`],
          ['Pending pod-seconds', fmtNumber(view.workload.pendingPodSeconds, 1)],
          [
            'Pod request',
            `${view.workload.podVcpu} vCPU · ${view.workload.podRamGb} GB on ${cluster.clusterId}`
          ]
        ]
      : [
          [
            'Machines up (avg)',
            `${fmtNumber(cluster.avgMachinesUp, 2)} of ${cluster.machinesConfigured}${
              cluster.maxMachines > cluster.machinesConfigured
                ? ` (max ${cluster.maxMachines})`
                : ''
            }`
          ],
          ['Machine', `${cluster.machineVcpu} vCPU · ${cluster.machineRamGb} GB`],
          ['vCPU allocated', `${(cluster.cpuAllocatedRatio * 100).toFixed(1)}%`],
          ['RAM allocated', `${(cluster.ramAllocatedRatio * 100).toFixed(1)}%`],
          [
            'Pending pods (avg / peak)',
            `${fmtNumber(cluster.avgPendingPods, 2)} / ${cluster.peakPendingPods}`
          ],
          ['Pods lost / recovered', `${cluster.podsLost} / ${cluster.podsRecovered}`]
        ]
  if (cluster.meanRecoveryMs !== null) {
    rows.push([
      'Recovery after machine failure (mean / max)',
      `${fmtNumber(cluster.meanRecoveryMs / 1000, 1)}s / ${fmtNumber((cluster.maxRecoveryMs ?? 0) / 1000, 1)}s`
    ])
  }
  return (
    <Section title="Cluster Scheduling">
      <div className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-nss-muted">{label}</span>
            <span className="font-semibold text-nss-text tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-nss-muted">
        Time-weighted over the run. Only ready pods serve; pending, starting and lost pods add no
        capacity. Allocation is requested vCPU / RAM over the machines that were up.
      </p>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">{title}</h3>
      <div className="rounded-lg border border-nss-border bg-nss-surface px-4 py-3">{children}</div>
    </section>
  )
}

interface SourceNodeMetricsDetailProps {
  offeredRps?: number
  pattern?: string
  emitted: number
}

/**
 * A source generates requests, it does not process them. Showing the processing
 * grid (throughput/utilization/arrived/latency/errors) for a source reads as a
 * dead node full of zeros. Instead we show what a generator actually did: the
 * offered load, its arrival pattern, and how many requests it emitted.
 */
export const SourceNodeMetricsDetail = ({
  offeredRps,
  pattern,
  emitted
}: SourceNodeMetricsDetailProps) => {
  return (
    <div className="space-y-6">
      <Section title="Traffic Generation">
        <div className="grid grid-cols-2 gap-4">
          <MetricItem
            label="Offered Load"
            value={offeredRps === undefined ? 'N/A' : offeredRps}
            unit={offeredRps === undefined ? undefined : 'req/s'}
          />
          <MetricItem label="Pattern" value={pattern ?? 'N/A'} />
          <MetricItem label="Emitted" value={emitted.toLocaleString()} unit="req" />
        </div>
      </Section>

      <p className="text-xs text-nss-muted">
        This is a traffic source. It generates requests rather than processing them, so throughput,
        latency, and error metrics apply to the downstream nodes it feeds - not here.
      </p>
    </div>
  )
}

/**
 * The second altitude (C3): everything the Nodes table shows for this node,
 * plus trait-specific detail (cache ratio, rejection reasons) the table
 * never had room for. This is what "click for detail" on the canvas card
 * links to - nothing here duplicates onto the card itself.
 */
export const NodeMetricsDetail = ({
  metrics,
  configuredCacheHitRate,
  downstreamSplit,
  isBroadcastFanout = false,
  clusterScheduling
}: NodeMetricsDetailProps) => {
  // Fan-out amplification: for a broadcast broker, one received message is
  // replicated to every subscriber, so processed = deliveries, not unique requests.
  const messagesReceived = metrics.postWarmupArrived ?? 0
  const subscriberDeliveries = metrics.postWarmupProcessed ?? 0
  const amplification =
    isBroadcastFanout && messagesReceived > 0 ? subscriberDeliveries / messagesReceived : 0
  const rejectionEntries = Object.entries(metrics.rejectionsByReason ?? {}).sort(
    (a, b) => b[1] - a[1]
  )
  const traitCounterEntries = Object.entries(metrics.traitCounters ?? {}).filter(
    ([key]) => key !== 'cacheHits' && key !== 'cacheMisses'
  )
  // Only show the Cache panel when the node-level cache trait is actually enabled
  // (a configured hit rate > 0). Otherwise the hit/miss counters are phantom
  // misses from a node that's really just a fast datastore.
  const cacheTraitEnabled = (configuredCacheHitRate ?? 0) > 0
  const hasCacheData =
    cacheTraitEnabled &&
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
          <MetricItem
            label="Throughput"
            value={metrics.throughput}
            unit={isBroadcastFanout ? 'deliveries/s' : 'req/s'}
          />
          <MetricItem label="Utilization" value={metrics.utilization} unit="%" />
          <MetricItem
            label={isBroadcastFanout ? 'Messages received' : 'Arrived'}
            value={fmtCount(metrics.postWarmupArrived)}
            unit={isBroadcastFanout ? 'msg' : 'req'}
          />
          <MetricItem
            label={isBroadcastFanout ? 'Subscriber deliveries' : 'Completed'}
            value={fmtCount(metrics.postWarmupProcessed)}
            unit={isBroadcastFanout ? 'deliveries' : 'req'}
          />
          {isBroadcastFanout && amplification > 0 && (
            <MetricItem
              label="Delivery amplification"
              value={Number(amplification.toFixed(amplification % 1 === 0 ? 0 : 1))}
              unit="×"
            />
          )}
          <MetricItem
            label="In Flight"
            value={fmtCount(metrics.postWarmupInFlight)}
            unit="req"
            textColor={inFlightColour}
          />
          <MetricItem
            label="Rejected"
            value={fmtCount(metrics.postWarmupRejected)}
            unit="req"
            textColor="text-nss-warning"
          />
          <MetricItem
            label="Timed Out"
            value={fmtCount(metrics.postWarmupTimedOut)}
            unit="req"
            textColor="text-nss-danger"
          />
          {(metrics.postWarmupFailedAfterService ?? 0) > 0 && (
            <MetricItem
              label="Failed after service"
              value={fmtCount(metrics.postWarmupFailedAfterService)}
              unit="req"
              textColor="text-nss-warning"
            />
          )}
        </div>
      </Section>

      {downstreamSplit && downstreamSplit.length > 0 && (
        <Section title={isBroadcastFanout ? 'Subscriber Deliveries' : 'Downstream Routing Split'}>
          <div className="space-y-2">
            {downstreamSplit.map((row) => (
              <div key={row.targetLabel} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-nss-text">{row.targetLabel}</span>
                  <span className="font-semibold text-nss-text tabular-nums">
                    {(row.share * 100).toFixed(isBroadcastFanout ? 0 : 1)}%
                    <span className="ml-1 text-nss-muted font-normal">
                      ({row.count.toLocaleString()} {isBroadcastFanout ? 'deliveries' : 'req'})
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-nss-surface">
                  <div
                    className="h-full rounded-full bg-nss-primary"
                    style={{ width: `${Math.max(row.share * 100, 1)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-nss-muted">
            {isBroadcastFanout
              ? 'Fan-out replication: each subscriber receives 100% of published messages — these are message deliveries, not a routing share. One received message becomes one delivery per subscriber.'
              : "Share of this node's outbound requests routed to each target. For a cache-aside path this is the real hit/miss split - cache hits and misses are modelled as which backend the request is routed to."}
          </p>
        </Section>
      )}

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

      {clusterScheduling && <ClusterSchedulingSection view={clusterScheduling} />}

      {traitCounterEntries.length > 0 && (
        <Section title="Trait Counters">
          <div className="space-y-1.5">
            {traitCounterEntries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-nss-muted">{TRAIT_COUNTER_LABELS[key] ?? key}</span>
                <span className="font-semibold text-nss-text tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
