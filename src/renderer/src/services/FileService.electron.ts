import type { IFileService } from './FileService.types'

const extractFileName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath

export const ElectronFileService: IFileService = {
  save: async (content, suggestedName) => {
    try {
      void suggestedName
      const result = await window.nssimulator.saveScenario(content)
      if (typeof result === 'string') {
        return { name: extractFileName(result) }
      }
      return null
    } catch (error) {
      console.error('[FileService] Save failed:', error)
      return null
    }
  },

  load: async () => {
    try {
      const result = await window.nssimulator.loadScenario()
      if (!result) return null

      if (typeof result === 'string') {
        return { content: result, name: 'scenario.json' }
      }

      return {
        content: result.data,
        name: result.path ? extractFileName(result.path) : 'scenario.json'
      }
    } catch (error) {
      console.error('[FileService] Load failed:', error)
      return null
    }
  }
}
