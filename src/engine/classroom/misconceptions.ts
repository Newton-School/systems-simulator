import { componentTypeSatisfies } from '../catalog/componentFamilies'
import type { AttemptGrade } from '../analysis/question'
import type { TopologyJSON } from '../core/types'
import { classroomCopies, type ClassroomMisconception, type MisconceptionDetector } from './types'

export interface ClassroomMisconceptionResult {
  id: string
  title: string
  message: string
  nudge?: string
  objectiveId?: string
}

function compare(left: number, op: '<' | '<=' | '>' | '>=' | '==', right: number): boolean {
  if (op === '<') return left < right
  if (op === '<=') return left <= right
  if (op === '>') return left > right
  if (op === '>=') return left >= right
  return left === right
}

/**
 * A Classroom check's outcome: `not-run` when it never got evaluated (no results, or
 * every rubric result was skipped because an earlier structure check failed). A
 * skipped check is not evidence of a mistake, so it matches neither detector.
 */
function classroomCheckOutcome(
  grade: AttemptGrade,
  checkId: string
): 'passed' | 'failed' | 'not-run' {
  const structural = grade.structural.checks.filter(
    (check) => check.id === checkId || check.id.startsWith(`${checkId}.`)
  )
  const rubric = grade.graded.cases
    .flatMap((entry) => entry.rubric?.checks.filter((check) => check.id === checkId) ?? [])
    .filter((check) => check.status !== 'skipped')
  const matches = [...structural, ...rubric]
  if (matches.length === 0) return 'not-run'
  return matches.every((result) => result.passed) ? 'passed' : 'failed'
}

function detectorMatches(
  detector: MisconceptionDetector,
  grade: AttemptGrade,
  topology: TopologyJSON
): boolean {
  switch (detector.kind) {
    case 'all':
      return (
        detector.of.length > 0 &&
        detector.of.every((child) => detectorMatches(child, grade, topology))
      )
    case 'any':
      return detector.of.some((child) => detectorMatches(child, grade, topology))
    case 'copies': {
      const copies = topology.nodes
        .filter((node) => componentTypeSatisfies(node.type, detector.component))
        .reduce((sum, node) => sum + classroomCopies(node), 0)
      return compare(copies, detector.op, detector.value)
    }
    case 'check-failed':
    case 'check-passed': {
      const outcome = classroomCheckOutcome(grade, detector.checkId)
      return outcome === (detector.kind === 'check-passed' ? 'passed' : 'failed')
    }
  }
}

/** Returns all matches in deterministic priority order; the UI presents the first. */
export function evaluateClassroomMisconceptions(
  misconceptions: readonly ClassroomMisconception[],
  grade: AttemptGrade,
  topology: TopologyJSON
): ClassroomMisconceptionResult[] {
  return misconceptions
    .map((misconception, index) => ({ misconception, index }))
    .sort(
      (left, right) =>
        (left.misconception.priority ?? Number.MAX_SAFE_INTEGER) -
          (right.misconception.priority ?? Number.MAX_SAFE_INTEGER) || left.index - right.index
    )
    .filter(({ misconception }) => detectorMatches(misconception.detect, grade, topology))
    .map(({ misconception }) => ({
      id: misconception.id,
      title: misconception.title,
      message: misconception.message,
      ...(misconception.nudge ? { nudge: misconception.nudge } : {}),
      ...(misconception.objectiveId ? { objectiveId: misconception.objectiveId } : {})
    }))
}
