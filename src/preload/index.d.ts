import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    nssimulator?: NsSimulatorApi
    api?: NsSimulatorApi
  }
}

export interface NsSimulatorApi {
  saveScenario: (data: string) => Promise<string | boolean>
  loadScenario: () => Promise<{ data: string; path: string } | null>
  runSimulation: (config: any) => void
  confirmDiscard: () => Promise<boolean>
  onCloseRequest: (callback: () => boolean) => () => void
}
