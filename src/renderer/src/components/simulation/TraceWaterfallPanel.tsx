import { useEffect, useMemo, useState } from 'react'
import { Bug, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import {
  indexTraces,
  terminalCauseLabel,
  waterfallAxisTicks,
  type TraceFilter,
  type TraceWaterfall,
  type WaterfallHop
} from './traceWaterfall'
import { useFocusNodeOnCanvas } from './useFocusNodeOnCanvas'
import useStore from '../../store/useStore'
import { RequestDebugger } from '../debugger/RequestDebugger'
import { buildRequestLifecycle, initialStepIndex } from '../debugger/requestLifecycle'

const SECTION_TITLE = 'text-[11px] font-semibold text-nss-muted uppercase tracking-wider'
const SURFACE_CARD = 'bg-nss-surface border border-nss-border rounded-md'

function fmtMs(ms: number): string {
  if (ms === 0) return '0ms'
  if (ms < 1) return `${ms.toFixed(3)}ms`
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function statusBadgeClass(status: TraceWaterfall['status']): string {
  if (status === 'success') return 'text-nss-success bg-nss-success/10 border-nss-success/20'
  if (status === 'timeout') return 'text-nss-warning bg-nss-warning/10 border-nss-warning/20'
  return 'text-nss-danger bg-nss-danger/10 border-nss-danger/20'
}

function controlButtonClass(active = false): string {
  return `inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    active
      ? 'border-nss-primary bg-nss-primary/10 text-nss-primary'
      : 'border-nss-border bg-nss-surface text-nss-muted hover:bg-nss-bg hover:text-nss-text'
  }`
}

function hopDetail(hop: WaterfallHop): string {
  const parts = [`network +${fmtMs(hop.edgeBeforeMs)}`]
  switch (hop.outcome) {
    case 'rejected-before-processing':
      parts.push('rejected before processing')
      break
    case 'ended-in-queue':
      parts.push(`waited ${fmtMs(hop.queueMs)} for a worker, never served`)
      break
    case 'ended-after-processing':
      parts.push(`queue ${fmtMs(hop.queueMs)}`, `service ${fmtMs(hop.serviceMs)}, then ended here`)
      break
    case 'ended-in-service':
      parts.push(`queue ${fmtMs(hop.queueMs)}`, `in service ${fmtMs(hop.serviceMs)} when it ended`)
      break
    default:
      parts.push(`queue ${fmtMs(hop.queueMs)}`, `service ${fmtMs(hop.serviceMs)}`)
  }
  return parts.join(' - ')
}

function WaterfallRow({
  hop,
  totalMs,
  label,
  onFocus
}: {
  hop: WaterfallHop
  totalMs: number
  label: string
  onFocus: () => void
}) {
  const pct = (ms: number) => (totalMs > 0 ? Math.max(0, Math.min(100, (ms / totalMs) * 100)) : 0)
  const widthPct = (ms: number) => (ms > 0 ? Math.max(0.6, pct(ms)) : 0)
  const failedHere = hop.outcome !== 'departed'
  const queueLeft = pct(hop.startMs)
  const queueWidth = widthPct(hop.queueMs)
  const serviceLeft = pct(hop.startMs + hop.queueMs)
  const serviceWidth = widthPct(hop.serviceMs)

  return (
    <div className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 py-1">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onFocus}
          className="block max-w-full truncate text-left text-xs font-medium text-nss-text hover:text-nss-primary hover:underline"
          title="Select on canvas"
        >
          {label}
        </button>
        <div className="truncate text-[10px] text-nss-muted" title={hopDetail(hop)}>
          {hopDetail(hop)}
        </div>
      </div>
      <div className="relative h-5 rounded bg-nss-panel">
        {queueWidth > 0 && (
          <div
            className={`absolute inset-y-1 rounded-l ${failedHere && hop.serviceMs === 0 ? 'bg-nss-danger/30' : 'bg-nss-primary/25'}`}
            style={{ left: `${queueLeft}%`, width: `${queueWidth}%` }}
            title={`queue wait ${fmtMs(hop.queueMs)}`}
          />
        )}
        {serviceWidth > 0 && (
          <div
            className={`absolute inset-y-1 rounded-r ${failedHere ? 'bg-nss-danger/70' : 'bg-nss-primary'}`}
            style={{ left: `${serviceLeft}%`, width: `${serviceWidth}%` }}
            title={`service ${fmtMs(hop.serviceMs)}`}
          />
        )}
        {hop.outcome === 'rejected-before-processing' && (
          <div
            className="absolute inset-y-0.5 w-1 rounded bg-nss-danger"
            style={{ left: `calc(${pct(hop.startMs)}% - 2px)` }}
            title="Rejected before processing"
          />
        )}
      </div>
    </div>
  )
}

export function TraceWaterfallPanel({
  output,
  traceSampleRate,
  topologyEdited = false
}: {
  output: SimulationOutput
  traceSampleRate: number | null
  topologyEdited?: boolean
}) {
  const focusNode = useFocusNodeOnCanvas()
  const debugSession = useStore((state) => state.requestDebug)
  const setRequestDebug = useStore((state) => state.setRequestDebug)
  const setTracedRequestIds = useStore((state) => state.setTracedRequestIds)
  // The debugger (and its canvas overlay) lives only while this tab is shown.
  useEffect(() => () => setRequestDebug(null), [setRequestDebug])
  const openDebugger = (requestId: string) => {
    const trace = output.traces.find((candidate) => candidate.requestId === requestId)
    const lifecycle = trace ? buildRequestLifecycle(trace) : null
    setTracedRequestIds([])
    setRequestDebug({ requestId, stepIndex: lifecycle ? initialStepIndex(lifecycle) : 0 })
  }
  const index = useMemo(() => indexTraces(output.traces), [output.traces])
  const [filter, setFilter] = useState<TraceFilter>('all')
  const [position, setPosition] = useState(0)
  const order = filter === 'failed' ? index.failed : index.all
  const clampedPosition = Math.min(position, Math.max(0, order.length - 1))
  const waterfall = order.length > 0 ? index.waterfalls[order[clampedPosition]] : null
  const labelFor = (id: string) =>
    output.perNode[id]?.nodeLabel ?? output.perEdge[id]?.edgeLabel ?? id

  const sampleNote =
    traceSampleRate !== null
      ? `Sampled at ${(traceSampleRate * 100).toFixed(traceSampleRate < 0.01 ? 2 : 0)}% of requests.`
      : 'A sample of requests.'

  if (index.waterfalls.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className={SECTION_TITLE}>Request Traces</h3>
        <div className="rounded border border-dashed border-nss-border bg-nss-panel px-3 py-4 text-xs text-nss-muted">
          No requests were traced in this run. {sampleNote} Short or low-traffic runs may not hit
          the sample.
        </div>
      </div>
    )
  }

  if (debugSession) {
    return <RequestDebugger output={output} topologyEdited={topologyEdited} />
  }

  const selectFilter = (next: TraceFilter) => {
    setFilter(next)
    setPosition(0)
  }
  const ticks = waterfall ? waterfallAxisTicks(waterfall.totalMs) : []
  const axisMax = waterfall ? Math.max(waterfall.totalMs, ticks[ticks.length - 1] ?? 0) : 0
  const terminal = waterfall?.terminal ?? null
  const showTerminal = terminal !== null && terminal.cause !== 'completed'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={`${SECTION_TITLE} mr-2`}>Request Traces</h3>
        <button
          type="button"
          className={controlButtonClass(filter === 'all')}
          onClick={() => selectFilter('all')}
          aria-pressed={filter === 'all'}
        >
          All ({index.all.length})
        </button>
        <button
          type="button"
          className={controlButtonClass(filter === 'failed')}
          onClick={() => selectFilter('failed')}
          aria-pressed={filter === 'failed'}
          disabled={index.failed.length === 0}
        >
          Failed ({index.failed.length})
        </button>
        <span className="mx-1 h-4 w-px bg-nss-border" />
        <button
          type="button"
          className={controlButtonClass()}
          onClick={() => selectFilter('all')}
          title="Jump to the trace with the highest end-to-end time"
          disabled={filter === 'all' && clampedPosition === 0}
        >
          Slowest
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={controlButtonClass()}
            onClick={() => setPosition(clampedPosition - 1)}
            disabled={clampedPosition === 0}
            aria-label="Previous trace"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <span className="px-1 text-[11px] tabular-nums text-nss-muted">
            {order.length > 0 ? clampedPosition + 1 : 0} / {order.length}
          </span>
          <button
            type="button"
            className={controlButtonClass()}
            onClick={() => setPosition(clampedPosition + 1)}
            disabled={clampedPosition >= order.length - 1}
            aria-label="Next trace"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {waterfall && (
        <div className={`${SURFACE_CARD} p-3 space-y-2`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-nss-text">{waterfall.requestId}</span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(waterfall.status)}`}
            >
              {waterfall.status.replace(/_/g, ' ')}
            </span>
            <span className="tabular-nums text-nss-muted">
              end-to-end {fmtMs(waterfall.totalMs)}
            </span>
            <span className="text-nss-muted">
              {waterfall.hops.length} hop{waterfall.hops.length === 1 ? '' : 's'}
            </span>
            {showTerminal && terminal && (
              <span className="text-nss-danger">
                {terminalCauseLabel(terminal.cause)} at {labelFor(terminal.locus)} (
                {fmtMs(terminal.atMs)})
              </span>
            )}
            <button
              type="button"
              className={`${controlButtonClass()} ml-auto`}
              onClick={() => openDebugger(waterfall.requestId)}
              title="Step through this request's recorded lifecycle and highlight it on the canvas"
            >
              <Bug className="h-3.5 w-3.5" /> Debug request
            </button>
          </div>

          <div className="grid grid-cols-[minmax(6rem,10rem)_1fr] gap-3">
            <div />
            <div className="relative h-4 text-[9px] tabular-nums text-nss-muted">
              {ticks.map((tick, i) => (
                <span
                  key={tick}
                  className="absolute top-0"
                  style={{
                    left: `${axisMax > 0 ? (tick / axisMax) * 100 : 0}%`,
                    transform:
                      i === 0
                        ? 'none'
                        : i === ticks.length - 1 && tick >= axisMax
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)'
                  }}
                >
                  {fmtMs(tick)}
                </span>
              ))}
            </div>
          </div>

          <div className="divide-y divide-nss-border/50">
            {waterfall.hops.map((hop, i) => (
              <WaterfallRow
                key={`${hop.nodeId}-${i}`}
                hop={hop}
                totalMs={axisMax}
                label={labelFor(hop.nodeId)}
                onFocus={() => focusNode(hop.nodeId)}
              />
            ))}
            {showTerminal && terminal && terminal.locusKind === 'edge' && (
              <div className="py-1.5 text-[11px] text-nss-danger">
                {terminalCauseLabel(terminal.cause)} on connection {labelFor(terminal.locus)} at{' '}
                {fmtMs(terminal.atMs)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[10px] text-nss-muted">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded-sm bg-nss-primary/25" /> queue wait
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded-sm bg-nss-primary" /> processing
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded-sm bg-nss-danger/70" /> where it ended
            </span>
            <span>gaps between bars = network time</span>
            {!waterfall.exact && <span>(span data only - the failing step was not retained)</span>}
          </div>
        </div>
      )}

      <p className="text-[10px] text-nss-muted">
        {sampleNote} Traces are listed slowest first; Next walks towards faster requests.
      </p>
    </div>
  )
}
