import type { IFileService } from './FileService.types'

const extractFileName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath

export const ElectronFileService: IFileService = {
  save: async (content, suggestedName, options) => {
    try {
      const result = await window.nssimulator.saveScenario(content, {
        title: options?.dialogTitle,
        suggestedName: suggestedName ?? undefined,
        fileDescription: options?.fileDescription
      })
      if (typeof result === 'string') {
        return { name: extractFileName(result) }
      }
      return null
    } catch (error) {
      console.error('[FileService] Save failed:', error)
      return null
    }
  },

  load: async (options) => {
    try {
      const result = await window.nssimulator.loadScenario({
        title: options?.dialogTitle,
        fileDescription: options?.fileDescription
      })
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
