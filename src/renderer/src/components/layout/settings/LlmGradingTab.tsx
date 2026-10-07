import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { SectionLabel } from './SettingsControls'

type ProviderId = 'gemini' | 'anthropic' | 'openai'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI'
}

function providerLabel(providerId: ProviderId | undefined): string {
  return (providerId && PROVIDER_LABELS[providerId]) || 'Unknown provider'
}

export function LlmGradingTab(): React.JSX.Element {
  const [status, setStatus] = useState<LlmGradingConfigStatus | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let cancelled = false
    void fetch('/api/llm/grading-status')
      .then(async (response) => (response.ok ? response.json() : { configured: false }))
      .catch(() => ({ configured: false }))
      .then((value: LlmGradingConfigStatus) => {
        if (!cancelled) setStatus({ ...value, source: 'local-development' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const configuredDescription = status?.configured
    ? `${providerLabel(status.providerId)} is configured from your local development environment.`
    : 'No LLM key is configured. Justifications use deterministic grading only.'

  return (
    <div className="space-y-4">
      <div
        id="settings-llm-grading"
        tabIndex={-1}
        className="rounded-md border border-nss-border bg-nss-surface p-3"
      >
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

      <SectionLabel>Provider key</SectionLabel>

      <p className="rounded-md border border-nss-border bg-nss-surface p-3 text-[11px] leading-relaxed text-nss-muted">
        {import.meta.env.DEV
          ? 'Browser development uses the local Vite proxy. Set a provider key in .env.local or your shell, then restart npm run dev. The key stays in the Vite server and is never sent to the browser.'
          : 'The browser production build uses deterministic justification grading until the hosted grading API is available.'}
      </p>
    </div>
  )
}
