export type FileLoadResult = {
  content: string
  name: string
}

export type FileSaveResult = {
  name: string
}

export interface FileDialogOptions {
  dialogTitle?: string
  fileDescription?: string
  /** Always choose a new destination without replacing the active project file handle. */
  saveAsNewFile?: boolean
}

export interface IFileService {
  save(
    content: string,
    suggestedName?: string | null,
    options?: FileDialogOptions
  ): Promise<FileSaveResult | null>
  load(options?: FileDialogOptions): Promise<FileLoadResult | null>
  /** Stop subsequent saves from overwriting the last opened browser file. */
  forgetActiveFile?(): void
}
