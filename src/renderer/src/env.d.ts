/// <reference types="vite/client" />

interface LlmGradingConfigStatus {
  configured?: boolean
  providerId?: 'gemini' | 'anthropic' | 'openai'
  source?: 'environment' | 'local-development'
  error?: string
  ok?: boolean
}
