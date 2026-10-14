import type { QuestionSuiteCase } from './question'
import type { Budget, QuestionDomain, WorkloadCategory } from './gradingCriteria'
import type { ComponentType } from '../core/types'
import type {
  QuestionConstraints,
  QuestionEntryFormat,
  QuestionPackage,
  QuestionPrompt,
  QuestionScaffold,
  QuestionType
} from './question'

/**
 * Browser-safe projection of a published question.
 *
 * This is intentionally not a QuestionPackage: a QuestionPackage contains the
 * private suite, rubric, semantic criteria and grader hints and must stay on the
 * author/grading side. The assignment renderer should receive only this shape.
 */
export interface StudentAssignmentPackage {
  version: '1.0'
  id: string
  title: string
  description?: string
  difficulty: QuestionPackage['difficulty']
  tags?: string[]
  estimatedTimeMinutes?: number
  type: QuestionType
  entryFormat?: QuestionEntryFormat
  prompt: QuestionPrompt
  scaffold: QuestionScaffold
  constraints: QuestionConstraints
  justify?: Array<{
    id: string
    decision: string
    boundTo?: { nodeId?: string; componentType?: ComponentType }
    requires: { choice: boolean; number?: boolean; tradeoff: boolean }
  }>
  budget?: Budget
  workloadCategory?: WorkloadCategory
  domains?: QuestionDomain[]
  concepts?: string[]
  /** The only executable case that may cross the student boundary. */
  dryRunCase?: QuestionSuiteCase
}

/**
 * Removes every private grading input before a question crosses into a student
 * browser. In particular, `suite.cases`, rubric checks, structural rules,
 * semantic criteria and justification answer tokens are never copied.
 */
export function buildStudentAssignmentPackage(question: QuestionPackage): StudentAssignmentPackage {
  return {
    version: question.version,
    id: question.id,
    title: question.title,
    ...(question.description ? { description: question.description } : {}),
    difficulty: question.difficulty,
    ...(question.tags ? { tags: [...question.tags] } : {}),
    ...(question.estimatedTimeMinutes
      ? { estimatedTimeMinutes: question.estimatedTimeMinutes }
      : {}),
    type: question.type,
    ...(question.entryFormat ? { entryFormat: question.entryFormat } : {}),
    prompt: question.prompt,
    scaffold: question.scaffold,
    constraints: question.constraints,
    ...(question.justify
      ? {
          justify: question.justify.map(({ id, decision, boundTo, requires }) => ({
            id,
            decision,
            ...(boundTo ? { boundTo } : {}),
            requires
          }))
        }
      : {}),
    ...(question.budget ? { budget: question.budget } : {}),
    ...(question.workloadCategory ? { workloadCategory: question.workloadCategory } : {}),
    ...(question.domains ? { domains: [...question.domains] } : {}),
    ...(question.concepts ? { concepts: [...question.concepts] } : {}),
    ...(question.suite.dryRunCase ? { dryRunCase: question.suite.dryRunCase } : {})
  }
}
