import { Activity, Plus, Trash2 } from 'lucide-react'
import {
  AUTHORING_METRIC_RULE_CAPABILITIES,
  AUTHORING_METRIC_RULE_OPERATOR_LABELS,
  authoringMetricRuleValueError,
  compileAuthoringMetricRule,
  createAuthoringMetricRule,
  getAuthoringMetricRuleCapability,
  type AuthoringMetricRuleAction,
  type AuthoringMetricRuleDraft,
  type AuthoringMetricRuleMetric
} from '../../../../engine/analysis/questionAuthoringMetricRules'
import {
  formatAuthoringNfrDescription,
  type AuthoringNfrOperator,
  type AuthoringNfrUnit
} from '../../../../engine/analysis/questionAuthoringNfr'

interface MetricGradingEditorProps {
  rules: readonly AuthoringMetricRuleDraft[]
  onAction: (action: AuthoringMetricRuleAction) => void
  compact?: boolean
}

const UNIT_SYMBOLS: Readonly<Record<AuthoringNfrUnit, string>> = {
  ms: 'ms',
  percent: '%',
  req_per_sec: 'req/s',
  nines: 'nines'
}

export function MetricGradingEditor({
  rules,
  onAction,
  compact = false
}: MetricGradingEditorProps): React.JSX.Element {
  const canAddRule = rules.length === 0

  return (
    <section
      className={
        compact
          ? 'bg-transparent'
          : 'rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm'
      }
      aria-labelledby="metric-grading-title"
    >
      {!compact && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
              Measured obligation
            </p>
            <h3 id="metric-grading-title" className="mt-1 text-base font-semibold text-nss-text">
              Runtime metric grading
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
              Build a simulation check in human units. The Studio converts it to the engine’s exact
              metric selector and stored value.
            </p>
          </div>
          <button
            type="button"
            disabled={!canAddRule}
            onClick={() => onAction({ type: 'add', rule: createAuthoringMetricRule() })}
            className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} aria-hidden="true" />
            {canAddRule ? 'Add metric test' : 'Metric test added'}
          </button>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-8 text-center">
          <Activity size={23} className="mx-auto text-nss-muted" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No metric tests yet</p>
          <p className="mt-1 text-[11px] leading-5 text-nss-muted">
            Add a P99 latency, error-rate, or throughput threshold.
          </p>
        </div>
      ) : (
        <ol className={compact ? 'space-y-2' : 'mt-5 space-y-4'}>
          {rules.map((rule) => {
            const capability = getAuthoringMetricRuleCapability(rule.metric)
            const compiled = compileAuthoringMetricRule(rule)
            const valueError = authoringMetricRuleValueError(rule)
            const description = formatAuthoringNfrDescription(rule)
            const fieldPrefix = `metric-rule-${rule.id}`

            return (
              <li
                key={rule.id}
                data-metric-rule-id={rule.id}
                className={`rounded-lg border border-nss-border bg-nss-surface ${compact ? 'p-3' : 'p-4'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  {!compact && (
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold text-nss-text">Simulation threshold</p>
                        <span className="rounded-full border border-nss-success/25 bg-nss-success/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-success">
                          First-class
                        </span>
                        <span className="rounded-full border border-nss-border bg-nss-panel px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-muted">
                          Discrete + analytic evidence
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-nss-warning">
                        Contract authored · empirical proof still pending
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onAction({ type: 'remove', id: rule.id })}
                    aria-label="Remove metric test"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>

                <div
                  className={`${compact ? 'mt-3 px-1 pb-1' : 'mt-4 rounded-lg border border-nss-borderHigh bg-nss-panel px-4 py-4'}`}
                >
                  {!compact && (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                      Controlled sentence
                    </p>
                  )}
                  <div
                    className={`${compact ? '' : 'mt-2'} flex flex-wrap items-center gap-2 text-sm text-nss-text`}
                  >
                    <label>
                      <span className="sr-only">Metric</span>
                      <select
                        id={`${fieldPrefix}-metric`}
                        aria-label="Metric"
                        required
                        value={rule.metric}
                        onChange={(event) =>
                          onAction({
                            type: 'update-metric',
                            id: rule.id,
                            metric: event.currentTarget.value as AuthoringMetricRuleMetric
                          })
                        }
                        className="rounded-md border border-nss-primary/25 bg-nss-primary/10 px-2 py-1.5 text-xs font-semibold text-nss-primary outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                      >
                        {AUTHORING_METRIC_RULE_CAPABILITIES.map((choice) => (
                          <option key={choice.metric} value={choice.metric}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="sr-only">Comparison</span>
                      <select
                        id={`${fieldPrefix}-operator`}
                        aria-label="Comparison"
                        required
                        value={rule.operator}
                        onChange={(event) =>
                          onAction({
                            type: 'update-operator',
                            id: rule.id,
                            operator: event.currentTarget.value as AuthoringNfrOperator
                          })
                        }
                        className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                      >
                        {capability.operators.map((operator) => (
                          <option key={operator} value={operator}>
                            {AUTHORING_METRIC_RULE_OPERATOR_LABELS[operator]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="sr-only">Target value</span>
                      <input
                        id={`${fieldPrefix}-value`}
                        aria-label="Target value"
                        required
                        type="number"
                        min="0"
                        step="any"
                        value={rule.value ?? ''}
                        onChange={(event) =>
                          onAction({
                            type: 'update-value',
                            id: rule.id,
                            value:
                              event.currentTarget.value === ''
                                ? null
                                : event.currentTarget.valueAsNumber
                          })
                        }
                        aria-invalid={valueError ? 'true' : undefined}
                        aria-describedby={`${fieldPrefix}-feedback`}
                        className="w-24 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                      />
                    </label>
                    <span className="rounded-md border border-nss-border bg-nss-surface px-2 py-1 font-semibold">
                      {UNIT_SYMBOLS[rule.unit]}
                    </span>
                  </div>
                  {!compact && (
                    <p className="mt-3 text-[11px] leading-5 text-nss-muted">
                      Evaluated independently for every scenario. A scenario fails when its measured
                      value misses this threshold.
                    </p>
                  )}
                </div>

                {!compact && (
                  <div
                    id={`${fieldPrefix}-feedback`}
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
                      {compiled ? 'Compiled metric meaning' : 'Rule incomplete'}
                    </p>
                    <output className="mt-1 block text-xs leading-5 text-nss-text">
                      {compiled
                        ? `${description} Runtime check: ${compiled.metric} ${compiled.op} ${compiled.value}.`
                        : (valueError ??
                          'Complete the highlighted field before this rule can grade a run.')}
                    </output>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
