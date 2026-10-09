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

/**
 * A node's live G/G/c/K occupancy, read at the instant a traced request reached
 * the node's admission check (before the request itself was counted). Measured,
 * not estimated: these are the exact counters the admission rule compared.
 */
export interface TracedNodeState {
  status: string
  activeWorkers: number
  queueLength: number
  /** Requests held by a hung failed node; they occupy K slots without a worker. */
  heldCount: number
  /** activeWorkers + queueLength + heldCount: what `inSystem >= K` compares. */
  totalInSystem: number
  /** Effective worker ceiling `c` at that instant (after any autoscale resize). */
  workers: number
  /** Effective admission capacity `K` at that instant. */
  capacity: number
}

/**
 * Where an arrival was decided, in the order the engine checks: the node's
 * security policy, then its beforeArrival traits (rate limiter, bulkhead, load
 * shedding, ...), then the G/G/c/K queue itself.
 */
export type RequestAdmissionStage = 'security' | 'trait' | 'node'

export type RequestAdmissionOutcome =
  /** Got a worker immediately. */
  | 'processing'
  /** Admitted but every worker was busy, so it waited in the queue. */
  | 'queued'
  | 'rejected'
  /** Silently held by a failed node (blackhole / hang); ends by timeout. */
  | 'held'
  /** Parked behind an in-flight leader (request collapsing). */
  | 'parked'
  /** Answered by a trait without entering the queue (e.g. a cache hit). */
  | 'handled'
  /** Dropped by the security policy's packet-drop rate; ends by timeout. */
  | 'dropped'

/** One admission decision for a traced request at one node visit. */
export interface RequestAdmissionRecord {
  nodeId: string
  atUs: bigint
  stage: RequestAdmissionStage
  outcome: RequestAdmissionOutcome
  reasonCode?: string
  /** The trait that decided, when `stage === 'trait'`. */
  traitName?: string
  /** Node occupancy the request saw at the admission check, when the node has a queue. */
  state: TracedNodeState | null
  /** Which constraint bounds K: RAM (instance model, full node = `oom`) or the authored backlog. */
  admissionBoundBy?: 'ram' | 'backlog'
  /** How c and K were derived (e.g. instance count x type). */
  concurrencyProvenance?: string
  /** Failure mode of the node when it was failed at arrival. */
  failureMode?: string
  /** Rule parameters that are fixed config, e.g. a security policy's block rate. */
  policy?: Record<string, number>
}

/** One trait hook evaluation for a traced request (scalar payload fields only). */
export interface RequestTraitDecisionRecord {
  nodeId: string
  atUs: bigint
  traitName: string
  hook: string
  decision: string
  reasonCode?: string
  detail: Record<string, string | number | boolean>
}

export interface RequestTrace {
  requestId: string
  totalLatency: number
  status: 'success' | 'timeout' | 'rejected' | 'connection_reset' | 'error'
  spans: RequestTraceSpan[]
  phaseRecord?: RequestPhaseRecord
  /** Admission decision at each node visit, in order (debugger / intake lens). */
  admissions?: RequestAdmissionRecord[]
  /** Trait hook decisions, in order. */
  traitDecisions?: RequestTraitDecisionRecord[]
  /** Raw engine reason code the request ended with (e.g. `capacity_exceeded`). */
  terminalReason?: string | null
}

interface TraceState {
  requestId: string
  spans: RequestSpan[]
  status: RequestTrace['status']
  createdAtUs?: bigint
  phaseRecord?: RequestPhaseRecord
  admissions: RequestAdmissionRecord[]
  traitDecisions: RequestTraitDecisionRecord[]
  terminalReason?: string | null
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

  recordAdmission(requestId: string, record: RequestAdmissionRecord): void {
    if (!this.shouldTrace(requestId)) {
      return
    }

    this.ensureTraceState(requestId).admissions.push(record)
  }

  recordTraitDecision(requestId: string, record: RequestTraitDecisionRecord): void {
    if (!this.shouldTrace(requestId)) {
      return
    }

    this.ensureTraceState(requestId).traitDecisions.push(record)
  }

  setTerminalReason(requestId: string, reasonCode: string | null | undefined): void {
    if (!this.shouldTrace(requestId)) {
      return
    }

    this.ensureTraceState(requestId).terminalReason = reasonCode ?? null
  }

  getTraces(): RequestTrace[] {
    const traces: RequestTrace[] = []

    for (const state of this.traces.values()) {
      // A request that failed at its first node never completes a span, but its
      // phase record still says where and when it ended; keep it so failed
      // requests are not silently missing from the sample.
      const hasPhaseNodes = (state.phaseRecord?.nodes.length ?? 0) > 0
      if (state.spans.length === 0 && !hasPhaseNodes) {
        continue
      }

      const orderedSpans = [...state.spans].sort((a, b) => {
        if (a.arrivalTime < b.arrivalTime) return -1
        if (a.arrivalTime > b.arrivalTime) return 1
        return 0
      })

      const baseline =
        state.createdAtUs ??
        orderedSpans[0]?.arrivalTime ??
        state.phaseRecord?.bornAtUs ??
        state.phaseRecord?.nodes[0]?.nodeArrivalUs ??
        0n
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

      // End-to-end time runs to the terminal step when one was recorded (a
      // timed-out request ends at its timeout, not at its last completed hop).
      const terminalUs = state.phaseRecord?.terminal?.timeUs
      const totalLatency =
        terminalUs !== undefined ? Math.max(prevEnd, microToMs(terminalUs - baseline)) : prevEnd

      traces.push({
        requestId: state.requestId,
        totalLatency,
        status: state.status,
        spans: converted,
        phaseRecord: cloneRequestPhaseRecord(state.phaseRecord),
        admissions: state.admissions.map((record) => ({
          ...record,
          state: record.state ? { ...record.state } : null
        })),
        traitDecisions: state.traitDecisions.map((record) => ({
          ...record,
          detail: { ...record.detail }
        })),
        terminalReason: state.terminalReason ?? null
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
      status: 'success',
      admissions: [],
      traitDecisions: []
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
