import type { IFileService } from './FileService.types'
import { ElectronFileService } from './FileService.electron'
import { WebFileService } from './FileService.web'

export type { FileLoadResult, FileSaveResult } from './FileService.types'

const isElectron =
  typeof window !== 'undefined' &&
  'nssimulator' in window &&
  typeof (window as any).nssimulator?.saveScenario === 'function'

export const FileService: IFileService = isElectron ? ElectronFileService : WebFileService
