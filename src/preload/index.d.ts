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
  gradeJustification: (request: any) => Promise<{ ok?: boolean; data?: any; error?: string }>
  getLlmGradingConfig: () => Promise<LlmGradingConfigStatus>
  setLlmGradingConfig: (
    providerId: 'gemini' | 'anthropic' | 'openai',
    apiKey: string
  ) => Promise<LlmGradingConfigStatus>
  clearSessionLlmGradingConfig: () => Promise<LlmGradingConfigStatus>
}

export interface LlmGradingConfigStatus {
  configured?: boolean
  providerId?: 'gemini' | 'anthropic' | 'openai'
  source?: 'session' | 'environment'
  error?: string
  ok?: boolean
}
