import {
  compileQuestionAuthoringExportBundle,
  type QuestionAuthoringExportBundle
} from '../../../engine/analysis/questionAuthoringExportBundle'
import type { QuestionAuthoringProject } from '../../../engine/analysis/questionAuthoringProject'
import { FileService } from './FileService'
import type { IFileService } from './FileService.types'

export type DownloadQuestionArtifactsResult =
  | { status: 'downloaded'; fileName: string; bundle: QuestionAuthoringExportBundle }
  | { status: 'blocked'; message: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export async function downloadQuestionAuthoringArtifacts(
  project: QuestionAuthoringProject,
  fileService: IFileService = FileService
): Promise<DownloadQuestionArtifactsResult> {
  const compiled = compileQuestionAuthoringExportBundle(project)
  if (compiled.status === 'blocked') {
    return {
      status: 'blocked',
      message: 'Complete the generated-output checklist before downloading artifacts.'
    }
  }

  try {
    const saved = await fileService.save(compiled.content, compiled.fileName, {
      dialogTitle: 'Download Question Studio Artifact Bundle',
      fileDescription: 'DSDS Question Export Bundles',
      saveAsNewFile: true
    })
    return saved
      ? { status: 'downloaded', fileName: saved.name, bundle: compiled.bundle }
      : { status: 'cancelled' }
  } catch (error) {
    console.error('[QuestionStudio] Artifact download failed:', error)
    return { status: 'error', message: 'Could not download the question artifact bundle.' }
  }
}
