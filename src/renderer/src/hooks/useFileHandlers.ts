import { useCallback } from 'react'
import { FileService } from '../services/FileService'

export const useFileHandlers = (
  onSaveRequested: () => string,
  onDataLoaded: (data: any, fileName?: string) => void
) => {
  const handleSave = useCallback(
    async (suggestedName?: string | null) => {
      const content = onSaveRequested()

      const savedFile = await FileService.save(content, suggestedName)

      if (savedFile) {
        console.log(`Saved to: ${savedFile.name}`)
      }

      return savedFile
    },
    [onSaveRequested]
  )

  const handleOpen = useCallback(async () => {
    const file = await FileService.load()

    if (!file?.content) return

    try {
      const parsedData = JSON.parse(file.content)
      onDataLoaded(parsedData, file.name)
    } catch (err) {
      console.error('[useFileHandlers] Failed to parse JSON content', err)
    }
  }, [onDataLoaded])

  return { handleSave, handleOpen }
}
