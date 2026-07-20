import { cloneRequestPhaseRecord, RequestPhaseRecord, RequestSpan } from './core/events'
import { microToMs } from './core/time'

export interface RequestTraceSpan {
  nodeId: string
  start: number
  end: number
  queueWait: number
  serviceTime: number
  edgeLatency: number
}

export interface RequestTrace {
  requestId: string
  totalLatency: number
  status: 'success' | 'timeout' | 'rejected' | 'connection_reset' | 'error'
  spans: RequestTraceSpan[]
  phaseRecord?: RequestPhaseRecord
}

interface TraceState {
  requestId: string
  spans: RequestSpan[]
  status: RequestTrace['status']
  createdAtUs?: bigint
  phaseRecord?: RequestPhaseRecord
}

export class RequestTracer {
  private readonly sampleRate: number
  private readonly traces = new Map<string, TraceState>()
  private readonly forcedRequestIds = new Set<string>()

  constructor(config: { sampleRate: number }) {
    this.sampleRate = Math.min(1, Math.max(0, config.sampleRate))
  }

  shouldTrace(requestId: string): boolean {
    if (this.forcedRequestIds.has(requestId)) {
      return true
    }

    if (this.traces.has(requestId)) {
      return true
    }

    const hash = this.hash32(requestId)
    const normalized = hash / 0x100000000
    return normalized < this.sampleRate
  }

  forceTrace(requestId: string): void {
    this.forcedRequestIds.add(requestId)
    this.ensureTraceState(requestId)
  }

  unforceTrace(requestId: string): void {
    this.forcedRequestIds.delete(requestId)
  }

  recordSpan(requestId: string, span: RequestSpan): void {
    if (!this.shouldTrace(requestId)) {
      return
    }

    const state = this.ensureTraceState(requestId)
    state.spans.push(span)
  }

  setRequestCreatedAt(requestId: string, createdAt: bigint): void {
    if (!this.shouldTrace(requestId)) {
      return
    }

    const state = this.ensureTraceState(requestId)
    state.createdAtUs = createdAt
  }

  markStatus(requestId: string, status: RequestTrace['status']): void {
    if (!this.shouldTrace(requestId)) {
      return
    }

    const state = this.ensureTraceState(requestId)
    state.status = status
  }

  setPhaseRecord(requestId: string, phaseRecord: RequestPhaseRecord | undefined): void {
    if (!this.shouldTrace(requestId) || !phaseRecord) {
      return
    }

    const state = this.ensureTraceState(requestId)
    state.phaseRecord = cloneRequestPhaseRecord(phaseRecord)
  }

  getTraces(): RequestTrace[] {
    const traces: RequestTrace[] = []

    for (const state of this.traces.values()) {
      if (state.spans.length === 0) {
        continue
      }

      const orderedSpans = [...state.spans].sort((a, b) => {
        if (a.arrivalTime < b.arrivalTime) return -1
        if (a.arrivalTime > b.arrivalTime) return 1
        return 0
      })

      const baseline = state.createdAtUs ?? orderedSpans[0].arrivalTime
      let prevEnd = 0
      const converted: RequestTraceSpan[] = orderedSpans.map((span, index) => {
        const start = microToMs(span.arrivalTime - baseline)
        const end = microToMs(span.departureTime - baseline)
        const queueWait = microToMs(span.queueWait)
        const serviceTime = microToMs(span.serviceTime)
        const edgeLatency = index === 0 ? Math.max(0, start) : Math.max(0, start - prevEnd)
        prevEnd = Math.max(prevEnd, end)

        return {
          nodeId: span.nodeId,
          start,
          end,
          queueWait,
          serviceTime,
          edgeLatency
        }
      })

      const totalLatency = prevEnd

      traces.push({
        requestId: state.requestId,
        totalLatency,
        status: state.status,
        spans: converted,
        phaseRecord: cloneRequestPhaseRecord(state.phaseRecord)
      })
    }

    return traces.sort((a, b) => a.requestId.localeCompare(b.requestId))
  }

  private ensureTraceState(requestId: string): TraceState {
    const existing = this.traces.get(requestId)
    if (existing) {
      return existing
    }

    const created: TraceState = {
      requestId,
      spans: [],
      status: 'success'
    }
    this.traces.set(requestId, created)
    return created
  }

  private hash32(value: string): number {
    let hash = 2166136261
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }
}
