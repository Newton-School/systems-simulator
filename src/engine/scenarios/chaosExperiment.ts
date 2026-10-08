/**
 * Chaos experiment runner (#65).
 *
 *   warm up -> verify the steady state holds -> run the steps (inject faults,
 *   change traffic, wait, verify) -> verify the steady state holds again
 *
 * Three pure stages, so the app worker, the CLI and tests share one path:
 *   1. `compileExperiment(topology, definition)` turns the steps into absolute
 *      times, writes them into a copy of the topology as scheduled `faults[]`
 *      and a workload `spike`, and lists every check with its time window.
 *   2. The engine runs that topology once, unchanged.
 *   3. `evaluateExperiment(plan, output)` measures each check from the run's
 *      1-second `latencyWindows` and reports pass / fail with the values.
 * `runChaosExperiment` does all three headlessly.
 *
 * Measurement rules (kept deliberately simple and stated in the result):
 * - Metrics come from 1-second windows keyed on when requests *finished*, so
 *   every time in a definition must be a whole number of seconds.
 * - error_rate = failed / (failed + succeeded) over the window.
 * - throughput = successful completions per second over the window length.
 * - latency_pNN = the worst 1-second pNN inside the window (window percentiles
 *   cannot be merged exactly, and the worst second is the honest SLO reading).
 * - If the steady state fails during the baseline, the experiment stops there:
 *   "not stable before injection", later checks are skipped.
 *
 * Fault conflicts (also used by the composer, #67): faults are intervals per
 * node. When two overlap on the same node, the one that starts later wins - the
 * earlier one is cut off at that moment; on a tie the later step wins. The
 * engine models one traffic spike per run, so with several the latest-starting
 * spike wins and the others are dropped. Both cases are reported in `notes`.
 */

import type { FaultSpec, TopologyJSON, WorkloadProfile } from '../core/types'
import type { LatencyWindowPoint } from '../metrics'
import type { SimulationOutput } from '../analysis/output'
import { runSimulation } from '../runSimulation'
import { CACHE_FLUSH_FAULT_TYPE } from '../traits/cache'
import type {
  AssertionResult,
  ChaosExperimentDefinition,
  CheckResult,
  ExperimentAssertion,
  ExperimentFault,
  ExperimentPlan,
  ExperimentResult,
  ExperimentStep,
  ExperimentTimelineEntry,
  ExperimentViolation,
  PlannedCheck,
  PlannedTimelineEntry
} from './types'

const WINDOW_MS = 1_000

// ─── Labels ──────────────────────────────────────────────────────────────────

const METRIC_LABEL: Record<ExperimentAssertion['metric'], string> = {
  error_rate: 'Error rate',
  latency_p50: 'p50 latency',
  latency_p95: 'p95 latency',
  latency_p99: 'p99 latency',
  throughput: 'Throughput'
}

export function formatMetricValue(metric: ExperimentAssertion['metric'], value: number): string {
  if (metric === 'error_rate') {
    const pct = value * 100
    return `${pct < 10 && pct !== 0 ? pct.toFixed(2) : pct.toFixed(1)}%`
  }
  if (metric === 'throughput') {
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} req/s`
  }
  return value < 10 ? `${value.toFixed(2)} ms` : `${Math.round(value)} ms`
}

export function describeAssertion(
  assertion: ExperimentAssertion,
  nodeLabel?: (nodeId: string) => string
): string {
  if (assertion.label) return assertion.label
  const scope = assertion.nodeId ? ` at ${nodeLabel?.(assertion.nodeId) ?? assertion.nodeId}` : ''
  const base = `${METRIC_LABEL[assertion.metric]}${scope}`
  if (!assertion.operator || assertion.value === undefined) return base
  return `${base} ${assertion.operator} ${formatMetricValue(assertion.metric, assertion.value)}`
}

function faultLabel(fault: ExperimentFault): string {
  if (fault.kind === 'cache-flush') return `Flush cache ${fault.targetId}`
  return `Fail ${fault.targetId} (${fault.mode ?? 'blackhole'})`
}

function stepLabel(step: ExperimentStep): string {
  if (step.label) return step.label
  switch (step.type) {
    case 'wait':
      return `Wait ${step.durationMs / 1000}s`
    case 'inject':
      return faultLabel(step.fault)
    case 'restore':
      return `Restore ${step.targetId}`
    case 'traffic':
      return `Traffic x${step.multiplier} for ${step.durationMs / 1000}s`
    case 'verify':
      return 'Verify'
  }
}

// ─── Compilation ─────────────────────────────────────────────────────────────

export class ExperimentCompileError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(issues.join(' '))
    this.name = 'ExperimentCompileError'
    this.issues = issues
  }
}

/** A fault interval on one node, in absolute experiment time. */
export interface ScheduledFault {
  fault: ExperimentFault
  startMs: number
  /** null = never recovers within the run. */
  endMs: number | null
  stepIndex: number
  /** Who scheduled it, for conflict notes (the composer names the scenario). */
  source?: string
}

export interface ScheduledSpike {
  multiplier: number
  startMs: number
  durationMs: number
  stepIndex: number
  source?: string
}

/**
 * Walk the steps once, assigning absolute times. Shared by the compiler and the
 * composer so both read a definition identically.
 */
export function scheduleSteps(
  definition: ChaosExperimentDefinition,
  stepsStartMs: number
): {
  endMs: number
  faults: ScheduledFault[]
  spikes: ScheduledSpike[]
  checks: PlannedCheck[]
  timeline: PlannedTimelineEntry[]
  issues: string[]
} {
  const issues: string[] = []
  const faults: ScheduledFault[] = []
  const spikes: ScheduledSpike[] = []
  const checks: PlannedCheck[] = []
  const timeline: PlannedTimelineEntry[] = []
  const openByTarget = new Map<string, ScheduledFault>()
  let cursor = stepsStartMs
  let lastCheckpoint = stepsStartMs

  definition.steps.forEach((step, index) => {
    const at = cursor
    const n = index + 1
    switch (step.type) {
      case 'wait': {
        if (!isWholeSeconds(step.durationMs) || step.durationMs <= 0) {
          issues.push(`Step ${n}: a wait must be a positive whole number of seconds.`)
          return
        }
        cursor += step.durationMs
        timeline.push({ stepIndex: index, type: 'wait', atMs: at, label: stepLabel(step) })
        return
      }
      case 'inject': {
        const durationMs = step.fault.durationMs
        if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs < 0)) {
          issues.push(`Step ${n}: fault duration must be zero or more milliseconds.`)
          return
        }
        if (step.fault.kind === 'cache-flush') {
          // A flush is a moment, not an outage: it never needs a restore.
          faults.push({ fault: step.fault, startMs: at, endMs: null, stepIndex: index })
        } else {
          const scheduled: ScheduledFault = {
            fault: step.fault,
            startMs: at,
            endMs: durationMs && durationMs > 0 ? at + durationMs : null,
            stepIndex: index
          }
          faults.push(scheduled)
          if (scheduled.endMs === null) openByTarget.set(step.fault.targetId, scheduled)
          else openByTarget.delete(step.fault.targetId)
        }
        lastCheckpoint = at
        timeline.push({
          stepIndex: index,
          type: 'inject',
          atMs: at,
          label: stepLabel(step),
          detail: durationMs ? `recovers after ${durationMs / 1000}s` : undefined
        })
        return
      }
      case 'restore': {
        const open = openByTarget.get(step.targetId)
        if (!open) {
          issues.push(`Step ${n}: nothing is failing on ${step.targetId} to restore.`)
          return
        }
        open.endMs = at
        openByTarget.delete(step.targetId)
        lastCheckpoint = at
        timeline.push({ stepIndex: index, type: 'restore', atMs: at, label: stepLabel(step) })
        return
      }
      case 'traffic': {
        if (!(step.multiplier > 0) || !(step.durationMs > 0)) {
          issues.push(`Step ${n}: a traffic change needs a positive multiplier and duration.`)
          return
        }
        spikes.push({
          multiplier: step.multiplier,
          startMs: at,
          durationMs: step.durationMs,
          stepIndex: index
        })
        lastCheckpoint = at
        timeline.push({ stepIndex: index, type: 'traffic', atMs: at, label: stepLabel(step) })
        return
      }
      case 'verify': {
        if (step.windowMs !== undefined && (!isWholeSeconds(step.windowMs) || step.windowMs <= 0)) {
          issues.push(`Step ${n}: a verify window must be a positive whole number of seconds.`)
          return
        }
        const fromMs = step.windowMs !== undefined ? at - step.windowMs : lastCheckpoint
        if (at - fromMs < WINDOW_MS) {
          issues.push(`Step ${n}: verify has nothing to measure yet - add a wait before it.`)
          return
        }
        if (step.assertions.length === 0) {
          issues.push(`Step ${n}: verify has no assertions.`)
          return
        }
        checks.push({
          id: `verify-${index}`,
          phase: 'verify',
          label: stepLabel(step),
          stepIndex: index,
          fromMs: Math.max(stepsStartMs, fromMs),
          toMs: at,
          assertions: step.assertions
        })
        lastCheckpoint = at
        timeline.push({ stepIndex: index, type: 'verify', atMs: at, label: stepLabel(step) })
        return
      }
    }
  })

  return { endMs: cursor, faults, spikes, checks, timeline, issues }
}

function isWholeSeconds(ms: number): boolean {
  return Number.isFinite(ms) && ms >= 0 && ms % WINDOW_MS === 0
}

/**
 * Resolve overlapping faults on the same node: the later start wins and the
 * earlier interval is cut off where the later one begins; on equal starts the
 * later entry (step order, or scenario order in a composition) wins outright.
 * Cache flushes are instantaneous and never conflict.
 */
export function resolveFaultConflicts(
  faults: ScheduledFault[],
  describe: (fault: ScheduledFault) => string = (f) => f.source ?? `step ${f.stepIndex + 1}`
): { faults: ScheduledFault[]; notes: string[] } {
  const notes: string[] = []
  const ordered = faults
    .map((fault, order) => ({ fault: { ...fault }, order }))
    .sort((a, b) => a.fault.startMs - b.fault.startMs || a.order - b.order)
  const kept: ScheduledFault[] = []
  const lastFailureByTarget = new Map<string, ScheduledFault>()

  for (const { fault } of ordered) {
    if (fault.fault.kind === 'cache-flush') {
      kept.push(fault)
      continue
    }
    const target = fault.fault.targetId
    const previous = lastFailureByTarget.get(target)
    if (previous && (previous.endMs === null || previous.endMs > fault.startMs)) {
      if (previous.startMs === fault.startMs) {
        kept.splice(kept.indexOf(previous), 1)
        notes.push(
          `${target}: two faults start at ${fault.startMs / 1000}s - ${describe(fault)} replaces ${describe(previous)}.`
        )
      } else {
        previous.endMs = fault.startMs
        notes.push(
          `${target}: ${describe(fault)} starts at ${fault.startMs / 1000}s while ${describe(previous)} is still active - the later fault takes over from that moment.`
        )
      }
    }
    kept.push(fault)
    lastFailureByTarget.set(target, fault)
  }

  return { faults: kept, notes }
}

export function resolveSpikeConflicts(
  spikes: ScheduledSpike[],
  describe: (spike: ScheduledSpike) => string = (s) => s.source ?? `step ${s.stepIndex + 1}`
): { spike: ScheduledSpike | null; notes: string[] } {
  if (spikes.length === 0) return { spike: null, notes: [] }
  const ordered = spikes
    .map((spike, order) => ({ spike, order }))
    .sort((a, b) => a.spike.startMs - b.spike.startMs || a.order - b.order)
  const winner = ordered[ordered.length - 1].spike
  const notes = ordered
    .slice(0, -1)
    .map(
      ({ spike }) =>
        `The engine runs one traffic spike per run: ${describe(winner)} (starting ${winner.startMs / 1000}s) wins, ${describe(spike)} is dropped.`
    )
  return { spike: winner, notes }
}

function toFaultSpec(scheduled: ScheduledFault): FaultSpec {
  const { fault, startMs, endMs } = scheduled
  if (fault.kind === 'cache-flush') {
    return {
      targetId: fault.targetId,
      faultType: CACHE_FLUSH_FAULT_TYPE,
      timing: 'deterministic',
      duration: 'fixed',
      params: {
        atMs: startMs,
        ...(fault.durationMs && fault.durationMs > 0 ? { durationMs: fault.durationMs } : {})
      }
    }
  }
  const durationMs = endMs === null ? 0 : endMs - startMs
  return {
    targetId: fault.targetId,
    faultType: 'chaos',
    timing: 'deterministic',
    duration: endMs === null ? 'permanent' : 'fixed',
    params: {
      atMs: startMs,
      durationMs,
      mode: fault.mode ?? 'blackhole',
      inFlightPolicy: fault.inFlightPolicy ?? 'hang',
      recoveryPolicy: fault.recoveryPolicy ?? 'reset',
      ...(fault.mode === 'degraded' && fault.degradation
        ? { degradation: { ...fault.degradation } }
        : {})
    }
  }
}

function applySpike(
  workload: WorkloadProfile,
  spike: ScheduledSpike,
  notes: string[],
  issues: string[]
): WorkloadProfile {
  if (workload.pattern !== 'constant' && workload.pattern !== 'poisson') {
    if (workload.pattern !== 'spike') {
      issues.push(
        `A traffic step needs a steady base workload (constant or Poisson); this source uses the ${workload.pattern} pattern.`
      )
      return workload
    }
    notes.push("The workload's own spike settings are replaced by the experiment's spike.")
  }
  if (workload.pattern === 'poisson') {
    notes.push(
      'The engine models a traffic spike as its spike pattern, which sends evenly spaced requests, so the Poisson base traffic becomes evenly spaced for this run.'
    )
  }
  return {
    ...workload,
    pattern: 'spike',
    spike: {
      spikeTime: spike.startMs,
      spikeRps: workload.baseRps * spike.multiplier,
      spikeDuration: spike.durationMs
    }
  }
}

function validateDefinitionShape(definition: ChaosExperimentDefinition, issues: string[]): void {
  if (!isWholeSeconds(definition.warmupMs)) {
    issues.push('Warmup must be a whole number of seconds.')
  }
  if (!isWholeSeconds(definition.baselineMs) || definition.baselineMs < WINDOW_MS) {
    issues.push('The steady-state baseline must be at least 1 second, in whole seconds.')
  }
  if (!isWholeSeconds(definition.finalCheckMs)) {
    issues.push('The final check window must be a whole number of seconds.')
  }
  if (definition.steadyState.length === 0) {
    issues.push('Define at least one steady-state assertion.')
  }
  for (const assertion of [
    ...definition.steadyState,
    ...definition.steps.flatMap((step) => (step.type === 'verify' ? step.assertions : []))
  ]) {
    if ((assertion.operator === undefined) !== (assertion.value === undefined)) {
      issues.push(
        `"${describeAssertion(assertion)}" needs both an operator and a value (or neither, to only observe it).`
      )
    }
  }
}

export interface CompiledExperiment {
  topology: TopologyJSON
  plan: ExperimentPlan
}

/**
 * Compile a definition against a topology. Throws {@link ExperimentCompileError}
 * with every problem found (unknown nodes, bad timing, unrestorable steps).
 *
 * The experiment owns the run's timing and chaos: the run's duration and warmup
 * are set from the definition, and any faults already on the topology are
 * replaced so they cannot confound the result.
 */
export function compileExperiment(
  topology: TopologyJSON,
  definition: ChaosExperimentDefinition
): CompiledExperiment {
  const issues: string[] = []
  const notes: string[] = [...(definition.notes ?? [])]
  validateDefinitionShape(definition, issues)

  const nodeIds = new Set(topology.nodes.map((node) => node.id))
  const referenced = [
    ...definition.steadyState.map((a) => a.nodeId),
    ...definition.steps.flatMap((step) => {
      if (step.type === 'inject') return [step.fault.targetId]
      if (step.type === 'restore') return [step.targetId]
      if (step.type === 'verify') return step.assertions.map((a) => a.nodeId)
      return []
    })
  ].filter((id): id is string => typeof id === 'string')
  for (const id of new Set(referenced)) {
    if (!nodeIds.has(id)) issues.push(`The experiment refers to "${id}", which is not in this topology.`)
  }

  const warmupMs = definition.warmupMs
  const stepsStartMs = warmupMs + definition.baselineMs
  const scheduled = scheduleSteps(definition, stepsStartMs)
  issues.push(...scheduled.issues)

  const resolvedFaults = resolveFaultConflicts(scheduled.faults)
  notes.push(...resolvedFaults.notes)
  const resolvedSpike = resolveSpikeConflicts(scheduled.spikes)
  notes.push(...resolvedSpike.notes)

  let workload = topology.workload
  if (resolvedSpike.spike) {
    if (!workload) issues.push('A traffic step needs a workload source on the topology.')
    else workload = applySpike(workload, resolvedSpike.spike, notes, issues)
  }

  if ((topology.faults ?? []).length > 0) {
    notes.push(
      `${topology.faults!.length} fault(s) already on the topology were set aside so only the experiment's faults run.`
    )
  }

  if (issues.length > 0) throw new ExperimentCompileError(issues)

  const durationMs = scheduled.endMs + definition.finalCheckMs
  const checks: PlannedCheck[] = [
    {
      id: 'steady-state',
      phase: 'steady-state',
      label: 'Steady state before injection',
      stepIndex: null,
      fromMs: warmupMs,
      toMs: stepsStartMs,
      assertions: definition.steadyState
    },
    ...scheduled.checks
  ]
  if (definition.finalCheckMs > 0) {
    checks.push({
      id: 'final',
      phase: 'final',
      label: 'Steady state after the experiment',
      stepIndex: null,
      fromMs: scheduled.endMs,
      toMs: durationMs,
      assertions: definition.steadyState
    })
  }

  const timeline: PlannedTimelineEntry[] = [
    ...(warmupMs > 0
      ? [{ stepIndex: null, type: 'warmup' as const, atMs: 0, label: `Warm up ${warmupMs / 1000}s` }]
      : []),
    {
      stepIndex: null,
      type: 'steady-state',
      atMs: warmupMs,
      label: `Measure steady state for ${definition.baselineMs / 1000}s`
    },
    ...scheduled.timeline,
    ...(definition.finalCheckMs > 0
      ? [
          {
            stepIndex: null,
            type: 'final' as const,
            atMs: scheduled.endMs,
            label: `Check steady state for ${definition.finalCheckMs / 1000}s`
          }
        ]
      : [])
  ]

  const compiledTopology: TopologyJSON = {
    ...topology,
    global: { ...topology.global, simulationDuration: durationMs, warmupDuration: warmupMs },
    faults: resolvedFaults.faults.map(toFaultSpec),
    ...(workload
      ? { workload: { ...workload, stopCondition: { ...workload.stopCondition, mode: 'duration' } } }
      : {})
  }
  if (workload?.stopCondition && workload.stopCondition.mode !== 'duration') {
    notes.push('The request-budget stop condition is ignored - an experiment runs for its full timeline.')
  }

  return {
    topology: compiledTopology,
    plan: {
      definition,
      durationMs,
      warmupMs,
      stepsStartMs,
      timeline,
      checks,
      notes
    }
  }
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

function windowsFor(output: SimulationOutput, nodeId?: string): LatencyWindowPoint[] | null {
  if (!nodeId) return output.summary.latencyWindows
  return output.perNode[nodeId]?.latencyWindows ?? null
}

function measure(
  assertion: ExperimentAssertion,
  windows: LatencyWindowPoint[],
  fromMs: number,
  toMs: number
): { actual: number | null; samples: number } {
  const inside = windows.filter((w) => w.windowStartMs >= fromMs && w.windowEndMs <= toMs)
  const success = inside.reduce((sum, w) => sum + w.successCount, 0)
  const errors = inside.reduce((sum, w) => sum + w.errorCount, 0)
  const samples = success + errors
  switch (assertion.metric) {
    case 'error_rate':
      return { actual: samples > 0 ? errors / samples : null, samples }
    case 'throughput':
      return { actual: success / ((toMs - fromMs) / 1000), samples }
    case 'latency_p50':
    case 'latency_p95':
    case 'latency_p99': {
      const key = assertion.metric === 'latency_p50' ? 'p50' : assertion.metric === 'latency_p95' ? 'p95' : 'p99'
      const values = inside.map((w) => w[key]).filter((v): v is number => v !== null)
      return { actual: values.length > 0 ? Math.max(...values) : null, samples }
    }
  }
}

function compare(actual: number, operator: NonNullable<ExperimentAssertion['operator']>, value: number): boolean {
  switch (operator) {
    case '<':
      return actual < value
    case '<=':
      return actual <= value
    case '>':
      return actual > value
    case '>=':
      return actual >= value
  }
}

function evaluateAssertion(
  assertion: ExperimentAssertion,
  output: SimulationOutput,
  fromMs: number,
  toMs: number,
  nodeLabel?: (nodeId: string) => string
): AssertionResult {
  const label = describeAssertion(assertion, nodeLabel)
  const windows = windowsFor(output, assertion.nodeId)
  if (windows === null) {
    return {
      assertion,
      label,
      status: 'no-data',
      actual: null,
      samples: 0,
      detail: 'This component has no measurements in the run.'
    }
  }
  const { actual, samples } = measure(assertion, windows, fromMs, toMs)
  const isObservation = !assertion.operator || assertion.value === undefined
  if (actual === null) {
    return {
      assertion,
      label,
      status: isObservation ? 'observed' : 'no-data',
      actual: null,
      samples,
      detail:
        assertion.metric.startsWith('latency') && samples > 0
          ? 'No request succeeded in this window, so there is no latency to measure.'
          : 'No requests finished in this window.'
    }
  }
  const measured = formatMetricValue(assertion.metric, actual)
  const reading = assertion.metric.startsWith('latency') ? `worst 1s window ${measured}` : measured
  if (isObservation) {
    return { assertion, label, status: 'observed', actual, samples, detail: `Measured ${reading}.` }
  }
  const passed = compare(actual, assertion.operator!, assertion.value!)
  return {
    assertion,
    label,
    status: passed ? 'pass' : 'fail',
    actual,
    samples,
    detail: `Measured ${reading} (${samples} requests).`
  }
}

export interface EvaluateOptions {
  /** Map node ids to display names in labels. */
  nodeLabel?: (nodeId: string) => string
  /** Sim time the run was stopped by the user, when it was (checks after it are skipped). */
  stoppedAtMs?: number
}

export function evaluateExperiment(
  plan: ExperimentPlan,
  output: SimulationOutput,
  options: EvaluateOptions = {}
): ExperimentResult {
  const { definition } = plan
  const notes = [...plan.notes]
  const analytic = output.evaluationMode === 'analytic'
  // A duration-bound run covers the whole plan; only a saturation halt, a request
  // budget, or a user stop (passed in by the caller) ends it early.
  const haltedEarly = output.stopReason === 'saturation' || output.stopReason === 'request-budget'
  const endedAtMs = Math.min(
    options.stoppedAtMs ?? Number.POSITIVE_INFINITY,
    haltedEarly ? (output.stoppedAtMs ?? plan.durationMs) : plan.durationMs
  )
  if (analytic) {
    notes.push(
      'This load was computed with the analytic model, which does not schedule faults or keep time windows, so no assertion could be checked. Lower the request rate to simulate it.'
    )
  } else if (endedAtMs < plan.durationMs) {
    notes.push(`The run ended at ${(endedAtMs / 1000).toFixed(1)}s, before the experiment finished.`)
  }

  let stable = true
  const checks: CheckResult[] = plan.checks.map((check) => {
    const skip = analytic || !stable || check.toMs > endedAtMs
    if (skip) {
      return {
        ...checkMeta(check),
        status: 'skipped',
        assertions: check.assertions.map((assertion) => ({
          assertion,
          label: describeAssertion(assertion, options.nodeLabel),
          status: 'skipped',
          actual: null,
          samples: 0,
          detail: analytic
            ? 'Not measurable in an analytic run.'
            : !stable
              ? 'Skipped - the steady state did not hold before injection.'
              : 'Skipped - the run ended before this window.'
        }))
      }
    }
    const assertions = check.assertions.map((assertion) =>
      evaluateAssertion(assertion, output, check.fromMs, check.toMs, options.nodeLabel)
    )
    const failed = assertions.some((a) => a.status === 'fail' || a.status === 'no-data')
    const asserted = assertions.some((a) => a.status === 'pass' || a.status === 'fail' || a.status === 'no-data')
    const status: CheckResult['status'] = failed ? 'fail' : asserted ? 'pass' : 'observed'
    if (check.phase === 'steady-state' && failed) stable = false
    return { ...checkMeta(check), status, assertions }
  })

  const violations: ExperimentViolation[] = checks.flatMap((check) =>
    check.assertions
      .filter((a) => a.status === 'fail' || a.status === 'no-data')
      .map((a) => ({
        checkId: check.id,
        stepIndex: check.stepIndex,
        assertion: a.assertion,
        label: a.label,
        actual: a.actual
      }))
  )

  const steadyState = checks.find((c) => c.phase === 'steady-state')
  const steadyStateHeld = steadyState?.status === 'pass'
  const anySkipped = checks.some((c) => c.status === 'skipped')
  let verdict: ExperimentResult['verdict']
  let summary: string
  if (analytic) {
    verdict = 'inconclusive'
    summary = 'Not evaluated: this load ran on the analytic model, which does not inject faults.'
  } else if (!steadyStateHeld) {
    verdict = 'not-stable'
    summary = 'The system was not stable before any fault was injected, so the experiment stopped there.'
  } else if (violations.length > 0) {
    verdict = 'failed'
    summary = `${violations.length} assertion${violations.length === 1 ? '' : 's'} did not hold.`
  } else if (anySkipped) {
    verdict = 'inconclusive'
    summary = 'Every check that ran passed, but the run ended before the experiment finished.'
  } else {
    verdict = 'passed'
    summary = 'The steady state held before, during and after the experiment.'
  }

  const resultByStep = new Map<number, CheckResult['status']>()
  for (const check of checks) if (check.stepIndex !== null) resultByStep.set(check.stepIndex, check.status)
  const timeline: ExperimentTimelineEntry[] = plan.timeline.map((entry) => {
    let result: ExperimentTimelineEntry['result'] = entry.atMs <= endedAtMs ? 'executed' : 'skipped'
    if (entry.type === 'steady-state') result = toTimelineResult(steadyState?.status)
    else if (entry.type === 'final') result = toTimelineResult(checks.find((c) => c.phase === 'final')?.status)
    else if (entry.type === 'verify' && entry.stepIndex !== null)
      result = toTimelineResult(resultByStep.get(entry.stepIndex))
    return { ...entry, result }
  })

  return {
    experimentId: definition.id,
    name: definition.name,
    passed: verdict === 'passed',
    verdict,
    summary,
    steadyStateHeld,
    checks,
    timeline,
    violations,
    notes,
    durationMs: plan.durationMs
  }
}

function checkMeta(check: PlannedCheck): Omit<CheckResult, 'status' | 'assertions'> {
  return {
    id: check.id,
    phase: check.phase,
    label: check.label,
    stepIndex: check.stepIndex,
    fromMs: check.fromMs,
    toMs: check.toMs
  }
}

function toTimelineResult(status: CheckResult['status'] | undefined): ExperimentTimelineEntry['result'] {
  if (status === 'pass' || status === 'observed') return 'pass'
  if (status === 'fail') return 'fail'
  return 'skipped'
}

// ─── Headless runner ─────────────────────────────────────────────────────────

export interface ChaosRun {
  result: ExperimentResult
  output: SimulationOutput
  compiled: CompiledExperiment
}

/** Compile, simulate (always event-by-event so faults apply) and evaluate. */
export function runChaosExperiment(
  topology: TopologyJSON,
  definition: ChaosExperimentDefinition,
  options: EvaluateOptions = {}
): ChaosRun {
  const compiled = compileExperiment(topology, definition)
  const output = runSimulation(compiled.topology, { mode: 'discrete' })
  return { result: evaluateExperiment(compiled.plan, output, options), output, compiled }
}

/**
 * Fluent builder matching the shape proposed in #65:
 *   new ChaosExperiment('db crash').defineSteadyState([...]).addStep(...).run(topology)
 */
export class ChaosExperiment {
  private readonly definition: ChaosExperimentDefinition

  constructor(name: string, init: Partial<Omit<ChaosExperimentDefinition, 'name'>> = {}) {
    this.definition = {
      id: init.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      description: init.description,
      warmupMs: init.warmupMs ?? 2_000,
      baselineMs: init.baselineMs ?? 5_000,
      steadyState: [...(init.steadyState ?? [])],
      steps: [...(init.steps ?? [])],
      finalCheckMs: init.finalCheckMs ?? 5_000,
      notes: [...(init.notes ?? [])]
    }
  }

  defineSteadyState(assertions: ExperimentAssertion[]): this {
    this.definition.steadyState = [...assertions]
    return this
  }

  addStep(step: ExperimentStep): this {
    this.definition.steps.push(step)
    return this
  }

  toDefinition(): ChaosExperimentDefinition {
    return structuredClone(this.definition)
  }

  run(topology: TopologyJSON, options: EvaluateOptions = {}): ChaosRun {
    return runChaosExperiment(topology, this.toDefinition(), options)
  }
}
