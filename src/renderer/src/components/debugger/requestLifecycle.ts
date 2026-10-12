import type { RequestTerminalCause } from '../../../../engine/core/events'
import type {
  RequestAdmissionRecord,
  RequestTrace,
  RequestTraitDecisionRecord
} from '../../../../engine/tracer'

/**
 * The request lifecycle debugger's data model (#156-#158). Everything here is a
 * re-arrangement of what the engine recorded for one traced request - its
 * microsecond phase record (node arrival / service start / departure, edge in /
 * out, terminal step), the admission decision at each node visit, and the trait
 * decisions. Nothing is estimated: when a value was not recorded the field is
 * null and the views say so.
 *
 * Granularity: a **phase** is one node visit (a Rail card, a Stack frame, a
 * mini-map stop); a **step** is one state transition inside the lifecycle
 * (generated, in flight on an edge, arrived, queued, processing, routing out,
 * and the terminal step). Prev / Step / Jump-to-rejection move over steps.
 */

/** States of the lifecycle state machine, one per engine handler. */
export type LifecycleState =
  | 'generated'
  | 'in-flight'
  | 'arrived'
  | 'queued'
  | 'processing'
  | 'routing'
  | 'held'
  | 'completed'
  | 'rejected'
  | 'timed-out'

export const TERMINAL_STATES: ReadonlySet<LifecycleState> = new Set([
  'completed',
  'rejected',
  'timed-out'
])

export interface LifecycleStep {
  index: number
  state: LifecycleState
  /** ms since the request was generated. */
  atMs: number
  nodeId: string | null
  edgeId: string | null
  /** The phase (node visit) this step belongs to. */
  phaseIndex: number
  label: string
  detail: string | null
  /** This step is the failure (rejection / timeout). */
  failed: boolean
}

export type PhaseResult =
  | 'generated'
  | 'passed'
  | 'completed'
  | 'rejected'
  | 'timeout'
  | 'in-flight'

export interface LifecyclePhase {
  index: number
  kind: 'source' | 'node'
  nodeId: string
  /** Edge the request arrived over (null for the source). */
  edgeInId: string | null
  /** ms since generation; null for the source. */
  arrivalMs: number | null
  /** Network time on the edge into this node. */
  edgeMs: number | null
  /** Time waiting for a worker; null when it never got one or was not recorded. */
  queueMs: number | null
  /** Time being served (to departure or to the end of the request). */
  serviceMs: number | null
  result: PhaseResult
  admission: RequestAdmissionRecord | null
  /** Trait decisions made at this node during this visit. */
  traitDecisions: RequestTraitDecisionRecord[]
  firstStep: number
  lastStep: number
}

export interface LifecycleTerminal {
  atMs: number
  cause: RequestTerminalCause
  locus: string
  locusKind: 'node' | 'edge'
  /** Raw engine reason code (e.g. capacity_exceeded), when recorded. */
  reasonCode: string | null
}

export type LifecycleStatus = 'success' | 'rejected' | 'timeout' | 'in-flight'

export interface RequestLifecycle {
  requestId: string
  status: LifecycleStatus
  traceStatus: RequestTrace['status']
  sourceNodeId: string | null
  phases: LifecyclePhase[]
  steps: LifecycleStep[]
  terminal: LifecycleTerminal | null
  totalMs: number
  /** Node ids in visit order, starting at the source. */
  actualPath: string[]
  /** Edge ids the request entered, in order (including a failed last one). */
  actualEdgeIds: string[]
  /** Endpoints of every edge the request entered, as recorded. */
  edgeEnds: Record<string, { source: string; target: string }>
  /** Index of the failing step, or null for a success / unfinished request. */
  failureStepIndex: number | null
  /** False when the trace has no phase record (older output): only spans survive. */
  exact: boolean
}

function usToMs(us: bigint): number {
  return Number(us) / 1000
}

function terminalState(cause: RequestTerminalCause): LifecycleState {
  if (cause === 'completed') return 'completed'
  if (cause === 'timeout') return 'timed-out'
  return 'rejected'
}

function phaseResultFor(cause: RequestTerminalCause): PhaseResult {
  if (cause === 'completed') return 'completed'
  if (cause === 'timeout') return 'timeout'
  return 'rejected'
}

function admissionDetail(admission: RequestAdmissionRecord | null): string | null {
  if (!admission) return null
  const state = admission.state
  const occupancy = state
    ? `${state.activeWorkers}/${state.workers} workers busy, ${state.queueLength} queued, K ${state.capacity}`
    : null
  switch (admission.outcome) {
    case 'processing':
      return occupancy ? `Got a worker immediately (${occupancy})` : 'Got a worker immediately'
    case 'queued':
      return occupancy ? `All workers busy, queued (${occupancy})` : 'All workers busy, queued'
    case 'rejected':
      return `Refused at admission: ${admission.reasonCode ?? 'rejected'}${
        admission.traitName ? ` by ${admission.traitName}` : ''
      }`
    case 'held':
      return `Held by a failed node (${admission.failureMode ?? 'failed'})`
    case 'parked':
      return 'Parked behind an in-flight leader request'
    case 'handled':
      return `Answered by ${admission.traitName ?? 'a trait'} without queueing`
    case 'dropped':
      return 'Dropped by the security policy'
  }
}

/**
 * Builds the lifecycle for one traced request. Returns null when the trace has
 * neither a phase record nor spans.
 */
export function buildRequestLifecycle(trace: RequestTrace): RequestLifecycle | null {
  const record = trace.phaseRecord
  if (!record || (record.nodes.length === 0 && record.edges.length === 0)) {
    return buildFromSpans(trace)
  }

  const born = record.bornAtUs
  const admissions = trace.admissions ?? []
  const traitDecisions = trace.traitDecisions ?? []
  const terminal: LifecycleTerminal | null = record.terminal
    ? {
        atMs: usToMs(record.terminal.timeUs - born),
        cause: record.terminal.cause,
        locus: record.terminal.locus,
        locusKind: record.terminal.locusKind,
        reasonCode: trace.terminalReason ?? null
      }
    : null

  const sourceNodeId = record.edges[0]?.source ?? null
  const steps: LifecycleStep[] = []
  const phases: LifecyclePhase[] = []
  const usedEdges = new Set<number>()
  const usedAdmissions = new Set<number>()
  const actualEdgeIds: string[] = []

  const pushStep = (step: Omit<LifecycleStep, 'index'>): void => {
    steps.push({ ...step, index: steps.length })
  }

  if (sourceNodeId) {
    phases.push({
      index: 0,
      kind: 'source',
      nodeId: sourceNodeId,
      edgeInId: null,
      arrivalMs: null,
      edgeMs: null,
      queueMs: null,
      serviceMs: null,
      result: 'generated',
      admission: null,
      traitDecisions: [],
      firstStep: 0,
      lastStep: 0
    })
    pushStep({
      state: 'generated',
      atMs: 0,
      nodeId: sourceNodeId,
      edgeId: null,
      phaseIndex: 0,
      label: 'Generated',
      detail: 'Request created by the traffic source',
      failed: false
    })
  }

  record.nodes.forEach((visit, visitIndex) => {
    const phaseIndex = phases.length
    const firstStep = steps.length
    const arrivalMs = usToMs(visit.nodeArrivalUs - born)

    // The edge this visit arrived over: the unused edge into this node whose
    // edge-out time is the arrival, else the first unused edge into it.
    let edgeIndex = record.edges.findIndex(
      (edge, index) =>
        !usedEdges.has(index) &&
        edge.target === visit.nodeId &&
        edge.edgeOutUs === visit.nodeArrivalUs
    )
    if (edgeIndex < 0) {
      edgeIndex = record.edges.findIndex(
        (edge, index) => !usedEdges.has(index) && edge.target === visit.nodeId
      )
    }
    const edge = edgeIndex >= 0 ? record.edges[edgeIndex] : null
    if (edge) {
      usedEdges.add(edgeIndex)
      actualEdgeIds.push(edge.edgeId)
      pushStep({
        state: 'in-flight',
        atMs: usToMs(edge.edgeInUs - born),
        nodeId: null,
        edgeId: edge.edgeId,
        phaseIndex,
        label: 'In flight',
        detail: `On the connection ${edge.source} -> ${edge.target}`,
        failed: false
      })
    }

    const admissionIndex = admissions.findIndex(
      (admission, index) =>
        !usedAdmissions.has(index) &&
        admission.nodeId === visit.nodeId &&
        admission.atUs === visit.nodeArrivalUs
    )
    const admission = admissionIndex >= 0 ? admissions[admissionIndex] : null
    if (admissionIndex >= 0) usedAdmissions.add(admissionIndex)

    pushStep({
      state: 'arrived',
      atMs: arrivalMs,
      nodeId: visit.nodeId,
      edgeId: null,
      phaseIndex,
      label: 'Arrived',
      detail: admissionDetail(admission),
      failed: false
    })

    const serviceStartMs =
      visit.serviceStartUs !== undefined ? usToMs(visit.serviceStartUs - born) : null
    const departureMs = visit.departureUs !== undefined ? usToMs(visit.departureUs - born) : null
    const isLastVisit = visitIndex === record.nodes.length - 1
    const endsHere =
      terminal !== null && terminal.locusKind === 'node' && isLastVisit && departureMs === null
    const endsAfterDeparture =
      terminal !== null &&
      terminal.locusKind === 'node' &&
      isLastVisit &&
      departureMs !== null &&
      terminal.locus === visit.nodeId

    const waited =
      admission?.outcome === 'queued' || (serviceStartMs !== null && serviceStartMs > arrivalMs)
    const neverServedButWaited =
      serviceStartMs === null && endsHere && terminal !== null && terminal.atMs > arrivalMs
    if (admission?.outcome === 'held') {
      pushStep({
        state: 'held',
        atMs: arrivalMs,
        nodeId: visit.nodeId,
        edgeId: null,
        phaseIndex,
        label: 'Held',
        detail: 'The node is failed and holds the request without answering',
        failed: false
      })
    } else if (waited || (neverServedButWaited && admission?.outcome !== 'rejected')) {
      pushStep({
        state: 'queued',
        atMs: arrivalMs,
        nodeId: visit.nodeId,
        edgeId: null,
        phaseIndex,
        label: 'Queued',
        detail: 'Waiting for a free worker',
        failed: false
      })
    }
    if (serviceStartMs !== null) {
      pushStep({
        state: 'processing',
        atMs: serviceStartMs,
        nodeId: visit.nodeId,
        edgeId: null,
        phaseIndex,
        label: 'Processing',
        detail: waited ? `Got a worker after ${fmt(serviceStartMs - arrivalMs)}` : null,
        failed: false
      })
    }

    let result: PhaseResult = departureMs !== null ? 'passed' : 'in-flight'
    if (terminal && (endsHere || endsAfterDeparture)) {
      result = phaseResultFor(terminal.cause)
      const state = terminalState(terminal.cause)
      pushStep({
        state,
        atMs: terminal.atMs,
        nodeId: visit.nodeId,
        edgeId: null,
        phaseIndex,
        label:
          state === 'completed' ? 'Completed' : state === 'timed-out' ? 'Timed out' : 'Rejected',
        detail:
          state === 'completed'
            ? 'The request finished successfully here'
            : (terminal.reasonCode ?? terminal.cause),
        failed: state !== 'completed'
      })
    } else if (departureMs !== null) {
      pushStep({
        state: 'routing',
        atMs: departureMs,
        nodeId: visit.nodeId,
        edgeId: null,
        phaseIndex,
        label: 'Routing',
        detail: 'Finished here; choosing the next hop',
        failed: false
      })
    }

    const visitEndUs = visit.departureUs ?? record.terminal?.timeUs ?? visit.nodeArrivalUs
    phases.push({
      index: phaseIndex,
      kind: 'node',
      nodeId: visit.nodeId,
      edgeInId: edge?.edgeId ?? null,
      arrivalMs,
      edgeMs: edge && edge.edgeOutUs !== undefined ? usToMs(edge.edgeOutUs - edge.edgeInUs) : null,
      queueMs:
        serviceStartMs !== null
          ? Math.max(0, serviceStartMs - arrivalMs)
          : endsHere && terminal
            ? Math.max(0, terminal.atMs - arrivalMs)
            : null,
      serviceMs:
        serviceStartMs !== null
          ? Math.max(0, (departureMs ?? terminal?.atMs ?? serviceStartMs) - serviceStartMs)
          : null,
      result,
      admission,
      traitDecisions: traitDecisions.filter(
        (decision) =>
          decision.nodeId === visit.nodeId &&
          decision.atUs >= visit.nodeArrivalUs &&
          decision.atUs <= visitEndUs
      ),
      firstStep,
      lastStep: steps.length - 1
    })
  })

  // Edges entered but never delivered (the request failed on the wire).
  record.edges.forEach((edge, index) => {
    if (usedEdges.has(index)) return
    const sourcePhase = [...phases].reverse().find((phase) => phase.nodeId === edge.source)
    const phaseIndex = sourcePhase?.index ?? Math.max(0, phases.length - 1)
    actualEdgeIds.push(edge.edgeId)
    pushStep({
      state: 'in-flight',
      atMs: usToMs(edge.edgeInUs - born),
      nodeId: null,
      edgeId: edge.edgeId,
      phaseIndex,
      label: 'In flight',
      detail: `On the connection ${edge.source} -> ${edge.target}`,
      failed: false
    })
  })
  if (terminal && terminal.locusKind === 'edge') {
    const lastStep = steps[steps.length - 1]
    const state = terminalState(terminal.cause)
    pushStep({
      state,
      atMs: terminal.atMs,
      nodeId: null,
      edgeId: terminal.locus,
      phaseIndex: lastStep?.phaseIndex ?? 0,
      label: state === 'timed-out' ? 'Timed out' : 'Rejected',
      detail: `${terminal.reasonCode ?? terminal.cause} on the connection`,
      failed: true
    })
    const phase = phases[lastStep?.phaseIndex ?? 0]
    if (phase) phase.lastStep = steps.length - 1
  }
  if (phases[0]?.kind === 'source') {
    const nextFirst = phases[1]?.firstStep
    phases[0].lastStep = nextFirst !== undefined ? nextFirst - 1 : steps.length - 1
  }

  const status: LifecycleStatus = !terminal
    ? 'in-flight'
    : terminal.cause === 'completed'
      ? 'success'
      : terminal.cause === 'timeout'
        ? 'timeout'
        : 'rejected'
  const failureStep = steps.find((step) => step.failed)
  const lastMs = steps.reduce((max, step) => Math.max(max, step.atMs), 0)

  return {
    requestId: trace.requestId,
    status,
    traceStatus: trace.status,
    sourceNodeId,
    phases,
    steps,
    terminal,
    totalMs: Math.max(lastMs, terminal?.atMs ?? 0),
    actualPath: phases.map((phase) => phase.nodeId),
    actualEdgeIds,
    edgeEnds: Object.fromEntries(
      record.edges.map((edge) => [edge.edgeId, { source: edge.source, target: edge.target }])
    ),
    failureStepIndex: failureStep ? failureStep.index : null,
    exact: true
  }
}

/** Older traces without a phase record: one processing step per completed span. */
function buildFromSpans(trace: RequestTrace): RequestLifecycle | null {
  if (trace.spans.length === 0) return null
  const steps: LifecycleStep[] = []
  const phases: LifecyclePhase[] = trace.spans.map((span, index) => {
    steps.push({
      index: steps.length,
      state: 'processing',
      atMs: span.start + span.queueWait,
      nodeId: span.nodeId,
      edgeId: null,
      phaseIndex: index,
      label: 'Processing',
      detail: null,
      failed: false
    })
    return {
      index,
      kind: 'node',
      nodeId: span.nodeId,
      edgeInId: null,
      arrivalMs: span.start,
      edgeMs: span.edgeLatency,
      queueMs: span.queueWait,
      serviceMs: span.serviceTime,
      result: 'passed',
      admission: null,
      traitDecisions: [],
      firstStep: steps.length - 1,
      lastStep: steps.length - 1
    }
  })
  const status: LifecycleStatus =
    trace.status === 'success' ? 'success' : trace.status === 'timeout' ? 'timeout' : 'rejected'
  return {
    requestId: trace.requestId,
    status,
    traceStatus: trace.status,
    sourceNodeId: null,
    phases,
    steps,
    terminal: null,
    totalMs: trace.totalLatency,
    actualPath: phases.map((phase) => phase.nodeId),
    actualEdgeIds: [],
    edgeEnds: {},
    failureStepIndex: null,
    exact: false
  }
}

function fmt(ms: number): string {
  if (ms < 1) return `${ms.toFixed(3)}ms`
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatDebugMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'not recorded'
  if (ms === 0) return '0ms'
  return fmt(ms)
}

// ─── Expected path ────────────────────────────────────────────────────────────

export interface TopologyEdgeLike {
  id: string
  source: string
  target: string
  mode?: string
  weight?: number
}

export interface ExpectedPath {
  nodeIds: string[]
  edgeIds: string[]
  /**
   * False when any node on the walk has more than one outgoing connection or a
   * non-synchronous one: routing there is weighted / random / conditional, so
   * the actual path can differ even without failures.
   */
  deterministic: boolean
}

/**
 * The route a request "should" take: from the source, follow the single
 * synchronous edge (or the highest-weight edge, ties by id) until a node with
 * no outgoing edges. Cycles stop the walk.
 */
export function buildExpectedPath(
  startNodeId: string | null,
  edges: readonly TopologyEdgeLike[]
): ExpectedPath {
  if (!startNodeId) return { nodeIds: [], edgeIds: [], deterministic: false }
  const nodeIds = [startNodeId]
  const edgeIds: string[] = []
  const visited = new Set<string>([startNodeId])
  let deterministic = true
  let current = startNodeId
  for (;;) {
    const outgoing = edges.filter((edge) => edge.source === current)
    if (outgoing.length === 0) break
    const synchronous = outgoing.filter((edge) => !edge.mode || edge.mode === 'synchronous')
    if (outgoing.length > 1 || synchronous.length !== outgoing.length) deterministic = false
    const pool = synchronous.length > 0 ? synchronous : outgoing
    const chosen = [...pool].sort((left, right) => {
      const delta = (right.weight ?? 1) - (left.weight ?? 1)
      return delta !== 0 ? delta : left.id.localeCompare(right.id)
    })[0]
    if (visited.has(chosen.target)) break
    edgeIds.push(chosen.id)
    nodeIds.push(chosen.target)
    visited.add(chosen.target)
    current = chosen.target
  }
  return { nodeIds, edgeIds, deterministic }
}

export type PathDiffKind = 'match' | 'stopped-early' | 'diverged' | 'went-further'

export interface PathDiff {
  kind: PathDiffKind
  /** First index where the two paths disagree (or where actual stopped). */
  divergenceIndex: number | null
  expectedNodeId: string | null
  actualNodeId: string | null
}

export function diffPaths(expected: readonly string[], actual: readonly string[]): PathDiff {
  const shared = Math.min(expected.length, actual.length)
  for (let i = 0; i < shared; i++) {
    if (expected[i] !== actual[i]) {
      return {
        kind: 'diverged',
        divergenceIndex: i,
        expectedNodeId: expected[i],
        actualNodeId: actual[i]
      }
    }
  }
  if (actual.length < expected.length) {
    return {
      kind: 'stopped-early',
      divergenceIndex: actual.length,
      expectedNodeId: expected[actual.length],
      actualNodeId: actual[actual.length - 1] ?? null
    }
  }
  if (actual.length > expected.length) {
    return {
      kind: 'went-further',
      divergenceIndex: expected.length,
      expectedNodeId: null,
      actualNodeId: actual[expected.length]
    }
  }
  return { kind: 'match', divergenceIndex: null, expectedNodeId: null, actualNodeId: null }
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

export function clampStep(lifecycle: RequestLifecycle, index: number): number {
  return Math.max(0, Math.min(lifecycle.steps.length - 1, index))
}

/** Step to open the debugger at: the failure if there is one, else the start. */
export function initialStepIndex(lifecycle: RequestLifecycle): number {
  return lifecycle.failureStepIndex ?? 0
}

/** The step to jump to when a phase (node visit) is clicked: its arrival or first step. */
export function stepForPhase(lifecycle: RequestLifecycle, phaseIndex: number): number {
  const phase = lifecycle.phases[phaseIndex]
  if (!phase) return 0
  const arrived = lifecycle.steps.find(
    (step) => step.phaseIndex === phaseIndex && step.state === 'arrived'
  )
  return arrived?.index ?? phase.firstStep
}
