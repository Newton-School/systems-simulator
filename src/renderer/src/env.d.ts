/// <reference types="vite/client" />

interface NsSimulatorApi {
  saveScenario: (data: string) => Promise<string | boolean>
  loadScenario: () => Promise<{ data: string; path: string } | string | null>
  runSimulation: (config: any) => void
  confirmDiscard: () => Promise<boolean>
  onCloseRequest: (callback: () => boolean) => () => void
}

interface Window {
  nssimulator?: NsSimulatorApi
}
