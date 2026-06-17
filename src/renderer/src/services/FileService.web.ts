import type { FileLoadResult, FileSaveResult, IFileService } from './FileService.types'

type BrowserFileHandle = {
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (data: Blob | BufferSource | string) => Promise<void>
    close: () => Promise<void>
  }>
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
}

type BrowserFileWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean
    excludeAcceptAllOption?: boolean
    types?: Array<{ description?: string; accept: Record<string, string[]> }>
  }) => Promise<BrowserFileHandle[]>
  showSaveFilePicker?: (options?: {
    excludeAcceptAllOption?: boolean
    suggestedName?: string
    types?: Array<{ description?: string; accept: Record<string, string[]> }>
  }) => Promise<BrowserFileHandle>
}

const JSON_FILE_TYPES = [
  {
    description: 'JSON Files',
    accept: {
      'application/json': ['.json']
    }
  }
]

let activeFileHandle: BrowserFileHandle | null = null

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function normalizeFileName(fileName?: string | null): string {
  const trimmed = fileName?.trim()
  if (!trimmed || trimmed === 'Untitled') {
    return 'scenario.json'
  }

  return trimmed.toLowerCase().endsWith('.json') ? trimmed : `${trimmed}.json`
}

async function ensureWritePermission(handle: BrowserFileHandle): Promise<boolean> {
  const descriptor = { mode: 'readwrite' as const }

  if (handle.queryPermission) {
    const currentPermission = await handle.queryPermission(descriptor)
    if (currentPermission === 'granted') {
      return true
    }
  }

  if (handle.requestPermission) {
    return (await handle.requestPermission(descriptor)) === 'granted'
  }

  return true
}

async function writeToHandle(handle: BrowserFileHandle, content: string): Promise<FileSaveResult> {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
  activeFileHandle = handle
  return { name: handle.name }
}

function downloadFile(content: string, suggestedName?: string | null): FileSaveResult {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const name = normalizeFileName(suggestedName)

  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'

  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  activeFileHandle = null

  return { name }
}

async function loadWithInputFallback(): Promise<FileLoadResult | null> {
  return await new Promise<FileLoadResult | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'

    const cleanup = () => {
      window.removeEventListener('focus', handleWindowFocus)
      input.remove()
    }

    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (input.files?.length) {
          return
        }

        cleanup()
        activeFileHandle = null
        resolve(null)
      }, 0)
    }

    input.addEventListener(
      'change',
      async () => {
        const file = input.files?.[0]
        cleanup()
        activeFileHandle = null

        if (!file) {
          resolve(null)
          return
        }

        resolve({
          content: await file.text(),
          name: file.name
        })
      },
      { once: true }
    )

    document.body.appendChild(input)
    window.addEventListener('focus', handleWindowFocus, { once: true })
    input.click()
  })
}

export const WebFileService: IFileService = {
  save: async (content, suggestedName) => {
    try {
      if (activeFileHandle && (await ensureWritePermission(activeFileHandle))) {
        return await writeToHandle(activeFileHandle, content)
      }

      const browserWindow = window as BrowserFileWindow

      if (browserWindow.showSaveFilePicker) {
        const handle = await browserWindow.showSaveFilePicker({
          suggestedName: normalizeFileName(suggestedName),
          excludeAcceptAllOption: true,
          types: JSON_FILE_TYPES
        })

        return await writeToHandle(handle, content)
      }

      return downloadFile(content, suggestedName)
    } catch (error) {
      if (isAbortError(error)) {
        return null
      }

      console.error('[FileService] Save failed:', error)
      return null
    }
  },

  load: async () => {
    try {
      const browserWindow = window as BrowserFileWindow

      if (browserWindow.showOpenFilePicker) {
        const [handle] = await browserWindow.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: JSON_FILE_TYPES
        })

        if (!handle) {
          return null
        }

        const file = await handle.getFile()
        activeFileHandle = handle

        return {
          content: await file.text(),
          name: file.name
        }
      }

      return await loadWithInputFallback()
    } catch (error) {
      if (isAbortError(error)) {
        return null
      }

      console.error('[FileService] Load failed:', error)
      return null
    }
  }
}
