import { Gauge, Plus, Trash2 } from 'lucide-react'
import {
  AUTHORING_NFR_CAPABILITIES,
  AUTHORING_NFR_UNIT_LABELS,
  authoringNfrValueError,
  createAuthoringNonFunctionalRequirement,
  formatAuthoringNfrDescription,
  getAuthoringNfrCapability,
  type AuthoringNfrMetric,
  type AuthoringNfrOperator,
  type AuthoringNfrUnit,
  type AuthoringNonFunctionalRequirement,
  type NonFunctionalRequirementAction
} from '../../../../engine/analysis/questionAuthoringNfr'
import { RequiredIndicator } from './RequiredIndicator'

interface NonFunctionalRequirementsEditorProps {
  requirements: readonly AuthoringNonFunctionalRequirement[]
  onAction: (action: NonFunctionalRequirementAction) => void
}

export function NonFunctionalRequirementsEditor({
  requirements,
  onAction
}: NonFunctionalRequirementsEditorProps): React.JSX.Element {
  return (
    <section
      className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
      aria-labelledby="non-functional-requirements-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Measurable targets
          </p>
          <h3
            id="non-functional-requirements-title"
            className="mt-1 text-base font-semibold text-nss-text"
          >
            Non-functional requirements
          </h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            Choose a metric and target in human units. The Studio keeps only valid operator and unit
            combinations available.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onAction({ type: 'add', requirement: createAuthoringNonFunctionalRequirement() })
          }
          className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
        >
          <Plus size={14} aria-hidden="true" />
          Add target
        </button>
      </div>

      {requirements.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-7 text-center">
          <Gauge size={22} className="mx-auto text-nss-muted" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No measurable targets yet</p>
          <p className="mt-1 text-[11px] leading-5 text-nss-muted">
            Add a latency, availability, error-rate, or throughput target.
          </p>
        </div>
      ) : (
        <ol className="mt-5 space-y-3">
          {requirements.map((requirement, index) => {
            const capability = getAuthoringNfrCapability(requirement.metric)
            const fieldPrefix = `non-functional-requirement-${index + 1}`
            const description = formatAuthoringNfrDescription(requirement)
            const valueError = authoringNfrValueError(requirement)

            return (
              <li
                key={requirement.id}
                data-nfr-id={requirement.id}
                className="rounded-lg border border-nss-border bg-nss-surface p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-nss-text">Target {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => onAction({ type: 'remove', id: requirement.id })}
                    aria-label={`Remove target ${index + 1}`}
                    className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(9rem,1.35fr)_minmax(6rem,0.7fr)_minmax(7rem,0.8fr)_minmax(9rem,1fr)]">
                  <label className="text-[11px] font-semibold text-nss-text">
                    Metric <RequiredIndicator />
                    <select
                      required
                      id={`${fieldPrefix}-metric`}
                      value={requirement.metric}
                      onChange={(event) =>
                        onAction({
                          type: 'update-metric',
                          id: requirement.id,
                          metric: event.currentTarget.value as AuthoringNfrMetric
                        })
                      }
                      className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    >
                      {AUTHORING_NFR_CAPABILITIES.map((choice) => (
                        <option key={choice.metric} value={choice.metric}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[11px] font-semibold text-nss-text">
                    Operator <RequiredIndicator />
                    <select
                      required
                      id={`${fieldPrefix}-operator`}
                      value={requirement.operator}
                      onChange={(event) =>
                        onAction({
                          type: 'update-operator',
                          id: requirement.id,
                          operator: event.currentTarget.value as AuthoringNfrOperator
                        })
                      }
                      className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    >
                      {capability.operators.map((operator) => (
                        <option key={operator} value={operator}>
                          {operator}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[11px] font-semibold text-nss-text">
                    Value <RequiredIndicator />
                    <input
                      required
                      id={`${fieldPrefix}-value`}
                      type="number"
                      min="0"
                      step="any"
                      value={requirement.value ?? ''}
                      onChange={(event) =>
                        onAction({
                          type: 'update-value',
                          id: requirement.id,
                          value:
                            event.currentTarget.value === ''
                              ? null
                              : event.currentTarget.valueAsNumber
                        })
                      }
                      aria-invalid={valueError ? 'true' : undefined}
                      aria-describedby={`${fieldPrefix}-feedback`}
                      className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    />
                  </label>

                  <label className="text-[11px] font-semibold text-nss-text">
                    Unit <RequiredIndicator />
                    <select
                      required
                      id={`${fieldPrefix}-unit`}
                      value={requirement.unit}
                      onChange={(event) =>
                        onAction({
                          type: 'update-unit',
                          id: requirement.id,
                          unit: event.currentTarget.value as AuthoringNfrUnit
                        })
                      }
                      disabled={capability.units.length === 1}
                      className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15 disabled:cursor-not-allowed disabled:opacity-65"
                    >
                      {capability.units.map((unit) => (
                        <option key={unit} value={unit}>
                          {AUTHORING_NFR_UNIT_LABELS[unit]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div
                  id={`${fieldPrefix}-feedback`}
                  className={`mt-3 rounded-md border px-3 py-2.5 ${
                    valueError
                      ? 'border-nss-danger/30 bg-nss-danger/10'
                      : 'border-nss-primary/20 bg-nss-primary/5'
                  }`}
                >
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      valueError ? 'text-nss-danger' : 'text-nss-primary'
                    }`}
                  >
                    {valueError ? 'Needs attention' : 'Generated learner sentence'}
                  </p>
                  <output
                    data-testid={`nfr-description-${index + 1}`}
                    className={`mt-1 block text-xs leading-5 ${
                      valueError ? 'text-nss-danger' : 'text-nss-text'
                    }`}
                  >
                    {valueError ?? description}
                  </output>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
