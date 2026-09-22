import { Gauge, Plus, Trash2 } from 'lucide-react'
import { RequiredIndicator } from './RequiredIndicator'
import { getRubricMetricCapability } from '../../../../engine/analysis/authoringCapabilities'
import type { CheckOp } from '../../../../engine/analysis/rubric'
import {
  AUTHORING_RUBRIC_METRIC_GROUPS,
  compileAuthoringRubricCheck,
  createAuthoringRubricCheck,
  type AuthoringRubricCheckAction,
  type AuthoringRubricCheckDraft
} from '../../../../engine/analysis/questionAuthoringRubricChecks'

interface RubricCheckEditorProps {
  checks: readonly AuthoringRubricCheckDraft[]
  onAction: (action: AuthoringRubricCheckAction) => void
  compact?: boolean
}

const OP_LABELS: Readonly<Record<CheckOp, string>> = {
  '<': '<  (below)',
  '<=': '≤  (at most)',
  '>': '>  (above)',
  '>=': '≥  (at least)',
  '==': '=  (equals)',
  '!=': '≠  (not equal)'
}

export function RubricCheckEditor({
  checks,
  onAction,
  compact = false
}: RubricCheckEditorProps): React.JSX.Element {
  return (
    <section
      className={
        compact
          ? 'bg-transparent'
          : 'rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm'
      }
      aria-labelledby="rubric-check-title"
    >
      {!compact && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
              Advanced behavior obligation
            </p>
            <h3 id="rubric-check-title" className="mt-1 text-base font-semibold text-nss-text">
              Verdict-metric grading
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
              Assert any engine verdict metric — per-node utilization, latency percentiles,
              invariant violations, reservation/lock/retry/rate-limit counters — as{' '}
              <code>metric op value</code>. Needs a workload from the Scenarios stage.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onAction({
                type: 'add',
                check: createAuthoringRubricCheck(undefined, `rubric-check-${checks.length + 1}`)
              })
            }
            className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
          >
            <Plus size={14} aria-hidden="true" />
            Add verdict check
          </button>
        </div>
      )}

      {checks.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-8 text-center">
          <Gauge size={23} className="mx-auto text-nss-muted" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No verdict checks yet</p>
          <p className="mt-1 text-[11px] leading-5 text-nss-muted">
            Add a utilization ceiling, an invariant-violation gate, or a capability counter.
          </p>
        </div>
      ) : (
        <ol className={compact ? 'space-y-2' : 'mt-5 space-y-4'}>
          {checks.map((check) => {
            const capability = getRubricMetricCapability(check.metric)
            const compiled = compileAuthoringRubricCheck(check)
            const prefix = `rubric-check-${check.id}`

            return (
              <li
                key={check.id}
                data-rubric-check-id={check.id}
                className={`rounded-lg border border-nss-border bg-nss-surface ${compact ? 'p-3' : 'p-4'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  {!compact && (
                    <span className="rounded-full border border-nss-border bg-nss-panel px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-muted">
                      {capability?.kind ?? 'metric'} evidence
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onAction({ type: 'remove', id: check.id })}
                    aria-label="Remove verdict check"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>

                <div
                  className={`mt-3 grid gap-3 sm:items-end ${
                    compact ? 'sm:grid-cols-[1fr_auto_auto]' : 'sm:grid-cols-[1fr_auto_auto_auto]'
                  }`}
                >
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                      Metric <RequiredIndicator />
                    </span>
                    <select
                      id={`${prefix}-metric`}
                      aria-label="Verdict metric"
                      value={check.metric}
                      required
                      onChange={(event) =>
                        onAction({
                          type: 'update-metric',
                          id: check.id,
                          metric: event.currentTarget.value
                        })
                      }
                      className="rounded-md border border-nss-primary/25 bg-nss-primary/10 px-2 py-1.5 text-xs font-semibold text-nss-primary outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    >
                      {AUTHORING_RUBRIC_METRIC_GROUPS.map((group) => (
                        <optgroup key={group.kind} label={group.label}>
                          {group.metrics.map((metric) => (
                            <option key={metric.id} value={metric.id}>
                              {metric.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                      Comparison <RequiredIndicator />
                    </span>
                    <select
                      id={`${prefix}-op`}
                      aria-label="Comparison"
                      value={check.op}
                      required
                      onChange={(event) =>
                        onAction({
                          type: 'update-op',
                          id: check.id,
                          op: event.currentTarget.value as CheckOp
                        })
                      }
                      className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    >
                      {(capability?.operators ?? []).map((op) => (
                        <option key={op} value={op}>
                          {OP_LABELS[op]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                      Value <RequiredIndicator />
                    </span>
                    <input
                      id={`${prefix}-value`}
                      aria-label="Target value"
                      type="number"
                      step="any"
                      value={check.value ?? ''}
                      required
                      onChange={(event) =>
                        onAction({
                          type: 'update-value',
                          id: check.id,
                          value:
                            event.currentTarget.value === ''
                              ? null
                              : event.currentTarget.valueAsNumber
                        })
                      }
                      className="w-24 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    />
                  </label>

                  {!compact && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                        Points <RequiredIndicator />
                      </span>
                      <input
                        id={`${prefix}-points`}
                        aria-label="Points"
                        type="number"
                        min="0"
                        step="1"
                        value={check.points ?? ''}
                        required
                        onChange={(event) =>
                          onAction({
                            type: 'update-points',
                            id: check.id,
                            points:
                              event.currentTarget.value === ''
                                ? null
                                : event.currentTarget.valueAsNumber
                          })
                        }
                        className="w-20 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                      />
                    </label>
                  )}
                </div>

                {!compact && (
                  <>
                    <label className="mt-3 flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                        Learner-facing description (optional)
                      </span>
                      <input
                        aria-label={`Learner-facing description for ${check.id}`}
                        value={check.description ?? ''}
                        placeholder="Leave blank to use the generated description"
                        onChange={(event) =>
                          onAction({
                            type: 'update-description',
                            id: check.id,
                            description: event.currentTarget.value
                          })
                        }
                        className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none placeholder:text-nss-muted/70 focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                      />
                    </label>
                    <div
                      className={`mt-4 rounded-md border px-3 py-2.5 ${
                        compiled
                          ? 'border-nss-primary/20 bg-nss-primary/5'
                          : 'border-nss-warning/30 bg-nss-warning/10'
                      }`}
                    >
                      <p
                        className={`text-[10px] font-semibold uppercase tracking-wide ${
                          compiled ? 'text-nss-primary' : 'text-nss-warning'
                        }`}
                      >
                        {compiled ? 'Compiled verdict check' : 'Check incomplete'}
                      </p>
                      <output className="mt-1 block text-xs leading-5 text-nss-text">
                        {compiled
                          ? `${compiled.description} ${compiled.metric} ${compiled.op} ${compiled.value} · ${compiled.points} pt`
                          : 'Choose a metric, comparison, and value.'}
                      </output>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
