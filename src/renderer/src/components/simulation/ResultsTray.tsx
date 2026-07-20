import { useEffect, useId, useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { SimulationOutput, StatusWindow } from '../../../../engine/analysis/output'
import type { DebugEvent } from '../../../../engine/core/event-stream'
import { projectToDebugEvent } from '../../../../engine/core/event-stream'
import type { SimulationStatus } from '../../hooks/useSimulation'
import useStore from '../../store/useStore'
import type { EdgeSimulationData, ScenarioRunContext } from '@renderer/types/ui'
import {
  ERROR_CAUSE_LABELS,
  dominantTimeToErrorCause
} from '@renderer/utils/errorCausePresentation'
import { failureRateLevelFromRatio } from '@renderer/utils/failureRatePresentation'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ResultsTrayProps {
  status: SimulationStatus
  stopped: boolean
  progress: number
  eventsProcessed: number
  results: SimulationOutput | null
  error: string | null
  runContext: ScenarioRunContext | null
  onClose?: () => void
}

interface EventEdgeDisplayInfo {
  label?: string
  source?: string
  target?: string
  protocol?: string
  mode?: string
}

interface EventGraphLookup {
  nodeLabelById: Map<string, string>
  edgeById: Map<string, EventEdgeDisplayInfo>
}

type ResultsTab = 'overview' | 'bottlenecks' | 'nodes' | 'traffic'
type SelectedComponent = { kind: 'node'; id: string } | { kind: 'edge'; id: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null): string {
  // `null` means no successful samples in this population/window — show N/A, never a fake 0.
  if (ms === null) return 'N/A'
  if (ms === 0) return '—'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`
}

function fmtRps(rps: number | null): string {
  return rps === null ? '—' : `${rps.toFixed(1)} rps`
}

function fmtCv(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(2)
}

function fmtLambda(lambda: number): string {
  return lambda === 0 ? '—' : `${lambda.toFixed(2)}`
}

function fmtL(l: number): string {
  return l === 0 ? '—' : l.toFixed(3)
}

function fmtW(wSeconds: number): string {
  return wSeconds === 0 ? '—' : fmtMs(wSeconds * 1000)
}

function fmtEventTime(timestampMs: number): string {
  if (timestampMs < 1000) return `${timestampMs.toFixed(3)}ms`
  return `${(timestampMs / 1000).toFixed(3)}s`
}

function clampSequence(sequence: number, maxSequence: number): number {
  return Math.min(maxSequence, Math.max(0, sequence))
}

function totalReplayEventCount(output: SimulationOutput): number {
  return Object.values(output.eventCountsByType).reduce((sum, count) => sum + count, 0)
}

const SECTION_TITLE = 'text-[11px] font-semibold text-nss-muted uppercase tracking-wider'
const SURFACE_CARD = 'bg-nss-surface border border-nss-border rounded-md'
const EVENT_LOG_PAGE_SIZE = 50
const RESULTS_TABS: Array<{ id: ResultsTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'bottlenecks', label: 'Bottlenecks' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'traffic', label: 'Traffic' }
]

const E2E_PERCENTILE_TOOLTIPS: Record<'p50' | 'p90' | 'p95' | 'p99' | 'max', string> = {
  p50: 'Median end-to-end latency. Half of requests were faster than this, half slower.',
  p90: '90th percentile — 10% of requests were slower than this value.',
  p95: '95th percentile — typical SLO target for latency-sensitive services.',
  p99: '99th percentile tail latency — 1% of requests were slower. Most user-facing SLOs live here.',
  max: 'Slowest observed request. Useful for spotting outliers; not a reliable tail metric.'
}

const HEALTH_CHECK_TOOLTIPS = {
  slo: "Compares each node's measured p99 latency and availability against the SLO targets you configured on the node.",
  errorRate:
    'Breakdown of rejected, timed-out, and connection-reset requests by node. Rejections happen when the queue is full; timeouts happen when the client waits too long; connection resets happen when in-flight work is explicitly dropped.',
  littlesLaw:
    "Little's Law (L = λ·W) is a queueing-theory identity that must hold in steady state. Violations usually indicate either measurement noise at low utilization, or that the simulation never reached steady state. At very low L (<0.1), relative errors can be large while absolute differences are sub-request — treat these as noise.",
  conservation:
    'Verifies that for every node: arrived = processed + rejected + timed out + connection reset + in-flight at cutoff. Small non-zero in-flight counts are expected when the run ends with requests still being processed.',
  warmup:
    "Checks that warmup duration is at least 10× the max observed p99. If it isn't, post-warmup metrics may still be contaminated by startup transients."
} as const

const PER_NODE_COLUMN_TOOLTIPS = {
  arrived: 'Requests that reached this node during the post-warmup window.',
  done: 'Requests this node finished processing before the simulation cutoff (post-warmup).',
  reject: "Requests turned away because the node's queue was full.",
  timedOut: "Requests that exceeded this node's processing timeout.",
  reset:
    'Requests explicitly terminated with connection_reset while queued, in service, or released from a hung recovery path.',
  errorRate:
    'Rejected + timed out + connection reset, divided by post-warmup arrivals at this node. Read the latency columns with this value, never by themselves.',
  arrivalCV:
    'Coefficient of variation of inter-arrival gaps at this node. 0 = perfectly even; ≈1 = Poisson. If this is higher than the offered CV, upstream jitter or contention bunched requests before this node.',
  inFlight:
    'Requests that had arrived at this node but were still queued or processing when the simulation ended.',
  avgQueue: 'Time-averaged queue depth (requests waiting, not yet being processed).',
  util: 'Fraction of workers busy on average. Below 70% is comfortable; above 80% queueing grows sharply; near 100% the node is saturated.',
  p50: 'Median service + queue time at this node only. Does not include network/link latency.',
  p95: '95th percentile per-hop latency at this node.',
  p99: '99th percentile per-hop latency at this node. Per-hop p99s do not sum to end-to-end p99.',
  lambda: 'Arrival rate (λ, requests per second) during the post-warmup window.',
  w: 'Mean time a request spends at this node (W, service + queue). End-to-end latency is roughly the sum of W across the path.',
  l: "Average number of requests concurrently at this node (L). By Little's Law, L = λ·W."
} as const

function eventStatusClass(status: DebugEvent['status']): string {
  switch (status) {
    case 'success':
      return 'text-nss-success bg-nss-success/10 border-nss-success/20'
    case 'timeout':
      return 'text-nss-warning bg-nss-warning/10 border-nss-warning/20'
    case 'rejected':
    case 'failure':
      return 'text-nss-danger bg-nss-danger/10 border-nss-danger/20'
    default:
      return 'text-nss-muted bg-nss-surface border-nss-border'
  }
}

function includesTerm(value: string | undefined, term: string): boolean {
  return value?.toLowerCase().includes(term) ?? false
}

function labelForNode(nodeId: string | undefined, lookup: EventGraphLookup): string | undefined {
  return nodeId ? lookup.nodeLabelById.get(nodeId) : undefined
}

function nodeDisplayName(event: DebugEvent, lookup: EventGraphLookup): string {
  return labelForNode(event.nodeId, lookup) ?? event.nodeId ?? '—'
}

function routeDisplayName(event: DebugEvent, lookup: EventGraphLookup): string {
  const edge = event.edgeId ? lookup.edgeById.get(event.edgeId) : undefined
  const sourceId = event.sourceNodeId ?? edge?.source
  const targetId = event.targetNodeId ?? edge?.target
  const source = labelForNode(sourceId, lookup) ?? sourceId
  const target = labelForNode(targetId, lookup) ?? targetId

  return source || target ? `${source ?? '—'} → ${target ?? '—'}` : '—'
}

function edgeDisplay(
  event: DebugEvent,
  lookup: EventGraphLookup
): { primary: string; secondary?: string; title?: string } {
  const edge = event.edgeId ? lookup.edgeById.get(event.edgeId) : undefined
  const route = routeDisplayName(event, lookup)
  const hasRoute = route !== '—'
  const protocolMode = [edge?.protocol, edge?.mode].filter(Boolean).join(' / ')
  const primary = edge?.label ?? (hasRoute ? route : event.edgeId) ?? '—'
  const secondaryParts: string[] = []

  if (edge?.label && hasRoute) {
    secondaryParts.push(route)
  }
  if (protocolMode) {
    secondaryParts.push(protocolMode)
  }

  return {
    primary,
    secondary: secondaryParts.length > 0 ? secondaryParts.join(' • ') : undefined,
    title: [event.edgeId, edge?.label, route, protocolMode].filter(Boolean).join(' | ')
  }
}

function eventMatchesQuery(event: DebugEvent, query: string, lookup: EventGraphLookup): boolean {
  const normalized = query.trim()
  if (normalized.length === 0) {
    return true
  }

  return normalized
    .split(/\s+OR\s+/i)
    .some((group) =>
      group.split(/\s+AND\s+/i).every((term) => eventMatchesTerm(event, term, lookup))
    )
}

function eventMatchesTerm(event: DebugEvent, rawTerm: string, lookup: EventGraphLookup): boolean {
  const term = rawTerm.trim()
  if (term.length === 0) {
    return true
  }

  const edge = event.edgeId ? lookup.edgeById.get(event.edgeId) : undefined
  const sourceId = event.sourceNodeId ?? edge?.source
  const targetId = event.targetNodeId ?? edge?.target

  const [field, ...rest] = term.split(':')
  const value = rest.join(':').toLowerCase()
  if (!value) {
    return event.message.toLowerCase().includes(term.toLowerCase())
  }

  switch (field.toLowerCase()) {
    case 'request':
      return includesTerm(event.requestId, value)
    case 'node':
      return (
        includesTerm(event.nodeId, value) ||
        includesTerm(labelForNode(event.nodeId, lookup), value) ||
        includesTerm(sourceId, value) ||
        includesTerm(labelForNode(sourceId, lookup), value) ||
        includesTerm(targetId, value) ||
        includesTerm(labelForNode(targetId, lookup), value)
      )
    case 'edge':
      return (
        includesTerm(event.edgeId, value) ||
        includesTerm(edge?.label, value) ||
        includesTerm(edge?.protocol, value) ||
        includesTerm(edge?.mode, value) ||
        includesTerm(sourceId, value) ||
        includesTerm(labelForNode(sourceId, lookup), value) ||
        includesTerm(targetId, value) ||
        includesTerm(labelForNode(targetId, lookup), value)
      )
    case 'status':
      return event.status.toLowerCase() === value
    case 'type':
      return event.type.toLowerCase() === value
    default:
      return event.message.toLowerCase().includes(term.toLowerCase())
  }
}

function RunContextPanel({ runContext }: { runContext: ScenarioRunContext }) {
  const workload = runContext.workload
  const patternExtras: string[] = []

  if (workload.pattern === 'bursty' && workload.bursty) {
    patternExtras.push(
      `${workload.bursty.burstRps} burst rps`,
      `${workload.bursty.burstDuration}ms burst`,
      `${workload.bursty.normalDuration}ms normal`
    )
  }

  if (workload.pattern === 'spike' && workload.spike) {
    patternExtras.push(
      `${workload.spike.spikeRps} spike rps`,
      `t=${workload.spike.spikeTime}ms`,
      `${workload.spike.spikeDuration}ms duration`
    )
  }

  if (workload.pattern === 'sawtooth' && workload.sawtooth) {
    patternExtras.push(
      `${workload.sawtooth.peakRps} peak rps`,
      `${workload.sawtooth.rampDuration}ms ramp`
    )
  }

  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Run Context</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <StatCard label="Source" value={runContext.sourceLabel} />
        <StatCard label="Pattern" value={workload.pattern} />
        <StatCard label="Base RPS" value={`${workload.baseRps.toFixed(1)} req/s`} />
        <StatCard label="Duration" value={fmtSeconds(runContext.global.simulationDuration)} />
        <StatCard label="Warmup" value={fmtSeconds(runContext.global.warmupDuration)} />
        <StatCard label="Seed" value={runContext.global.seed} />
      </div>
      {patternExtras.length > 0 && (
        <div className={`${SURFACE_CARD} p-2 text-xs text-nss-muted`}>
          {patternExtras.join(' • ')}
        </div>
      )}
    </div>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-nss-surface border border-nss-border rounded-full h-2 overflow-hidden">
      <div
        className="h-2 rounded-full bg-nss-primary transition-all duration-200"
        style={{ width: `${Math.min(100, progress)}%` }}
      />
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  highlight,
  tooltip
}: {
  label: string
  value: string
  highlight?: 'ok' | 'warn' | 'crit'
  tooltip?: string
}) {
  const colour =
    highlight === 'crit'
      ? 'text-nss-danger'
      : highlight === 'warn'
        ? 'text-nss-warning'
        : 'text-nss-text'

  return (
    <div className={`${SURFACE_CARD} p-2`} title={tooltip}>
      <div className="text-xs text-nss-muted">{label}</div>
      <div className={`font-medium tabular-nums text-sm ${colour}`}>{value}</div>
    </div>
  )
}

function LatencyPopulationSection({
  title,
  subtitle,
  sampleCount,
  errorRate,
  children
}: {
  title: string
  subtitle: string
  sampleCount: number
  errorRate: number
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className={SECTION_TITLE}>{title}</h3>
          <p className="text-[10px] text-nss-muted">{subtitle}</p>
        </div>
        <div className="text-right text-[10px] text-nss-muted tabular-nums">
          <div>{sampleCount.toLocaleString()} samples</div>
          <div>Error rate: {fmtPct(errorRate)}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

function TimeToErrorCard({
  title,
  count,
  errorRate,
  shareOfErrors,
  p50,
  p95,
  p99
}: {
  title: string
  count: number
  errorRate: number
  shareOfErrors: number
  p50: number | null
  p95: number | null
  p99: number | null
}) {
  return (
    <div className={`${SURFACE_CARD} p-2 space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-nss-text">{title}</div>
          <div className="text-[10px] text-nss-muted">
            {count.toLocaleString()} failures • {fmtPct(shareOfErrors)} of errors
          </div>
        </div>
        <div className="text-right text-[10px] text-nss-muted tabular-nums">
          <div>{fmtPct(errorRate)} of requests</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs text-center">
        {[
          { key: 'p50', value: p50 },
          { key: 'p95', value: p95 },
          { key: 'p99', value: p99 }
        ].map((metric) => (
          <div key={metric.key} className="rounded border border-nss-border bg-nss-panel p-1.5">
            <div className="text-nss-muted">{metric.key}</div>
            <div className="font-medium tabular-nums text-nss-text">{fmtMs(metric.value)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Summary Panel ────────────────────────────────────────────────────────────

function SummaryPanel({ output }: { output: SimulationOutput }) {
  const { summary } = output
  const l = summary.latency
  // Only show causes that actually fired — a "Node Failed" card appearing while
  // "Queue Full" stays absent is exactly the dead-vs-overloaded discriminator.
  const timeToErrorEntries = (
    Object.entries(summary.timeToErrorByCause) as Array<
      [
        keyof typeof summary.timeToErrorByCause,
        (typeof summary.timeToErrorByCause)[keyof typeof summary.timeToErrorByCause]
      ]
    >
  ).filter(([, metrics]) => metrics.count > 0)
  const throughputDisplay = summary.postWarmupTotalRequests > 0 ? fmtRps(summary.throughput) : '—'
  const totalInFlightAtCutoff = output.conservationCheck.reduce(
    (sum, result) => sum + result.inFlight,
    0
  )

  const windowStart = output.warmupDuration / 1000
  const windowEnd = output.simulationDuration / 1000
  const windowLen = windowEnd - windowStart

  const errorHighlight: 'ok' | 'warn' | 'crit' = failureRateLevelFromRatio(summary.errorRate)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className={SECTION_TITLE}>Summary</h3>
        <span className="text-[10px] text-nss-muted tabular-nums">
          Window: t={windowStart.toFixed(0)}s → t={windowEnd.toFixed(0)}s&nbsp;(
          {windowLen.toFixed(0)}s,&nbsp;{summary.postWarmupTotalRequests.toLocaleString()} samples)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        <StatCard
          label="Requests (post-warmup)"
          value={summary.postWarmupTotalRequests.toLocaleString()}
          tooltip="Total requests that entered the system after warmup ended. Warmup samples are excluded so transient startup behavior doesn't skew the metrics."
        />
        <StatCard
          label="Successful"
          value={summary.postWarmupSuccessfulRequests.toLocaleString()}
          tooltip="Requests that both entered after warmup and eventually completed successfully."
        />
        <StatCard
          label="Throughput"
          value={throughputDisplay}
          tooltip="Requests completed per second, averaged over the post-warmup window. If this exceeds your configured Base RPS, something (retries, fan-out, misconfigured source) is amplifying traffic."
        />
        <StatCard
          label="Error Rate"
          value={fmtPct(summary.errorRate)}
          highlight={errorHighlight}
          tooltip="Fraction of post-warmup requests that failed. This includes instant rejects, timeout walls, and connection resets."
        />
        <StatCard
          label="In Flight at Cutoff"
          value={totalInFlightAtCutoff.toLocaleString()}
          highlight={totalInFlightAtCutoff > 0 ? 'warn' : 'ok'}
          tooltip="Requests that had entered at least one node after warmup, but had not yet completed, timed out, or been rejected when the simulation stopped."
        />
        <StatCard
          label="Offered Arrival CV"
          value={fmtCv(summary.offeredArrivalCV)}
          tooltip="Coefficient of variation of source-generated inter-arrival gaps after warmup. 0 means perfectly even; ≈1 is Poisson."
        />
      </div>

      {totalInFlightAtCutoff > 0 && (
        <div className="rounded-md border border-nss-warning/20 bg-nss-warning/10 px-3 py-2 text-xs text-nss-warning">
          {totalInFlightAtCutoff.toLocaleString()} request
          {totalInFlightAtCutoff === 1 ? '' : 's'} were still in flight when the simulation hit its
          duration limit. They are not counted as completed or failed.
        </div>
      )}

      <LatencyPopulationSection
        title="Success Latency"
        subtitle="Successful requests only. Read these percentiles together with the paired error rate for the same steady-state window."
        sampleCount={summary.successLatencySamples}
        errorRate={summary.latencyWindowErrorRate}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span
            className="text-[10px] text-nss-muted"
            title="Percentiles don't compose — E2E p99 ≠ sum of per-hop p99s. Use per-node mean (W) for additive decomposition."
          >
            ⓘ percentiles do not sum across hops
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1 text-xs text-center">
          {(['p50', 'p90', 'p95', 'p99', 'max'] as const).map((k) => (
            <div key={k} className={`${SURFACE_CARD} p-1.5`} title={E2E_PERCENTILE_TOOLTIPS[k]}>
              <div className="text-nss-muted">{k}</div>
              <div className="font-medium tabular-nums text-nss-text">{fmtMs(l[k])}</div>
            </div>
          ))}
        </div>
      </LatencyPopulationSection>

      <LatencyPopulationSection
        title="Time-to-Error"
        subtitle="Failed requests only, split by cause so instant rejects, silent timeouts, and connection resets do not blend into one fake latency distribution."
        sampleCount={summary.timeToErrorSamples}
        errorRate={summary.latencyWindowErrorRate}
      >
        <div className="grid gap-2 md:grid-cols-3">
          {timeToErrorEntries.map(([cause, metrics]) => (
            <TimeToErrorCard
              key={cause}
              title={ERROR_CAUSE_LABELS[cause]}
              count={metrics.count}
              errorRate={metrics.errorRate}
              shareOfErrors={metrics.shareOfErrors}
              p50={metrics.p50}
              p95={metrics.p95}
              p99={metrics.p99}
            />
          ))}
        </div>
      </LatencyPopulationSection>
    </div>
  )
}

// ─── Simulation Health ────────────────────────────────────────────────────────

type HealthLevel = 'healthy' | 'warnings' | 'breaches'

function worstLevel(levels: HealthLevel[]): HealthLevel {
  if (levels.includes('breaches')) return 'breaches'
  if (levels.includes('warnings')) return 'warnings'
  return 'healthy'
}

function HealthBadge({ level }: { level: HealthLevel }) {
  const conf: Record<HealthLevel, { label: string; cls: string }> = {
    healthy: { label: 'Healthy', cls: 'text-nss-success bg-nss-success/10 border-nss-success/20' },
    warnings: {
      label: 'Warnings',
      cls: 'text-nss-warning bg-nss-warning/10 border-nss-warning/20'
    },
    breaches: { label: 'Breaches', cls: 'text-nss-danger bg-nss-danger/10 border-nss-danger/20' }
  }
  const { label, cls } = conf[level]
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${cls}`}>{label}</span>
  )
}

function CollapsibleCheck({
  title,
  level,
  tooltip,
  children
}: {
  title: string
  level: HealthLevel
  tooltip?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const iconCls =
    level === 'breaches'
      ? 'text-nss-danger'
      : level === 'warnings'
        ? 'text-nss-warning'
        : 'text-nss-success'
  const icon = level === 'healthy' ? '✓' : level === 'warnings' ? '⚠' : '✕'

  return (
    <div className="border border-nss-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={contentId}
        title={tooltip}
        className="w-full flex items-center justify-between px-3 py-2 bg-nss-surface hover:bg-nss-bg text-left transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-medium text-nss-text">
          <span className={iconCls}>{icon}</span>
          {title}
        </span>
        <span className="text-nss-muted text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div id={contentId} className="px-3 py-2 bg-nss-panel space-y-1">
          {children}
        </div>
      )}
    </div>
  )
}

type NodeMetric = SimulationOutput['perNode'][string]
type EdgeMetric = SimulationOutput['perEdge'][string]
type ErrorCauseKey = keyof typeof ERROR_CAUSE_LABELS

/** Node-local success samples below this render latency as "low sample", grayed. */
const LOW_SAMPLE_FLOOR = 50

const CONDITION_CLASSES: Record<'ok' | 'warn' | 'crit', string> = {
  ok: 'text-nss-success border-nss-success/30 bg-nss-success/10',
  warn: 'text-nss-warning border-nss-warning/30 bg-nss-warning/10',
  crit: 'text-nss-danger border-nss-danger/30 bg-nss-danger/10'
}

function dominantCause(tte: NodeMetric['timeToErrorByCause']): ErrorCauseKey | null {
  return dominantTimeToErrorCause(tte)
}

/**
 * A node's condition, derived from its own scoped metrics. Status is the
 * headline; latency is subordinate to it. A dead node (no successful node-local
 * passes) never renders as healthy, and the dominant failure cause separates
 * "overloaded" (queue_full) from "dead" (node_failed) from "silent" (timeout).
 */
function nodeCondition(m: NodeMetric): { label: string; level: 'ok' | 'warn' | 'crit' } {
  const hasWindowSamples = m.successLatencySamples + m.timeToErrorSamples > 0
  if (m.postWarmupArrived === 0 && !hasWindowSamples) return { label: 'Idle', level: 'ok' }
  const served = m.successLatencySamples > 0
  const dominant = dominantCause(m.timeToErrorByCause)

  if (!served && m.latencyWindowErrorRate > 0.5) {
    if (dominant === 'timeout') return { label: 'Silent (timing out)', level: 'crit' }
    return { label: 'Down', level: 'crit' }
  }
  if (m.latencyWindowErrorRate > 0.05) {
    switch (dominant) {
      case 'node_failed':
        return { label: 'Failing', level: 'crit' }
      case 'queue_full':
        return { label: 'Overloaded', level: 'warn' }
      case 'timeout':
        return { label: 'Timing out', level: 'warn' }
      case 'network_error':
        return { label: 'Network errors', level: 'warn' }
      default:
        return { label: 'Degraded', level: 'warn' }
    }
  }
  return { label: 'Healthy', level: 'ok' }
}

/**
 * State-aware node card. Every number declares its population, window, and locus
 * inline (node-local, over the served count) — a bare "8ms" is a different,
 * wrong claim. The card never puts an approving mark next to a latency when the
 * node is down: the survivor-bias 8ms is only over requests that succeeded.
 */
function NodeConditionCard({ nodeId, m }: { nodeId: string; m: NodeMetric }) {
  const condition = nodeCondition(m)
  const served = m.successLatencySamples
  const lowSample = served > 0 && served < LOW_SAMPLE_FLOOR
  const p95 = m.latencyNodeLocal.p95
  const dominant = dominantCause(m.timeToErrorByCause)

  return (
    <div className={`${SURFACE_CARD} p-2.5 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-nss-text truncate">{m.nodeLabel ?? nodeId}</span>
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CONDITION_CLASSES[condition.level]}`}
        >
          {condition.label}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-nss-muted uppercase tracking-wide">p95 latency</span>
        <span
          className={`text-sm font-medium tabular-nums ${lowSample ? 'text-nss-muted' : 'text-nss-text'}`}
        >
          {fmtMs(p95)}
        </span>
      </div>
      <div className="text-[10px] text-nss-muted">
        node-local · {served.toLocaleString()} successes{lowSample ? ' · low sample' : ''}
        {p95 === null ? ' · no successful passes in this window' : ''}
      </div>

      <div className="flex items-baseline justify-between gap-2 border-t border-nss-border pt-1.5">
        <span className="text-[10px] text-nss-muted uppercase tracking-wide">error rate</span>
        <span
          className={`text-sm font-medium tabular-nums ${
            m.latencyWindowErrorRate > 0.05
              ? 'text-nss-danger'
              : m.latencyWindowErrorRate > 0.01
                ? 'text-nss-warning'
                : 'text-nss-muted'
          }`}
        >
          {fmtPct(m.latencyWindowErrorRate)}
        </span>
      </div>
      <div className="text-[10px] text-nss-muted">
        {dominant ? `mostly ${ERROR_CAUSE_LABELS[dominant]}` : 'no failures at this node'}
        {' · same window as latency'}
      </div>
    </div>
  )
}

function conditionRank(level: 'ok' | 'warn' | 'crit'): number {
  return level === 'crit' ? 2 : level === 'warn' ? 1 : 0
}

function NodeConditionCards({ output }: { output: SimulationOutput }) {
  const active = Object.entries(output.perNode)
    .filter(
      ([, m]) => m.postWarmupArrived > 0 || m.successLatencySamples > 0 || m.timeToErrorSamples > 0
    )
    .sort(([, a], [, b]) => {
      const aCondition = nodeCondition(a)
      const bCondition = nodeCondition(b)
      return (
        conditionRank(bCondition.level) - conditionRank(aCondition.level) ||
        b.latencyWindowErrorRate - a.latencyWindowErrorRate ||
        b.timeToErrorSamples - a.timeToErrorSamples ||
        b.successLatencySamples - a.successLatencySamples
      )
    })
  if (active.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Node Health</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {active.map(([nodeId, m]) => (
          <NodeConditionCard key={nodeId} nodeId={nodeId} m={m} />
        ))}
      </div>
    </div>
  )
}

/**
 * The two one-line verdicts an operator actually wants: where time goes, and
 * where requests die. Computed from the phase-timeline decomposition and the
 * failure-by-locus Pareto — the same data every other panel projects from.
 */
function BottleneckVerdicts({
  output,
  onSelectComponent
}: {
  output: SimulationOutput
  onSelectComponent?: (selection: SelectedComponent) => void
}) {
  const { latencyDecomposition, failuresByLocus } = output.summary
  const latTop = latencyDecomposition[0]
  const failTop = failuresByLocus[0]
  const latencySelection =
    latTop && latTop.kind !== 'unattributed'
      ? ({
          kind: latTop.kind === 'edge' ? 'edge' : 'node',
          id: latTop.component
        } satisfies SelectedComponent)
      : null
  const failureSelection = failTop
    ? ({
        kind: failTop.locusKind,
        id: failTop.locus
      } satisfies SelectedComponent)
    : null
  const latencyLabel =
    latTop && latTop.kind !== 'edge' && latTop.component !== 'unattributed'
      ? (output.perNode[latTop.component]?.nodeLabel ?? latTop.label)
      : latTop?.kind === 'edge'
        ? (output.perEdge[latTop.component]?.edgeLabel ?? latTop.label)
        : latTop?.label
  const failureLabel =
    failTop?.locusKind === 'node'
      ? (output.perNode[failTop.locus]?.nodeLabel ?? failTop.locus)
      : (output.perEdge[failTop?.locus ?? '']?.edgeLabel ?? failTop?.locus)
  const rowClass =
    'w-full text-left rounded border border-transparent px-1.5 py-1 -mx-1.5 hover:border-nss-border hover:bg-nss-panel transition-colors'

  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Bottlenecks</h3>
      <div className={`${SURFACE_CARD} p-2.5 space-y-2`}>
        <div>
          <div className="text-[10px] text-nss-muted uppercase tracking-wide">
            Latency bottleneck
          </div>
          {latTop ? (
            <button
              type="button"
              className={rowClass}
              onClick={() => latencySelection && onSelectComponent?.(latencySelection)}
              disabled={!latencySelection}
            >
              <div className="text-xs text-nss-text">
                <span className="font-medium">{latencyLabel}</span>{' '}
                <span className="text-nss-muted">
                  — {fmtMs(latTop.meanMs)} ({fmtPct(latTop.shareOfEndToEnd)} of end-to-end,{' '}
                  {latTop.kind})
                </span>
              </div>
            </button>
          ) : (
            <div className="text-xs text-nss-muted">No completed requests to decompose.</div>
          )}
        </div>
        <div className="border-t border-nss-border pt-2">
          <div className="text-[10px] text-nss-muted uppercase tracking-wide">
            Failure bottleneck
          </div>
          {failTop ? (
            <button
              type="button"
              className={rowClass}
              onClick={() => failureSelection && onSelectComponent?.(failureSelection)}
              disabled={!failureSelection}
            >
              <div className="text-xs text-nss-text">
                <span className="font-medium">{failureLabel}</span>{' '}
                <span className="text-nss-muted">
                  — {failTop.total.toLocaleString()} killed (
                  {ERROR_CAUSE_LABELS[failTop.dominantCause]}, {fmtPct(failTop.shareOfFailures)} of
                  failures)
                </span>
              </div>
            </button>
          ) : (
            <div className="text-xs text-nss-success">No failures — nothing to locate.</div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The status timeline: each component's failure windows shaded over the run's
 * time axis. Partitions the run into before / during / after at a glance, and
 * makes the survivor-bias trap self-evident — success samples all live outside
 * the red bands.
 */
function StatusTimelineStrip({ output }: { output: SimulationOutput }) {
  const windows = output.statusTimeline
  if (windows.length === 0) return null

  const totalMs = output.simulationDuration || 1
  const warmupMs = output.warmupDuration
  const pct = (ms: number): number => Math.max(0, Math.min(100, (ms / totalMs) * 100))

  const byComponent = new Map<string, typeof windows>()
  for (const w of windows) {
    const list = byComponent.get(w.componentId) ?? []
    list.push(w)
    byComponent.set(w.componentId, list)
  }

  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Status Timeline</h3>
      <div className={`${SURFACE_CARD} p-2.5 space-y-2`}>
        {[...byComponent].map(([componentId, comp]) => (
          <div key={componentId}>
            <div className="text-[10px] text-nss-muted mb-0.5">
              {output.perNode[componentId]?.nodeLabel ??
                output.perEdge[componentId]?.edgeLabel ??
                componentId}
            </div>
            <div className="relative h-4 rounded bg-nss-panel overflow-hidden">
              {warmupMs > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-nss-border/40"
                  style={{ width: `${pct(warmupMs)}%` }}
                  title={`warmup ${(warmupMs / 1000).toFixed(0)}s (excluded from metrics)`}
                />
              )}
              {comp.map((w, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 bg-nss-danger/40 border-x border-nss-danger/70"
                  style={{
                    left: `${pct(w.startMs)}%`,
                    width: `${Math.max(0.5, pct(w.endMs) - pct(w.startMs))}%`
                  }}
                  title={`${w.mode} · ${(w.startMs / 1000).toFixed(1)}s → ${(w.endMs / 1000).toFixed(1)}s`}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="flex justify-between text-[9px] text-nss-muted tabular-nums">
          <span>t=0</span>
          <span className="text-nss-danger">▮ failure window</span>
          <span>t={(totalMs / 1000).toFixed(0)}s</span>
        </div>
      </div>
    </div>
  )
}

type ChartPoint = { xMs: number; y: number | null }
type ChartSeries = { label: string; color: string; points: ChartPoint[] }

function edgeCondition(m: EdgeMetric): { label: string; level: 'ok' | 'warn' | 'crit' } {
  const total = m.successLatencySamples + m.timeToErrorSamples
  if (total === 0) return { label: 'Idle', level: 'ok' }
  const dominant = dominantCause(m.timeToErrorByCause)
  if (m.successLatencySamples === 0 && m.latencyWindowErrorRate > 0.5) {
    return { label: 'Broken', level: 'crit' }
  }
  if (m.latencyWindowErrorRate > 0.05) {
    switch (dominant) {
      case 'timeout':
        return { label: 'Timing out', level: 'warn' }
      case 'network_error':
        return { label: 'Dropping', level: 'warn' }
      default:
        return { label: 'Degraded', level: 'warn' }
    }
  }
  return { label: 'Healthy', level: 'ok' }
}

function componentLabel(output: SimulationOutput, selection: SelectedComponent): string {
  if (selection.kind === 'node') {
    return output.perNode[selection.id]?.nodeLabel ?? selection.id
  }
  return output.perEdge[selection.id]?.edgeLabel ?? selection.id
}

function defaultSelectedComponent(output: SimulationOutput): SelectedComponent | null {
  const failureTop = output.summary.failuresByLocus[0]
  if (failureTop) {
    return { kind: failureTop.locusKind, id: failureTop.locus }
  }

  const latencyTop = output.summary.latencyDecomposition.find(
    (entry) => entry.kind !== 'unattributed'
  )
  if (latencyTop) {
    return { kind: latencyTop.kind === 'edge' ? 'edge' : 'node', id: latencyTop.component }
  }

  const firstNode = Object.entries(output.perNode).find(
    ([, metric]) =>
      metric.postWarmupArrived > 0 ||
      metric.successLatencySamples > 0 ||
      metric.timeToErrorSamples > 0
  )
  if (firstNode) {
    return { kind: 'node', id: firstNode[0] }
  }

  const firstEdge = Object.entries(output.perEdge).find(
    ([, metric]) => metric.successLatencySamples > 0 || metric.timeToErrorSamples > 0
  )
  if (firstEdge) {
    return { kind: 'edge', id: firstEdge[0] }
  }

  return null
}

function statusWindowsForSelection(
  output: SimulationOutput,
  selection: SelectedComponent
): StatusWindow[] {
  const scoped = output.statusTimeline.filter((window) => window.componentId === selection.id)
  return scoped.length > 0 ? scoped : output.statusTimeline
}

function latencyWindowPointSeries(
  windows: SimulationOutput['summary']['latencyWindows'],
  metric: 'p95' | 'p99' | 'errorRate'
): ChartPoint[] {
  return windows.map((window) => ({
    xMs: (window.windowStartMs + window.windowEndMs) / 2,
    y: metric === 'errorRate' ? window.errorRate * 100 : window[metric]
  }))
}

function nodeTimeSeries(
  output: SimulationOutput,
  nodeId: string,
  metric: 'queueLength' | 'utilization'
): ChartPoint[] {
  return output.timeSeries.map((snapshot) => {
    const node = snapshot.node[nodeId]
    if (!node) {
      return { xMs: snapshot.timestamp, y: null }
    }
    return {
      xMs: snapshot.timestamp,
      y: metric === 'queueLength' ? node.queueLength : node.utilization * 100
    }
  })
}

function linePath(
  points: ChartPoint[],
  xAt: (xMs: number) => number,
  yAt: (y: number) => number
): string | null {
  const defined = points.filter((point) => point.y !== null) as Array<{ xMs: number; y: number }>
  if (defined.length < 2) {
    return null
  }

  return defined
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(point.xMs)},${yAt(point.y)}`)
    .join(' ')
}

function TimelineChart({
  title,
  subtitle,
  totalDurationMs,
  warmupDurationMs,
  statusWindows,
  series,
  yFormatter
}: {
  title: string
  subtitle: string
  totalDurationMs: number
  warmupDurationMs: number
  statusWindows: StatusWindow[]
  series: ChartSeries[]
  yFormatter: (value: number | null) => string
}) {
  const width = 640
  const height = 180
  const margin = { top: 12, right: 12, bottom: 24, left: 36 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const duration = Math.max(1, totalDurationMs)
  const values = series.flatMap((item) =>
    item.points.map((point) => point.y).filter((value): value is number => value !== null)
  )
  const yMax = values.length > 0 ? Math.max(1, ...values) : 1
  const xAt = (xMs: number) =>
    margin.left + (Math.max(0, Math.min(duration, xMs)) / duration) * plotWidth
  const yAt = (value: number) => margin.top + plotHeight - (Math.max(0, value) / yMax) * plotHeight

  return (
    <div className={`${SURFACE_CARD} p-2.5 space-y-2`}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-nss-text">{title}</div>
          <div className="text-[10px] text-nss-muted">{subtitle}</div>
        </div>
        <div className="text-[10px] text-nss-muted tabular-nums">
          max {yFormatter(values.length > 0 ? yMax : null)}
        </div>
      </div>

      {values.length === 0 ? (
        <div className="rounded border border-dashed border-nss-border bg-nss-panel px-3 py-6 text-center text-xs text-nss-muted">
          No windowed samples for this chart.
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 rounded bg-nss-panel">
          <rect x={0} y={0} width={width} height={height} rx={8} fill="transparent" />
          {warmupDurationMs > 0 && (
            <rect
              x={margin.left}
              y={margin.top}
              width={(Math.min(duration, warmupDurationMs) / duration) * plotWidth}
              height={plotHeight}
              fill="rgba(148, 163, 184, 0.12)"
            />
          )}
          {statusWindows.map((window, index) => (
            <rect
              key={`${window.componentId}-${window.startMs}-${index}`}
              x={xAt(window.startMs)}
              y={margin.top}
              width={Math.max(2, xAt(window.endMs) - xAt(window.startMs))}
              height={plotHeight}
              fill="rgba(239, 68, 68, 0.16)"
            />
          ))}
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              key={fraction}
              x1={margin.left}
              x2={width - margin.right}
              y1={margin.top + plotHeight - plotHeight * fraction}
              y2={margin.top + plotHeight - plotHeight * fraction}
              stroke="rgba(148, 163, 184, 0.18)"
              strokeWidth={1}
            />
          ))}
          {series.map((item) => {
            const path = linePath(item.points, xAt, yAt)
            return (
              <g key={item.label}>
                {path && (
                  <path
                    d={path}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {item.points
                  .filter((point) => point.y !== null)
                  .map((point, index) => (
                    <circle
                      key={`${item.label}-${index}`}
                      cx={xAt(point.xMs)}
                      cy={yAt(point.y as number)}
                      r={2.4}
                      fill={item.color}
                    />
                  ))}
              </g>
            )
          })}
          <text x={margin.left} y={height - 6} fill="rgba(148, 163, 184, 0.8)" fontSize="10">
            t=0
          </text>
          <text
            x={width - margin.right}
            y={height - 6}
            textAnchor="end"
            fill="rgba(148, 163, 184, 0.8)"
            fontSize="10"
          >
            t={(duration / 1000).toFixed(0)}s
          </text>
        </svg>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-nss-muted">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
        <span className="text-nss-danger">failure windows shaded</span>
      </div>
    </div>
  )
}

function SystemWindowCharts({ output }: { output: SimulationOutput }) {
  if (output.summary.latencyWindows.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Windowed System View</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        <TimelineChart
          title="System Success p95"
          subtitle="Successful requests only; end-to-end latency in 1s termination windows."
          totalDurationMs={output.simulationDuration}
          warmupDurationMs={output.warmupDuration}
          statusWindows={output.statusTimeline}
          series={[
            {
              label: 'p95 latency',
              color: '#60a5fa',
              points: latencyWindowPointSeries(output.summary.latencyWindows, 'p95')
            }
          ]}
          yFormatter={fmtMs}
        />
        <TimelineChart
          title="System Error Rate"
          subtitle="Failed terminals divided by all terminals over the same 1s windows."
          totalDurationMs={output.simulationDuration}
          warmupDurationMs={output.warmupDuration}
          statusWindows={output.statusTimeline}
          series={[
            {
              label: 'error rate',
              color: '#f97316',
              points: latencyWindowPointSeries(output.summary.latencyWindows, 'errorRate')
            }
          ]}
          yFormatter={(value) => (value === null ? 'N/A' : `${value.toFixed(1)}%`)}
        />
      </div>
    </div>
  )
}

function traceTouchesComponent(
  trace: SimulationOutput['traces'][number],
  selection: SelectedComponent
): boolean {
  if (selection.kind === 'node') {
    return (
      trace.phaseRecord?.nodes.some((phase) => phase.nodeId === selection.id) ??
      trace.spans.some((span) => span.nodeId === selection.id)
    )
  }

  return (
    trace.phaseRecord?.edges.some((phase) => phase.edgeId === selection.id) ??
    (trace.phaseRecord?.terminal?.locusKind === 'edge' &&
      trace.phaseRecord.terminal.locus === selection.id)
  )
}

function traceComponentDetail(
  trace: SimulationOutput['traces'][number],
  selection: SelectedComponent
): string | null {
  if (selection.kind === 'node') {
    const phases = trace.phaseRecord?.nodes.filter((phase) => phase.nodeId === selection.id) ?? []
    if (phases.length > 0) {
      let queueUs = 0
      let serviceUs = 0
      for (const phase of phases) {
        if (phase.serviceStartUs !== undefined) {
          queueUs += Number(phase.serviceStartUs - phase.nodeArrivalUs)
        }
        if (phase.serviceStartUs !== undefined && phase.departureUs !== undefined) {
          serviceUs += Number(phase.departureUs - phase.serviceStartUs)
        }
      }
      const terminalAtNode =
        trace.phaseRecord?.terminal?.locusKind === 'node' &&
        trace.phaseRecord.terminal.locus === selection.id
      const timeToErrorMs =
        terminalAtNode && trace.phaseRecord?.terminal
          ? Number(trace.phaseRecord.terminal.timeUs - phases[phases.length - 1].nodeArrivalUs) /
            1000
          : null
      return [
        `${phases.length} visit${phases.length === 1 ? '' : 's'}`,
        `queue ${fmtMs(queueUs / 1000)}`,
        `service ${fmtMs(serviceUs / 1000)}`,
        timeToErrorMs !== null ? `time-to-error ${fmtMs(timeToErrorMs)}` : null
      ]
        .filter(Boolean)
        .join(' • ')
    }

    const spans = trace.spans.filter((span) => span.nodeId === selection.id)
    if (spans.length === 0) {
      return null
    }
    const queueMs = spans.reduce((sum, span) => sum + span.queueWait, 0)
    const serviceMs = spans.reduce((sum, span) => sum + span.serviceTime, 0)
    return [
      `${spans.length} visit${spans.length === 1 ? '' : 's'}`,
      `queue ${fmtMs(queueMs)}`,
      `service ${fmtMs(serviceMs)}`
    ].join(' • ')
  }

  const phases = trace.phaseRecord?.edges.filter((phase) => phase.edgeId === selection.id) ?? []
  if (phases.length === 0) {
    return null
  }
  const transitUs = phases.reduce(
    (sum, phase) =>
      sum + (phase.edgeOutUs !== undefined ? Number(phase.edgeOutUs - phase.edgeInUs) : 0),
    0
  )
  const terminalAtEdge =
    trace.phaseRecord?.terminal?.locusKind === 'edge' &&
    trace.phaseRecord.terminal.locus === selection.id
  const timeToErrorMs =
    terminalAtEdge && trace.phaseRecord?.terminal
      ? Number(trace.phaseRecord.terminal.timeUs - phases[phases.length - 1].edgeInUs) / 1000
      : null
  return [
    `${phases.length} attempt${phases.length === 1 ? '' : 's'}`,
    transitUs > 0 ? `transit ${fmtMs(transitUs / 1000)}` : null,
    timeToErrorMs !== null ? `time-to-error ${fmtMs(timeToErrorMs)}` : null
  ]
    .filter(Boolean)
    .join(' • ')
}

function ComponentSelectorPanel({
  output,
  selected,
  onSelect
}: {
  output: SimulationOutput
  selected: SelectedComponent | null
  onSelect: (selection: SelectedComponent) => void
}) {
  const nodeEntries = Object.entries(output.perNode)
    .filter(
      ([, metric]) =>
        metric.postWarmupArrived > 0 ||
        metric.successLatencySamples > 0 ||
        metric.timeToErrorSamples > 0
    )
    .sort(([, a], [, b]) => {
      const aCondition = nodeCondition(a)
      const bCondition = nodeCondition(b)
      return (
        conditionRank(bCondition.level) - conditionRank(aCondition.level) ||
        b.latencyWindowErrorRate - a.latencyWindowErrorRate
      )
    })
  const edgeEntries = Object.entries(output.perEdge)
    .filter(([, metric]) => metric.successLatencySamples > 0 || metric.timeToErrorSamples > 0)
    .sort(([, a], [, b]) => {
      const aCondition = edgeCondition(a)
      const bCondition = edgeCondition(b)
      return (
        conditionRank(bCondition.level) - conditionRank(aCondition.level) ||
        b.latencyWindowErrorRate - a.latencyWindowErrorRate
      )
    })

  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Component Selector</h3>
      <div className="grid gap-2 lg:grid-cols-2">
        {nodeEntries.map(([nodeId, metric]) => {
          const condition = nodeCondition(metric)
          const isSelected = selected?.kind === 'node' && selected.id === nodeId
          return (
            <button
              key={`node-${nodeId}`}
              type="button"
              onClick={() => onSelect({ kind: 'node', id: nodeId })}
              className={`${SURFACE_CARD} p-2.5 text-left transition-colors ${
                isSelected
                  ? 'ring-1 ring-inset ring-nss-primary border-nss-primary/40'
                  : 'hover:bg-nss-surface/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-nss-text">
                    {metric.nodeLabel ?? nodeId}
                  </div>
                  <div className="text-[10px] text-nss-muted">node-local scope</div>
                </div>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CONDITION_CLASSES[condition.level]}`}
                >
                  {condition.label}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-nss-muted tabular-nums">
                <div>p95 {fmtMs(metric.latencyNodeLocal.p95)}</div>
                <div className="text-right">Err {fmtPct(metric.latencyWindowErrorRate)}</div>
              </div>
            </button>
          )
        })}
        {edgeEntries.map(([edgeId, metric]) => {
          const condition = edgeCondition(metric)
          const isSelected = selected?.kind === 'edge' && selected.id === edgeId
          return (
            <button
              key={`edge-${edgeId}`}
              type="button"
              onClick={() => onSelect({ kind: 'edge', id: edgeId })}
              className={`${SURFACE_CARD} p-2.5 text-left transition-colors ${
                isSelected
                  ? 'ring-1 ring-inset ring-nss-primary border-nss-primary/40'
                  : 'hover:bg-nss-surface/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-nss-text">
                    {metric.edgeLabel}
                  </div>
                  <div className="text-[10px] text-nss-muted">
                    {metric.sourceNodeId} → {metric.targetNodeId}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CONDITION_CLASSES[condition.level]}`}
                >
                  {condition.label}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-nss-muted tabular-nums">
                <div>p95 {fmtMs(metric.transitLatency.p95)}</div>
                <div className="text-right">Err {fmtPct(metric.latencyWindowErrorRate)}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ComponentDrilldown({
  output,
  selected,
  onSelect
}: {
  output: SimulationOutput
  selected: SelectedComponent | null
  onSelect: (selection: SelectedComponent) => void
}) {
  if (!selected) {
    return (
      <div className="space-y-2">
        <ComponentSelectorPanel output={output} selected={selected} onSelect={onSelect} />
      </div>
    )
  }

  const traces = output.traces
    .filter((trace) => traceTouchesComponent(trace, selected))
    .sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'success' ? 1 : -1
      }
      return b.totalLatency - a.totalLatency
    })
    .slice(0, 6)

  const statusWindows = statusWindowsForSelection(output, selected)

  if (selected.kind === 'node') {
    const metric = output.perNode[selected.id]
    if (!metric) {
      return (
        <div className="space-y-2">
          <ComponentSelectorPanel output={output} selected={selected} onSelect={onSelect} />
        </div>
      )
    }

    const windows = metric.latencyWindows
    const condition = nodeCondition(metric)
    const label = componentLabel(output, selected)
    const timeToErrorEntries = (
      Object.entries(metric.timeToErrorByCause) as Array<
        [ErrorCauseKey, (typeof metric.timeToErrorByCause)[ErrorCauseKey]]
      >
    ).filter(([, summary]) => summary.count > 0)

    return (
      <div className="space-y-3">
        <ComponentSelectorPanel output={output} selected={selected} onSelect={onSelect} />

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className={SECTION_TITLE}>Component Drill-down</h3>
            <span className="text-[10px] text-nss-muted">
              node-local queue + service · 1s windows
            </span>
          </div>

          <div className={`${SURFACE_CARD} p-3 space-y-3`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-nss-text">{label}</div>
                <div className="text-[10px] text-nss-muted">
                  Latency is scoped to successful passes at this node only; failures are only
                  terminals that died here.
                </div>
              </div>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${CONDITION_CLASSES[condition.level]}`}
              >
                {condition.label}
              </span>
            </div>

            <div className="grid gap-2 text-sm md:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Kind" value={selected.kind} />
              <StatCard
                label="Success Samples"
                value={`${metric.successLatencySamples.toLocaleString()}`}
              />
              <StatCard
                label="Failure Samples"
                value={`${metric.timeToErrorSamples.toLocaleString()}`}
              />
              <StatCard
                label="Error Rate"
                value={fmtPct(metric.latencyWindowErrorRate)}
                highlight={failureRateLevelFromRatio(metric.latencyWindowErrorRate)}
              />
              <StatCard
                label="Offered CV"
                value={fmtCv(output.summary.offeredArrivalCV)}
                tooltip="Source-generated inter-arrival CV after warmup. Compare against this node's arrival CV to see how much variance the network added."
              />
              <StatCard
                label="Arrival CV"
                value={fmtCv(metric.arrivalCV)}
                highlight={
                  metric.arrivalCV !== null &&
                  output.summary.offeredArrivalCV !== null &&
                  metric.arrivalCV > output.summary.offeredArrivalCV + 0.05
                    ? 'warn'
                    : undefined
                }
                tooltip="Delivered inter-arrival CV at this node after warmup. 0 = perfectly even; ≈1 = Poisson."
              />
            </div>

            <div className="text-[10px] text-nss-muted">
              CV 0 means perfectly even spacing; CV ≈ 1 looks Poisson. When this node&apos;s arrival
              CV exceeds the offered CV, upstream edge jitter or congestion bunched requests before
              they hit this queue.
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <TimelineChart
                title="Success p95"
                subtitle="Successful requests only; node-local latency over 1s windows."
                totalDurationMs={output.simulationDuration}
                warmupDurationMs={output.warmupDuration}
                statusWindows={statusWindows}
                series={[
                  {
                    label: 'p95 latency',
                    color: '#60a5fa',
                    points: latencyWindowPointSeries(windows, 'p95')
                  }
                ]}
                yFormatter={fmtMs}
              />
              <TimelineChart
                title="Error Rate"
                subtitle="Terminals in the same 1s windows, scoped to this node."
                totalDurationMs={output.simulationDuration}
                warmupDurationMs={output.warmupDuration}
                statusWindows={statusWindows}
                series={[
                  {
                    label: 'error rate',
                    color: '#f97316',
                    points: latencyWindowPointSeries(windows, 'errorRate')
                  }
                ]}
                yFormatter={(value) => (value === null ? 'N/A' : `${value.toFixed(1)}%`)}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <TimelineChart
                title="Queue Depth"
                subtitle="Observed queue length snapshots for this node."
                totalDurationMs={output.simulationDuration}
                warmupDurationMs={output.warmupDuration}
                statusWindows={statusWindows}
                series={[
                  {
                    label: 'queue length',
                    color: '#a78bfa',
                    points: nodeTimeSeries(output, selected.id, 'queueLength')
                  }
                ]}
                yFormatter={(value) => (value === null ? 'N/A' : value.toFixed(1))}
              />
              <TimelineChart
                title="Utilization"
                subtitle="Observed worker utilization snapshots for this node."
                totalDurationMs={output.simulationDuration}
                warmupDurationMs={output.warmupDuration}
                statusWindows={statusWindows}
                series={[
                  {
                    label: 'utilization',
                    color: '#34d399',
                    points: nodeTimeSeries(output, selected.id, 'utilization')
                  }
                ]}
                yFormatter={(value) => (value === null ? 'N/A' : `${value.toFixed(1)}%`)}
              />
            </div>

            {timeToErrorEntries.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-nss-text">Per-cause Time-to-Error</div>
                <div className="grid gap-2 md:grid-cols-3">
                  {timeToErrorEntries.map(([cause, summary]) => (
                    <TimeToErrorCard
                      key={`${selected.kind}-${selected.id}-${cause}`}
                      title={ERROR_CAUSE_LABELS[cause]}
                      count={summary.count}
                      errorRate={summary.errorRate}
                      shareOfErrors={summary.shareOfErrors}
                      p50={summary.p50}
                      p95={summary.p95}
                      p99={summary.p99}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-medium text-nss-text">Traced Requests</div>
              {traces.length === 0 ? (
                <div className="rounded border border-dashed border-nss-border bg-nss-panel px-3 py-4 text-xs text-nss-muted">
                  No retained traces touched this component.
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {traces.map((trace) => (
                    <div key={trace.requestId} className={`${SURFACE_CARD} p-2 space-y-1`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-nss-text truncate">
                          {trace.requestId}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] ${eventStatusClass(
                            trace.status === 'success'
                              ? 'success'
                              : trace.status === 'timeout'
                                ? 'timeout'
                                : 'rejected'
                          )}`}
                        >
                          {trace.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-nss-muted">
                        total {fmtMs(trace.totalLatency)}
                      </div>
                      <div className="text-[10px] text-nss-muted">
                        {traceComponentDetail(trace, selected) ??
                          'No component-local phase detail retained.'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const metric = output.perEdge[selected.id]
  if (!metric) {
    return (
      <div className="space-y-2">
        <ComponentSelectorPanel output={output} selected={selected} onSelect={onSelect} />
      </div>
    )
  }

  const timeToErrorEntries = (
    Object.entries(metric.timeToErrorByCause) as Array<
      [ErrorCauseKey, (typeof metric.timeToErrorByCause)[ErrorCauseKey]]
    >
  ).filter(([, summary]) => summary.count > 0)
  const condition = edgeCondition(metric)
  const label = componentLabel(output, selected)

  return (
    <div className="space-y-3">
      <ComponentSelectorPanel output={output} selected={selected} onSelect={onSelect} />

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={SECTION_TITLE}>Component Drill-down</h3>
          <span className="text-[10px] text-nss-muted">edge transit · 1s windows</span>
        </div>

        <div className={`${SURFACE_CARD} p-3 space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-nss-text">{label}</div>
              <div className="text-[10px] text-nss-muted">
                Latency is scoped to successful transits on this edge only; failures are only
                terminals attributed to this edge.
              </div>
            </div>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${CONDITION_CLASSES[condition.level]}`}
            >
              {condition.label}
            </span>
          </div>

          <div className="grid gap-2 text-sm md:grid-cols-4">
            <StatCard label="Kind" value={selected.kind} />
            <StatCard
              label="Success Samples"
              value={`${metric.successLatencySamples.toLocaleString()}`}
            />
            <StatCard
              label="Failure Samples"
              value={`${metric.timeToErrorSamples.toLocaleString()}`}
            />
            <StatCard
              label="Error Rate"
              value={fmtPct(metric.latencyWindowErrorRate)}
              highlight={failureRateLevelFromRatio(metric.latencyWindowErrorRate)}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <TimelineChart
              title="Transit p95"
              subtitle="Successful hops only; edge transit latency over 1s windows."
              totalDurationMs={output.simulationDuration}
              warmupDurationMs={output.warmupDuration}
              statusWindows={statusWindows}
              series={[
                {
                  label: 'p95 latency',
                  color: '#60a5fa',
                  points: latencyWindowPointSeries(metric.latencyWindows, 'p95')
                }
              ]}
              yFormatter={fmtMs}
            />
            <TimelineChart
              title="Error Rate"
              subtitle="Terminals in the same 1s windows, scoped to this component."
              totalDurationMs={output.simulationDuration}
              warmupDurationMs={output.warmupDuration}
              statusWindows={statusWindows}
              series={[
                {
                  label: 'error rate',
                  color: '#f97316',
                  points: latencyWindowPointSeries(metric.latencyWindows, 'errorRate')
                }
              ]}
              yFormatter={(value) => (value === null ? 'N/A' : `${value.toFixed(1)}%`)}
            />
          </div>

          {timeToErrorEntries.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-nss-text">Per-cause Time-to-Error</div>
              <div className="grid gap-2 md:grid-cols-3">
                {timeToErrorEntries.map(([cause, summary]) => (
                  <TimeToErrorCard
                    key={`${selected.kind}-${selected.id}-${cause}`}
                    title={ERROR_CAUSE_LABELS[cause]}
                    count={summary.count}
                    errorRate={summary.errorRate}
                    shareOfErrors={summary.shareOfErrors}
                    p50={summary.p50}
                    p95={summary.p95}
                    p99={summary.p99}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-medium text-nss-text">Traced Requests</div>
            {traces.length === 0 ? (
              <div className="rounded border border-dashed border-nss-border bg-nss-panel px-3 py-4 text-xs text-nss-muted">
                No retained traces touched this component.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {traces.map((trace) => (
                  <div key={trace.requestId} className={`${SURFACE_CARD} p-2 space-y-1`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-nss-text truncate">
                        {trace.requestId}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[10px] ${eventStatusClass(
                          trace.status === 'success'
                            ? 'success'
                            : trace.status === 'timeout'
                              ? 'timeout'
                              : 'rejected'
                        )}`}
                      >
                        {trace.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-nss-muted">
                      total {fmtMs(trace.totalLatency)}
                    </div>
                    <div className="text-[10px] text-nss-muted">
                      {traceComponentDetail(trace, selected) ??
                        'No component-local phase detail retained.'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SimulationHealth({ output }: { output: SimulationOutput }) {
  const sloLevel: HealthLevel =
    output.sloBreaches.length === 0
      ? 'healthy'
      : output.sloBreaches.some((b) => b.severity === 'critical')
        ? 'breaches'
        : 'warnings'

  const llViolations = output.littlesLawCheck.filter((r) => !r.withinTolerance)
  const llLevel: HealthLevel = llViolations.length === 0 ? 'healthy' : 'warnings'

  const imbalanced = output.conservationCheck.filter((c) => !c.balanced)
  const inFlightAtCutoff = output.conservationCheck.filter((c) => c.inFlight > 0)
  const totalInFlightAtCutoff = inFlightAtCutoff.reduce((sum, result) => sum + result.inFlight, 0)
  const conservationLevel: HealthLevel = imbalanced.length === 0 ? 'healthy' : 'warnings'

  const warmupLevel: HealthLevel = output.warmupAdequacy.adequate ? 'healthy' : 'warnings'

  // Error breakdown: nodes with post-warmup rejects, timeouts, or connection resets.
  const errorNodes = Object.entries(output.perNode)
    .filter(
      ([, m]) =>
        m.postWarmupRejected > 0 || m.postWarmupTimedOut > 0 || m.postWarmupConnectionReset > 0
    )
    .sort(
      ([, a], [, b]) =>
        b.postWarmupRejected +
        b.postWarmupTimedOut +
        b.postWarmupConnectionReset -
        (a.postWarmupRejected + a.postWarmupTimedOut + a.postWarmupConnectionReset)
    )
  const summaryFailureLevel = failureRateLevelFromRatio(output.summary.errorRate)
  const errorLevel: HealthLevel =
    summaryFailureLevel === 'crit'
      ? 'breaches'
      : summaryFailureLevel === 'warn'
        ? 'warnings'
        : 'healthy'

  const overall = worstLevel([sloLevel, llLevel, conservationLevel, warmupLevel, errorLevel])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className={SECTION_TITLE}>Simulation Health</h3>
        <HealthBadge level={overall} />
      </div>

      {/* SLO */}
      <CollapsibleCheck
        title={
          sloLevel === 'healthy'
            ? 'SLO — No breaches'
            : `SLO — ${output.sloBreaches.length} breach${output.sloBreaches.length !== 1 ? 'es' : ''}`
        }
        level={sloLevel}
        tooltip={HEALTH_CHECK_TOOLTIPS.slo}
      >
        {sloLevel === 'healthy' ? (
          <p className="text-xs text-nss-muted">All configured SLO targets met.</p>
        ) : (
          output.sloBreaches.map((b, i) => {
            const metricStr =
              b.metric === 'latencyP99'
                ? `p99: target ${fmtMs(b.target)} / actual ${fmtMs(b.actual)}`
                : `availability: target ${fmtPct(b.target)} / actual ${fmtPct(b.actual)}`
            return (
              <div
                key={i}
                className={`text-xs rounded px-2 py-1 flex items-start gap-2 ${
                  b.severity === 'critical'
                    ? 'bg-nss-danger/10 border border-nss-danger/20 text-nss-danger'
                    : 'bg-nss-warning/10 border border-nss-warning/20 text-nss-warning'
                }`}
              >
                <span className="shrink-0 font-semibold">
                  {b.severity === 'critical' ? 'CRIT' : 'WARN'}
                </span>
                <span>
                  {b.nodeLabel} — {metricStr}
                </span>
              </div>
            )
          })
        )}
      </CollapsibleCheck>

      {/* Error Rate */}
      <CollapsibleCheck
        title={
          errorLevel === 'healthy'
            ? 'Error Rate — None'
            : `Error Rate — ${fmtPct(output.summary.errorRate)} (${output.summary.postWarmupFailedRequests.toLocaleString()} errors)`
        }
        level={errorLevel}
        tooltip={HEALTH_CHECK_TOOLTIPS.errorRate}
      >
        {errorLevel === 'healthy' ? (
          <p className="text-xs text-nss-muted">
            No rejected, timed-out, or connection-reset requests.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-5 gap-1 text-[10px] text-nss-muted font-medium pb-0.5 border-b border-nss-border">
              <span>Node</span>
              <span className="text-right">Rejected</span>
              <span className="text-right">Timed Out</span>
              <span className="text-right">Reset</span>
              <span className="text-right">Total</span>
            </div>
            {errorNodes.map(([nodeId, m]) => (
              <div key={nodeId} className="grid grid-cols-5 gap-1 text-[10px] tabular-nums">
                <span className="text-nss-text truncate">{m.nodeLabel ?? nodeId}</span>
                <span
                  className={`text-right ${m.postWarmupRejected > 0 ? 'text-nss-warning' : 'text-nss-muted'}`}
                >
                  {m.postWarmupRejected.toLocaleString()}
                </span>
                <span
                  className={`text-right ${m.postWarmupTimedOut > 0 ? 'text-nss-danger' : 'text-nss-muted'}`}
                >
                  {m.postWarmupTimedOut.toLocaleString()}
                </span>
                <span
                  className={`text-right ${m.postWarmupConnectionReset > 0 ? 'text-nss-danger' : 'text-nss-muted'}`}
                >
                  {m.postWarmupConnectionReset.toLocaleString()}
                </span>
                <span className="text-right text-nss-text">
                  {(
                    m.postWarmupRejected +
                    m.postWarmupTimedOut +
                    m.postWarmupConnectionReset
                  ).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCheck>

      {/* Little's Law */}
      <CollapsibleCheck
        title={
          llLevel === 'healthy'
            ? "Little's Law — Within tolerance"
            : `Little's Law — ${llViolations.length} violation${llViolations.length !== 1 ? 's' : ''} (error > 10%)`
        }
        level={llLevel}
        tooltip={HEALTH_CHECK_TOOLTIPS.littlesLaw}
      >
        {llLevel === 'healthy' ? (
          <p className="text-xs text-nss-muted">L = λW verified for all nodes (error ≤ 10%).</p>
        ) : (
          llViolations.map((r, i) => {
            const nodeLabel = output.perNode[r.nodeId]?.nodeLabel ?? r.nodeId
            return (
              <div
                key={i}
                className="text-xs tabular-nums text-nss-warning bg-nss-warning/10 border border-nss-warning/20 rounded px-2 py-1"
              >
                {nodeLabel}: L={fmtL(r.observedL)} expected={fmtL(r.expectedL)} error=
                {`${(r.error * 100).toFixed(1)}%`} | λ={fmtLambda(r.lambda)} rps, W=
                {fmtW(r.wSeconds)}
              </div>
            )
          })
        )}
      </CollapsibleCheck>

      {/* Conservation */}
      <CollapsibleCheck
        title={
          conservationLevel === 'healthy'
            ? totalInFlightAtCutoff > 0
              ? `Conservation — Balanced (${totalInFlightAtCutoff} in-flight at cutoff)`
              : 'Conservation — Balanced'
            : `Conservation — ${imbalanced.length} node${imbalanced.length !== 1 ? 's' : ''} with in-flight requests`
        }
        level={conservationLevel}
        tooltip={HEALTH_CHECK_TOOLTIPS.conservation}
      >
        {conservationLevel === 'healthy' ? (
          totalInFlightAtCutoff === 0 ? (
            <p className="text-xs text-nss-muted">
              All nodes closed cleanly: arrived = processed + rejected + timed-out + reset.
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-nss-muted">
                All nodes balance once you include requests that were still in flight at cutoff.
              </p>
              {inFlightAtCutoff.map((c, i) => (
                <div
                  key={i}
                  className="text-xs text-nss-muted bg-nss-surface border border-nss-border rounded px-2 py-1"
                >
                  {c.nodeLabel ?? c.nodeId}: {c.inFlight} in-flight at cutoff (
                  {((c.inFlight / Math.max(c.postWarmupArrived, 1)) * 100).toFixed(1)}% of arrivals)
                </div>
              ))}
            </div>
          )
        ) : (
          imbalanced.map((c, i) => (
            <div
              key={i}
              className="text-xs text-nss-warning bg-nss-warning/10 border border-nss-warning/20 rounded px-2 py-1"
            >
              {c.nodeLabel ?? c.nodeId}: {c.inFlight} in-flight at cutoff (
              {((c.inFlight / Math.max(c.postWarmupArrived, 1)) * 100).toFixed(1)}% of arrivals)
            </div>
          ))
        )}
      </CollapsibleCheck>

      {/* Warmup */}
      <CollapsibleCheck
        title={warmupLevel === 'healthy' ? 'Warmup — Adequate' : 'Warmup — May be too short'}
        level={warmupLevel}
        tooltip={HEALTH_CHECK_TOOLTIPS.warmup}
      >
        <p
          className={`text-xs ${warmupLevel === 'healthy' ? 'text-nss-muted' : 'text-nss-warning'}`}
        >
          {output.warmupAdequacy.reason}
        </p>
        {!output.warmupAdequacy.adequate && (
          <p className="text-xs text-nss-muted mt-1">
            Recommended warmup:{' '}
            <span className="font-medium text-nss-text">
              {output.warmupAdequacy.recommendedWarmupMs.toLocaleString()}ms
            </span>
          </p>
        )}
      </CollapsibleCheck>
    </div>
  )
}

// ─── Per-Node Table ───────────────────────────────────────────────────────────

function PerNodeTable({ output }: { output: SimulationOutput }) {
  const [showInactive, setShowInactive] = useState(false)
  const entries = Object.entries(output.perNode)
  if (entries.length === 0) return null

  const llByNode = new Map(output.littlesLawCheck.map((r) => [r.nodeId, r]))
  const conservationByNode = new Map(
    output.conservationCheck.map((result) => [result.nodeId, result])
  )

  const activeEntries = entries.filter(([, m]) => m.postWarmupArrived > 0)
  const inactiveEntries = entries.filter(([, m]) => m.postWarmupArrived === 0)

  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Per-node Metrics</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-nss-muted border-b border-nss-border">
              <th className="text-left pb-1 pr-2">Node</th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.arrived}>
                Arrived
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.done}>
                Done
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.reject}>
                Reject
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.timedOut}>
                T.O.
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.reset}>
                Reset
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.inFlight}>
                In Flight
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.avgQueue}>
                Avg Q
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.util}>
                Util
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.errorRate}>
                Err %
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.arrivalCV}>
                Arr CV
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.p50}>
                p50
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.p95}>
                p95
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.p99}>
                p99
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.lambda}>
                λ
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.w}>
                W
              </th>
              <th className="text-right pb-1" title={PER_NODE_COLUMN_TOOLTIPS.l}>
                L
              </th>
            </tr>
          </thead>
          <tbody>
            {activeEntries.map(([nodeId, m]) => {
              const ll = llByNode.get(nodeId)
              const conservation = conservationByNode.get(nodeId)
              const inFlight = conservation?.inFlight ?? 0
              const utilPct = (m.utilization * 100).toFixed(1)
              const utilColour =
                m.utilization > 0.9
                  ? 'text-nss-danger'
                  : m.utilization > 0.7
                    ? 'text-nss-warning'
                    : 'text-nss-success'
              const arrivalCvWarn =
                m.arrivalCV !== null &&
                output.summary.offeredArrivalCV !== null &&
                m.arrivalCV > output.summary.offeredArrivalCV + 0.05
              const llViolation = ll && !ll.withinTolerance

              return (
                <tr key={nodeId} className="border-b border-nss-border hover:bg-nss-surface/70">
                  <td className="py-1 pr-2 text-nss-text truncate max-w-[100px]">
                    {m.nodeLabel ?? nodeId}
                  </td>
                  <td className="text-right pr-2 text-nss-text">
                    {m.postWarmupArrived.toLocaleString()}
                  </td>
                  <td className="text-right pr-2 text-nss-text">
                    {m.postWarmupProcessed.toLocaleString()}
                  </td>
                  <td className="text-right pr-2 text-nss-muted">
                    {m.postWarmupRejected.toLocaleString()}
                  </td>
                  <td className="text-right pr-2 text-nss-muted">
                    {m.postWarmupTimedOut.toLocaleString()}
                  </td>
                  <td className="text-right pr-2 text-nss-muted">
                    {m.postWarmupConnectionReset.toLocaleString()}
                  </td>
                  <td
                    className={`text-right pr-2 ${inFlight > 0 ? 'text-nss-warning' : 'text-nss-muted'}`}
                  >
                    {inFlight.toLocaleString()}
                  </td>
                  <td className="text-right pr-2 text-nss-muted">{m.avgQueueLength.toFixed(1)}</td>
                  <td className={`text-right pr-2 ${utilColour}`}>{utilPct}%</td>
                  <td
                    className={`text-right pr-2 ${
                      m.errorRate > 0.05
                        ? 'text-nss-danger'
                        : m.errorRate > 0.01
                          ? 'text-nss-warning'
                          : 'text-nss-muted'
                    }`}
                  >
                    {fmtPct(m.errorRate)}
                  </td>
                  <td
                    className={`text-right pr-2 ${
                      arrivalCvWarn ? 'text-nss-warning' : 'text-nss-muted'
                    }`}
                  >
                    {fmtCv(m.arrivalCV)}
                  </td>
                  <td className="text-right pr-2 text-nss-text">{fmtMs(m.latencyP50)}</td>
                  <td className="text-right pr-2 text-nss-text">{fmtMs(m.latencyP95)}</td>
                  <td className="text-right pr-2 text-nss-text">{fmtMs(m.latencyP99)}</td>
                  <td className="text-right pr-2 text-nss-muted">
                    {ll ? fmtLambda(ll.lambda) : '—'}
                  </td>
                  <td className="text-right pr-2 text-nss-muted">{ll ? fmtW(ll.wSeconds) : '—'}</td>
                  <td
                    className={`text-right ${llViolation ? 'text-nss-warning font-medium' : 'text-nss-muted'}`}
                    title={
                      llViolation ? `Little's Law: expected ${fmtL(ll!.expectedL)}` : undefined
                    }
                  >
                    {ll ? fmtL(ll.observedL) : '—'}
                    {llViolation && <span className="ml-0.5">⚠</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {inactiveEntries.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive((s) => !s)}
            className="text-[10px] text-nss-muted hover:text-nss-text transition-colors"
          >
            {showInactive ? '▲' : '▼'} Inactive nodes ({inactiveEntries.length}) — post-warmup
          </button>
          {showInactive && (
            <table className="w-full text-xs tabular-nums mt-1 opacity-50">
              <tbody>
                {inactiveEntries.map(([nodeId, m]) => (
                  <tr key={nodeId} className="border-b border-nss-border">
                    <td className="py-0.5 pr-2 text-nss-muted">{m.nodeLabel ?? nodeId}</td>
                    <td className="text-right text-nss-muted text-[10px] italic" colSpan={16}>
                      no post-warmup traffic
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Replay Preview ──────────────────────────────────────────────────────────

function ReplayPreview({
  output,
  graphLookup
}: {
  output: SimulationOutput
  graphLookup: EventGraphLookup
}) {
  const retainedEventCount = output.eventStream.length
  const totalEventCount = totalReplayEventCount(output)
  const isTruncated = retainedEventCount < totalEventCount
  const [sequence, setSequence] = useState(0)
  const maxSequence = Math.max(0, retainedEventCount - 1)

  useEffect(() => {
    setSequence((current) => clampSequence(current, maxSequence))
  }, [maxSequence])

  const event = output.eventStream[clampSequence(sequence, maxSequence)]
  const debugEvent = useMemo(() => (event ? projectToDebugEvent(event) : null), [event])

  if (!debugEvent) {
    return null
  }

  const currentEdge = edgeDisplay(debugEvent, graphLookup)
  const replayProgress =
    maxSequence > 0 ? Math.round((clampSequence(sequence, maxSequence) / maxSequence) * 100) : 0

  const buttonClass =
    'h-7 w-7 inline-flex items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-text hover:bg-nss-surface transition-colors disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className={SECTION_TITLE}>Replay Preview</h3>
        <span className="text-[10px] text-nss-muted tabular-nums">
          {sequence + 1} / {retainedEventCount.toLocaleString()}
        </span>
      </div>

      <div className={`${SURFACE_CARD} p-3 space-y-3`}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSequence(0)}
            disabled={sequence === 0}
            className={buttonClass}
            title="Jump to start"
          >
            <ChevronsLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => setSequence((current) => clampSequence(current - 1, maxSequence))}
            disabled={sequence === 0}
            className={buttonClass}
            title="Previous event"
          >
            <ChevronLeft size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={maxSequence}
            value={sequence}
            onChange={(event) => setSequence(Number(event.target.value))}
            className="nss-range min-w-0 flex-1"
            style={{ '--range-progress': `${replayProgress}%` } as CSSProperties}
            aria-label="Replay sequence"
          />
          <button
            type="button"
            onClick={() => setSequence((current) => clampSequence(current + 1, maxSequence))}
            disabled={sequence === maxSequence}
            className={buttonClass}
            title="Next event"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => setSequence(maxSequence)}
            disabled={sequence === maxSequence}
            className={buttonClass}
            title="Jump to end"
          >
            <ChevronsRight size={14} />
          </button>
        </div>

        {isTruncated && (
          <div className="rounded-md border border-nss-warning/20 bg-nss-warning/10 px-2 py-1 text-[10px] text-nss-warning">
            Showing the first {retainedEventCount.toLocaleString()} replay events out of{' '}
            {totalEventCount.toLocaleString()} recorded for this run.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <StatCard label="Sequence" value={debugEvent.sequence.toLocaleString()} />
          <StatCard label="Time" value={fmtEventTime(debugEvent.timestampMs)} />
          <StatCard label="Type" value={debugEvent.type} />
          <StatCard label="Status" value={debugEvent.status} />
          <StatCard label="Request" value={debugEvent.requestId ?? '—'} />
          <StatCard label="Node" value={nodeDisplayName(debugEvent, graphLookup)} />
          <StatCard label="Edge" value={currentEdge.primary} />
          <StatCard label="Route" value={routeDisplayName(debugEvent, graphLookup)} />
        </div>

        {(debugEvent.reasonCode || debugEvent.nodeSnapshot) && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {debugEvent.reasonCode && <StatCard label="Reason" value={debugEvent.reasonCode} />}
            {debugEvent.nodeSnapshot && (
              <StatCard
                label="Node State"
                value={`${debugEvent.nodeSnapshot.activeWorkers} active / ${debugEvent.nodeSnapshot.queueLength} queued`}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EventLog({
  output,
  graphLookup
}: {
  output: SimulationOutput
  graphLookup: EventGraphLookup
}) {
  const [isOpen, setIsOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [activeSequence, setActiveSequence] = useState<number | null>(null)
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const retainedEventCount = output.eventStream.length
  const totalEventCount = totalReplayEventCount(output)
  const isTruncated = retainedEventCount < totalEventCount
  const debugEvents = useMemo(
    () => (isOpen ? output.eventStream.map((event) => projectToDebugEvent(event)) : []),
    [isOpen, output.eventStream]
  )
  const visibleEvents = useMemo(
    () => debugEvents.filter((event) => eventMatchesQuery(event, query, graphLookup)),
    [debugEvents, query, graphLookup]
  )
  const summary = useMemo(
    () =>
      visibleEvents.reduce(
        (acc, event) => {
          acc[event.status] = (acc[event.status] ?? 0) + 1
          return acc
        },
        {} as Partial<Record<DebugEvent['status'], number>>
      ),
    [visibleEvents]
  )
  const pageCount = Math.max(1, Math.ceil(visibleEvents.length / EVENT_LOG_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageStart = clampedPage * EVENT_LOG_PAGE_SIZE
  const rows = visibleEvents.slice(pageStart, pageStart + EVENT_LOG_PAGE_SIZE)
  const displayStart = visibleEvents.length === 0 ? 0 : pageStart + 1
  const displayEnd = pageStart + rows.length

  useEffect(() => {
    setPage(0)
  }, [query, retainedEventCount])

  function selectEventTarget(event: DebugEvent): void {
    if (!event.nodeId && !event.edgeId) {
      return
    }

    setActiveSequence(event.sequence)
    selectGraphElements({ nodeId: event.nodeId, edgeId: event.edgeId })
  }

  function handleRowKeyDown(
    keyboardEvent: KeyboardEvent<HTMLTableRowElement>,
    event: DebugEvent
  ): void {
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
      return
    }

    keyboardEvent.preventDefault()
    selectEventTarget(event)
  }

  if (retainedEventCount === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={isOpen}
      >
        <span className={SECTION_TITLE}>Event Log</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-nss-muted tabular-nums">
            {isTruncated
              ? `${retainedEventCount.toLocaleString()} / ${totalEventCount.toLocaleString()} replay events`
              : `${totalEventCount.toLocaleString()} replay events`}
          </span>
          <span className="text-nss-muted text-[10px]">{isOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      {!isOpen && (
        <div className={`${SURFACE_CARD} px-3 py-2 text-xs text-nss-muted`}>
          {isTruncated
            ? `Open to inspect the retained replay window (${retainedEventCount.toLocaleString()} of ${totalEventCount.toLocaleString()} events).`
            : 'Open to inspect canonical events and filter by request, node, edge, status, or type.'}
        </div>
      )}

      {isOpen && (
        <>
          {isTruncated && (
            <div className="rounded-md border border-nss-warning/20 bg-nss-warning/10 px-3 py-2 text-xs text-nss-warning">
              Large runs are capped to keep the renderer responsive. This table shows the first{' '}
              {retainedEventCount.toLocaleString()} replay events out of{' '}
              {totalEventCount.toLocaleString()} total canonical events.
            </div>
          )}

          <div className="flex flex-wrap gap-1 text-[10px]">
            {(['rejected', 'timeout', 'success', 'info'] as const).map((status) => (
              <span
                key={status}
                className={`px-1.5 py-0.5 rounded border ${eventStatusClass(status)}`}
              >
                {summary[status] ?? 0} {status}
              </span>
            ))}
          </div>

          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
            placeholder="type:request-forwarded OR status:rejected"
            className="w-full h-8 px-2 rounded-md bg-nss-surface border border-nss-border text-xs text-nss-text placeholder:text-nss-muted outline-none focus:border-nss-primary"
          />

          <div className={`${SURFACE_CARD} overflow-hidden`}>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="sticky top-0 bg-nss-surface text-nss-muted border-b border-nss-border">
                  <tr>
                    <th className="text-right py-1.5 px-2">Seq</th>
                    <th className="text-right py-1.5 px-2">Time</th>
                    <th className="text-left py-1.5 px-2">Type</th>
                    <th className="text-left py-1.5 px-2">Request</th>
                    <th className="text-left py-1.5 px-2">Node</th>
                    <th className="text-left py-1.5 px-2">Edge / Route</th>
                    <th className="text-left py-1.5 px-2">Status</th>
                    <th className="text-left py-1.5 px-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((event) => {
                    const edge = edgeDisplay(event, graphLookup)
                    const isActive = activeSequence === event.sequence
                    const isSelectable = Boolean(event.nodeId || event.edgeId)
                    return (
                      <tr
                        key={event.sequence}
                        tabIndex={isSelectable ? 0 : undefined}
                        aria-selected={isActive}
                        onClick={() => selectEventTarget(event)}
                        onKeyDown={(keyboardEvent) => handleRowKeyDown(keyboardEvent, event)}
                        className={`border-b border-nss-border outline-none ${
                          isSelectable ? 'cursor-pointer hover:bg-nss-bg focus:bg-nss-bg' : ''
                        } ${
                          isActive ? 'bg-nss-primary/10 ring-1 ring-inset ring-nss-primary/30' : ''
                        }`}
                      >
                        <td className="text-right py-1 px-2 text-nss-muted">{event.sequence}</td>
                        <td className="text-right py-1 px-2 text-nss-muted">
                          {fmtEventTime(event.timestampMs)}
                        </td>
                        <td className="py-1 px-2 text-nss-text whitespace-nowrap">{event.type}</td>
                        <td className="py-1 px-2 text-nss-muted">{event.requestId ?? '—'}</td>
                        <td className="py-1 px-2 text-nss-muted max-w-32" title={event.nodeId}>
                          <div className="truncate text-nss-text">
                            {nodeDisplayName(event, graphLookup)}
                          </div>
                          {labelForNode(event.nodeId, graphLookup) && event.nodeId && (
                            <div className="truncate text-[10px] text-nss-muted">
                              {event.nodeId}
                            </div>
                          )}
                        </td>
                        <td className="py-1 px-2 text-nss-muted max-w-48" title={edge.title}>
                          <div className="truncate text-nss-text">{edge.primary}</div>
                          {edge.secondary && (
                            <div className="truncate text-[10px] text-nss-muted">
                              {edge.secondary}
                            </div>
                          )}
                        </td>
                        <td className="py-1 px-2">
                          <span
                            className={`px-1.5 py-0.5 rounded border ${eventStatusClass(event.status)}`}
                          >
                            {event.status}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-nss-muted">{event.reasonCode ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {visibleEvents.length > 0 && (
              <div className="px-2 py-1 border-t border-nss-border flex items-center justify-between gap-2 text-[10px] text-nss-muted">
                <span>
                  Showing {displayStart.toLocaleString()}-{displayEnd.toLocaleString()} of{' '}
                  {visibleEvents.length.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                    disabled={clampedPage === 0}
                    className="px-2 py-0.5 rounded border border-nss-border text-nss-muted hover:text-nss-text hover:bg-nss-bg disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    Prev
                  </button>
                  <span className="tabular-nums px-1">
                    {clampedPage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                    disabled={clampedPage >= pageCount - 1}
                    className="px-2 py-0.5 rounded border border-nss-border text-nss-muted hover:text-nss-text hover:bg-nss-bg disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {visibleEvents.length === 0 && (
              <div className="px-3 py-4 text-xs text-nss-muted text-center">
                No events match this filter.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SimulationStatus }) {
  const conf: Record<SimulationStatus, { label: string; cls: string }> = {
    idle: { label: 'Idle', cls: 'text-nss-muted' },
    running: { label: 'Running', cls: 'text-nss-primary animate-pulse' },
    paused: { label: 'Paused', cls: 'text-nss-warning' },
    complete: { label: 'Complete', cls: 'text-nss-success' },
    error: { label: 'Error', cls: 'text-nss-danger' }
  }
  const { label, cls } = conf[status]
  return <span className={`text-xs font-medium ${cls}`}>{label}</span>
}

function TabButton({
  tab,
  activeTab,
  onSelect
}: {
  tab: (typeof RESULTS_TABS)[number]
  activeTab: ResultsTab
  onSelect: (tab: ResultsTab) => void
}) {
  const isActive = activeTab === tab.id

  return (
    <button
      type="button"
      onClick={() => onSelect(tab.id)}
      className={`h-8 px-3 rounded-md border text-xs font-semibold whitespace-nowrap transition-colors ${
        isActive
          ? 'bg-nss-primary text-white border-nss-primary'
          : 'bg-nss-surface text-nss-muted border-nss-border hover:text-nss-text hover:bg-nss-bg'
      }`}
      aria-pressed={isActive}
    >
      {tab.label}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResultsTray({
  status,
  stopped,
  progress,
  eventsProcessed,
  results,
  error,
  runContext,
  onClose
}: ResultsTrayProps) {
  const [activeTab, setActiveTab] = useState<ResultsTab>('overview')
  const [selectedComponent, setSelectedComponent] = useState<SelectedComponent | null>(null)
  const nodes = useStore((state) => state.nodes)
  const edges = useStore((state) => state.edges)
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const graphLookup = useMemo<EventGraphLookup>(() => {
    const nodeLabelById = new Map<string, string>()
    const edgeById = new Map<string, EventEdgeDisplayInfo>()

    for (const node of nodes) {
      const label = (node.data as { label?: unknown } | undefined)?.label
      if (typeof label === 'string' && label.length > 0) {
        nodeLabelById.set(node.id, label)
      }
    }

    for (const edge of edges) {
      const data = edge.data as Partial<EdgeSimulationData> | undefined
      edgeById.set(edge.id, {
        label: typeof edge.label === 'string' && edge.label.length > 0 ? edge.label : undefined,
        source: edge.source,
        target: edge.target,
        protocol: data?.protocol,
        mode: data?.mode
      })
    }

    return { nodeLabelById, edgeById }
  }, [nodes, edges])

  useEffect(() => {
    if (results) {
      setActiveTab('overview')
      setSelectedComponent(defaultSelectedComponent(results))
    }
  }, [results])

  useEffect(() => {
    if (!results) {
      return
    }

    selectGraphElements({
      nodeId: selectedComponent?.kind === 'node' ? selectedComponent.id : undefined,
      edgeId: selectedComponent?.kind === 'edge' ? selectedComponent.id : undefined
    })
  }, [results, selectedComponent, selectGraphElements])

  const retainedReplayEventCount = results ? results.eventStream.length : 0
  const totalCapturedReplayEvents = results ? totalReplayEventCount(results) : 0
  const replayEventsTruncated = retainedReplayEventCount < totalCapturedReplayEvents
  const progressLabel =
    stopped && status === 'paused'
      ? `Stopping at ${progress.toFixed(1)}% complete...`
      : `${progress.toFixed(1)}% complete`

  if (status === 'idle') return null

  return (
    <div className="flex flex-col h-full bg-nss-panel border-t border-nss-border text-nss-text font-sans overflow-hidden">
      {/* Header — status badge only; raw event count demoted to footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-nss-border shrink-0">
        <span className="text-sm font-semibold text-nss-text">Simulation</span>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          {stopped && results && (
            <span className="px-2 py-0.5 rounded border border-nss-warning/20 bg-nss-warning/10 text-[10px] font-medium text-nss-warning">
              Stopped early
            </span>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="h-6 w-6 inline-flex items-center justify-center rounded border border-transparent text-nss-muted hover:text-nss-text hover:bg-nss-surface hover:border-nss-border transition-colors"
              aria-label="Close results"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(status === 'running' || status === 'paused') && (
        <div className="px-4 py-2 shrink-0">
          <ProgressBar progress={progress} />
          <div className="text-xs text-nss-muted mt-1">{progressLabel}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 my-2 text-xs text-nss-danger bg-nss-danger/10 border border-nss-danger/20 rounded-md p-2 shrink-0">
          {error}
        </div>
      )}

      {/* Results */}
      {results && (
        <>
          <div className="shrink-0 px-4 py-2 border-b border-nss-border overflow-x-auto">
            <div className="flex items-center gap-2 min-w-max">
              {RESULTS_TABS.map((tab) => (
                <TabButton key={tab.id} tab={tab} activeTab={activeTab} onSelect={setActiveTab} />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
            {stopped && (
              <div className="rounded-md border border-nss-warning/20 bg-nss-warning/10 px-3 py-2 text-xs text-nss-warning">
                This run was stopped before the event queue drained. Metrics and replay data below
                reflect the partial output captured up to that point.
              </div>
            )}

            {activeTab === 'overview' && (
              <>
                {runContext && <RunContextPanel runContext={runContext} />}
                <SummaryPanel output={results} />
                <SystemWindowCharts output={results} />
              </>
            )}

            {activeTab === 'bottlenecks' && (
              <div className="space-y-4">
                <BottleneckVerdicts
                  output={results}
                  onSelectComponent={(selection) => setSelectedComponent(selection)}
                />
                <StatusTimelineStrip output={results} />
                <ComponentDrilldown
                  output={results}
                  selected={selectedComponent}
                  onSelect={(selection) => setSelectedComponent(selection)}
                />
                <SimulationHealth output={results} />
              </div>
            )}

            {activeTab === 'nodes' && (
              <div className="space-y-4">
                <NodeConditionCards output={results} />
                <PerNodeTable output={results} />
              </div>
            )}

            {activeTab === 'traffic' && (
              <>
                <ReplayPreview output={results} graphLookup={graphLookup} />
                <EventLog output={results} graphLookup={graphLookup} />
              </>
            )}

            {/* Footer — debug info */}
            <div className="text-[10px] text-nss-muted pb-2 flex flex-wrap gap-x-3 gap-y-1">
              <span>Seed: {results.seed}</span>
              <span>Reproducible: {results.reproducible ? 'yes' : 'no'}</span>
              <span>{eventsProcessed.toLocaleString()} events processed</span>
              <span>
                {replayEventsTruncated
                  ? `${retainedReplayEventCount.toLocaleString()} / ${totalCapturedReplayEvents.toLocaleString()} replay events retained`
                  : `${totalCapturedReplayEvents.toLocaleString()} replay events`}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
