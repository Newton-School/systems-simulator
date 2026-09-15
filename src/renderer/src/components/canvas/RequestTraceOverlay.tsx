import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useViewport } from 'reactflow'
import { Pause, Play, X } from 'lucide-react'
import type { RequestOutcomeRecord } from '../../../../engine/core/event-stream'
import useStore from '@renderer/store/useStore'

/** Per-segment travel time = floor + latency·scale, so slow hops visibly linger. */
const SEG_MIN_MS = 600
const SEG_MAX_MS = 6000
const LATENCY_SCALE = 25
const SLOW_MULTIPLIER = 2.2

interface TraceHop {
  nodeId: string
  state: string
  detail?: string
  reasonCode?: string
  arrivalMs: number
}

interface TracePlan {
  requestId: string
  record: RequestOutcomeRecord | null
  hops: TraceHop[]
  segmentMs: number[]
  totalMs: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function describeHop(hop: TraceHop): string {
  const pretty = hop.detail ?? hop.state.replace(/[-_]/g, ' ')
  return hop.reasonCode ? `${pretty} (${hop.reasonCode})` : pretty
}

function terminalTone(status: string): string {
  if (status === 'success') return 'text-nss-success'
  if (status === 'timeout') return 'text-nss-warning'
  return 'text-nss-danger'
}

function statusColor(status: string): string {
  if (status === 'success') return 'rgb(var(--nss-success))'
  if (status === 'timeout') return 'rgb(var(--nss-warning))'
  return 'rgb(var(--nss-danger))'
}

/** Distinct, stable hue per request so several traced dots stay tellable apart. */
function requestHue(requestId: string): string {
  let hash = 2166136261
  for (let i = 0; i < requestId.length; i++) {
    hash ^= requestId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `hsl(${(((hash >>> 0) * 137.508) % 360).toFixed(0)} 75% 58%)`
}

function buildHops(record: RequestOutcomeRecord): TraceHop[] {
  const collapsed: TraceHop[] = []
  for (const transition of record.stateTimeline) {
    if (!transition.nodeId) continue
    const last = collapsed[collapsed.length - 1]
    if (last && last.nodeId === transition.nodeId) {
      last.state = transition.state
      last.detail = transition.detail ?? last.detail
      last.reasonCode = transition.reasonCode ?? last.reasonCode
    } else {
      collapsed.push({
        nodeId: transition.nodeId,
        state: transition.state,
        detail: transition.detail ?? undefined,
        reasonCode: transition.reasonCode ?? undefined,
        arrivalMs: Number(transition.timestampUs) / 1000
      })
    }
  }
  return collapsed
}

function buildSegmentMs(hops: TraceHop[], slow: boolean): number[] {
  const multiplier = slow ? SLOW_MULTIPLIER : 1
  return hops.slice(0, -1).map((hop, index) => {
    const rawMs = Math.max(0, hops[index + 1].arrivalMs - hop.arrivalMs)
    return clamp(SEG_MIN_MS + rawMs * LATENCY_SCALE, SEG_MIN_MS, SEG_MAX_MS) * multiplier
  })
}

/**
 * Causal request tracer. Follows one request ("Follow on canvas") or a minimal
 * covering set ("Trace all paths") as dots travelling node-to-node across the
 * topology, paced by each hop's real latency, pausable, with only the traced
 * requests shown (ambient dots hidden in PacketEdge). Rendered inside React
 * Flow's edge layer so it sits UNDER the node cards (the dot passes behind a node
 * rather than over its title). Turns aggregate numbers into a living, causal story.
 */
export function RequestTraceOverlay() {
  const tracedRequestIds = useStore((state) => state.tracedRequestIds)
  const setTracedRequestIds = useStore((state) => state.setTracedRequestIds)
  const paused = useStore((state) => state.tracePaused)
  const setPaused = useStore((state) => state.setTracePaused)
  const speed = useStore((state) => state.traceSpeed)
  const setSpeed = useStore((state) => state.setTraceSpeed)
  const output = useStore((state) => state.lastRunOutput)
  const { getNode } = useReactFlow()
  const { x: viewportX, y: viewportY, zoom } = useViewport()

  const [, forceRender] = useState(0)
  const elapsedRef = useRef(0)
  const lastTickRef = useRef(performance.now())

  const traces = useMemo<TracePlan[]>(() => {
    if (!output)
      return tracedRequestIds.map((id) => ({
        requestId: id,
        record: null,
        hops: [],
        segmentMs: [],
        totalMs: 1
      }))
    return tracedRequestIds.map((id) => {
      const record = output.requestOutcomes?.find((row) => row.requestId === id) ?? null
      if (!record) return { requestId: id, record: null, hops: [], segmentMs: [], totalMs: 1 }
      const hops = buildHops(record)
      const segmentMs = buildSegmentMs(hops, speed === 'slow')
      const totalMs = segmentMs.reduce((sum, ms) => sum + ms, 0) || 1
      return { requestId: id, record, hops, segmentMs, totalMs }
    })
  }, [tracedRequestIds, output, speed])

  const active = traces.filter((trace) => trace.record && trace.hops.length > 0)

  useEffect(() => {
    elapsedRef.current = 0
    lastTickRef.current = performance.now()
  }, [tracedRequestIds])

  useEffect(() => {
    if (active.length === 0) return
    const interval = window.setInterval(() => {
      const nowWall = performance.now()
      const delta = nowWall - lastTickRef.current
      lastTickRef.current = nowWall
      if (!paused) elapsedRef.current += delta
      forceRender((tick) => tick + 1)
    }, 33)
    return () => window.clearInterval(interval)
  }, [active.length, paused])

  if (tracedRequestIds.length === 0) return null

  const close = () => setTracedRequestIds([])

  const controls = (
    <>
      <button
        type="button"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? 'Resume' : 'Pause'}
        className="shrink-0 rounded border border-nss-border p-1 text-nss-muted transition-colors hover:border-nss-primary hover:text-nss-primary"
      >
        {paused ? <Play size={12} /> : <Pause size={12} />}
      </button>
      <button
        type="button"
        onClick={() => setSpeed(speed === 'slow' ? 'normal' : 'slow')}
        className="shrink-0 rounded border border-nss-border px-1.5 py-0.5 text-[10px] font-semibold text-nss-muted transition-colors hover:border-nss-primary hover:text-nss-primary"
        title="Playback speed"
      >
        {speed === 'slow' ? 'Slow' : '1×'}
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Stop tracing"
        className="shrink-0 rounded border border-nss-border p-1 text-nss-muted transition-colors hover:border-nss-danger hover:text-nss-danger"
      >
        <X size={12} />
      </button>
    </>
  )

  const panel = (body: React.ReactNode) => (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-nss-border bg-nss-surface/95 px-3 py-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="text-[11px] text-nss-text">{body}</div>
        {controls}
      </div>
    </div>
  )

  if (active.length === 0) {
    return panel(
      <>
        {tracedRequestIds.length === 1 ? 'This request' : 'These requests'} aren&apos;t in the
        sampled trace ledger. Raise the trace sample rate and re-run.
      </>
    )
  }

  const nodeCenter = (nodeId: string): { x: number; y: number } | null => {
    const node = getNode(nodeId)
    if (!node) return null
    const pos = node.positionAbsolute ?? node.position
    return { x: pos.x + (node.width ?? 256) / 2, y: pos.y + (node.height ?? 100) / 2 }
  }

  const showLabels = active.length <= 4
  // Screen-constant sizes despite the group's zoom scaling.
  const dotR = 7 / zoom
  const pathW = 3 / zoom

  // Per-trace geometry in FLOW coordinates: the node-path polyline (straight
  // segments through node centers) and the dot's current position along it.
  const rendered = active
    .map((trace) => {
      const centers = trace.hops
        .map((hop) => nodeCenter(hop.nodeId))
        .filter((point): point is { x: number; y: number } => point !== null)
      if (centers.length === 0) return null

      let segmentIndex = 0
      let frac = 1
      if (trace.segmentMs.length > 0) {
        const position = elapsedRef.current % trace.totalMs
        let acc = 0
        let placed = false
        for (let i = 0; i < trace.segmentMs.length; i++) {
          if (position < acc + trace.segmentMs[i]) {
            segmentIndex = i
            frac = (position - acc) / trace.segmentMs[i]
            placed = true
            break
          }
          acc += trace.segmentMs[i]
        }
        if (!placed) {
          segmentIndex = trace.segmentMs.length - 1
          frac = 1
        }
      }

      const a = centers[Math.min(centers.length - 1, segmentIndex)]
      const b = centers[Math.min(centers.length - 1, segmentIndex + 1)]
      const dot = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }
      const record = trace.record as RequestOutcomeRecord
      const atEnd = segmentIndex >= trace.segmentMs.length - 1 && frac > 0.9
      const color = atEnd ? statusColor(record.status) : requestHue(trace.requestId)
      const fromHop = trace.hops[Math.min(trace.hops.length - 1, segmentIndex)]
      const toHop = trace.hops[Math.min(trace.hops.length - 1, segmentIndex + 1)]
      const cause = atEnd
        ? `${record.status}${record.reasonCode ? ` · ${record.reasonCode}` : ''}`
        : describeHop(frac < 0.5 ? fromHop : toHop)
      const points = centers.map((point) => `${point.x},${point.y}`).join(' ')
      return { requestId: trace.requestId, points, dot, color, cause }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  // Trace shapes in FLOW coordinates: straight node-path polyline + moving dot.
  const traceContent = rendered.map((entry) => (
    <g key={entry.requestId}>
      <polyline
        points={entry.points}
        fill="none"
        stroke={entry.color}
        strokeWidth={pathW}
        strokeOpacity={0.7}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={entry.dot.x}
        cy={entry.dot.y}
        r={dotR}
        fill={entry.color}
        stroke="var(--nss-panel)"
        strokeWidth={1.5 / zoom}
      />
    </g>
  ))

  // Render inside React Flow's edge layer so the trace sits UNDER the node cards
  // (that layer is already viewport-transformed, so shapes use flow coords). Fall
  // back to a top overlay (own transform) if the layer isn't found.
  const edgeLayer =
    typeof document !== 'undefined' ? document.querySelector('.react-flow__edges') : null

  return (
    <>
      {edgeLayer ? (
        createPortal(<g className="pointer-events-none">{traceContent}</g>, edgeLayer)
      ) : (
        <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
          <g transform={`translate(${viewportX} ${viewportY}) scale(${zoom})`}>{traceContent}</g>
        </svg>
      )}

      {/* Current state label per dot, rendered ON TOP (above nodes) so the causal
          step — forwarded / processing / cached / completed / rejected — is always
          readable even when the dot is behind a node card. */}
      {showLabels
        ? rendered.map((entry) => (
            <div
              key={`${entry.requestId}-label`}
              className="pointer-events-none absolute z-30"
              style={{
                left: entry.dot.x * zoom + viewportX,
                top: entry.dot.y * zoom + viewportY,
                transform: 'translate(-50%, -150%)'
              }}
            >
              <span
                className="whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold shadow"
                style={{
                  borderColor: 'var(--nss-border)',
                  color: 'var(--nss-text)',
                  backgroundColor: 'var(--nss-panel)'
                }}
              >
                {entry.cause}
              </span>
            </div>
          ))
        : null}

      {panel(
        active.length === 1 ? (
          <>
            Following <span className="font-mono">{active[0].record?.operationLabel}</span> —{' '}
            <span className={terminalTone((active[0].record as RequestOutcomeRecord).status)}>
              {(active[0].record as RequestOutcomeRecord).status}
            </span>{' '}
            · {active[0].hops.length} hops
          </>
        ) : (
          <>
            Tracing <span className="font-semibold">{active.length}</span> requests across the
            topology — each dot is one request&apos;s real path.
          </>
        )
      )}
    </>
  )
}
