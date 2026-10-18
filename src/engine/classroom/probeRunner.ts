import { gradeAttempt, type QuestionPackage } from '../analysis/question'
import type { SimulationOutput } from '../analysis/output'
import { classroomSketchToTopology } from './designSketch'

export interface ClassroomProbeResult {
  misconceptionId: string
  passed: boolean
  matchedIds: string[]
  detail: string
}

/** Proves each authored wrong design triggers its own message and no other. */
export function runClassroomMisconceptionProbes(
  question: QuestionPackage,
  runTopology: (topology: Parameters<typeof gradeAttempt>[1]) => SimulationOutput
): ClassroomProbeResult[] {
  const peak = question.prompt.scale.peakRps ?? question.suite.dryRunCase?.workload?.baseRps ?? 1
  return (question.classroom?.misconceptions ?? [])
    .filter((misconception) => misconception.probe)
    .map((misconception) => {
      const topology = classroomSketchToTopology(
        misconception.probe!,
        peak,
        `probe-${misconception.id}`
      )
      const grade = gradeAttempt(question, topology, runTopology, [], { abstraction: 'classroom' })
      const matchedIds = grade.classroom?.misconceptions.map((match) => match.id) ?? []
      const passed = matchedIds.length === 1 && matchedIds[0] === misconception.id
      return {
        misconceptionId: misconception.id,
        passed,
        matchedIds,
        detail: passed
          ? 'Triggered only the intended teaching message.'
          : matchedIds.length === 0
            ? 'The probe did not trigger a teaching message.'
            : `Triggered: ${matchedIds.join(', ')}.`
      }
    })
}
