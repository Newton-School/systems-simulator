import type { RequestTrace } from '../../../../engine/tracer'
import type { RequestTerminalCause } from '../../../../engine/core/events'

/**
 * Data shaping for the results tray's Traces tab (a horizontal waterfall per
 * sampled request). All times are ms relative to the request's creation.
 *
 * The phase record is preferred because it is exact and also carries the
 * terminal step (who ended the request, when, and why). The tracer's span list
 * only holds hops that finished processing, so for a failed request it stops
 * at the last successful hop; it is used only as a fallback.
 */

export interface WaterfallHop {
  nodeId: string
  /** Arrival at the node. */
  startMs: number
  /** Time waiting for a worker. */
  queueMs: number
  /** Time being processed (or, for the hop that ended the request, until it ended). */
  serviceMs: number
  endMs: number
  /** Network time between the previous hop's departure and this arrival. */
  edgeBeforeMs: number
  /**
   * How this hop ended: `departed` normally, `rejected-before-processing` when
   * the request never got a worker here, `ended-in-service` when it failed or
   * timed out while being processed here, `ended-in-queue` while queued here,
   * `ended-after-processing` when this node finished its work and then ended
   * the request (e.g. a circuit breaker or error rate on the way out).
   */
  outcome:
    | 'departed'
    | 'rejected-before-processing'
    | 'ended-in-service'
    | 'ended-in-queue'
    | 'ended-after-processing'
}

export interface WaterfallTerminal {
  atMs: number
  cause: RequestTerminalCause
  locus: string
  locusKind: 'node' | 'edge'
}

export interface TraceWaterfall {
  requestId: string
  status: RequestTrace['status']
  totalMs: number
  hops: WaterfallHop[]
  terminal: WaterfallTerminal | null
  /** True when built from the exact phase record (false = span fallback). */
  exact: boolean
}

function usToMs(us: bigint): number {
  return Number(us) / 1000
}

export function buildTraceWaterfall(trace: RequestTrace): TraceWaterfall {
  const record = trace.phaseRecord
  if (record && record.nodes.length > 0) {
    const born = record.bornAtUs
    const terminal: WaterfallTerminal | null = record.terminal
      ? {
          atMs: usToMs(record.terminal.timeUs - born),
          cause: record.terminal.cause,
          locus: record.terminal.locus,
          locusKind: record.terminal.locusKind
        }
      : null
    let prevEnd = 0
    const hops: WaterfallHop[] = record.nodes.map((phase) => {
      const startMs = usToMs(phase.nodeArrivalUs - born)
      const edgeBeforeMs = Math.max(0, startMs - prevEnd)
      let queueMs: number
      let serviceMs: number
      let endMs: number
      let outcome: WaterfallHop['outcome']
      if (phase.departureUs !== undefined) {
        endMs = usToMs(phase.departureUs - born)
        const serviceStartMs =
          phase.serviceStartUs !== undefined ? usToMs(phase.serviceStartUs - born) : startMs
        queueMs = Math.max(0, serviceStartMs - startMs)
        serviceMs = Math.max(0, endMs - serviceStartMs)
        outcome = 'departed'
      } else {
        endMs = Math.max(startMs, terminal?.atMs ?? startMs)
        if (phase.serviceStartUs !== undefined) {
          const serviceStartMs = usToMs(phase.serviceStartUs - born)
          queueMs = Math.max(0, serviceStartMs - startMs)
          serviceMs = Math.max(0, endMs - serviceStartMs)
          outcome = 'ended-in-service'
        } else if (endMs > startMs) {
          queueMs = endMs - startMs
          serviceMs = 0
          outcome = 'ended-in-queue'
        } else {
          queueMs = 0
          serviceMs = 0
          outcome = 'rejected-before-processing'
        }
      }
      prevEnd = Math.max(prevEnd, endMs)
      return { nodeId: phase.nodeId, startMs, queueMs, serviceMs, endMs, edgeBeforeMs, outcome }
    })
    if (terminal && terminal.cause !== 'completed' && terminal.locusKind === 'node') {
      for (let i = hops.length - 1; i >= 0; i--) {
        if (hops[i].nodeId !== terminal.locus) continue
        if (hops[i].outcome === 'departed') {
          hops[i] = { ...hops[i], outcome: 'ended-after-processing' }
        }
        break
      }
    }
    const lastEnd = hops.reduce((max, hop) => Math.max(max, hop.endMs), 0)
    return {
      requestId: trace.requestId,
      status: trace.status,
      totalMs: Math.max(lastEnd, terminal?.atMs ?? 0),
      hops,
      terminal,
      exact: true
    }
  }

  const hops: WaterfallHop[] = trace.spans.map((span) => ({
    nodeId: span.nodeId,
    startMs: span.start,
    queueMs: span.queueWait,
    serviceMs: span.serviceTime,
    endMs: span.end,
    edgeBeforeMs: span.edgeLatency,
    outcome: 'departed'
  }))
  return {
    requestId: trace.requestId,
    status: trace.status,
    totalMs: Math.max(trace.totalLatency, ...hops.map((hop) => hop.endMs), 0),
    hops,
    terminal: null,
    exact: false
  }
}

/** A "nice" axis step (1, 2 or 5 x 10^k) that splits `totalMs` into ~`targetTicks` parts. */
export function waterfallAxisTicks(totalMs: number, targetTicks = 4): number[] {
  if (!(totalMs > 0)) {
    return [0]
  }
  const raw = totalMs / targetTicks
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const ticks: number[] = []
  for (let tick = 0; tick <= totalMs + step * 1e-9; tick += step) {
    ticks.push(Number(tick.toPrecision(12)))
  }
  return ticks
}

export type TraceFilter = 'all' | 'failed'

export interface TraceIndex {
  waterfalls: TraceWaterfall[]
  /** Indices into `waterfalls`, in the order the picker steps through them. */
  all: number[]
  failed: number[]
  slowestIndex: number | null
}

/**
 * Builds every waterfall once and the orderings the picker needs. Traces are
 * listed slowest first so "next" walks towards faster requests.
 */
export function indexTraces(traces: readonly RequestTrace[]): TraceIndex {
  const waterfalls = traces.map(buildTraceWaterfall)
  const all = waterfalls
    .map((_, index) => index)
    .sort((a, b) => {
      const delta = waterfalls[b].totalMs - waterfalls[a].totalMs
      return delta !== 0 ? delta : waterfalls[a].requestId.localeCompare(waterfalls[b].requestId)
    })
  const failed = all.filter((index) => waterfalls[index].status !== 'success')
  return { waterfalls, all, failed, slowestIndex: all.length > 0 ? all[0] : null }
}

export function terminalCauseLabel(cause: RequestTerminalCause): string {
  switch (cause) {
    case 'completed':
      return 'Completed'
    case 'queue_full':
      return 'Rejected - queue full'
    case 'oom':
      return 'Rejected - out of memory'
    case 'node_failed':
      return 'Failed - node down'
    case 'network_error':
      return 'Failed - network error'
    case 'timeout':
      return 'Timed out'
    case 'connection_reset':
      return 'Connection reset'
    case 'rejected':
      return 'Rejected'
  }
}
