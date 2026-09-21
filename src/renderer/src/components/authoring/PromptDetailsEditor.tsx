import type { ScaleParameters } from '../../../../engine/analysis/question'

const SCALE_FIELDS: Array<{ key: keyof ScaleParameters; label: string; suffix: string }> = [
  { key: 'dau', label: 'Daily active users', suffix: 'users' },
  { key: 'peakRps', label: 'Peak traffic', suffix: 'req/s' },
  { key: 'readWriteRatio', label: 'Read share', suffix: '%' },
  { key: 'storageGb', label: 'Stored data', suffix: 'GB' },
  { key: 'retentionDays', label: 'Retention', suffix: 'days' },
  { key: 'growthRatePercent', label: 'Growth rate', suffix: '%' }
]

export function PromptDetailsEditor({
  additionalContext,
  scale,
  onChange
}: {
  additionalContext?: string
  scale: ScaleParameters
  onChange: (details: { additionalContext?: string; scale: ScaleParameters }) => void
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-nss-text">Scale and additional context</h3>
      <p className="mt-1 text-xs leading-5 text-nss-muted">
        These values appear in the learner brief and remain available to grading and justification
        checks.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SCALE_FIELDS.map((field) => (
          <label key={field.key} className="text-[11px] font-semibold text-nss-text">
            {field.label}
            <div className="relative mt-1.5">
              <input
                type="number"
                min="0"
                max={field.key === 'readWriteRatio' ? 100 : undefined}
                step="any"
                value={scale[field.key] ?? ''}
                onChange={(event) =>
                  onChange({
                    additionalContext,
                    scale: {
                      ...scale,
                      [field.key]:
                        event.currentTarget.value === ''
                          ? undefined
                          : event.currentTarget.valueAsNumber
                    }
                  })
                }
                className="block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 pr-14 text-xs font-normal text-nss-text"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] text-nss-muted">
                {field.suffix}
              </span>
            </div>
          </label>
        ))}
      </div>
      <label className="mt-4 block text-[11px] font-semibold text-nss-text">
        Additional learner context
        <textarea
          rows={4}
          value={additionalContext ?? ''}
          onChange={(event) =>
            onChange({ scale, additionalContext: event.currentTarget.value || undefined })
          }
          className="mt-1.5 block w-full resize-y rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-xs font-normal leading-5 text-nss-text"
          placeholder="Constraints, assumptions, existing systems, or business context…"
        />
      </label>
    </section>
  )
}
