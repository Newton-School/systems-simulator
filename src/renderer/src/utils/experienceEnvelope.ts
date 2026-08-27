import type { EnvironmentProfile } from '../../../engine/analysis/environmentProfile'
import {
  formatQuestionEntryFormat,
  resolveQuestionEntryFormat,
  type QuestionEntryFormat,
  type QuestionPackage
} from '../../../engine/analysis/question'

export type ExperienceKind = 'SANDBOX' | 'ASSIGNMENT' | 'INTERVIEW' | 'LAB'

export type ExperienceSidebarTab =
  | 'question'
  | 'library'
  | 'scenarios'
  | 'blueprints'
  | 'labs'

export interface ExperienceEnvelope {
  kind: ExperienceKind
  label: string
  description: string
  entryFormat: QuestionEntryFormat | null
  entryFormatLabel: string | null
  questionTabLabel: string
  allowedTabs: readonly ExperienceSidebarTab[]
  canvasLocked: boolean
  resultsButtonLabel: string
  testActionLabel: string
}

type ExperienceQuestion =
  | Pick<QuestionPackage, 'entryFormat' | 'tags' | 'type' | 'scaffold' | 'constraints'>
  | null
  | undefined
type ExperienceProfile = Pick<EnvironmentProfile, 'mode' | 'graded'>

const SANDBOX_TABS: readonly ExperienceSidebarTab[] = [
  'question',
  'blueprints',
  'labs',
  'library',
  'scenarios'
]
const ASSIGNMENT_TABS: readonly ExperienceSidebarTab[] = ['question', 'library']
const INTERVIEW_TABS: readonly ExperienceSidebarTab[] = ['question', 'blueprints', 'library']
const LAB_TABS: readonly ExperienceSidebarTab[] = ['question', 'labs']

function hasTag(question: ExperienceQuestion, tag: string): boolean {
  return question?.tags?.some((value) => value.toLowerCase() === tag.toLowerCase()) ?? false
}

export function isLabQuestion(question: ExperienceQuestion): boolean {
  if (!question) {
    return false
  }

  if (resolveQuestionEntryFormat(question) === 'locked-lab') {
    return true
  }

  if (hasTag(question, 'lab')) {
    return true
  }

  return (
    question.scaffold.type === 'complete' &&
    question.constraints.canModifyScaffold === false &&
    question.constraints.canRemoveScaffoldNodes === false &&
    (question.constraints.allowedNodeTypes?.length ?? 0) === 0
  )
}

export function resolveExperienceEnvelope(
  environmentProfile: ExperienceProfile,
  activeQuestion?: ExperienceQuestion
): ExperienceEnvelope {
  if (!activeQuestion) {
    return {
      kind: 'SANDBOX',
      label: 'Sandbox',
      description: 'Free-play canvas with the full simulator workbench around it.',
      entryFormat: null,
      entryFormatLabel: null,
      questionTabLabel: 'Question Text',
      allowedTabs: SANDBOX_TABS,
      canvasLocked: false,
      resultsButtonLabel: 'Show Results',
      testActionLabel: 'Test'
    }
  }

  const entryFormat = resolveQuestionEntryFormat(activeQuestion)
  const entryFormatLabel = formatQuestionEntryFormat(entryFormat)

  if (isLabQuestion(activeQuestion)) {
    return {
      kind: 'LAB',
      label: 'Lab',
      description: 'Locked topology with guided parameter changes and results analysis.',
      entryFormat,
      entryFormatLabel,
      questionTabLabel: 'Lab Guide',
      allowedTabs: LAB_TABS,
      canvasLocked: true,
      resultsButtonLabel: 'Open Timeline & Results',
      testActionLabel: 'Run Lab'
    }
  }

  if (environmentProfile.graded || environmentProfile.mode === 'ASSIGNMENT') {
    return {
      kind: 'ASSIGNMENT',
      label: 'Assignment',
      description: 'Prompt, rubric, and grading wrap the shared simulator canvas.',
      entryFormat,
      entryFormatLabel,
      questionTabLabel:
        entryFormat === 'requirements-first'
          ? 'Requirements Brief'
          : entryFormat === 'partial-scaffold'
            ? 'Starter Brief'
            : entryFormat === 'broken-scaffold'
              ? 'Repair Brief'
              : entryFormat === 'baseline-optimize'
                ? 'Optimization Brief'
                : 'Assignment Brief',
      allowedTabs: ASSIGNMENT_TABS,
      canvasLocked: false,
      resultsButtonLabel:
        entryFormat === 'baseline-optimize'
          ? 'Open Comparison & Results'
          : 'Open Timeline & Results',
      testActionLabel:
        entryFormat === 'requirements-first'
          ? 'Run Against Requirements'
          : entryFormat === 'partial-scaffold'
            ? 'Run Completion Check'
            : entryFormat === 'broken-scaffold'
              ? 'Run Repair Check'
              : entryFormat === 'baseline-optimize'
                ? 'Run & Compare'
                : 'Run & Evaluate'
    }
  }

  return {
    kind: 'INTERVIEW',
    label: 'Interview',
    description: 'A guided question shell wrapped around the same simulator engine.',
    entryFormat,
    entryFormatLabel,
    questionTabLabel:
      entryFormat === 'requirements-first'
        ? 'Requirements Brief'
        : entryFormat === 'partial-scaffold'
          ? 'Starter Brief'
          : entryFormat === 'broken-scaffold'
            ? 'Repair Brief'
            : entryFormat === 'baseline-optimize'
              ? 'Optimization Brief'
              : 'Interview Brief',
    allowedTabs: INTERVIEW_TABS,
    canvasLocked: false,
    resultsButtonLabel:
      entryFormat === 'baseline-optimize'
        ? 'Open Comparison & Results'
        : 'Open Timeline & Results',
    testActionLabel:
      entryFormat === 'requirements-first'
        ? 'Run Against Requirements'
        : entryFormat === 'partial-scaffold'
          ? 'Run Completion Check'
          : entryFormat === 'broken-scaffold'
            ? 'Run Repair Check'
            : entryFormat === 'baseline-optimize'
              ? 'Run & Compare'
              : 'Run & Evaluate'
  }
}
