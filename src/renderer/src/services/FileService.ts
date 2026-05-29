type FilePickerFileHandle = FileSystemFileHandle

let activeFileHandle: FilePickerFileHandle | null = null

const JSON_FILE_TYPES = [
  {
    description: 'JSON Files',
    accept: {
      'application/json': ['.json']
    }
  }
]

function getSuggestedFileName(): string {
  return 'scenario.json'
}

function downloadFallback(content: string): string | null {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = getSuggestedFileName()
  link.style.display = 'none'

  document.body.append(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)

  return getSuggestedFileName()
}

async function saveWithExistingHandle(content: string): Promise<string | null> {
  if (!activeFileHandle) return null

  const writable = await activeFileHandle.createWritable()
  await writable.write(content)
  await writable.close()

  return activeFileHandle.name
}

async function saveWithPicker(content: string): Promise<string | null> {
  if (!('showSaveFilePicker' in window)) {
    return downloadFallback(content)
  }

  const handle = await window.showSaveFilePicker!({
    suggestedName: getSuggestedFileName(),
    types: JSON_FILE_TYPES
  })

  activeFileHandle = handle

  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()

  return handle.name
}

async function openWithPicker(): Promise<{ content: string; path?: string } | null> {
  if (!('showOpenFilePicker' in window)) {
    return openWithInputFallback()
  }

  const [handle] = await window.showOpenFilePicker!({
    multiple: false,
    types: JSON_FILE_TYPES
  })

  if (!handle) return null

  activeFileHandle = handle

  const file = await handle.getFile()
  const content = await file.text()

  return {
    content,
    path: file.name
  }
}

function openWithInputFallback(): Promise<{ content: string; path?: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'

    input.addEventListener(
      'change',
      async () => {
        const file = input.files?.[0]
        input.remove()

        if (!file) {
          resolve(null)
          return
        }

        const content = await file.text()
        activeFileHandle = null

        resolve({
          content,
          path: file.name
        })
      },
      { once: true }
    )

    document.body.append(input)
    input.click()
  })
}

export const FileService = {
  save: async (content: string): Promise<string | null> => {
    try {
      return (await saveWithExistingHandle(content)) ?? (await saveWithPicker(content))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null
      }

      console.error('[FileService] Save failed:', error)
      return null
    }
  },

  saveAs: async (content: string): Promise<string | null> => {
    try {
      return await saveWithPicker(content)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null
      }

      console.error('[FileService] Save As failed:', error)
      return null
    }
  },

  load: async (): Promise<{ content: string; path?: string } | null> => {
    try {
      return await openWithPicker()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null
      }

      console.error('[FileService] Load failed:', error)
      return null
    }
  }
}
