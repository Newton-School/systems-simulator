import {
  questionAuthoringProjectFileName,
  serializeQuestionAuthoringProject,
  type QuestionAuthoringProject
} from '../../../engine/analysis/questionAuthoringProject'
import { deserializeQuestionAuthoringArtifact } from '../../../engine/analysis/questionAuthoringImport'
import { FileService } from './FileService'
import type { IFileService } from './FileService.types'

const QUESTION_PROJECT_DIALOG_OPTIONS = {
  dialogTitle: 'Question Studio project',
  fileDescription: 'DSDS Question Studio Projects, Packages, or Newton Rows'
} as const

export type SaveQuestionProjectResult =
  | { status: 'saved'; fileName: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type OpenQuestionProjectResult =
  | { status: 'opened'; fileName: string; project: QuestionAuthoringProject }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export async function saveQuestionAuthoringProject(
  project: QuestionAuthoringProject,
  fileService: IFileService = FileService
): Promise<SaveQuestionProjectResult> {
  try {
    const savedFile = await fileService.save(
      serializeQuestionAuthoringProject(project),
      questionAuthoringProjectFileName(project.question.title),
      {
        ...QUESTION_PROJECT_DIALOG_OPTIONS,
        dialogTitle: 'Save Question Studio Project'
      }
    )

    return savedFile ? { status: 'saved', fileName: savedFile.name } : { status: 'cancelled' }
  } catch (error) {
    console.error('[QuestionStudio] Project save failed:', error)
    return { status: 'error', message: 'Could not save the Question Studio project.' }
  }
}

export async function openQuestionAuthoringProject(
  fileService: IFileService = FileService
): Promise<OpenQuestionProjectResult> {
  try {
    const loadedFile = await fileService.load({
      ...QUESTION_PROJECT_DIALOG_OPTIONS,
      dialogTitle: 'Open Question Studio Project'
    })
    if (!loadedFile) return { status: 'cancelled' }

    return {
      status: 'opened',
      fileName: loadedFile.name,
      project: deserializeQuestionAuthoringArtifact(loadedFile.content)
    }
  } catch (error) {
    fileService.forgetActiveFile?.()
    console.error('[QuestionStudio] Project open failed:', error)
    return {
      status: 'error',
      message:
        error instanceof SyntaxError
          ? 'The selected file is not valid JSON.'
          : 'The selected file is not a valid Question Studio project, question package, export bundle, or Newton row seed.'
    }
  }
}
