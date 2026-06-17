import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  saveScenario: (jsonString: string) => {
    // Validate that data is a non-empty string and not excessively long
    if (typeof jsonString !== 'string') {
      console.error('saveScenario: data must be a string')
      return
    }
    if (jsonString.length === 0) {
      console.error('saveScenario: data must not be empty')
      return
    }
    if (jsonString.length > 1000000) {
      console.error('saveScenario: data is too large')
      return
    }
    return ipcRenderer.invoke('dialog:save', jsonString).catch((error) => {
      console.error('Error in saveScenario:', error)
      throw error
    })
  },

  loadScenario: () =>
    ipcRenderer.invoke('dialog:open').catch((error) => {
      console.error('Error in loadScenario:', error)
      throw error
    }),

  confirmDiscard: () =>
    ipcRenderer.invoke('dialog:confirm-discard').catch((error) => {
      console.error('Error in confirmDiscard:', error)
      throw error
    }),

  onCloseRequest: (callback: () => boolean) => {
    const handler = () => {
      const isUnsaved = callback()
      ipcRenderer.send('window-close-response', isUnsaved)
    }
    ipcRenderer.on('window-close-attempt', handler)
    return () => {
      ipcRenderer.removeListener('window-close-attempt', handler)
    }
  },

  runSimulation: (config: any) => ipcRenderer.send('nssimulator:run-simulation', config)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('nssimulator', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
