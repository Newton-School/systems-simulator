import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  Search,
  X
} from 'lucide-react'
import type {
  SimulationOutput,
  StatusWindow,
  TimeSeriesSnapshot
} from '../../../../engine/analysis/output'
import type {
  CanonicalEventRecord,
  CanonicalEventType,
  DebugEvent,
  RequestOutcomeRecord
} from '../../../../engine/core/event-stream'
import type { SimulationStatus } from '../../hooks/useSimulation'
import useStore, { type EdgeFlowRenderEvent } from '../../store/useStore'
import { HoverTooltip, TooltipInfo } from '@renderer/components/ui/Tooltip'
import {
  RESULTS_CONTEXTUAL_TOOLTIPS,
  RESULTS_E2E_PERCENTILE_TOOLTIPS,
  RESULTS_HEALTH_CHECK_TOOLTIPS,
  RESULTS_PER_NODE_COLUMN_TOOLTIPS,
  RESULTS_SUMMARY_TOOLTIPS,
  formatInFlightAtCutoffBanner
} from '@renderer/config/tooltipCatalog'
import type { EdgeSimulationData, ScenarioRunContext } from '@renderer/types/ui'
import {
  ERROR_CAUSE_LABELS,
  dominantTimeToErrorCause
} from '@renderer/utils/errorCausePresentation'
import { failureRateLevelFromRatio } from '@renderer/utils/failureRatePresentation'
import {
  capacityRank,
  deriveCapacityStatus,
  deriveReliabilityStatus,
  reliabilityRank,
  toneRank,
  type ReliabilityStatus
} from '@renderer/utils/nodeHealthThresholds'
import { simulatedArrivalBins, workloadRateMultiplierAtMs } from './resultsTrayWorkload'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ResultsTrayProps {
  status: SimulationStatus
  stopped: boolean
  progress: number
  eventsProcessed: number
  runStartedAtMs: number | null
  snapshot: TimeSeriesSnapshot | null
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
  if (ms === 0) return '-'
  if (ms < 1) return `${ms.toFixed(3)}ms`
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
  return rps === null ? '-' : `${rps.toFixed(1)} rps`
}

function fmtCv(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(2)
}

function fmtLambda(lambda: number): string {
  return lambda === 0 ? '-' : `${lambda.toFixed(2)}`
}

function fmtL(l: number): string {
  return l === 0 ? '-' : l.toFixed(3)
}

function fmtW(wSeconds: number): string {
  return wSeconds === 0 ? '-' : fmtMs(wSeconds * 1000)
}

function totalReplayEventCount(output: SimulationOutput): number {
  return Object.values(output.eventCountsByType).reduce((sum, count) => sum + count, 0)
}

const SECTION_TITLE = 'text-[11px] font-semibold text-nss-muted uppercase tracking-wider'
const SURFACE_CARD = 'bg-nss-surface border border-nss-border rounded-md'
const TRAFFIC_EVENT_LOG_SIZE = 24
const RESULTS_TABS: Array<{ id: ResultsTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'bottlenecks', label: 'Bottlenecks' },
  { id: 'nodes', label: 'Node Metrics' },
  { id: 'traffic', label: 'Traffic' }
]

const LIVE_PATTERN_BAR_COUNT = 24
type TrafficStatusFilter = 'all' | EdgeFlowRenderEvent['status']
const TRAFFIC_STATUS_FILTERS: Array<{ id: TrafficStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'Success' },
  { id: 'timeout', label: 'Timeout' },
  { id: 'edge-error', label: 'Edge Error' },
  { id: 'packet-loss', label: 'Packet Loss' }
]

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

function labelForNode(nodeId: string | undefined, lookup: EventGraphLookup): string | undefined {
  return nodeId ? lookup.nodeLabelById.get(nodeId) : undefined
}

function workloadPatternDetails(workload: ScenarioRunContext['workload']): string[] {
  const details: string[] = []

  if (workload.pattern === 'bursty' && workload.bursty) {
    details.push(
      `${workload.bursty.burstRps} burst rps`,
      `${workload.bursty.burstDuration}ms burst`,
      `${workload.bursty.normalDuration}ms normal`
    )
  }

  if (workload.pattern === 'spike' && workload.spike) {
    details.push(
      `${workload.spike.spikeRps} spike rps`,
      `t=${workload.spike.spikeTime}ms`,
      `${workload.spike.spikeDuration}ms duration`
    )
  }

  if (workload.pattern === 'sawtooth' && workload.sawtooth) {
    details.push(
      `${workload.sawtooth.peakRps} peak rps`,
      `${workload.sawtooth.rampDuration}ms ramp`
    )
  }

  return details
}

function livePatternPhaseLabel(
  workload: ScenarioRunContext['workload'],
  currentSimMs: number
): string | null {
  switch (workload.pattern) {
    case 'constant':
    case 'replay':
      return 'even arrivals'

    case 'poisson':
      return 'random gaps'

    case 'bursty': {
      if (!workload.bursty) return null
      const burstDuration = Math.max(1, workload.bursty.burstDuration)
      const normalDuration = Math.max(1, workload.bursty.normalDuration)
      const cycle = burstDuration + normalDuration
      return currentSimMs % cycle < burstDuration ? 'burst' : 'base'
    }

    case 'spike': {
      if (!workload.spike) return null
      return currentSimMs >= workload.spike.spikeTime &&
        currentSimMs < workload.spike.spikeTime + workload.spike.spikeDuration
        ? 'spike'
        : 'base'
    }

    case 'sawtooth': {
      if (!workload.sawtooth) return null
      const rampDuration = Math.max(1, workload.sawtooth.rampDuration)
      const progress = (currentSimMs % rampDuration) / rampDuration
      if (progress > 0.66) return 'ramp high'
      if (progress > 0.33) return 'ramp mid'
      return 'ramp low'
    }

    case 'diurnal': {
      const multipliers = workload.diurnal?.hourlyMultipliers
      if (!multipliers) return null
      const hourPosition = (((currentSimMs / 1000 / 60 / 60) % 24) + 24) % 24
      const hour = Math.floor(hourPosition)
      const value = multipliers[hour] ?? 1
      if (value > 1.1) return 'peak'
      if (value < 0.8) return 'low'
      return 'normal'
    }

    default:
      return null
  }
}

function liveNodeStatusClass(status: string): string {
  switch (status) {
    case 'failed':
      return 'text-nss-danger bg-nss-danger/10 border-nss-danger/20'
    case 'saturated':
      return 'text-nss-warning bg-nss-warning/10 border-nss-warning/20'
    case 'busy':
      return 'text-nss-primary bg-nss-primary/10 border-nss-primary/20'
    default:
      return 'text-nss-muted bg-nss-surface border-nss-border'
  }
}

function edgeFlowStatusClass(status: 'success' | 'edge-error' | 'packet-loss' | 'timeout'): string {
  switch (status) {
    case 'success':
      return 'text-nss-success bg-nss-success/10 border-nss-success/20'
    case 'timeout':
      return 'text-nss-warning bg-nss-warning/10 border-nss-warning/20'
    case 'edge-error':
    case 'packet-loss':
      return 'text-nss-danger bg-nss-danger/10 border-nss-danger/20'
  }
}

function upperBoundTrafficEventTime(events: EdgeFlowRenderEvent[], currentSimMs: number): number {
  let low = 0
  let high = events.length

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (events[mid]?.startedAtMs <= currentSimMs) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

function trafficEventsUpToTime(
  events: EdgeFlowRenderEvent[],
  currentSimMs: number,
  limit = TRAFFIC_EVENT_LOG_SIZE
): EdgeFlowRenderEvent[] {
  const endIndex = upperBoundTrafficEventTime(events, currentSimMs)
  const startIndex = Math.max(0, endIndex - limit)
  return events.slice(startIndex, endIndex)
}

function edgeFlowStatusLabel(status: EdgeFlowRenderEvent['status']): string {
  switch (status) {
    case 'edge-error':
      return 'edge error'
    case 'packet-loss':
      return 'packet loss'
    default:
      return status
  }
}

function trafficFilterButtonClass(
  filter: TrafficStatusFilter,
  activeFilter: TrafficStatusFilter
): string {
  if (filter === 'all') {
    return activeFilter === 'all'
      ? 'border-nss-primary bg-nss-primary/15 text-nss-primary'
      : 'border-nss-border bg-nss-surface text-nss-muted hover:text-nss-text hover:bg-nss-bg'
  }

  if (activeFilter === filter) {
    return `${edgeFlowStatusClass(filter)} ring-1 ring-inset ring-current/25`
  }

  switch (filter) {
    case 'success':
      return 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-success/20 hover:bg-nss-success/10 hover:text-nss-success'
    case 'timeout':
      return 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-warning/20 hover:bg-nss-warning/10 hover:text-nss-warning'
    case 'edge-error':
    case 'packet-loss':
      return 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-danger/20 hover:bg-nss-danger/10 hover:text-nss-danger'
  }
}

// ─── Request outcome log ──────────────────────────────────────────────────────
// Post-run Event Log source: one row per request keyed on terminal fate. Chips
// are terminal OUTCOMES a user filters for — never lifecycle transitions, which
// live in the per-row drill-down instead. `in-flight` is a confidence state
// (unfinished at cutoff), styled muted, never as an alarm.

type OutcomeStatus = RequestOutcomeRecord['status']
type OutcomeStatusFilter = 'all' | OutcomeStatus

const OUTCOME_PAGE_SIZE = 50

const OUTCOME_STATUS_ORDER: OutcomeStatus[] = [
  'success',
  'rejected',
  'timeout',
  'connection_reset',
  'in-flight'
]

const OUTCOME_STATUS_LABEL: Record<OutcomeStatus, string> = {
  success: 'Success',
  rejected: 'Rejected',
  timeout: 'Timeout',
  connection_reset: 'Reset',
  'in-flight': 'In-flight'
}

function outcomeStatusBadgeClass(status: OutcomeStatus): string {
  switch (status) {
    case 'success':
      return 'text-nss-success bg-nss-success/10 border-nss-success/20'
    case 'timeout':
      return 'text-nss-warning bg-nss-warning/10 border-nss-warning/20'
    case 'rejected':
    case 'connection_reset':
      return 'text-nss-danger bg-nss-danger/10 border-nss-danger/20'
    // In-flight is a confidence caveat, not a fault: muted, never red or green.
    case 'in-flight':
      return 'text-nss-muted bg-nss-muted/10 border-nss-muted/30'
  }
}

function outcomeFilterButtonClass(
  filter: OutcomeStatusFilter,
  activeFilter: OutcomeStatusFilter
): string {
  if (filter === 'all') {
    return activeFilter === 'all'
      ? 'border-nss-primary bg-nss-primary/15 text-nss-primary'
      : 'border-nss-border bg-nss-surface text-nss-muted hover:text-nss-text hover:bg-nss-bg'
  }

  if (activeFilter === filter) {
    return `${outcomeStatusBadgeClass(filter)} ring-1 ring-inset ring-current/25`
  }

  switch (filter) {
    case 'success':
      return 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-success/20 hover:bg-nss-success/10 hover:text-nss-success'
    case 'timeout':
      return 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-warning/20 hover:bg-nss-warning/10 hover:text-nss-warning'
    case 'rejected':
    case 'connection_reset':
      return 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-danger/20 hover:bg-nss-danger/10 hover:text-nss-danger'
    case 'in-flight':
      return 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-muted/40 hover:bg-nss-muted/10 hover:text-nss-text'
  }
}

function fmtAttempts(attempts: number): string {
  return attempts === 1 ? '1' : `${attempts}×`
}

/** Prettify a canonical lifecycle event type for the per-row drill-down. */
function lifecycleStepLabel(type: CanonicalEventType): string {
  return type.replace(/^request-/, '').replace(/-/g, ' ')
}

/** One collapsed lifecycle step, with a repeat count for consecutive duplicates. */
interface LifecycleStep {
  key: number
  label: string
  reasonCode?: string
  timeMs: number
  count: number
}

/** A run of consecutive lifecycle steps that happened at the same node. */
interface LifecycleNodeGroup {
  key: number
  nodeId: string | null
  label: string
  /** Time attributed to this node hop: entry here → entry at the next node. */
  deltaMs: number
  steps: LifecycleStep[]
}

/**
 * Fold a request's flat, sequence-ordered lifecycle events into per-node groups
 * for the drill-down tree. Each group's delta is the time from arriving at that
 * node to arriving at the next one (the last hop runs to the request's final
 * event), so the group deltas sum to the request's end-to-end latency. Repeated
 * consecutive steps at a node (e.g. two `trait-evaluated`) collapse into one row
 * carrying an `×N` count.
 */
function buildLifecycleGroups(
  steps: CanonicalEventRecord[],
  graphLookup: EventGraphLookup
): LifecycleNodeGroup[] {
  if (steps.length === 0) return []

  const groups: LifecycleNodeGroup[] = []
  for (const event of steps) {
    const nodeId = event.nodeId ?? null
    const timeMs = Number(event.timestampUs) / 1000
    const label = lifecycleStepLabel(event.type)
    const current = groups[groups.length - 1]

    if (!current || current.nodeId !== nodeId) {
      groups.push({
        key: event.sequence,
        nodeId,
        label: nodeId ? (labelForNode(nodeId, graphLookup) ?? nodeId) : 'System',
        deltaMs: 0,
        steps: [{ key: event.sequence, label, reasonCode: event.reasonCode, timeMs, count: 1 }]
      })
      continue
    }

    const lastStep = current.steps[current.steps.length - 1]
    if (lastStep.label === label && lastStep.reasonCode === event.reasonCode) {
      lastStep.count += 1
    } else {
      current.steps.push({
        key: event.sequence,
        label,
        reasonCode: event.reasonCode,
        timeMs,
        count: 1
      })
    }
  }

  const overallEndMs = Number(steps[steps.length - 1].timestampUs) / 1000
  for (let index = 0; index < groups.length; index++) {
    const entryMs = groups[index].steps[0].timeMs
    const nextEntryMs = index < groups.length - 1 ? groups[index + 1].steps[0].timeMs : overallEndMs
    groups[index].deltaMs = Math.max(0, nextEntryMs - entryMs)
  }

  return groups
}

/**
 * The per-request drill-down: a node-grouped lifecycle tree. Each node hop is an
 * independently collapsible branch showing its steps and the wall time spent
 * before the request moved on.
 */
function LifecycleTree({
  requestId,
  totalLatencyMs,
  groups
}: {
  requestId: string
  totalLatencyMs: number | null
  groups: LifecycleNodeGroup[]
}) {
  // All hops start expanded; collapsing is opt-in per branch.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())

  return (
    <div className="text-[10px] text-nss-muted">
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <span className="font-semibold text-nss-text">{requestId}</span>
        <span className="rounded border border-nss-border bg-nss-surface px-1.5 py-0.5 tabular-nums text-nss-text">
          {fmtMs(totalLatencyMs)} total
        </span>
      </div>
      <div className="space-y-0.5 border-l border-nss-border/70 pl-2">
        {groups.map((group) => {
          const isOpen = !collapsed.has(group.key)
          return (
            <div key={group.key}>
              <button
                type="button"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current)
                    if (next.has(group.key)) next.delete(group.key)
                    else next.add(group.key)
                    return next
                  })
                }
                className="flex w-full items-center justify-between gap-2 rounded py-0.5 pr-1 text-left outline-none hover:bg-nss-bg/60 focus-visible:bg-nss-bg/60"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="w-2 shrink-0 text-nss-muted">{isOpen ? '▾' : '▸'}</span>
                  <span className="truncate font-semibold text-nss-text">{group.label}</span>
                </span>
                <span className="shrink-0 tabular-nums text-nss-muted">
                  Δ {fmtMs(group.deltaMs)}
                </span>
              </button>
              {isOpen && (
                <ol className="mb-1 ml-[3px] space-y-0.5 border-l border-nss-border/40 py-0.5 pl-3">
                  {group.steps.map((step) => (
                    <li key={step.key} className="flex items-baseline gap-2">
                      <span className="w-12 shrink-0 tabular-nums text-nss-muted/80">
                        {fmtChartTime(step.timeMs)}
                      </span>
                      <span className="text-nss-text">
                        {step.label}
                        {step.count > 1 ? (
                          <span className="text-nss-muted"> (×{step.count})</span>
                        ) : null}
                        {step.reasonCode ? (
                          <span className="text-nss-muted"> · {step.reasonCode}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function errorRateAtTime(output: SimulationOutput, currentSimMs: number): number | null {
  const window =
    output.summary.latencyWindows.find(
      (entry) => currentSimMs >= entry.windowStartMs && currentSimMs <= entry.windowEndMs
    ) ??
    [...output.summary.latencyWindows]
      .reverse()
      .find((entry) => currentSimMs >= entry.windowEndMs) ??
    output.summary.latencyWindows[0]

  return window ? window.errorRate : null
}

function RunContextPanel({ runContext }: { runContext: ScenarioRunContext }) {
  const workload = runContext.workload
  const patternExtras = workloadPatternDetails(workload)

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

function ArrivalPatternStrip({ bins, active }: { bins: number[]; active: boolean }) {
  const maxBin = Math.max(1, ...bins)
  const positiveBins = bins.filter((count) => count > 0)
  const minPositiveBin =
    positiveBins.length > 0 ? positiveBins.reduce((min, count) => Math.min(min, count), maxBin) : 0
  const spread = Math.max(0, maxBin - minPositiveBin)
  const hasMeaningfulVariation = spread > maxBin * 0.08

  return (
    <div
      className={`${SURFACE_CARD} relative h-24 overflow-hidden bg-[linear-gradient(180deg,rgba(59,130,246,0.06),rgba(15,23,42,0.04))] px-2 py-2`}
      aria-label="Live arrival pattern strip"
    >
      <div className="pointer-events-none absolute inset-0">
        {[25, 50, 75].map((marker) => (
          <div
            key={marker}
            className="absolute inset-x-0 border-t border-white/6"
            style={{ bottom: `${marker}%` } satisfies CSSProperties}
          />
        ))}
      </div>

      <div className="relative z-[1] flex h-full items-end gap-1.5">
        {bins.map((count, index) => {
          const height =
            count <= 0
              ? 10
              : hasMeaningfulVariation
                ? Math.max(
                    18,
                    Math.round(22 + ((count - minPositiveBin) / Math.max(spread, 0.0001)) * 68)
                  )
                : 64

          return (
            <div
              key={index}
              className="relative flex-1 h-full overflow-hidden rounded-[4px] border border-white/6 bg-black/10"
            >
              <div
                className={`absolute inset-x-0 bottom-0 rounded-[3px] border-t transition-[height,opacity,background-color] duration-200 ${
                  active
                    ? 'border-nss-primary/70 bg-nss-primary/80 shadow-[0_0_16px_rgba(59,130,246,0.18)]'
                    : 'border-sky-300/60 bg-sky-400/55'
                }`}
                style={
                  { height: `${height}%`, opacity: count > 0 ? 1 : 0.28 } satisfies CSSProperties
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrafficEventLog({
  currentSimMs,
  graphLookup,
  mode
}: {
  currentSimMs: number
  graphLookup: EventGraphLookup
  mode: 'live' | 'replay'
}) {
  const edgeFlowHistory = useStore((state) => state.edgeFlowHistory)
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<TrafficStatusFilter>('all')
  const eventsAtTime = useMemo(
    () => trafficEventsUpToTime(edgeFlowHistory, currentSimMs),
    [currentSimMs, edgeFlowHistory]
  )
  const statusCounts = useMemo(() => {
    const counts: Record<TrafficStatusFilter, number> = {
      all: eventsAtTime.length,
      success: 0,
      timeout: 0,
      'edge-error': 0,
      'packet-loss': 0
    }

    for (const event of eventsAtTime) {
      counts[event.status] += 1
    }

    return counts
  }, [eventsAtTime])
  const visibleEvents = useMemo(
    () =>
      statusFilter === 'all'
        ? eventsAtTime
        : eventsAtTime.filter((event) => event.status === statusFilter),
    [eventsAtTime, statusFilter]
  )

  useEffect(() => {
    if (
      activeEventKey !== null &&
      !visibleEvents.some(
        (event) => `${event.requestId}:${event.edgeId}:${event.sequence}` === activeEventKey
      )
    ) {
      setActiveEventKey(null)
    }
  }, [activeEventKey, visibleEvents])

  return (
    <div className={`${SURFACE_CARD} p-3`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-nss-muted">
            Event Log
          </div>
          <div className="text-[11px] text-nss-muted">
            {mode === 'live'
              ? 'Requests append here as the run advances.'
              : 'This list rewinds and advances with the replay slider.'}
          </div>
        </div>
        <span className="text-[10px] text-nss-muted tabular-nums">
          {visibleEvents.length.toLocaleString()} visible
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {TRAFFIC_STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setStatusFilter(filter.id)}
            className={`rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${trafficFilterButtonClass(filter.id, statusFilter)}`}
            aria-pressed={statusFilter === filter.id}
          >
            {statusCounts[filter.id].toLocaleString()} {filter.label}
          </button>
        ))}
      </div>

      {visibleEvents.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-md border border-nss-border">
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead className="sticky top-0 border-b border-nss-border bg-nss-surface text-nss-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left">Sim Time</th>
                  <th className="px-2 py-1.5 text-left">Request</th>
                  <th className="px-2 py-1.5 text-left">Route</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-right">Latency</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event) => {
                  const source = labelForNode(event.sourceNodeId, graphLookup) ?? event.sourceNodeId
                  const target = labelForNode(event.targetNodeId, graphLookup) ?? event.targetNodeId
                  const edge = graphLookup.edgeById.get(event.edgeId)
                  const routeLabel = edge?.label ?? `${source} → ${target}`
                  const routeMeta = [
                    edge?.label ? `${source} → ${target}` : undefined,
                    edge?.protocol,
                    edge?.mode
                  ]
                    .filter(Boolean)
                    .join(' • ')
                  const rowKey = `${event.requestId}:${event.edgeId}:${event.sequence}`
                  const isActive = activeEventKey === rowKey

                  return (
                    <tr
                      key={rowKey}
                      tabIndex={0}
                      aria-selected={isActive}
                      onClick={() => {
                        setActiveEventKey(rowKey)
                        selectGraphElements({ edgeId: event.edgeId })
                      }}
                      onKeyDown={(keyboardEvent) => {
                        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
                          return
                        }

                        keyboardEvent.preventDefault()
                        setActiveEventKey(rowKey)
                        selectGraphElements({ edgeId: event.edgeId })
                      }}
                      className={`cursor-pointer border-b border-nss-border outline-none hover:bg-nss-bg focus:bg-nss-bg ${
                        isActive ? 'bg-nss-primary/10 ring-1 ring-inset ring-nss-primary/30' : ''
                      }`}
                    >
                      <td className="px-2 py-1 text-nss-muted">
                        {fmtChartTime(event.startedAtMs)}
                      </td>
                      <td className="px-2 py-1 text-nss-text">
                        <div className="truncate">{event.requestId}</div>
                        <div className="truncate text-[10px] text-nss-muted">
                          seq {event.sequence}
                        </div>
                      </td>
                      <td className="max-w-56 px-2 py-1 text-nss-muted" title={routeLabel}>
                        <div className="truncate text-nss-text">{routeLabel}</div>
                        <div className="truncate text-[10px] text-nss-muted">
                          {routeMeta || `${source} → ${target}`}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${edgeFlowStatusClass(event.status)}`}
                        >
                          {edgeFlowStatusLabel(event.status)}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right text-nss-text">
                        {fmtMs(event.latencyMs)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-nss-border px-2 py-1 text-[10px] text-nss-muted">
            Showing the latest {visibleEvents.length}{' '}
            {statusFilter === 'all' ? '' : `${edgeFlowStatusLabel(statusFilter)} `}
            traversals at or before {fmtChartTime(currentSimMs)}.
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-nss-muted">
          {statusFilter !== 'all'
            ? `No ${edgeFlowStatusLabel(statusFilter)} traversals are visible at this point in the run.`
            : mode === 'live'
              ? 'Waiting for requests to start moving through the graph.'
              : 'No retained request traversals exist at this replay point yet.'}
        </div>
      )}
    </div>
  )
}

function RequestOutcomeLog({
  output,
  graphLookup
}: {
  output: SimulationOutput
  graphLookup: EventGraphLookup
}) {
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const [statusFilter, setStatusFilter] = useState<OutcomeStatusFilter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null)

  const outcomes = output.requestOutcomes

  // Per-request terminal reason (e.g. queue_full, node_error_rate, policy). It is
  // not on the outcome row — it lives as reasonCode on the request's events — so
  // we fold the stream into requestId → last reasonCode (highest sequence wins,
  // which is the terminal one). Empty when the stream was capped for a large run.
  const reasonByRequestId = useMemo(() => {
    const map = new Map<string, { sequence: number; reason: string }>()
    for (const event of output.eventStream) {
      if (!event.requestId || !event.reasonCode) continue
      const existing = map.get(event.requestId)
      if (!existing || event.sequence > existing.sequence) {
        map.set(event.requestId, { sequence: event.sequence, reason: event.reasonCode })
      }
    }
    return map
  }, [output.eventStream])

  const statusCounts = useMemo(() => {
    const counts: Record<OutcomeStatusFilter, number> = {
      all: outcomes.length,
      success: 0,
      rejected: 0,
      timeout: 0,
      connection_reset: 0,
      'in-flight': 0
    }
    for (const row of outcomes) {
      counts[row.status] += 1
    }
    return counts
  }, [outcomes])

  // Chip filter, then free-text search over request id / node label / status.
  const trimmedQuery = query.trim().toLowerCase()
  const visibleRows = useMemo(() => {
    const byStatus =
      statusFilter === 'all' ? outcomes : outcomes.filter((row) => row.status === statusFilter)
    if (trimmedQuery === '') return byStatus
    return byStatus.filter((row) => {
      const nodeLabel = row.nodeId ? (labelForNode(row.nodeId, graphLookup) ?? row.nodeId) : ''
      const reason = reasonByRequestId.get(row.requestId)?.reason ?? ''
      const haystack =
        `${row.requestId} ${nodeLabel} ${OUTCOME_STATUS_LABEL[row.status]} ${reason}`.toLowerCase()
      return haystack.includes(trimmedQuery)
    })
  }, [outcomes, statusFilter, trimmedQuery, graphLookup, reasonByRequestId])

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / OUTCOME_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount)
  const pageStart = (clampedPage - 1) * OUTCOME_PAGE_SIZE
  const pagedRows = visibleRows.slice(pageStart, pageStart + OUTCOME_PAGE_SIZE)

  // Reset to the first page whenever the filter or search narrows the set.
  useEffect(() => {
    setPage(1)
  }, [statusFilter, trimmedQuery])

  // Lifecycle steps for the one expanded request, derived on demand from the
  // canonical stream. Empty when the stream was truncated for a large run.
  const expandedSteps = useMemo(() => {
    if (expandedRequestId === null) return []
    return output.eventStream
      .filter((event) => event.requestId === expandedRequestId)
      .sort((a, b) => a.sequence - b.sequence)
  }, [expandedRequestId, output.eventStream])

  // The same steps folded into per-node hops for the drill-down tree.
  const expandedGroups = useMemo(
    () => buildLifecycleGroups(expandedSteps, graphLookup),
    [expandedSteps, graphLookup]
  )

  useEffect(() => {
    if (
      expandedRequestId !== null &&
      !visibleRows.some((row) => row.requestId === expandedRequestId)
    ) {
      setExpandedRequestId(null)
    }
  }, [expandedRequestId, visibleRows])

  const inFlightCount = statusCounts['in-flight']
  const totalOutcomeCount = output.requestOutcomeTotal ?? outcomes.length
  const outcomesSampled = output.requestOutcomesSampled ?? false

  const filters: OutcomeStatusFilter[] = ['all', ...OUTCOME_STATUS_ORDER]

  return (
    <div className={`${SURFACE_CARD} p-3`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-nss-muted">
              Request Outcomes
            </span>
            <TooltipInfo
              label="About the request outcome log"
              content="One row per request, keyed on its final fate. Every generated request appears exactly once - successes, failures, and requests still in flight at the cutoff. Click a row to see its lifecycle steps."
            />
          </div>
          <div className="text-[11px] text-nss-muted">
            {outcomesSampled
              ? `Showing a sampled request-outcome ledger. ${outcomes.length.toLocaleString()} outcomes are retained from ${totalOutcomeCount.toLocaleString()} total; aggregate metrics above remain exact. Search and pagination only cover retained rows.`
              : 'Final fate of every request this run. Click a row for its lifecycle.'}
          </div>
        </div>
        <span className="text-[10px] text-nss-muted tabular-nums">
          {outcomesSampled
            ? `${visibleRows.length.toLocaleString()} visible of ${outcomes.length.toLocaleString()} sampled`
            : `${visibleRows.length.toLocaleString()} of ${outcomes.length.toLocaleString()} retained`}
        </span>
      </div>

      {inFlightCount > 0 && (
        <div className="mt-3 rounded-md border border-nss-muted/30 bg-nss-muted/10 px-2.5 py-1.5 text-[11px] leading-snug text-nss-muted">
          {formatInFlightAtCutoffBanner(inFlightCount)}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {filters.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${outcomeFilterButtonClass(filter, statusFilter)}`}
            aria-pressed={statusFilter === filter}
          >
            {statusCounts[filter].toLocaleString()}{' '}
            {filter === 'all' ? 'All' : OUTCOME_STATUS_LABEL[filter]}
          </button>
        ))}
      </div>

      <div className="relative mt-2">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nss-muted"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by request id, node, or status…"
          aria-label="Search request outcomes"
          className="w-full rounded-md border border-nss-border bg-nss-bg py-1.5 pl-8 pr-8 text-[11px] text-nss-text placeholder:text-nss-muted focus:border-nss-primary/50 focus:outline-none focus:ring-1 focus:ring-nss-primary/40"
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-nss-muted hover:text-nss-text"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {pagedRows.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-md border border-nss-border">
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead className="sticky top-0 border-b border-nss-border bg-nss-surface text-nss-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left">Request</th>
                  <th className="px-2 py-1.5 text-left">Terminal</th>
                  <th className="px-2 py-1.5 text-left">Node</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-right">Attempts</th>
                  <th className="px-2 py-1.5 text-right">Latency</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const nodeLabel = row.nodeId
                    ? (labelForNode(row.nodeId, graphLookup) ?? row.nodeId)
                    : '-'
                  const isExpanded = expandedRequestId === row.requestId
                  // Only failed terminals have a "why"; success and in-flight do not.
                  const failureReason =
                    row.status !== 'success' && row.status !== 'in-flight'
                      ? (reasonByRequestId.get(row.requestId)?.reason ?? null)
                      : null

                  return (
                    <Fragment key={row.requestId}>
                      <tr
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => {
                          setExpandedRequestId(isExpanded ? null : row.requestId)
                          if (row.nodeId) {
                            selectGraphElements({ nodeId: row.nodeId })
                          }
                        }}
                        onKeyDown={(keyboardEvent) => {
                          if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
                            return
                          }
                          keyboardEvent.preventDefault()
                          setExpandedRequestId(isExpanded ? null : row.requestId)
                          if (row.nodeId) {
                            selectGraphElements({ nodeId: row.nodeId })
                          }
                        }}
                        className={`cursor-pointer border-b border-nss-border outline-none hover:bg-nss-bg focus:bg-nss-bg ${
                          isExpanded
                            ? 'bg-nss-primary/10 ring-1 ring-inset ring-nss-primary/30'
                            : ''
                        }`}
                      >
                        <td className="px-2 py-1 text-nss-text">
                          <div className="flex items-center gap-1 truncate">
                            <span className="text-nss-muted">{isExpanded ? '▾' : '▸'}</span>
                            <span className="truncate">{row.requestId}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1 text-nss-muted">
                          {row.terminalAtMs === null ? '-' : fmtChartTime(row.terminalAtMs)}
                        </td>
                        <td className="max-w-40 px-2 py-1 text-nss-muted" title={nodeLabel}>
                          <span className="block truncate">{nodeLabel}</span>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex flex-col items-start gap-0.5">
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${outcomeStatusBadgeClass(row.status)}`}
                            >
                              {OUTCOME_STATUS_LABEL[row.status]}
                            </span>
                            {failureReason && (
                              <span className="text-[9px] text-nss-muted" title={failureReason}>
                                {failureReason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1 text-right text-nss-muted">
                          {fmtAttempts(row.attempts)}
                        </td>
                        <td className="px-2 py-1 text-right text-nss-text">
                          {fmtMs(row.latencyMs)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-nss-border bg-nss-bg/40">
                          <td colSpan={6} className="px-3 py-2">
                            {expandedGroups.length > 0 ? (
                              <LifecycleTree
                                requestId={row.requestId}
                                totalLatencyMs={row.latencyMs}
                                groups={expandedGroups}
                              />
                            ) : (
                              <div className="text-[10px] text-nss-muted">
                                Lifecycle steps for this request were not retained (the event stream
                                was capped for this large run).
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-nss-border px-2 py-1.5 text-[10px] text-nss-muted">
            <span className="tabular-nums">
              Showing {(pageStart + 1).toLocaleString()}–
              {(pageStart + pagedRows.length).toLocaleString()} of{' '}
              {visibleRows.length.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={clampedPage <= 1}
                className="inline-flex items-center gap-0.5 rounded border border-nss-border px-1.5 py-0.5 text-nss-muted transition-colors hover:text-nss-text disabled:opacity-40 disabled:hover:text-nss-muted"
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <span className="px-1 tabular-nums">
                {clampedPage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={clampedPage >= pageCount}
                className="inline-flex items-center gap-0.5 rounded border border-nss-border px-1.5 py-0.5 text-nss-muted transition-colors hover:text-nss-text disabled:opacity-40 disabled:hover:text-nss-muted"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-nss-muted">
          {outcomes.length === 0
            ? 'No requests were generated in this run.'
            : trimmedQuery !== ''
              ? `No requests match “${query.trim()}”${statusFilter === 'all' ? '' : ` in ${OUTCOME_STATUS_LABEL[statusFilter as OutcomeStatus].toLowerCase()}`}.`
              : `No ${statusFilter === 'all' ? '' : `${OUTCOME_STATUS_LABEL[statusFilter as OutcomeStatus].toLowerCase()} `}requests in this run.`}
        </div>
      )}
    </div>
  )
}

function LiveMonitorPanel({
  status,
  progress,
  eventsProcessed,
  runStartedAtMs,
  snapshot,
  runContext,
  graphLookup
}: {
  status: SimulationStatus
  progress: number
  eventsProcessed: number
  runStartedAtMs: number | null
  snapshot: TimeSeriesSnapshot | null
  runContext: ScenarioRunContext
  graphLookup: EventGraphLookup
}) {
  const edges = useStore((state) => state.edges)
  const edgeFlowById = useStore((state) => state.edgeFlowById)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (status !== 'running' && status !== 'paused') {
      return
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 100)
    return () => window.clearInterval(intervalId)
  }, [status])

  const elapsedWallMs = Math.max(0, runStartedAtMs === null ? 0 : nowMs - runStartedAtMs)
  const currentSimMs =
    snapshot?.timestamp ??
    (runContext.global.simulationDuration > 0
      ? (progress / 100) * runContext.global.simulationDuration
      : 0)
  const isWarmup = currentSimMs < runContext.global.warmupDuration
  const phaseLabel = livePatternPhaseLabel(runContext.workload, currentSimMs)
  const sourceEdgeIds = useMemo(
    () => edges.filter((edge) => edge.source === runContext.sourceNodeId).map((edge) => edge.id),
    [edges, runContext.sourceNodeId]
  )

  const sourceFlows = sourceEdgeIds
    .map((edgeId) => edgeFlowById[edgeId])
    .filter((flow): flow is NonNullable<(typeof edgeFlowById)[string]> => Boolean(flow))
  const sourceHasTraffic = sourceFlows.some((flow) => flow.totalAttempted > 0)
  const allFlows = Object.values(edgeFlowById)

  const arrivalWindowMs = Math.min(
    4_000,
    Math.max(1_200, Math.round(runContext.global.simulationDuration / 12))
  )
  const arrivalBins = sourceHasTraffic
    ? simulatedArrivalBins(
        runContext.workload,
        currentSimMs,
        arrivalWindowMs,
        LIVE_PATTERN_BAR_COUNT
      )
    : Array.from({ length: LIVE_PATTERN_BAR_COUNT }, () => 0)
  const sourceEmitRate =
    workloadRateMultiplierAtMs(runContext.workload, currentSimMs) * runContext.workload.baseRps
  const totalAttemptedPerSecond = allFlows.reduce((sum, flow) => sum + flow.attemptedPerSecond, 0)
  const totalFailedPerSecond = allFlows.reduce((sum, flow) => sum + flow.failedPerSecond, 0)
  const edgeFailureRatio =
    totalAttemptedPerSecond > 0 ? totalFailedPerSecond / totalAttemptedPerSecond : 0

  const liveNodes = Object.entries(snapshot?.node ?? {})
  const totalInSystem = liveNodes.reduce((sum, [, node]) => sum + node.totalInSystem, 0)
  const totalWorkers = liveNodes.reduce((sum, [, node]) => sum + node.activeWorkers, 0)
  const hotQueueEntry = [...liveNodes].sort((a, b) => {
    const queueDiff = b[1].queueLength - a[1].queueLength
    if (queueDiff !== 0) return queueDiff
    return b[1].totalInSystem - a[1].totalInSystem
  })[0]
  const hotQueueLabel = hotQueueEntry
    ? `${labelForNode(hotQueueEntry[0], graphLookup) ?? hotQueueEntry[0]} · ${Math.round(hotQueueEntry[1].queueLength)}`
    : '-'
  const busiestNodes = [...liveNodes]
    .sort((a, b) => {
      const inSystemDiff = b[1].totalInSystem - a[1].totalInSystem
      if (inSystemDiff !== 0) return inSystemDiff
      const queueDiff = b[1].queueLength - a[1].queueLength
      if (queueDiff !== 0) return queueDiff
      // Stable tiebreak so interpolated near-ties don't swap rows every frame.
      return a[0].localeCompare(b[0])
    })
    .filter(([, node]) => node.totalInSystem > 0 || node.queueLength > 0 || node.status !== 'idle')
  const patternDetails = workloadPatternDetails(runContext.workload)
  const phaseValue = `${isWarmup ? 'Warmup' : 'Steady state'}${phaseLabel ? ` · ${phaseLabel}` : ''}`

  return (
    <div className="space-y-3">
      <div>
        <h3 className={SECTION_TITLE}>Live Monitor</h3>
        <div className="text-xs text-nss-muted">
          Runtime snapshot plus source-side arrivals. This stays compact on purpose.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-4">
        <StatCard
          label="Sim Clock"
          value={`${fmtSeconds(currentSimMs)} / ${fmtSeconds(runContext.global.simulationDuration)}`}
        />
        <StatCard label="Elapsed" value={fmtSeconds(elapsedWallMs)} />
        <StatCard label="Phase" value={phaseValue} highlight={isWarmup ? 'warn' : undefined} />
        <StatCard label="Events" value={eventsProcessed.toLocaleString()} />
      </div>

      <div className={`${SURFACE_CARD} p-3 space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-nss-muted">Source workload</div>
            <div className="text-sm font-medium text-nss-text">
              {runContext.sourceLabel} · {runContext.workload.pattern} ·{' '}
              {runContext.workload.baseRps.toFixed(1)} rps
            </div>
          </div>
          {phaseLabel && (
            <span className="rounded-full border border-nss-primary/20 bg-nss-primary/10 px-2 py-1 text-[11px] font-medium text-nss-primary">
              {phaseLabel}
            </span>
          )}
        </div>

        <ArrivalPatternStrip bins={arrivalBins} active={status === 'running'} />

        <div className="flex items-center justify-between gap-3 text-[11px] text-nss-muted">
          <span>{fmtSeconds(arrivalWindowMs)} source arrival window</span>
          <span>
            {sourceHasTraffic
              ? 'Same average rate, different spacing is what the pattern changes.'
              : 'Waiting for source traffic.'}
          </span>
        </div>

        {patternDetails.length > 0 && (
          <div className="text-xs text-nss-muted">{patternDetails.join(' • ')}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-4">
        <StatCard label="Source Emit" value={fmtRps(sourceEmitRate)} />
        <StatCard label="In System" value={totalInSystem.toLocaleString()} />
        <StatCard
          label="Edge Fail"
          value={fmtPct(edgeFailureRatio)}
          highlight={edgeFailureRatio > 0.05 ? 'crit' : edgeFailureRatio > 0 ? 'warn' : 'ok'}
        />
        <StatCard label="Hot Queue" value={hotQueueLabel} />
      </div>

      <TrafficEventLog currentSimMs={currentSimMs} graphLookup={graphLookup} mode="live" />

      <BusiestNodesCard
        busiestNodes={busiestNodes}
        totalWorkers={totalWorkers}
        graphLookup={graphLookup}
        nodeCount={liveNodes.length}
        emptyLabel="No components are carrying visible load yet."
      />
    </div>
  )
}

// ─── Paced playback ───────────────────────────────────────────────────────────
// Snapshots are sampled at a coarse cadence, so stepping frame-to-frame looks
// choppy. Instead we run a wall-clock playhead over sim time and interpolate the
// bracketing snapshots, so the clock, gauges, and bars move continuously.

type SnapshotNodeState = TimeSeriesSnapshot['node'][string]

function lerp(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction
}

/** Interpolated topology state at an arbitrary sim time `t` (ms). */
function snapshotAtTime(timeSeries: TimeSeriesSnapshot[], t: number): TimeSeriesSnapshot {
  if (timeSeries.length === 0) return { timestamp: t, node: {} }
  if (t <= timeSeries[0].timestamp) return timeSeries[0]
  const last = timeSeries[timeSeries.length - 1]
  if (t >= last.timestamp) return last

  let lo = 0
  let hi = timeSeries.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (timeSeries[mid].timestamp <= t) lo = mid
    else hi = mid
  }

  const before = timeSeries[lo]
  const after = timeSeries[hi]
  const span = after.timestamp - before.timestamp
  const fraction = span > 0 ? (t - before.timestamp) / span : 0

  const node: TimeSeriesSnapshot['node'] = {}
  const ids = new Set([...Object.keys(before.node), ...Object.keys(after.node)])
  for (const id of ids) {
    const a = before.node[id]
    const b = after.node[id]
    if (a && b) {
      node[id] = {
        queueLength: lerp(a.queueLength, b.queueLength, fraction),
        activeWorkers: lerp(a.activeWorkers, b.activeWorkers, fraction),
        totalInSystem: lerp(a.totalInSystem, b.totalInSystem, fraction),
        utilization: lerp(a.utilization, b.utilization, fraction),
        // Status is categorical — snap to the nearer sample rather than blend.
        status: fraction < 0.5 ? a.status : b.status
      } satisfies SnapshotNodeState
    } else {
      node[id] = (a ?? b) as SnapshotNodeState
    }
  }
  return { timestamp: t, node }
}

// ─── Busiest nodes (animated, height-stable) ────────────────────────────────────
// The card count varies as nodes cross the "carrying load" threshold, so a naive
// list changes height and shoves the content below it up and down. We reserve a
// fixed number of slots (so nothing below ever moves) and animate each card's
// entry/exit, keeping departing cards mounted briefly so they fade out in place.

type BusiestNodeEntry = [string, SnapshotNodeState]
type NodeCardPhase = 'present' | 'exit'
interface AnimatedNodeCard {
  id: string
  node: SnapshotNodeState
  phase: NodeCardPhase
}

const BUSIEST_MAX_SLOTS = 4
const BUSIEST_ROW_HEIGHT = 'h-[3.25rem]'
const BUSIEST_EXIT_MS = 240

function busiestNodeEntrySignature(entries: BusiestNodeEntry[]): string {
  return entries
    .map(
      ([id, node]) =>
        `${id}:${node.status}:${node.queueLength}:${node.totalInSystem}:${node.activeWorkers}:${node.utilization}`
    )
    .join('|')
}

function useAnimatedNodeList(entries: BusiestNodeEntry[]): AnimatedNodeCard[] {
  const [cards, setCards] = useState<AnimatedNodeCard[]>(() =>
    entries.map(([id, node]) => ({ id, node, phase: 'present' as NodeCardPhase }))
  )
  const entriesRef = useRef(entries)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const entriesSignature = busiestNodeEntrySignature(entries)

  entriesRef.current = entries

  useEffect(() => {
    const currentEntries = entriesRef.current
    const currentById = new Map(currentEntries)
    const currentIds = new Set(currentById.keys())

    // A node that came back cancels its pending exit.
    for (const id of currentIds) {
      const timer = timers.current.get(id)
      if (timer) {
        clearTimeout(timer)
        timers.current.delete(id)
      }
    }

    setCards((prev) => {
      const prevIds = new Set(prev.map((card) => card.id))
      const next: AnimatedNodeCard[] = []
      // Keep existing cards in place; refresh live ones, mark departed ones exiting.
      for (const card of prev) {
        const liveNode = currentById.get(card.id)
        if (liveNode) {
          next.push({ id: card.id, node: liveNode, phase: 'present' })
        } else {
          next.push({ ...card, phase: 'exit' })
          if (!timers.current.has(card.id)) {
            timers.current.set(
              card.id,
              setTimeout(() => {
                timers.current.delete(card.id)
                setCards((current) => current.filter((entry) => entry.id !== card.id))
              }, BUSIEST_EXIT_MS)
            )
          }
        }
      }
      // Append newly arrived cards.
      for (const [id, node] of currentEntries) {
        if (!prevIds.has(id)) next.push({ id, node, phase: 'present' })
      }
      return next
    })
  }, [entriesSignature])

  useEffect(() => {
    const map = timers.current
    return () => map.forEach((timer) => clearTimeout(timer))
  }, [])

  return cards
}

function BusiestNodesCard({
  busiestNodes,
  totalWorkers,
  graphLookup,
  nodeCount,
  emptyLabel
}: {
  busiestNodes: BusiestNodeEntry[]
  totalWorkers: number
  graphLookup: EventGraphLookup
  nodeCount: number
  emptyLabel: string
}) {
  const slotCount = Math.min(BUSIEST_MAX_SLOTS, Math.max(1, nodeCount))
  const shown = busiestNodes.slice(0, slotCount)
  const overflow = busiestNodes.length - shown.length
  const cards = useAnimatedNodeList(shown)
  const isEmpty = cards.length === 0
  // Reserve height for a full set of slots (row + gap) so nothing below ever
  // moves; cards collapse into this space instead of resizing the section.
  const reservedHeight = `${slotCount * 3.75}rem`

  return (
    <div className={`${SURFACE_CARD} p-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-nss-muted">
          Busiest Nodes
        </div>
        <div className="text-[11px] text-nss-muted">
          {overflow > 0 && <span className="text-nss-warning">+{overflow} more busy · </span>}
          {Math.round(totalWorkers).toLocaleString()} active workers
        </div>
      </div>

      <div className="relative mt-3" style={{ minHeight: reservedHeight }}>
        {cards.map((card) => (
          <div
            key={card.id}
            className={`flex ${BUSIEST_ROW_HEIGHT} mb-2 max-h-[3.25rem] items-center justify-between gap-3 overflow-hidden rounded-md border border-nss-border bg-nss-bg px-3 ${
              card.phase === 'exit' ? 'nss-node-card-exit' : 'nss-node-card-enter'
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm text-nss-text">
                {labelForNode(card.id, graphLookup) ?? card.id}
              </div>
              <div className="text-[11px] text-nss-muted tabular-nums">
                q={Math.round(card.node.queueLength)} • in-system=
                {Math.round(card.node.totalInSystem)} • util={fmtPct(card.node.utilization)}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium capitalize ${liveNodeStatusClass(card.node.status)}`}
            >
              {card.node.status}
            </span>
          </div>
        ))}
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[11px] text-nss-muted">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  )
}

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const

interface PacedPlayback {
  playheadMs: number
  isPlaying: boolean
  speed: number
  atEnd: boolean
  setSpeed: (speed: number) => void
  toggle: () => void
  seek: (ms: number) => void
  stepToFrame: (direction: -1 | 1) => void
  jumpStart: () => void
  jumpEnd: () => void
}

/**
 * Wall-clock playhead over sim time. `speed` is sim-ms advanced per wall-ms, so
 * speed 1 replays in real time. Advances via rAF for frame-rate-smooth motion.
 */
function usePacedPlayback(durationMs: number, frameTimes: number[]): PacedPlayback {
  const [playheadMs, setPlayheadMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const lastWallRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isPlaying || durationMs <= 0) return

    let raf = 0
    lastWallRef.current = null
    const tick = (nowWall: number): void => {
      const previous = lastWallRef.current ?? nowWall
      const deltaWall = nowWall - previous
      lastWallRef.current = nowWall
      setPlayheadMs((current) => {
        const next = current + deltaWall * speed
        if (next >= durationMs) {
          setIsPlaying(false)
          return durationMs
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, durationMs, speed])

  const atEnd = playheadMs >= durationMs

  const toggle = useCallback(() => {
    setIsPlaying((playing) => {
      if (!playing && playheadMs >= durationMs) {
        setPlayheadMs(0)
      }
      return !playing
    })
  }, [playheadMs, durationMs])

  const seek = useCallback(
    (ms: number) => {
      setIsPlaying(false)
      setPlayheadMs(Math.min(durationMs, Math.max(0, ms)))
    },
    [durationMs]
  )

  const stepToFrame = useCallback(
    (direction: -1 | 1) => {
      setIsPlaying(false)
      setPlayheadMs((current) => {
        if (direction === 1) {
          const nextFrame = frameTimes.find((time) => time > current + 0.001)
          return nextFrame ?? durationMs
        }
        let target = 0
        for (const time of frameTimes) {
          if (time < current - 0.001) target = time
          else break
        }
        return target
      })
    },
    [frameTimes, durationMs]
  )

  const jumpStart = useCallback(() => {
    setIsPlaying(false)
    setPlayheadMs(0)
  }, [])

  const jumpEnd = useCallback(() => {
    setIsPlaying(false)
    setPlayheadMs(durationMs)
  }, [durationMs])

  return {
    playheadMs,
    isPlaying,
    speed,
    atEnd,
    setSpeed,
    toggle,
    seek,
    stepToFrame,
    jumpStart,
    jumpEnd
  }
}

function ReplayMonitorPanel({
  output,
  runContext,
  graphLookup
}: {
  output: SimulationOutput
  runContext: ScenarioRunContext | null
  graphLookup: EventGraphLookup
}) {
  const durationMs = runContext?.global.simulationDuration ?? 0
  const frameTimes = useMemo(
    () => output.timeSeries.map((frame) => frame.timestamp),
    [output.timeSeries]
  )
  const playback = usePacedPlayback(durationMs, frameTimes)

  if (!runContext) {
    return (
      <div className={`${SURFACE_CARD} p-4 text-sm text-nss-muted`}>
        Replay data is available, but the run context for this session is missing.
      </div>
    )
  }

  if (output.timeSeries.length === 0) {
    return (
      <div className={`${SURFACE_CARD} p-4 text-sm text-nss-muted`}>
        No time-series snapshots were retained for this run.
      </div>
    )
  }

  const currentSimMs = playback.playheadMs
  const snapshot = snapshotAtTime(output.timeSeries, currentSimMs)
  const replayProgress = durationMs > 0 ? (currentSimMs / durationMs) * 100 : 0
  const isWarmup = currentSimMs < runContext.global.warmupDuration
  const phaseLabel = livePatternPhaseLabel(runContext.workload, currentSimMs)
  const phaseValue = `${isWarmup ? 'Warmup' : 'Steady state'}${phaseLabel ? ` · ${phaseLabel}` : ''}`
  const arrivalWindowMs = Math.min(
    4_000,
    Math.max(1_200, Math.round(runContext.global.simulationDuration / 12))
  )
  const arrivalBins = simulatedArrivalBins(
    runContext.workload,
    currentSimMs,
    arrivalWindowMs,
    LIVE_PATTERN_BAR_COUNT
  )
  const currentSourceRate =
    workloadRateMultiplierAtMs(runContext.workload, currentSimMs) * runContext.workload.baseRps
  const currentErrorRate = errorRateAtTime(output, currentSimMs)
  const liveNodes = Object.entries(snapshot.node)
  const totalInSystem = liveNodes.reduce((sum, [, node]) => sum + node.totalInSystem, 0)
  const totalWorkers = liveNodes.reduce((sum, [, node]) => sum + node.activeWorkers, 0)
  const hotQueueEntry = [...liveNodes].sort((a, b) => {
    const queueDiff = b[1].queueLength - a[1].queueLength
    if (queueDiff !== 0) return queueDiff
    return b[1].totalInSystem - a[1].totalInSystem
  })[0]
  const hotQueueLabel = hotQueueEntry
    ? `${labelForNode(hotQueueEntry[0], graphLookup) ?? hotQueueEntry[0]} · ${Math.round(hotQueueEntry[1].queueLength)}`
    : '-'
  const busiestNodes = [...liveNodes]
    .sort((a, b) => {
      const inSystemDiff = b[1].totalInSystem - a[1].totalInSystem
      if (inSystemDiff !== 0) return inSystemDiff
      const queueDiff = b[1].queueLength - a[1].queueLength
      if (queueDiff !== 0) return queueDiff
      // Stable tiebreak so interpolated near-ties don't swap rows every frame.
      return a[0].localeCompare(b[0])
    })
    .filter(([, node]) => node.totalInSystem > 0 || node.queueLength > 0 || node.status !== 'idle')
  const buttonClass =
    'h-7 w-7 inline-flex items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-text hover:bg-nss-surface transition-colors disabled:opacity-40 disabled:hover:bg-transparent'
  const patternDetails = workloadPatternDetails(runContext.workload)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={SECTION_TITLE}>Replay Monitor</h3>
          <div className="text-xs text-nss-muted">
            Scrub saved snapshots to replay the run state over simulation time.
          </div>
        </div>
        <span className="text-[10px] text-nss-muted tabular-nums">
          {fmtChartTime(currentSimMs)} · {playback.speed}×
        </span>
      </div>

      <div className={`${SURFACE_CARD} p-3 space-y-3`}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={playback.jumpStart}
            disabled={currentSimMs <= 0}
            className={buttonClass}
            title="Jump to start"
            aria-label="Jump to start"
          >
            <ChevronsLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => playback.stepToFrame(-1)}
            disabled={currentSimMs <= 0}
            className={buttonClass}
            title="Step back one snapshot"
            aria-label="Step back"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={playback.toggle}
            disabled={durationMs <= 0}
            className={buttonClass}
            title={playback.isPlaying ? 'Pause' : 'Play'}
            aria-label={playback.isPlaying ? 'Pause' : 'Play'}
          >
            {playback.isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(1, durationMs)}
            step={Math.max(1, durationMs / 1000)}
            value={currentSimMs}
            onChange={(event) => playback.seek(Number(event.target.value))}
            className="nss-range min-w-0 flex-1"
            style={{ '--range-progress': `${replayProgress}%` } as CSSProperties}
            aria-label="Replay time"
          />
          <button
            type="button"
            onClick={() => playback.stepToFrame(1)}
            disabled={playback.atEnd}
            className={buttonClass}
            title="Step forward one snapshot"
            aria-label="Step forward"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            onClick={playback.jumpEnd}
            disabled={playback.atEnd}
            className={buttonClass}
            title="Jump to end"
            aria-label="Jump to end"
          >
            <ChevronsRight size={14} />
          </button>
          <div className="ml-1 flex items-center gap-0.5">
            {PLAYBACK_SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => playback.setSpeed(option)}
                className={`rounded px-1.5 py-1 text-[10px] font-medium tabular-nums transition-colors ${
                  playback.speed === option
                    ? 'bg-nss-primary/15 text-nss-primary'
                    : 'text-nss-muted hover:text-nss-text'
                }`}
                aria-pressed={playback.speed === option}
                title={`${option}× speed`}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-nss-muted">
          Playback eases between sampled snapshots over sim time. Drag to scrub; the step buttons
          jump to a sampled frame.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-4">
        <StatCard
          label="Sim Clock"
          value={`${fmtSeconds(currentSimMs)} / ${fmtSeconds(runContext.global.simulationDuration)}`}
        />
        <StatCard label="Snapshot" value={fmtChartTime(currentSimMs)} />
        <StatCard label="Phase" value={phaseValue} highlight={isWarmup ? 'warn' : undefined} />
        <StatCard label="Warmup Ends" value={fmtSeconds(runContext.global.warmupDuration)} />
      </div>

      <div className={`${SURFACE_CARD} p-3 space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-nss-muted">Source workload</div>
            <div className="text-sm font-medium text-nss-text">
              {runContext.sourceLabel} · {runContext.workload.pattern} ·{' '}
              {runContext.workload.baseRps.toFixed(1)} rps
            </div>
          </div>
          {phaseLabel && (
            <span className="rounded-full border border-nss-primary/20 bg-nss-primary/10 px-2 py-1 text-[11px] font-medium text-nss-primary">
              {phaseLabel}
            </span>
          )}
        </div>

        <ArrivalPatternStrip bins={arrivalBins} active={playback.isPlaying} />

        <div className="flex items-center justify-between gap-3 text-[11px] text-nss-muted">
          <span>{fmtSeconds(arrivalWindowMs)} arrival window</span>
          <span>Slide or press play to walk the run again.</span>
        </div>

        {patternDetails.length > 0 && (
          <div className="text-xs text-nss-muted">{patternDetails.join(' • ')}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-4">
        <StatCard label="Est. Source Emit" value={fmtRps(currentSourceRate)} />
        <StatCard label="In System" value={Math.round(totalInSystem).toLocaleString()} />
        <StatCard
          label={currentSimMs <= 0 ? 'First Retained Window Fail' : 'Replay Window Fail'}
          value={currentErrorRate === null ? '-' : fmtPct(currentErrorRate)}
          highlight={
            currentErrorRate === null
              ? undefined
              : currentErrorRate > 0.05
                ? 'crit'
                : currentErrorRate > 0
                  ? 'warn'
                  : 'ok'
          }
        />
        <StatCard label="Hot Queue" value={hotQueueLabel} />
      </div>

      <RequestOutcomeLog output={output} graphLookup={graphLookup} />

      <BusiestNodesCard
        busiestNodes={busiestNodes}
        totalWorkers={totalWorkers}
        graphLookup={graphLookup}
        nodeCount={liveNodes.length}
        emptyLabel="No components were carrying visible load at this replay point. Move the scrubber or press play to inspect active workers over time."
      />
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

  const card = (triggerProps?: HTMLAttributes<HTMLDivElement>) => (
    <div className={`${SURFACE_CARD} p-2`} tabIndex={tooltip ? 0 : undefined} {...triggerProps}>
      <div className="text-xs text-nss-muted">{label}</div>
      <div className={`font-medium tabular-nums text-sm ${colour}`}>{value}</div>
    </div>
  )

  if (!tooltip) {
    return card()
  }

  return <HoverTooltip content={tooltip}>{(triggerProps) => card(triggerProps)}</HoverTooltip>
}

function MetricHeaderCell({
  label,
  tooltip,
  className = 'text-right pb-1 pr-2'
}: {
  label: string
  tooltip: string
  className?: string
}) {
  return (
    <th className={className}>
      <span className="inline-flex items-center justify-end gap-1">
        <span>{label}</span>
        <TooltipInfo
          label={`Explain ${label}`}
          content={tooltip}
          width={280}
          className="h-3 w-3 text-[8px]"
        />
      </span>
    </th>
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
  const throughputDisplay = summary.postWarmupTotalRequests > 0 ? fmtRps(summary.throughput) : '-'
  const totalInFlightAtCutoff = output.conservationCheck.reduce(
    (sum, result) => sum + result.inFlight,
    0
  )
  const nodeEntries = Object.entries(output.perNode)
  const hottestNode = nodeEntries.reduce<(typeof nodeEntries)[number] | null>((winner, entry) => {
    if (!winner) return entry
    return entry[1].utilization > winner[1].utilization ? entry : winner
  }, null)
  const downstreamHeadroom = nodeEntries.filter(
    ([nodeId, metrics]) => nodeId !== hottestNode?.[0] && metrics.postWarmupArrived > 0
  )
  const avgDownstreamUtil =
    downstreamHeadroom.length > 0
      ? downstreamHeadroom.reduce((sum, [, metrics]) => sum + metrics.utilization, 0) /
        downstreamHeadroom.length
      : null
  const showOverloadConclusion =
    hottestNode !== null &&
    hottestNode[1].utilization >= 0.95 &&
    output.summary.errorRate >= 0.2 &&
    (avgDownstreamUtil === null || avgDownstreamUtil < 0.5)

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
          {windowLen.toFixed(0)}s,&nbsp;{summary.postWarmupTotalRequests.toLocaleString()} requests)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        <StatCard
          label="Requests (post-warmup)"
          value={summary.postWarmupTotalRequests.toLocaleString()}
          tooltip={RESULTS_SUMMARY_TOOLTIPS.requestsPostWarmup}
        />
        <StatCard
          label="Successful"
          value={summary.postWarmupSuccessfulRequests.toLocaleString()}
          tooltip={RESULTS_SUMMARY_TOOLTIPS.successful}
        />
        <StatCard
          label="Success Throughput"
          value={throughputDisplay}
          tooltip={RESULTS_SUMMARY_TOOLTIPS.throughput}
        />
        <StatCard
          label="Error Rate"
          value={fmtPct(summary.errorRate)}
          highlight={errorHighlight}
          tooltip={RESULTS_SUMMARY_TOOLTIPS.errorRate}
        />
        <StatCard
          label="In Flight at Cutoff"
          value={totalInFlightAtCutoff.toLocaleString()}
          highlight={totalInFlightAtCutoff > 0 ? 'warn' : 'ok'}
          tooltip={RESULTS_SUMMARY_TOOLTIPS.inFlightAtCutoff}
        />
        <StatCard
          label="Offered Arrival CV"
          value={fmtCv(summary.offeredArrivalCV)}
          tooltip={RESULTS_SUMMARY_TOOLTIPS.offeredArrivalCv}
        />
      </div>

      {totalInFlightAtCutoff > 0 && (
        <div className="rounded-md border border-nss-warning/20 bg-nss-warning/10 px-3 py-2 text-xs text-nss-warning">
          {formatInFlightAtCutoffBanner(totalInFlightAtCutoff)}
        </div>
      )}

      {showOverloadConclusion && hottestNode && (
        <div className="rounded-md border border-nss-danger/20 bg-nss-danger/10 px-3 py-2 text-xs leading-relaxed text-nss-danger">
          <span className="font-semibold">
            Overload conclusion: {hottestNode[1].nodeLabel ?? hottestNode[0]} is saturated.
          </span>{' '}
          Downstream nodes are underused, so this run is constrained at the bottleneck. Add capacity
          there, reduce offered load, or apply load shedding before it.
        </div>
      )}

      <LatencyPopulationSection
        title="Success Latency"
        subtitle="Successful requests only. Read these percentiles together with the paired error rate for the same steady-state window."
        sampleCount={summary.successLatencySamples}
        errorRate={summary.latencyWindowErrorRate}
      >
        <div className="flex items-baseline justify-between gap-3">
          <HoverTooltip content={RESULTS_CONTEXTUAL_TOOLTIPS.percentilesDoNotCompose} width={320}>
            {(triggerProps) => (
              <span className="text-[10px] text-nss-muted" tabIndex={0} {...triggerProps}>
                ⓘ percentiles do not sum across hops
              </span>
            )}
          </HoverTooltip>
        </div>
        <div className="grid grid-cols-5 gap-1 text-xs text-center">
          {(['p50', 'p90', 'p95', 'p99', 'max'] as const).map((k) => (
            <HoverTooltip key={k} content={RESULTS_E2E_PERCENTILE_TOOLTIPS[k]} width={280}>
              {(triggerProps) => (
                <div className={`${SURFACE_CARD} p-1.5`} tabIndex={0} {...triggerProps}>
                  <div className="text-nss-muted">{k}</div>
                  <div className="font-medium tabular-nums text-nss-text">{fmtMs(l[k])}</div>
                </div>
              )}
            </HoverTooltip>
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
  const button = (triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-controls={contentId}
      className="w-full flex items-center justify-between px-3 py-2 bg-nss-surface hover:bg-nss-bg text-left transition-colors"
      {...triggerProps}
    >
      <span className="flex items-center gap-2 text-xs font-medium text-nss-text">
        <span className={iconCls}>{icon}</span>
        {title}
      </span>
      <span className="text-nss-muted text-[10px]">{open ? '▲' : '▼'}</span>
    </button>
  )

  return (
    <div className="border border-nss-border rounded-md overflow-hidden">
      {tooltip ? (
        <HoverTooltip content={tooltip}>{(triggerProps) => button(triggerProps)}</HoverTooltip>
      ) : (
        button()
      )}
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
function nodeCondition(m: NodeMetric): ReliabilityStatus {
  return deriveReliabilityStatus({
    postWarmupArrived: m.postWarmupArrived,
    successLatencySamples: m.successLatencySamples,
    timeToErrorSamples: m.timeToErrorSamples,
    latencyWindowErrorRate: m.latencyWindowErrorRate,
    timeToErrorByCause: m.timeToErrorByCause
  })
}

function conditionRank(condition: ReliabilityStatus): number {
  return reliabilityRank(condition.level) * 10 + toneRank(condition.tone)
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
                  - {fmtMs(latTop.meanMs)} ({fmtPct(latTop.shareOfEndToEnd)} of end-to-end,{' '}
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
                  - {failTop.total.toLocaleString()} killed (
                  {ERROR_CAUSE_LABELS[failTop.dominantCause]}, {fmtPct(failTop.shareOfFailures)} of
                  failures)
                </span>
              </div>
            </button>
          ) : (
            <div className="text-xs text-nss-success">No failures - nothing to locate.</div>
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
type HoveredChartPoint = {
  key: string
  label: string
  value: string
  timeLabel: string
  leftPercent: number
  topPercent: number
  placement: 'above' | 'below'
}

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

function fmtChartTime(ms: number): string {
  const seconds = ms / 1000
  return `t=${seconds.toFixed(Number.isInteger(seconds) ? 0 : 1)}s`
}

function TimelineChart({
  title,
  subtitle,
  totalDurationMs,
  warmupDurationMs,
  statusWindows,
  series,
  yFormatter,
  xAxisLabel = 'simulation time (seconds)',
  yAxisLabel
}: {
  title: string
  subtitle: string
  totalDurationMs: number
  warmupDurationMs: number
  statusWindows: StatusWindow[]
  series: ChartSeries[]
  yFormatter: (value: number | null) => string
  xAxisLabel?: string
  yAxisLabel: string
}) {
  const width = 640
  const height = 180
  const margin = { top: 12, right: 12, bottom: 24, left: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const duration = Math.max(1, totalDurationMs)
  const [hoveredPoint, setHoveredPoint] = useState<HoveredChartPoint | null>(null)
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
          <div className="mt-1 text-[10px] text-nss-muted">
            x-axis: {xAxisLabel} · y-axis: {yAxisLabel}
          </div>
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
        <div className="relative" onMouseLeave={() => setHoveredPoint(null)}>
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
            <text
              x={14}
              y={margin.top + plotHeight / 2}
              textAnchor="middle"
              fill="rgba(148, 163, 184, 0.8)"
              fontSize="9"
              transform={`rotate(-90 14 ${margin.top + plotHeight / 2})`}
            >
              {yAxisLabel}
            </text>
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
                    .map((point, index) => {
                      const value = point.y as number
                      const cx = xAt(point.xMs)
                      const cy = yAt(value)
                      const key = `${item.label}-${index}-${point.xMs}`
                      const isHovered = hoveredPoint?.key === key

                      return (
                        <g key={key}>
                          {isHovered && (
                            <circle
                              cx={cx}
                              cy={cy}
                              r={5.5}
                              fill="transparent"
                              stroke={item.color}
                              strokeWidth={1.5}
                              opacity={0.85}
                            />
                          )}
                          <circle cx={cx} cy={cy} r={2.4} fill={item.color} />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={8}
                            fill="transparent"
                            onMouseEnter={() =>
                              setHoveredPoint({
                                key,
                                label: item.label,
                                value: yFormatter(value),
                                timeLabel: fmtChartTime(point.xMs),
                                leftPercent: (cx / width) * 100,
                                topPercent: (cy / height) * 100,
                                placement: cy < margin.top + 34 ? 'below' : 'above'
                              })
                            }
                          />
                        </g>
                      )
                    })}
                </g>
              )
            })}
            <text x={margin.left} y={height - 6} fill="rgba(148, 163, 184, 0.8)" fontSize="10">
              t=0
            </text>
            <text
              x={width / 2}
              y={height - 6}
              textAnchor="middle"
              fill="rgba(148, 163, 184, 0.8)"
              fontSize="10"
            >
              {xAxisLabel}
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

          {hoveredPoint && (
            <div
              className="pointer-events-none absolute z-10 w-44 -translate-x-1/2 rounded-md border border-nss-border bg-nss-surface px-2.5 py-2 shadow-xl"
              style={{
                left: `${hoveredPoint.leftPercent}%`,
                top: `${hoveredPoint.topPercent}%`,
                transform:
                  hoveredPoint.placement === 'above'
                    ? 'translate(-50%, calc(-100% - 10px))'
                    : 'translate(-50%, 10px)'
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                {hoveredPoint.label}
              </div>
              <div className="mt-1 text-xs font-medium text-nss-text">{hoveredPoint.value}</div>
              <div className="mt-1 text-[10px] text-nss-muted">{hoveredPoint.timeLabel}</div>
            </div>
          )}
        </div>
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
          yAxisLabel="end-to-end p95 latency (ms)"
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
          yAxisLabel="error rate (% of terminals)"
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
      const aCapacity = deriveCapacityStatus({
        utilization: a.utilization,
        utilizationUnit: 'ratio',
        queueDepth: a.avgQueueLength
      })
      const bCapacity = deriveCapacityStatus({
        utilization: b.utilization,
        utilizationUnit: 'ratio',
        queueDepth: b.avgQueueLength
      })
      return (
        conditionRank(bCondition) - conditionRank(aCondition) ||
        capacityRank(bCapacity.level) - capacityRank(aCapacity.level) ||
        b.latencyWindowErrorRate - a.latencyWindowErrorRate
      )
    })
  const edgeEntries = Object.entries(output.perEdge)
    .filter(([, metric]) => metric.successLatencySamples > 0 || metric.timeToErrorSamples > 0)
    .sort(([, a], [, b]) => {
      const aCondition = edgeCondition(a)
      const bCondition = edgeCondition(b)
      return (
        toneRank(bCondition.level) - toneRank(aCondition.level) ||
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
          const capacity = deriveCapacityStatus({
            utilization: metric.utilization,
            utilizationUnit: 'ratio',
            queueDepth: metric.avgQueueLength
          })
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
                  <div className="text-[10px] text-nss-muted">
                    node-local scope · capacity {capacity.label.toLowerCase()}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CONDITION_CLASSES[condition.tone]}`}
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
                className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${CONDITION_CLASSES[condition.tone]}`}
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
                tooltip={RESULTS_CONTEXTUAL_TOOLTIPS.offeredCvVsArrivalCv}
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
                tooltip={RESULTS_CONTEXTUAL_TOOLTIPS.arrivalCvNode}
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
                yAxisLabel="node-local p95 latency (ms)"
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
                yAxisLabel="error rate (% of terminals)"
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
                yAxisLabel="queue length (requests)"
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
                yAxisLabel="utilization (% busy)"
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
              yAxisLabel="edge transit p95 latency (ms)"
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
              yAxisLabel="error rate (% of terminals)"
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
  const hasConfiguredSloTargets = output.sloTargetCount > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className={SECTION_TITLE}>Simulation Health</h3>
        <HealthBadge level={overall} />
      </div>

      {/* SLO */}
      <CollapsibleCheck
        title={
          !hasConfiguredSloTargets
            ? 'SLO -No targets configured'
            : sloLevel === 'healthy'
              ? 'Configured SLOs -No breaches'
              : `SLO -${output.sloBreaches.length} breach${output.sloBreaches.length !== 1 ? 'es' : ''}`
        }
        level={sloLevel}
        tooltip={RESULTS_HEALTH_CHECK_TOOLTIPS.slo}
      >
        {!hasConfiguredSloTargets ? (
          <p className="text-xs text-nss-muted">
            No latency or availability SLO targets are configured on these nodes. Use the Error Rate
            section for this run-level overload result.
          </p>
        ) : sloLevel === 'healthy' ? (
          <p className="text-xs text-nss-muted">
            No configured latency or availability SLO targets were breached. This is separate from
            the run-level error-rate check below.
          </p>
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
                  {b.nodeLabel} - {metricStr}
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
            ? 'Error Rate -None'
            : `Error Rate -${fmtPct(output.summary.errorRate)} (${output.summary.postWarmupFailedRequests.toLocaleString()} errors)`
        }
        level={errorLevel}
        tooltip={RESULTS_HEALTH_CHECK_TOOLTIPS.errorRate}
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
            ? "Little's Law -Within tolerance"
            : `Little's Law -${llViolations.length} violation${llViolations.length !== 1 ? 's' : ''} (error > 10%)`
        }
        level={llLevel}
        tooltip={RESULTS_HEALTH_CHECK_TOOLTIPS.littlesLaw}
      >
        {llLevel === 'healthy' ? (
          <p className="text-xs text-nss-muted">
            L = λW verified for accepted node-local work (error ≤ 10%).
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-[11px] leading-relaxed text-nss-muted">
              This check is most reliable for stable accepted traffic. In rejection-heavy overload,
              λ and W can describe only the work that actually entered service, so treat this as a
              consistency warning, not an additional capacity diagnosis.
            </p>
            {llViolations.map((r, i) => {
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
            })}
          </div>
        )}
      </CollapsibleCheck>

      {/* Conservation */}
      <CollapsibleCheck
        title={
          conservationLevel === 'healthy'
            ? totalInFlightAtCutoff > 0
              ? `Conservation -Balanced (${totalInFlightAtCutoff} in-flight at cutoff)`
              : 'Conservation -Balanced'
            : `Conservation -${imbalanced.length} node${imbalanced.length !== 1 ? 's' : ''} with in-flight requests`
        }
        level={conservationLevel}
        tooltip={RESULTS_HEALTH_CHECK_TOOLTIPS.conservation}
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
        title={warmupLevel === 'healthy' ? 'Warmup -Adequate' : 'Warmup -May be too short'}
        level={warmupLevel}
        tooltip={RESULTS_HEALTH_CHECK_TOOLTIPS.warmup}
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

type PerNodeFinding = {
  text: string
  level: 'ok' | 'warn' | 'crit'
}

function findingClass(level: PerNodeFinding['level']): string {
  if (level === 'crit') {
    return 'border-nss-danger/20 bg-nss-danger/10 text-nss-danger'
  }
  if (level === 'warn') {
    return 'border-nss-warning/20 bg-nss-warning/10 text-nss-warning'
  }
  return 'border-nss-border bg-nss-bg text-nss-muted'
}

function buildPerNodeFindings(
  entries: Array<[string, SimulationOutput['perNode'][string]]>
): PerNodeFinding[] {
  const active = entries.filter(([, metrics]) => metrics.postWarmupArrived > 0)
  if (active.length === 0) {
    return [{ text: 'No node received post-warmup traffic.', level: 'ok' }]
  }

  const topUtil = active.reduce((winner, current) =>
    current[1].utilization > winner[1].utilization ? current : winner
  )
  const topErrors = active.reduce((winner, current) =>
    current[1].errorRate > winner[1].errorRate ? current : winner
  )
  const topQueue = active.reduce((winner, current) =>
    current[1].avgQueueLength > winner[1].avgQueueLength ? current : winner
  )

  const labelFor = ([nodeId, metrics]: [string, SimulationOutput['perNode'][string]]) =>
    metrics.nodeLabel ?? nodeId
  const findings: PerNodeFinding[] = [
    {
      text: `${labelFor(topUtil)} has highest utilization at ${(topUtil[1].utilization * 100).toFixed(1)}%.`,
      level: topUtil[1].utilization >= 0.95 ? 'crit' : topUtil[1].utilization >= 0.7 ? 'warn' : 'ok'
    },
    topErrors[1].errorRate > 0
      ? {
          text: `${labelFor(topErrors)} has highest node-local error rate at ${fmtPct(topErrors[1].errorRate)}.`,
          level: topErrors[1].errorRate >= 0.05 ? 'crit' : 'warn'
        }
      : { text: 'No node-local errors were recorded.', level: 'ok' },
    topQueue[1].avgQueueLength > 0
      ? {
          text: `${labelFor(topQueue)} has the deepest average queue at ${topQueue[1].avgQueueLength.toFixed(1)} requests.`,
          level: topQueue[1].avgQueueLength >= 1 ? 'warn' : 'ok'
        }
      : { text: 'No persistent node queue was observed.', level: 'ok' }
  ]

  return findings
}

function PerNodeTable({ output }: { output: SimulationOutput }) {
  const [showInactive, setShowInactive] = useState(false)
  const nodes = useStore((state) => state.nodes)
  const entries = Object.entries(output.perNode)

  // Source nodes emit traffic rather than receive it, so their `postWarmupArrived`
  // is always 0. Without this, the driver of the whole run gets mislabelled as an
  // "inactive node with no post-warmup traffic". Split them out explicitly.
  const sourceNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const node of nodes) {
      const data = node.data as { structuralRole?: unknown; profile?: unknown } | undefined
      if (data?.structuralRole === 'source' || data?.profile === 'source') {
        ids.add(node.id)
      }
    }
    return ids
  }, [nodes])

  if (entries.length === 0) return null

  const llByNode = new Map(output.littlesLawCheck.map((r) => [r.nodeId, r]))
  const conservationByNode = new Map(
    output.conservationCheck.map((result) => [result.nodeId, result])
  )

  const activeEntries = entries.filter(([, m]) => m.postWarmupArrived > 0)
  const idleEntries = entries.filter(([, m]) => m.postWarmupArrived === 0)
  const sourceEntries = idleEntries.filter(([nodeId]) => sourceNodeIds.has(nodeId))
  const inactiveEntries = idleEntries.filter(([nodeId]) => !sourceNodeIds.has(nodeId))
  const findings = buildPerNodeFindings(entries)

  return (
    <div className="space-y-2">
      <h3 className={SECTION_TITLE}>Per-node Metrics</h3>
      <div className={`${SURFACE_CARD} p-3`}>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
          Top Findings
        </div>
        <div className="grid gap-2 text-xs text-nss-muted md:grid-cols-3">
          {findings.map((finding) => (
            <div
              key={finding.text}
              className={`rounded-md border px-2 py-1.5 ${findingClass(finding.level)}`}
            >
              {finding.text}
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-nss-muted border-b border-nss-border">
              <th className="text-left pb-1 pr-2">Node</th>
              <MetricHeaderCell
                label="Arrived"
                tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.arrived}
              />
              <MetricHeaderCell label="Done" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.done} />
              <MetricHeaderCell label="Reject" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.reject} />
              <MetricHeaderCell label="T.O." tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.timedOut} />
              <MetricHeaderCell label="Reset" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.reset} />
              <MetricHeaderCell
                label="In Flight"
                tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.inFlight}
              />
              <MetricHeaderCell label="Avg Q" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.avgQueue} />
              <MetricHeaderCell label="Util" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.util} />
              <MetricHeaderCell
                label="Err %"
                tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.errorRate}
              />
              <MetricHeaderCell
                label="Arr CV"
                tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.arrivalCV}
              />
              <MetricHeaderCell label="p50" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.p50} />
              <MetricHeaderCell label="p95" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.p95} />
              <MetricHeaderCell label="p99" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.p99} />
              <MetricHeaderCell label="λ" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.lambda} />
              <MetricHeaderCell label="W" tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.w} />
              <MetricHeaderCell
                label="L"
                tooltip={RESULTS_PER_NODE_COLUMN_TOOLTIPS.l}
                className="text-right pb-1"
              />
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
                    {ll ? fmtLambda(ll.lambda) : '-'}
                  </td>
                  <td className="text-right pr-2 text-nss-muted">{ll ? fmtW(ll.wSeconds) : '-'}</td>
                  <td
                    className={`text-right ${llViolation ? 'text-nss-warning font-medium' : 'text-nss-muted'}`}
                    title={
                      llViolation ? `Little's Law: expected ${fmtL(ll!.expectedL)}` : undefined
                    }
                  >
                    {ll ? fmtL(ll.observedL) : '-'}
                    {llViolation && <span className="ml-0.5">⚠</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sourceEntries.length > 0 && (
        <table className="w-full text-xs tabular-nums mt-1 opacity-60">
          <tbody>
            {sourceEntries.map(([nodeId, m]) => (
              <tr key={nodeId} className="border-b border-nss-border">
                <td className="py-0.5 pr-2 text-nss-muted">{m.nodeLabel ?? nodeId}</td>
                <td className="text-right text-nss-muted text-[10px] italic" colSpan={16}>
                  source · emits traffic (not measured by arrivals)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inactiveEntries.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive((s) => !s)}
            className="text-[10px] text-nss-muted hover:text-nss-text transition-colors"
          >
            {showInactive ? '▲' : '▼'} Inactive nodes ({inactiveEntries.length}) - post-warmup
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
  runStartedAtMs,
  snapshot,
  results,
  error,
  runContext,
  onClose
}: ResultsTrayProps) {
  const [activeTab, setActiveTab] = useState<ResultsTab>('overview')
  const [selectedComponent, setSelectedComponent] = useState<SelectedComponent | null>(null)
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
      setSelectedComponent(defaultSelectedComponent(results))
    }
  }, [results])

  useEffect(() => {
    if (!results && (status === 'running' || status === 'paused') && activeTab !== 'traffic') {
      setActiveTab('traffic')
    }
  }, [activeTab, results, status])

  const retainedReplayEventCount = results ? results.eventStream.length : 0
  const totalCapturedReplayEvents = results ? totalReplayEventCount(results) : 0
  const replayEventsTruncated = retainedReplayEventCount < totalCapturedReplayEvents
  const visibleTabs = results !== null ? RESULTS_TABS : []
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

      {!results && runContext && (status === 'running' || status === 'paused') && (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <LiveMonitorPanel
            status={status}
            progress={progress}
            eventsProcessed={eventsProcessed}
            runStartedAtMs={runStartedAtMs}
            snapshot={snapshot}
            runContext={runContext}
            graphLookup={graphLookup}
          />
        </div>
      )}

      {results && (
        <>
          {visibleTabs.length > 0 && (
            <div className="shrink-0 overflow-x-auto border-b border-nss-border px-4 py-2">
              <div className="flex min-w-max items-center gap-2">
                {visibleTabs.map((tab) => (
                  <TabButton key={tab.id} tab={tab} activeTab={activeTab} onSelect={setActiveTab} />
                ))}
              </div>
            </div>
          )}

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
                <PerNodeTable output={results} />
              </div>
            )}

            {activeTab === 'traffic' && (
              <ReplayMonitorPanel
                output={results}
                runContext={runContext}
                graphLookup={graphLookup}
              />
            )}

            <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-[10px] text-nss-muted">
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
