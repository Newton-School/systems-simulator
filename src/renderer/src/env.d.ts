/// <reference types="vite/client" />

interface NsSimulatorApi {
  saveScenario: (data: string) => Promise<string | boolean>
  loadScenario: () => Promise<{ data: string; path: string } | string | null>
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

interface LlmGradingConfigStatus {
  configured?: boolean
  providerId?: 'gemini' | 'anthropic' | 'openai'
  source?: 'session' | 'environment'
  error?: string
  ok?: boolean
}

interface Window {
  nssimulator?: NsSimulatorApi
}
