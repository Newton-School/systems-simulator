import type {
  FileDialogOptions,
  FileLoadResult,
  FileSaveResult,
  IFileService
} from './FileService.types'

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

function jsonFileTypes(options?: FileDialogOptions) {
  return [
    {
      description: options?.fileDescription ?? 'JSON Files',
      accept: {
        'application/json': ['.json']
      }
    }
  ]
}

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

async function writeToHandle(
  handle: BrowserFileHandle,
  content: string,
  rememberHandle = true
): Promise<FileSaveResult> {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
  if (rememberHandle) activeFileHandle = handle
  return { name: handle.name }
}

function downloadFile(
  content: string,
  suggestedName?: string | null,
  clearActiveHandle = true
): FileSaveResult {
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
  if (clearActiveHandle) activeFileHandle = null

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
  save: async (content, suggestedName, options) => {
    try {
      const saveAsNewFile = options?.saveAsNewFile === true
      if (!saveAsNewFile && activeFileHandle && (await ensureWritePermission(activeFileHandle))) {
        return await writeToHandle(activeFileHandle, content)
      }

      const browserWindow = window as BrowserFileWindow

      if (browserWindow.showSaveFilePicker) {
        try {
          const handle = await browserWindow.showSaveFilePicker({
            suggestedName: normalizeFileName(suggestedName),
            excludeAcceptAllOption: true,
            types: jsonFileTypes(options)
          })

          return await writeToHandle(handle, content, !saveAsNewFile)
        } catch (error) {
          // The user cancelling the picker is a no-op, not a failure.
          if (isAbortError(error)) return null
          // The picker can be unavailable even when the API exists — e.g. when
          // the app runs in a cross-origin iframe or the browser blocks it. Fall
          // back to a plain download so the file is always delivered.
          console.warn('[FileService] Save picker unavailable, using download fallback:', error)
        }
      }

      return downloadFile(content, suggestedName, !saveAsNewFile)
    } catch (error) {
      if (isAbortError(error)) {
        return null
      }

      console.error('[FileService] Save failed:', error)
      return null
    }
  },

  load: async (options) => {
    try {
      const browserWindow = window as BrowserFileWindow

      if (browserWindow.showOpenFilePicker) {
        const [handle] = await browserWindow.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: jsonFileTypes(options)
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
  },

  forgetActiveFile: () => {
    activeFileHandle = null
  }
}
