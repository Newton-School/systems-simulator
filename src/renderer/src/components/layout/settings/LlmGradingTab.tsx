import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { SectionLabel, SelectField } from './SettingsControls'

type ProviderId = 'gemini' | 'anthropic' | 'openai'

const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI' }
] as const

function providerLabel(providerId: ProviderId | undefined): string {
  return (
    PROVIDER_OPTIONS.find((provider) => provider.value === providerId)?.label ?? 'Unknown provider'
  )
}

export function LlmGradingTab(): React.JSX.Element {
  const [providerId, setProviderId] = useState<ProviderId>('openai')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<LlmGradingConfigStatus | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const reloadStatus = async (): Promise<void> => {
    const nextStatus =
      typeof window.nssimulator?.getLlmGradingConfig === 'function'
        ? await window.nssimulator.getLlmGradingConfig()
        : import.meta.env.DEV
          ? await fetch('/api/llm/grading-status')
              .then(async (response) => (response.ok ? response.json() : { configured: false }))
              .then((value) => ({ ...value, source: 'local-development' as const }))
              .catch(() => ({ configured: false, source: 'local-development' as const }))
          : null
    if (!nextStatus) return
    setStatus(nextStatus)
    if (nextStatus.providerId) setProviderId(nextStatus.providerId)
  }

  useEffect(() => {
    void reloadStatus()
  }, [])

  const save = async (): Promise<void> => {
    if (!apiKey.trim() || typeof window.nssimulator?.setLlmGradingConfig !== 'function') return
    setIsSaving(true)
    try {
      const nextStatus = await window.nssimulator.setLlmGradingConfig(providerId, apiKey)
      setStatus(nextStatus)
      if (nextStatus.ok) setApiKey('')
    } finally {
      setIsSaving(false)
    }
  }

  const clearSessionKey = async (): Promise<void> => {
    if (typeof window.nssimulator?.clearSessionLlmGradingConfig !== 'function') return
    setIsSaving(true)
    try {
      setStatus(await window.nssimulator.clearSessionLlmGradingConfig())
    } finally {
      setIsSaving(false)
    }
  }

  const electronAvailable = typeof window.nssimulator?.setLlmGradingConfig === 'function'
  const configuredDescription = status?.configured
    ? `${providerLabel(status.providerId)} is configured from ${status.source === 'session' ? 'this app session' : status.source === 'local-development' ? 'your local development environment' : 'environment variables'}.`
    : 'No LLM key is configured. Justifications use deterministic grading only.'

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-nss-border bg-nss-surface p-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-nss-text">
          <KeyRound size={15} className="text-nss-primary" aria-hidden="true" />
          Justification grading
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
          Test semantic LLM grading without saving a key to a scenario or display settings.
        </p>
      </div>

      <div className="rounded-md border border-nss-border px-3 py-2.5 text-[11px] text-nss-muted">
        <span className={status?.configured ? 'text-nss-success' : 'text-nss-muted'}>
          {status?.configured ? 'Configured' : 'Not configured'}
        </span>
        <span> · {configuredDescription}</span>
      </div>

      <SectionLabel>Session key</SectionLabel>

      {!electronAvailable ? (
        <p className="rounded-md border border-nss-border bg-nss-surface p-3 text-[11px] leading-relaxed text-nss-muted">
          {import.meta.env.DEV
            ? 'Browser development uses the local Vite proxy. Set a provider key in .env.local or your shell, then restart npm run dev. The key stays in the Vite server and is never sent to the browser.'
            : 'The browser production build uses deterministic justification grading until the hosted grading API is available.'}
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-nss-text">Provider</span>
            <SelectField
              value={providerId}
              options={[...PROVIDER_OPTIONS]}
              onChange={(nextProviderId) => setProviderId(nextProviderId as ProviderId)}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-nss-text">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste a key for this session"
              autoComplete="off"
              className="w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text placeholder-nss-placeholder focus:border-nss-info focus:outline-none focus:ring-1 focus:ring-nss-info"
            />
          </label>

          {status?.error && <p className="text-[11px] text-nss-danger">{status.error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving || !apiKey.trim()}
              onClick={() => void save()}
              className="rounded bg-nss-primary px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-nss-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Use key for this session'}
            </button>
            {status?.source === 'session' && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void clearSessionKey()}
                className="rounded px-2 py-1.5 text-[11px] font-medium text-nss-muted transition-colors hover:bg-nss-surface hover:text-nss-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear session key
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
