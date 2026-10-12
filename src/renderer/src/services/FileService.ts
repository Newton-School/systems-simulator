import type { IFileService } from './FileService.types'
import { WebFileService } from './FileService.web'

export type { FileDialogOptions, FileLoadResult, FileSaveResult } from './FileService.types'

export const FileService: IFileService = WebFileService
