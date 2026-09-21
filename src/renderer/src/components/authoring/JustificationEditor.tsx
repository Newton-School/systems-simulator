import { MessageSquareText, Plus, Trash2 } from 'lucide-react'
import type { JustifyPrompt } from '../../../../engine/analysis/gradingCriteria'
import { AUTHORING_COMPONENT_CAPABILITIES } from '../../../../engine/analysis/authoringCapabilities'
import type { ComponentType } from '../../../../engine/core/types'

export function JustificationEditor({
  prompts,
  onChange
}: {
  prompts: readonly JustifyPrompt[]
  onChange: (prompts: JustifyPrompt[]) => void
}): React.JSX.Element {
  const patch = (index: number, changes: Partial<JustifyPrompt>): void =>
    onChange(
      prompts.map((prompt, current) => (current === index ? { ...prompt, ...changes } : prompt))
    )

  return (
    <section className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Reasoning obligation
          </p>
          <h3 className="mt-1 text-base font-semibold text-nss-text">Learner justifications</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
            Ask learners to defend a graph-bound decision, cite scale, and state its trade-off.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...prompts,
              {
                id: `justify-${prompts.length + 1}`,
                decision: '',
                requires: { choice: true, tradeoff: true },
                acceptTradeoffTokens: []
              }
            ])
          }
          className="flex items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white"
        >
          <Plus size={14} /> Add justification
        </button>
      </div>
      {prompts.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-8 text-center">
          <MessageSquareText size={22} className="mx-auto text-nss-muted" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No justification prompts</p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {prompts.map((prompt, index) => (
            <article
              key={`${prompt.id}-${index}`}
              className="rounded-lg border border-nss-border bg-nss-surface p-4"
            >
              <div className="flex justify-between gap-3">
                <div className="grid flex-1 gap-3 md:grid-cols-[0.7fr_1.5fr]">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                    ID
                    <input
                      value={prompt.id}
                      onChange={(event) => patch(index, { id: event.currentTarget.value })}
                      className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-2 font-mono text-xs font-normal text-nss-text"
                    />
                  </label>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                    Decision to defend
                    <input
                      value={prompt.decision}
                      onChange={(event) => patch(index, { decision: event.currentTarget.value })}
                      placeholder="Why did you choose this storage model?"
                      className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-2 text-xs font-normal text-nss-text"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  aria-label="Remove justification"
                  onClick={() => onChange(prompts.filter((_, current) => current !== index))}
                  className="flex h-8 w-8 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Bound node ID (optional)
                  <input
                    value={prompt.boundTo?.nodeId ?? ''}
                    onChange={(event) =>
                      patch(index, {
                        boundTo: {
                          ...prompt.boundTo,
                          nodeId: event.currentTarget.value || undefined
                        }
                      })
                    }
                    className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-2 font-mono text-xs font-normal text-nss-text"
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Bound component type (optional)
                  <select
                    value={prompt.boundTo?.componentType ?? ''}
                    onChange={(event) =>
                      patch(index, {
                        boundTo: {
                          ...prompt.boundTo,
                          componentType: (event.currentTarget.value || undefined) as
                            | ComponentType
                            | undefined
                        }
                      })
                    }
                    className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-2 text-xs font-normal text-nss-text"
                  >
                    <option value="">Any type</option>
                    {AUTHORING_COMPONENT_CAPABILITIES.map((component) => (
                      <option key={component.id} value={component.id}>
                        {component.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                {(
                  [
                    ['choice', 'Reference the chosen graph element'],
                    ['number', 'Cite a scale number'],
                    ['tradeoff', 'State a trade-off']
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-[11px] font-semibold text-nss-text"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(prompt.requires[key])}
                      onChange={(event) =>
                        patch(index, {
                          requires: { ...prompt.requires, [key]: event.currentTarget.checked }
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                Accepted trade-off terms
                <input
                  value={(prompt.acceptTradeoffTokens ?? []).join(', ')}
                  onChange={(event) =>
                    patch(index, {
                      acceptTradeoffTokens: event.currentTarget.value
                        .split(',')
                        .map((token) => token.trim())
                        .filter(Boolean)
                    })
                  }
                  placeholder="latency, consistency, cost"
                  className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-2 text-xs font-normal text-nss-text"
                />
              </label>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
