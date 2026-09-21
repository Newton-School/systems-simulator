import type { LucideIcon } from 'lucide-react'
import { Boxes, ClipboardCheck, Eye, FileOutput, Flag, ListChecks, PlaySquare } from 'lucide-react'
import type { AuthoringStageId } from '../../../../engine/analysis/questionAuthoringProject'

export type { AuthoringStageId } from '../../../../engine/analysis/questionAuthoringProject'

export interface AuthoringStageDefinition {
  id: AuthoringStageId
  number: number
  label: string
  shortDescription: string
  icon: LucideIcon
}

export const QUESTION_STUDIO_STAGES: readonly AuthoringStageDefinition[] = [
  {
    id: 'frame',
    number: 1,
    label: 'Frame',
    shortDescription: 'Lesson and intent',
    icon: Flag
  },
  {
    id: 'brief',
    number: 2,
    label: 'Brief',
    shortDescription: 'Learner prompt',
    icon: ListChecks
  },
  {
    id: 'start',
    number: 3,
    label: 'Start',
    shortDescription: 'Starting design',
    icon: PlaySquare
  },
  {
    id: 'scenarios',
    number: 4,
    label: 'Scenarios',
    shortDescription: 'Workload and faults',
    icon: Boxes
  },
  {
    id: 'grading',
    number: 5,
    label: 'Grading',
    shortDescription: 'Visual obligations',
    icon: ClipboardCheck
  },
  // The 'prove' (Discrimination Lab) stage is intentionally hidden. Its stage id,
  // engine (`questionAuthoringVerification`), and `DiscriminationLab` UI all remain
  // in the codebase; re-add the entry here to bring the stage back.
  {
    id: 'preview',
    number: 6,
    label: 'Preview',
    shortDescription: 'Learner experience',
    icon: Eye
  },
  {
    id: 'export',
    number: 7,
    label: 'Export',
    shortDescription: 'Review and generate',
    icon: FileOutput
  }
]

export function getQuestionStudioStage(id: AuthoringStageId): AuthoringStageDefinition {
  return QUESTION_STUDIO_STAGES.find((stage) => stage.id === id) ?? QUESTION_STUDIO_STAGES[0]
}
