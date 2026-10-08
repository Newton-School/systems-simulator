/**
 * Scenario composer (#67): run several experiments in one simulation, each
 * shifted by an offset, e.g. a cache stampede that starts 5s into a traffic spike.
 *
 * Rules (deterministic, and reported in the composed experiment's notes):
 * - Timeline: the composed warmup and baseline are the longest of the inputs.
 *   Each scenario's first step runs `offsetMs` after the shared baseline ends,
 *   and its steps keep their own spacing from there.
 * - Steady state: the union of every scenario's steady-state assertions
 *   (identical ones are kept once); all of them must hold before injection and
 *   in the final check.
 * - Verify steps keep the exact windows they had in their own scenario.
 * - Faults on the same node: the fault that starts later wins - the earlier one
 *   is cut off at that moment. If two start at the same time, the scenario
 *   listed later wins.
 * - Traffic: the engine runs one traffic spike per simulation, so the spike that
 *   starts last wins and the others are dropped.
 * - The final check is the longest of the inputs and starts after the last step
 *   of any scenario.
 *
 * The result is an ordinary {@link ChaosExperimentDefinition}: its steps are the
 * merged absolute events with `wait`s between them, faults carry explicit
 * durations, and verify steps carry explicit windows.
 */

import {
  resolveFaultConflicts,
  resolveSpikeConflicts,
  scheduleSteps,
  type ScheduledFault,
  type ScheduledSpike
} from './chaosExperiment'
import type { ChaosExperimentDefinition, ExperimentAssertion, ExperimentStep } from './types'

export interface ComposedScenarioInput {
  experiment: ChaosExperimentDefinition
  /** Delay, in whole seconds expressed as ms, before this scenario's first step. */
  offsetMs: number
}

interface TimedStep {
  atMs: number
  /** Sort key within one instant: restores, then faults/traffic, then verifies. */
  rank: number
  order: number
  step: ExperimentStep
}

function assertionKey(assertion: ExperimentAssertion): string {
  return [assertion.metric, assertion.operator ?? '', assertion.value ?? '', assertion.nodeId ?? ''].join('|')
}

export function composeScenarios(inputs: ComposedScenarioInput[]): ChaosExperimentDefinition {
  if (inputs.length === 0) throw new Error('Compose at least one scenario.')
  for (const input of inputs) {
    if (!Number.isFinite(input.offsetMs) || input.offsetMs < 0 || input.offsetMs % 1000 !== 0) {
      throw new Error(
        `Offset for "${input.experiment.name}" must be zero or a whole number of seconds.`
      )
    }
  }
  if (inputs.length === 1 && inputs[0].offsetMs === 0) return structuredClone(inputs[0].experiment)

  const warmupMs = Math.max(...inputs.map((input) => input.experiment.warmupMs))
  const baselineMs = Math.max(...inputs.map((input) => input.experiment.baselineMs))
  const finalCheckMs = Math.max(...inputs.map((input) => input.experiment.finalCheckMs))
  const notes: string[] = []

  const faults: ScheduledFault[] = []
  const spikes: ScheduledSpike[] = []
  const verifies: TimedStep[] = []
  let endMs = 0

  inputs.forEach((input, scenarioIndex) => {
    const { experiment, offsetMs } = input
    const scheduled = scheduleSteps(experiment, offsetMs)
    if (scheduled.issues.length > 0) {
      throw new Error(`${experiment.name}: ${scheduled.issues.join(' ')}`)
    }
    endMs = Math.max(endMs, scheduled.endMs)
    for (const fault of scheduled.faults) {
      faults.push({ ...fault, source: `${experiment.name}'s fault` })
    }
    for (const spike of scheduled.spikes) {
      spikes.push({ ...spike, source: `${experiment.name}'s spike` })
    }
    for (const check of scheduled.checks) {
      const step = experiment.steps[check.stepIndex!]
      verifies.push({
        atMs: check.toMs,
        rank: 2,
        order: scenarioIndex,
        step: {
          type: 'verify',
          windowMs: check.toMs - check.fromMs,
          assertions: check.assertions,
          label: `${experiment.name}: ${step.label ?? 'Verify'}`
        }
      })
    }
  })

  const resolvedFaults = resolveFaultConflicts(faults)
  notes.push(...resolvedFaults.notes)
  const resolvedSpike = resolveSpikeConflicts(spikes)
  notes.push(...resolvedSpike.notes)

  const timed: TimedStep[] = [...verifies]
  resolvedFaults.faults.forEach((fault, order) => {
    timed.push({
      atMs: fault.startMs,
      rank: 1,
      order,
      step: {
        type: 'inject',
        fault: {
          ...fault.fault,
          ...(fault.fault.kind === 'cache-flush'
            ? {}
            : { durationMs: fault.endMs === null ? undefined : fault.endMs - fault.startMs })
        }
      }
    })
  })
  if (resolvedSpike.spike) {
    timed.push({
      atMs: resolvedSpike.spike.startMs,
      rank: 1,
      order: 0,
      step: {
        type: 'traffic',
        multiplier: resolvedSpike.spike.multiplier,
        durationMs: resolvedSpike.spike.durationMs
      }
    })
  }
  timed.sort((a, b) => a.atMs - b.atMs || a.rank - b.rank || a.order - b.order)

  const steps: ExperimentStep[] = []
  let cursor = 0
  for (const entry of timed) {
    if (entry.atMs > cursor) {
      steps.push({ type: 'wait', durationMs: entry.atMs - cursor })
      cursor = entry.atMs
    }
    steps.push(entry.step)
  }
  if (endMs > cursor) steps.push({ type: 'wait', durationMs: endMs - cursor })

  const seen = new Set<string>()
  const steadyState: ExperimentAssertion[] = []
  for (const assertion of inputs.flatMap((input) => input.experiment.steadyState)) {
    const key = assertionKey(assertion)
    if (seen.has(key)) continue
    seen.add(key)
    steadyState.push(assertion)
  }

  return {
    id: inputs.map((input) => input.experiment.id).join('+'),
    name: inputs.map((input) => input.experiment.name).join(' + '),
    description: inputs
      .map((input) =>
        input.offsetMs > 0
          ? `${input.experiment.name} starting ${input.offsetMs / 1000}s in`
          : `${input.experiment.name} from the start`
      )
      .join(', '),
    warmupMs,
    baselineMs,
    steadyState,
    steps,
    finalCheckMs,
    notes: [
      ...notes,
      ...inputs.flatMap((input) => input.experiment.notes ?? []).filter((note, i, all) => all.indexOf(note) === i)
    ]
  }
}
