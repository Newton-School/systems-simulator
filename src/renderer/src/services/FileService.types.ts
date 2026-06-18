export type FileLoadResult = {
  content: string
  name: string
}

export type FileSaveResult = {
  name: string
}

export interface IFileService {
  save(content: string, suggestedName?: string | null): Promise<FileSaveResult | null>
  load(): Promise<FileLoadResult | null>
}
