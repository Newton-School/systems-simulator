import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react'
import {
  createAuthoringFunctionalRequirement,
  type AuthoringFunctionalRequirement,
  type FunctionalRequirementAction
} from '../../../../engine/analysis/questionAuthoringRequirements'
import { RequiredIndicator } from './RequiredIndicator'

interface FunctionalRequirementsEditorProps {
  requirements: readonly AuthoringFunctionalRequirement[]
  onAction: (action: FunctionalRequirementAction) => void
}

export function FunctionalRequirementsEditor({
  requirements,
  onAction
}: FunctionalRequirementsEditorProps): React.JSX.Element {
  const addRequirement = () => {
    onAction({ type: 'add', requirement: createAuthoringFunctionalRequirement() })
  }

  return (
    <section
      className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
      aria-labelledby="functional-requirements-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Learner obligations
          </p>
          <h3
            id="functional-requirements-title"
            className="mt-1 text-base font-semibold text-nss-text"
          >
            Functional requirements
          </h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            Add one observable capability per card. Their visual order becomes learner order.
          </p>
        </div>
        <button
          type="button"
          onClick={addRequirement}
          className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
        >
          <Plus size={14} aria-hidden="true" />
          Add requirement
        </button>
      </div>

      {requirements.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-7 text-center">
          <ListChecks size={22} className="mx-auto text-nss-muted" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No functional requirements yet</p>
          <p className="mt-1 text-[11px] leading-5 text-nss-muted">
            Add the first capability the learner’s design must provide.
          </p>
        </div>
      ) : (
        <ol className="mt-5 space-y-3">
          {requirements.map((requirement, index) => {
            const inputId = `functional-requirement-${index + 1}`
            return (
              <li
                key={requirement.id}
                data-requirement-id={requirement.id}
                className="rounded-lg border border-nss-border bg-nss-surface p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={inputId} className="text-xs font-semibold text-nss-text">
                    Requirement {index + 1} <RequiredIndicator />
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onAction({ type: 'move', id: requirement.id, direction: 'up' })
                      }
                      disabled={index === 0}
                      aria-label={`Move requirement ${index + 1} up`}
                      title="Move up · Alt+ArrowUp"
                      className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:bg-nss-panel hover:text-nss-text disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowUp size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAction({ type: 'move', id: requirement.id, direction: 'down' })
                      }
                      disabled={index === requirements.length - 1}
                      aria-label={`Move requirement ${index + 1} down`}
                      title="Move down · Alt+ArrowDown"
                      className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:bg-nss-panel hover:text-nss-text disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowDown size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onAction({ type: 'remove', id: requirement.id })}
                      aria-label={`Remove requirement ${index + 1}`}
                      className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <textarea
                  id={inputId}
                  value={requirement.text}
                  onChange={(event) =>
                    onAction({
                      type: 'update',
                      id: requirement.id,
                      text: event.currentTarget.value
                    })
                  }
                  onKeyDown={(event) => {
                    if (!event.altKey) return
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    event.preventDefault()
                    onAction({
                      type: 'move',
                      id: requirement.id,
                      direction: event.key === 'ArrowUp' ? 'up' : 'down'
                    })
                  }}
                  rows={2}
                  placeholder="e.g. Redirect a short URL to its original destination"
                  required
                  className="mt-2 block w-full resize-y rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-sm leading-5 text-nss-text outline-none placeholder:text-nss-placeholder focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                />
                <p className="mt-1.5 text-[10px] text-nss-muted">
                  Reorder with Alt+ArrowUp / Alt+ArrowDown
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
