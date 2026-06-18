import { useEffect, useId, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import type { DebugEvent } from '../../../../engine/core/event-stream'
import { projectToDebugEvent } from '../../../../engine/core/event-stream'
import type { SimulationStatus } from '../../hooks/useSimulation'
import useStore from '../../store/useStore'
import type { EdgeSimulationData, ScenarioRunContext } from '@renderer/types/ui'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
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
    "Breakdown of rejected and timed-out requests by node. Rejections happen when the queue is full; timeouts happen when processing exceeds the node's configured timeout.",
  littlesLaw:
    "Little's Law (L = λ·W) is a queueing-theory identity that must hold in steady state. Violations usually indicate either measurement noise at low utilization, or that the simulation never reached steady state. At very low L (<0.1), relative errors can be large while absolute differences are sub-request — treat these as noise.",
  conservation:
    "Verifies that for every node: arrived = processed + rejected + timed out. If this fails, there's a request-accounting bug in the simulator.",
  warmup:
    "Checks that warmup duration is at least 10× the max observed p99. If it isn't, post-warmup metrics may still be contaminated by startup transients."
} as const

const PER_NODE_COLUMN_TOOLTIPS = {
  arrived: 'Requests that reached this node during the post-warmup window.',
  done: 'Requests this node finished processing (post-warmup).',
  reject: "Requests turned away because the node's queue was full.",
  timedOut: "Requests that exceeded this node's processing timeout.",
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

// ─── Summary Panel ────────────────────────────────────────────────────────────

function SummaryPanel({ output }: { output: SimulationOutput }) {
  const { summary } = output
  const l = summary.latency
  const throughputDisplay = summary.postWarmupTotalRequests > 0 ? fmtRps(summary.throughput) : '—'

  const windowStart = output.warmupDuration / 1000
  const windowEnd = output.simulationDuration / 1000
  const windowLen = windowEnd - windowStart

  // Correct threshold order: >5% is critical, >1% is warning
  const errorHighlight: 'ok' | 'warn' | 'crit' =
    summary.errorRate > 0.05 ? 'crit' : summary.errorRate > 0.01 ? 'warn' : 'ok'

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className={SECTION_TITLE}>Summary</h3>
        <span className="text-[10px] text-nss-muted tabular-nums">
          Window: t={windowStart.toFixed(0)}s → t={windowEnd.toFixed(0)}s&nbsp;(
          {windowLen.toFixed(0)}s,&nbsp;{summary.postWarmupTotalRequests.toLocaleString()} samples)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <StatCard
          label="Requests (post-warmup)"
          value={summary.postWarmupTotalRequests.toLocaleString()}
          tooltip="Total requests that entered the system after warmup ended. Warmup samples are excluded so transient startup behavior doesn't skew the metrics."
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
          tooltip="Fraction of requests that were rejected or timed out. >1% turns yellow, >5% turns red."
        />
        <StatCard
          label="Timed Out"
          value={summary.timedOutRequests.toLocaleString()}
          tooltip="Requests that exceeded a node's processing timeout. Zero timeouts usually means either the system has headroom or the timeout is set too high."
        />
      </div>

      <div className="flex items-baseline justify-between pt-1">
        <h3 className={SECTION_TITLE}>End-to-end Latency</h3>
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
  const conservationLevel: HealthLevel = imbalanced.length === 0 ? 'healthy' : 'warnings'

  const warmupLevel: HealthLevel = output.warmupAdequacy.adequate ? 'healthy' : 'warnings'

  // Error breakdown: nodes with post-warmup rejects or timeouts
  const errorNodes = Object.entries(output.perNode)
    .filter(([, m]) => m.postWarmupRejected > 0 || m.postWarmupTimedOut > 0)
    .sort(
      ([, a], [, b]) =>
        b.postWarmupRejected + b.postWarmupTimedOut - (a.postWarmupRejected + a.postWarmupTimedOut)
    )
  const errorLevel: HealthLevel =
    output.summary.errorRate === 0
      ? 'healthy'
      : output.summary.errorRate > 0.05
        ? 'breaches'
        : 'warnings'

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
            : `Error Rate — ${fmtPct(output.summary.errorRate)} (${(output.summary.rejectedRequests + output.summary.timedOutRequests).toLocaleString()} errors)`
        }
        level={errorLevel}
        tooltip={HEALTH_CHECK_TOOLTIPS.errorRate}
      >
        {errorLevel === 'healthy' ? (
          <p className="text-xs text-nss-muted">No rejected or timed-out requests.</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-4 gap-1 text-[10px] text-nss-muted font-medium pb-0.5 border-b border-nss-border">
              <span>Node</span>
              <span className="text-right">Rejected</span>
              <span className="text-right">Timed Out</span>
              <span className="text-right">Total</span>
            </div>
            {errorNodes.map(([nodeId, m]) => (
              <div key={nodeId} className="grid grid-cols-4 gap-1 text-[10px] tabular-nums">
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
                <span className="text-right text-nss-text">
                  {(m.postWarmupRejected + m.postWarmupTimedOut).toLocaleString()}
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
            ? 'Conservation — Balanced'
            : `Conservation — ${imbalanced.length} node${imbalanced.length !== 1 ? 's' : ''} with in-flight requests`
        }
        level={conservationLevel}
        tooltip={HEALTH_CHECK_TOOLTIPS.conservation}
      >
        {conservationLevel === 'healthy' ? (
          <p className="text-xs text-nss-muted">
            All nodes: arrived ≈ processed + rejected + timed-out.
          </p>
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
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.avgQueue}>
                Avg Q
              </th>
              <th className="text-right pb-1 pr-2" title={PER_NODE_COLUMN_TOOLTIPS.util}>
                Util
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
              const utilPct = (m.utilization * 100).toFixed(1)
              const utilColour =
                m.utilization > 0.9
                  ? 'text-nss-danger'
                  : m.utilization > 0.7
                    ? 'text-nss-warning'
                    : 'text-nss-success'
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
                  <td className="text-right pr-2 text-nss-muted">{m.avgQueueLength.toFixed(1)}</td>
                  <td className={`text-right pr-2 ${utilColour}`}>{utilPct}%</td>
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
                    <td className="text-right text-nss-muted text-[10px] italic" colSpan={12}>
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
            className="min-w-0 flex-1 accent-nss-primary"
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
  const nodes = useStore((state) => state.nodes)
  const edges = useStore((state) => state.edges)
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
    }
  }, [results])

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
              </>
            )}

            {activeTab === 'bottlenecks' && <SimulationHealth output={results} />}

            {activeTab === 'nodes' && <PerNodeTable output={results} />}

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
