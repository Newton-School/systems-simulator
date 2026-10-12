import type { RequestTraitDecisionRecord, TracedNodeState } from '../../../../engine/tracer'
import type { LifecyclePhase, LifecycleTerminal } from './requestLifecycle'

/**
 * Node Intake Lens model (#157): explains the admission decision a node made for
 * one arrival, using the rule the engine actually ran, in the order it runs:
 *
 *   1. security policy - block rate / packet drop (random draw per arrival)
 *   2. beforeArrival traits - rate limiter, bulkhead, load shedding, ...
 *   3. the G/G/c/K queue (GGcKNode.handleArrival):
 *        failed node            -> reject `node_failed` (or hold, for blackhole / hang)
 *        active + queued >= K   -> reject `capacity_exceeded` (`oom` when K is RAM-bound)
 *        active < c             -> start processing
 *        otherwise              -> queue
 *
 * Every number shown is from the trace's admission record (the node's counters at
 * the arrival instant, before this request was counted) or a trait's recorded
 * payload. Nothing is recomputed from config.
 */

export type AdmissionRule =
  | 'capacity'
  | 'oom'
  | 'node_failed'
  | 'held_failed'
  | 'security_blocked'
  | 'security_dropped'
  | 'trait'
  | 'admitted'

export type LensOutcome =
  | 'admitted'
  | 'queued'
  | 'rejected'
  | 'held'
  | 'handled'
  | 'parked'
  | 'dropped'

export interface LensGauge {
  label: string
  value: number
  max: number
  /** Short text such as "2 / 2". */
  text: string
}

export interface LensEquation {
  expression: string
  substituted: string
  holds: boolean
}

export interface LensSlots {
  capacity: number
  active: number
  queued: number
  held: number
  /** Whether the arriving request is drawn in a slot (it got one) or outside (refused). */
  arrivingInside: boolean
  /** Slots represented by one square when K is too large to draw one per slot. */
  slotsPerSquare: number
}

export interface AdmissionExplanation {
  nodeId: string
  available: boolean
  outcome: LensOutcome
  rule: AdmissionRule
  ruleLabel: string
  stage: 'security' | 'trait' | 'node' | null
  state: TracedNodeState | null
  gauges: LensGauge[]
  slots: LensSlots | null
  equation: LensEquation | null
  explanation: string
  /** Extra measured detail from the deciding trait, if any. */
  traitDetail: Array<{ key: string; value: string }>
  /** Admission traits that ran before the decision, with what they decided. */
  checks: Array<{ traitName: string; decision: string; reasonCode?: string }>
  provenance: string | null
  /** Something happened after admission at this node (e.g. failed after processing). */
  afterAdmission: string | null
  /** Recorded values that are not available, said plainly. */
  unavailable: string[]
}

const MAX_SQUARES = 400

function slotsFor(state: TracedNodeState, arrivingInside: boolean): LensSlots {
  const capacity = Math.max(1, state.capacity)
  const slotsPerSquare = capacity > MAX_SQUARES ? Math.ceil(capacity / MAX_SQUARES) : 1
  return {
    capacity,
    active: state.activeWorkers,
    queued: state.queueLength,
    held: state.heldCount,
    arrivingInside,
    slotsPerSquare
  }
}

function gaugesFor(state: TracedNodeState): LensGauge[] {
  const queueRoom = Math.max(0, state.capacity - state.workers)
  return [
    {
      label: 'Workers',
      value: state.activeWorkers,
      max: state.workers,
      text: `${state.activeWorkers} / ${state.workers}`
    },
    {
      label: 'Queue',
      value: state.queueLength,
      max: queueRoom,
      text: `${state.queueLength} / ${queueRoom}`
    },
    {
      label: 'Capacity',
      value: state.totalInSystem,
      max: state.capacity,
      text: `${state.totalInSystem} / ${state.capacity}`
    }
  ]
}

function occupancyTerms(state: TracedNodeState): { expression: string; sum: string } {
  if (state.heldCount > 0) {
    return {
      expression: 'active + queued + held',
      sum: `${state.activeWorkers} + ${state.queueLength} + ${state.heldCount}`
    }
  }
  return { expression: 'active + queued', sum: `${state.activeWorkers} + ${state.queueLength}` }
}

function capacityEquation(state: TracedNodeState): LensEquation {
  const terms = occupancyTerms(state)
  const holds = state.totalInSystem >= state.capacity
  return {
    expression: `${terms.expression} >= K`,
    substituted: `${terms.sum} = ${state.totalInSystem} ${holds ? '>=' : '<'} ${state.capacity}`,
    holds
  }
}

function formatValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  return String(value)
}

/** A trait's own comparison, from the fields it recorded when it decided. */
function traitEquation(decision: RequestTraitDecisionRecord | undefined): LensEquation | null {
  if (!decision) return null
  const d = decision.detail
  if (typeof d.bulkheadInUse === 'number' && typeof d.bulkheadLimit === 'number') {
    const holds = d.bulkheadInUse >= d.bulkheadLimit
    return {
      expression: 'compartment in use >= compartment limit',
      substituted: `${d.bulkheadInUse} ${holds ? '>=' : '<'} ${d.bulkheadLimit}`,
      holds
    }
  }
  if (
    d.loadShedTrigger === 'queue-depth' &&
    typeof d.queueLength === 'number' &&
    typeof d.threshold === 'number'
  ) {
    const holds = d.queueLength >= d.threshold
    return {
      expression: 'queued >= shed threshold',
      substituted: `${d.queueLength} ${holds ? '>=' : '<'} ${d.threshold}`,
      holds
    }
  }
  if (
    d.loadShedTrigger === 'queue-delay' &&
    typeof d.estimatedQueueDelayMs === 'number' &&
    typeof d.threshold === 'number'
  ) {
    const holds = d.estimatedQueueDelayMs > d.threshold
    return {
      expression: "trait's estimated queue delay > max delay",
      substituted: `${d.estimatedQueueDelayMs.toFixed(2)}ms ${holds ? '>' : '<='} ${d.threshold}ms`,
      holds
    }
  }
  return null
}

function traitLabel(traitName: string | undefined): string {
  if (!traitName) return 'an admission trait'
  return traitName
}

/**
 * Explains the admission at one phase. `terminal` is used to say what happened
 * after a successful admission when the request still ended at this node.
 */
export function explainAdmission(
  phase: LifecyclePhase,
  terminal: LifecycleTerminal | null,
  isLastPhase: boolean
): AdmissionExplanation {
  const admission = phase.admission
  const arrivalChecks = phase.traitDecisions
    .filter((decision) => decision.hook === 'beforeArrival')
    .map((decision) => ({
      traitName: decision.traitName,
      decision: decision.decision,
      reasonCode: decision.reasonCode
    }))
  const base = {
    nodeId: phase.nodeId,
    checks: arrivalChecks,
    traitDetail: [] as Array<{ key: string; value: string }>,
    afterAdmission: null as string | null,
    unavailable: [] as string[]
  }

  if (!admission) {
    return {
      ...base,
      available: false,
      outcome: 'admitted',
      rule: 'admitted',
      ruleLabel: phase.kind === 'source' ? 'Traffic source' : 'Not recorded',
      stage: null,
      state: null,
      gauges: [],
      slots: null,
      equation: null,
      explanation:
        phase.kind === 'source'
          ? 'The source generates the request; it has no admission check.'
          : 'No admission record was kept for this visit (traces from older runs, or a path that skips the node queue). Re-run to record it.',
      provenance: null,
      unavailable: ['admission decision']
    }
  }

  const state = admission.state
  const provenance = admission.concurrencyProvenance ?? null
  const gauges = state ? gaugesFor(state) : []
  const unavailable = state ? [] : ['node occupancy at arrival (this node has no queue)']

  // What happened after a successful admission, when the request ended here.
  let afterAdmission: string | null = null
  if (
    isLastPhase &&
    terminal &&
    terminal.locusKind === 'node' &&
    terminal.locus === phase.nodeId &&
    terminal.cause !== 'completed' &&
    (admission.outcome === 'processing' ||
      admission.outcome === 'queued' ||
      admission.outcome === 'handled')
  ) {
    const routingReject = phase.traitDecisions.find(
      (decision) => decision.hook !== 'beforeArrival' && decision.decision === 'rejected'
    )
    const reason = terminal.reasonCode ?? terminal.cause
    afterAdmission = routingReject
      ? `Admitted, then ended after processing: ${routingReject.traitName} rejected it (${reason}).`
      : terminal.cause === 'timeout'
        ? `Admitted, then timed out here (${reason}) before it finished.`
        : `Admitted, then ended after processing (${reason}).`
  }

  if (admission.stage === 'security') {
    const blockRate = admission.policy?.blockRate
    const dropRate = admission.policy?.droppedPackets
    const blocked = admission.outcome === 'rejected'
    return {
      ...base,
      available: true,
      outcome: blocked ? 'rejected' : 'dropped',
      rule: blocked ? 'security_blocked' : 'security_dropped',
      ruleLabel: blocked ? 'Security policy - block rate' : 'Security policy - packet drop',
      stage: 'security',
      state,
      gauges,
      slots: null,
      equation: null,
      explanation: blocked
        ? `The node's security policy refuses a random ${pct(blockRate)} of arrivals, and this request was one of them (security_blocked). It never reached the queue, so its occupancy did not matter.`
        : `The node's security policy silently drops a random ${pct(dropRate)} of arrivals. This one was dropped, so the client waits until its timeout.`,
      traitDetail: [
        ...(blockRate !== undefined ? [{ key: 'blockRate', value: pct(blockRate) }] : []),
        ...(dropRate !== undefined ? [{ key: 'droppedPackets', value: pct(dropRate) }] : [])
      ],
      provenance,
      afterAdmission,
      unavailable
    }
  }

  if (admission.stage === 'trait') {
    const decision = phase.traitDecisions.find(
      (candidate) =>
        candidate.hook === 'beforeArrival' &&
        candidate.traitName === admission.traitName &&
        candidate.atUs === admission.atUs &&
        candidate.decision !== 'continue'
    )
    const traitDetail = decision
      ? Object.entries(decision.detail).map(([key, value]) => ({ key, value: formatValue(value) }))
      : []
    const name = traitLabel(admission.traitName)
    const equation = traitEquation(decision)
    if (admission.outcome === 'rejected') {
      const traitUnavailable =
        equation === null
          ? [`${name}'s internal state at this instant (it records only its decision)`]
          : []
      return {
        ...base,
        available: true,
        outcome: 'rejected',
        rule: 'trait',
        ruleLabel: `${name} (${admission.reasonCode ?? 'rejected'})`,
        stage: 'trait',
        state,
        gauges,
        slots: state ? slotsFor(state, false) : null,
        equation,
        explanation: `${name} refused the request before it reached the queue (${admission.reasonCode ?? 'rejected'}).${
          state && state.totalInSystem < state.capacity
            ? ` The queue itself still had room (${state.totalInSystem} of K ${state.capacity}), so this rejection came from the trait, not from capacity.`
            : ''
        }`,
        traitDetail,
        provenance,
        afterAdmission: null,
        unavailable: [...unavailable, ...traitUnavailable]
      }
    }
    const outcome: LensOutcome = admission.outcome === 'parked' ? 'parked' : 'handled'
    return {
      ...base,
      available: true,
      outcome,
      rule: 'admitted',
      ruleLabel: name,
      stage: 'trait',
      state,
      gauges,
      slots: state ? slotsFor(state, false) : null,
      equation: null,
      explanation:
        outcome === 'parked'
          ? `${name} parked this request behind an identical in-flight request (request collapsing); it takes no worker or queue slot.`
          : `${name} answered the request itself without entering the queue (for example a cache hit).`,
      traitDetail,
      provenance,
      afterAdmission,
      unavailable
    }
  }

  // stage === 'node': the G/G/c/K rule.
  if (admission.outcome === 'rejected' && admission.reasonCode === 'node_failed') {
    return {
      ...base,
      available: true,
      outcome: 'rejected',
      rule: 'node_failed',
      ruleLabel: 'Node failed',
      stage: 'node',
      state,
      gauges: [],
      slots: null,
      equation: null,
      explanation: `The node was FAILED (fault mode ${admission.failureMode ?? 'reject'}) when the request arrived, so it refused every arrival with node_failed regardless of free capacity.`,
      provenance,
      unavailable
    }
  }

  if (admission.outcome === 'held') {
    return {
      ...base,
      available: true,
      outcome: 'held',
      rule: 'held_failed',
      ruleLabel: `Node failed (${admission.failureMode ?? 'blackhole'})`,
      stage: 'node',
      state,
      gauges,
      slots: null,
      equation: null,
      explanation: `The node was FAILED in ${admission.failureMode ?? 'blackhole'} mode: it accepts the connection but never answers, so the request ends by timeout.`,
      provenance,
      afterAdmission,
      unavailable
    }
  }

  if (!state) {
    return {
      ...base,
      available: true,
      outcome: admission.outcome === 'rejected' ? 'rejected' : 'admitted',
      rule: admission.outcome === 'rejected' ? 'capacity' : 'admitted',
      ruleLabel: admission.reasonCode ?? admission.outcome,
      stage: 'node',
      state: null,
      gauges: [],
      slots: null,
      equation: null,
      explanation: 'The decision was recorded but not the occupancy behind it.',
      provenance,
      afterAdmission,
      unavailable
    }
  }

  const equation = capacityEquation(state)
  const terms = occupancyTerms(state)
  if (admission.outcome === 'rejected') {
    const ram = admission.reasonCode === 'oom' || admission.admissionBoundBy === 'ram'
    return {
      ...base,
      available: true,
      outcome: 'rejected',
      rule: ram ? 'oom' : 'capacity',
      ruleLabel: ram
        ? `Memory-bound capacity (K = ${state.capacity})`
        : `Capacity (K = ${state.capacity})`,
      stage: 'node',
      state,
      gauges,
      slots: slotsFor(state, false),
      equation,
      explanation: `${state.activeWorkers} active + ${state.queueLength} queued${
        state.heldCount > 0 ? ` + ${state.heldCount} held` : ''
      } = ${state.totalInSystem}. Capacity is ${state.capacity}${
        ram ? ' (set by RAM: total memory / per-request memory)' : ''
      }, so the arriving request cannot enter the node (${admission.reasonCode ?? 'capacity_exceeded'}).`,
      provenance,
      afterAdmission: null,
      unavailable
    }
  }

  const queued = admission.outcome === 'queued'
  return {
    ...base,
    available: true,
    outcome: queued ? 'queued' : 'admitted',
    rule: 'admitted',
    ruleLabel: queued ? 'Admitted to the queue' : 'Admitted to a worker',
    stage: 'node',
    state,
    gauges,
    slots: slotsFor(state, true),
    equation,
    explanation: queued
      ? `${terms.sum} = ${state.totalInSystem} < K ${state.capacity}, so there was room in the node, but all ${state.workers} workers were busy (${state.activeWorkers} >= c ${state.workers}), so it waited in the queue.`
      : `${terms.sum} = ${state.totalInSystem} < K ${state.capacity} and ${state.activeWorkers} < c ${state.workers} workers busy, so it started processing immediately.`,
    provenance,
    afterAdmission,
    unavailable
  }
}

function pct(rate: number | undefined): string {
  if (rate === undefined) return 'configured share'
  return `${(rate * 100).toFixed(rate < 0.01 ? 2 : 0)}%`
}
