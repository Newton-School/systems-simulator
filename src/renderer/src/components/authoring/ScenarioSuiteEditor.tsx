import { Activity, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react'
import {
  authoringScenarioFieldErrors,
  createAuthoringFault,
  createAuthoringScenario,
  formatAuthoringScenarioSummary,
  type AuthoringScenarioAction,
  type AuthoringScenarioDraft
} from '../../../../engine/analysis/questionAuthoringScenario'
import { RequiredIndicator } from './RequiredIndicator'

const WORKLOAD_PATTERNS: Array<{ value: AuthoringScenarioDraft['pattern']; label: string }> = [
  { value: 'constant', label: 'Constant' },
  { value: 'poisson', label: 'Poisson arrivals' },
  { value: 'bursty', label: 'Recurring bursts' },
  { value: 'spike', label: 'Single spike' },
  { value: 'sawtooth', label: 'Sawtooth ramp' },
  { value: 'diurnal', label: 'Daily curve' },
  { value: 'replay', label: 'Replay-compatible' }
]

interface ScenarioSuiteEditorProps {
  scenarios: readonly AuthoringScenarioDraft[]
  dryRunScenarioId?: string
  onAction: (action: AuthoringScenarioAction) => void
  onDryRunChange?: (scenarioId: string | undefined) => void
}

type NumberField =
  | 'durationSeconds'
  | 'warmupSeconds'
  | 'baseRps'
  | 'readPercent'
  | 'requestSizeBytes'

interface ScenarioNumberInputProps {
  scenario: AuthoringScenarioDraft
  field: NumberField
  label: string
  suffix: string
  min: number
  max?: number
  error?: string
  onAction: (action: AuthoringScenarioAction) => void
}

function ScenarioNumberInput({
  scenario,
  field,
  label,
  suffix,
  min,
  max,
  error,
  onAction
}: ScenarioNumberInputProps): React.JSX.Element {
  const inputId = `scenario-${scenario.id}-${field}`
  const errorId = `${inputId}-error`
  return (
    <label className="text-[11px] font-semibold text-nss-text">
      {label} <RequiredIndicator />
      <div className="relative mt-1.5">
        <input
          id={inputId}
          type="number"
          min={min}
          max={max}
          step="any"
          value={scenario[field] ?? ''}
          onChange={(event) =>
            onAction({
              type: 'update-number',
              id: scenario.id,
              field,
              value: event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber
            })
          }
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          required
          className="block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 pr-12 text-xs font-normal tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] font-normal text-nss-muted">
          {suffix}
        </span>
      </div>
      {error && (
        <span id={errorId} className="mt-1 block text-[10px] font-normal text-nss-danger">
          {error}
        </span>
      )}
    </label>
  )
}

function DraftNumberInput({
  label,
  suffix,
  value,
  min = 0,
  required = false,
  onChange
}: {
  label: string
  suffix: string
  value: number | null | undefined
  min?: number
  required?: boolean
  onChange: (value: number | null) => void
}): React.JSX.Element {
  return (
    <label className="text-[11px] font-semibold text-nss-text">
      {label} {required && <RequiredIndicator />}
      <div className="relative mt-1.5">
        <input
          type="number"
          min={min}
          step="any"
          value={value ?? ''}
          required={required}
          onChange={(event) =>
            onChange(event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber)
          }
          className="block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 pr-12 text-xs font-normal tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] font-normal text-nss-muted">
          {suffix}
        </span>
      </div>
    </label>
  )
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function parseStructuredValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

export function ScenarioSuiteEditor({
  scenarios,
  dryRunScenarioId,
  onAction,
  onDryRunChange = () => undefined
}: ScenarioSuiteEditorProps): React.JSX.Element {
  const nextScenarioId = (() => {
    if (scenarios.length === 0) return 'baseline'
    let index = 2
    while (scenarios.some((scenario) => scenario.id === `scenario-${index}`)) index += 1
    return `scenario-${index}`
  })()

  return (
    <section
      className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
      aria-labelledby="scenario-suite-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Deterministic baseline
          </p>
          <h3 id="scenario-suite-title" className="mt-1 text-base font-semibold text-nss-text">
            Grading scenario
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
            Define one repeatable grading run, including traffic shape, contended keys, and
            deterministic failures. Human units compile to the simulator contract.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onAction({ type: 'add', scenario: createAuthoringScenario(nextScenarioId) })
          }
          className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
        >
          <Plus size={14} aria-hidden="true" />
          {scenarios.length === 0 ? 'Add baseline' : 'Add scenario'}
        </button>
      </div>

      {scenarios.length > 0 && (
        <label className="mt-4 flex max-w-md flex-col gap-1 text-[11px] font-semibold text-nss-text">
          Learner-visible dry run
          <select
            value={dryRunScenarioId ?? ''}
            onChange={(event) => onDryRunChange(event.currentTarget.value || undefined)}
            className="rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          >
            <option value="">No dry run</option>
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.id} — {scenario.description || 'Untitled scenario'}
              </option>
            ))}
          </select>
          <span className="font-normal text-nss-muted">
            The selected case is exposed to learners for practice; all cases still grade
            submissions.
          </span>
        </label>
      )}

      {scenarios.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-8 text-center">
          <Activity size={23} className="mx-auto text-nss-muted" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No grading scenario yet</p>
          <p className="mt-1 text-[11px] leading-5 text-nss-muted">
            Add the repeatable baseline every learner design will run against.
          </p>
        </div>
      ) : (
        <ol className="mt-5 space-y-4">
          {scenarios.map((scenario) => {
            const errors = authoringScenarioFieldErrors(scenario)
            const summary = formatAuthoringScenarioSummary(scenario)
            const descriptionId = `scenario-${scenario.id}-description`
            const seedId = `scenario-${scenario.id}-seed`

            return (
              <li
                key={scenario.id}
                data-scenario-id={scenario.id}
                className="rounded-lg border border-nss-border bg-nss-surface p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-nss-text">
                      {scenario.id === 'baseline'
                        ? 'Baseline scenario'
                        : `Scenario ${scenario.id.split('-').at(-1)}`}
                    </p>
                    <span className="rounded-full border border-nss-primary/20 bg-nss-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-primary">
                      {scenario.pattern}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAction({ type: 'remove', id: scenario.id })}
                    aria-label="Remove baseline scenario"
                    className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-[11px] font-semibold text-nss-text">
                    What this scenario tests <RequiredIndicator />
                    <input
                      id={descriptionId}
                      type="text"
                      value={scenario.description}
                      onChange={(event) =>
                        onAction({
                          type: 'update-text',
                          id: scenario.id,
                          field: 'description',
                          value: event.currentTarget.value
                        })
                      }
                      aria-invalid={errors.description ? 'true' : undefined}
                      aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
                      required
                      className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text outline-none placeholder:text-nss-placeholder focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    />
                    {errors.description && (
                      <span
                        id={`${descriptionId}-error`}
                        className="mt-1 block text-[10px] font-normal text-nss-danger"
                      >
                        {errors.description}
                      </span>
                    )}
                  </label>

                  <label className="text-[11px] font-semibold text-nss-text">
                    Fixed seed <RequiredIndicator />
                    <input
                      id={seedId}
                      type="text"
                      value={scenario.seed}
                      onChange={(event) =>
                        onAction({
                          type: 'update-text',
                          id: scenario.id,
                          field: 'seed',
                          value: event.currentTarget.value
                        })
                      }
                      aria-invalid={errors.seed ? 'true' : undefined}
                      aria-describedby={errors.seed ? `${seedId}-error` : `${seedId}-help`}
                      required
                      className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 font-mono text-xs font-normal text-nss-text outline-none placeholder:text-nss-placeholder focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    />
                    <span
                      id={errors.seed ? `${seedId}-error` : `${seedId}-help`}
                      className={`mt-1 block text-[10px] font-normal ${errors.seed ? 'text-nss-danger' : 'text-nss-muted'}`}
                    >
                      {errors.seed ?? 'The same seed reproduces the same request sequence.'}
                    </span>
                  </label>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-[11px] font-semibold text-nss-text">
                    Traffic pattern <RequiredIndicator />
                    <select
                      required
                      value={scenario.pattern}
                      onChange={(event) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: {
                            pattern: event.currentTarget.value as AuthoringScenarioDraft['pattern']
                          }
                        })
                      }
                      className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                    >
                      {WORKLOAD_PATTERNS.map((pattern) => (
                        <option key={pattern.value} value={pattern.value}>
                          {pattern.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="rounded-md border border-nss-border bg-nss-panel px-3 py-2.5 text-[11px] leading-5 text-nss-muted">
                    The selected pattern and its controls are exported directly into every learner
                    evaluation run.
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <ScenarioNumberInput
                    scenario={scenario}
                    field="durationSeconds"
                    label="Run duration"
                    suffix="sec"
                    min={0.001}
                    error={errors.durationSeconds}
                    onAction={onAction}
                  />
                  <ScenarioNumberInput
                    scenario={scenario}
                    field="warmupSeconds"
                    label="Warmup"
                    suffix="sec"
                    min={0}
                    error={errors.warmupSeconds}
                    onAction={onAction}
                  />
                  <ScenarioNumberInput
                    scenario={scenario}
                    field="baseRps"
                    label="Base traffic"
                    suffix="req/s"
                    min={0.001}
                    error={errors.baseRps}
                    onAction={onAction}
                  />
                  <ScenarioNumberInput
                    scenario={scenario}
                    field="readPercent"
                    label="Read traffic"
                    suffix="%"
                    min={0}
                    max={100}
                    error={errors.readPercent}
                    onAction={onAction}
                  />
                  <ScenarioNumberInput
                    scenario={scenario}
                    field="requestSizeBytes"
                    label="Request size"
                    suffix="bytes"
                    min={1}
                    error={errors.requestSizeBytes}
                    onAction={onAction}
                  />
                </div>

                {scenario.pattern === 'bursty' && (
                  <div className="mt-4 grid gap-3 rounded-md border border-nss-border bg-nss-panel p-3 sm:grid-cols-3">
                    <DraftNumberInput
                      label="Burst traffic"
                      required
                      suffix="req/s"
                      min={0.001}
                      value={scenario.burstRps}
                      onChange={(value) =>
                        onAction({ type: 'update', id: scenario.id, changes: { burstRps: value } })
                      }
                    />
                    <DraftNumberInput
                      label="Burst duration"
                      required
                      suffix="sec"
                      min={0.001}
                      value={scenario.burstDurationSeconds}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { burstDurationSeconds: value }
                        })
                      }
                    />
                    <DraftNumberInput
                      label="Normal duration"
                      required
                      suffix="sec"
                      min={0.001}
                      value={scenario.normalDurationSeconds}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { normalDurationSeconds: value }
                        })
                      }
                    />
                  </div>
                )}
                {scenario.pattern === 'spike' && (
                  <div className="mt-4 grid gap-3 rounded-md border border-nss-border bg-nss-panel p-3 sm:grid-cols-3">
                    <DraftNumberInput
                      label="Spike starts"
                      required
                      suffix="sec"
                      value={scenario.spikeTimeSeconds}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { spikeTimeSeconds: value }
                        })
                      }
                    />
                    <DraftNumberInput
                      label="Spike traffic"
                      required
                      suffix="req/s"
                      min={0.001}
                      value={scenario.spikeRps}
                      onChange={(value) =>
                        onAction({ type: 'update', id: scenario.id, changes: { spikeRps: value } })
                      }
                    />
                    <DraftNumberInput
                      label="Spike duration"
                      required
                      suffix="sec"
                      min={0.001}
                      value={scenario.spikeDurationSeconds}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { spikeDurationSeconds: value }
                        })
                      }
                    />
                  </div>
                )}
                {scenario.pattern === 'sawtooth' && (
                  <div className="mt-4 grid gap-3 rounded-md border border-nss-border bg-nss-panel p-3 sm:grid-cols-2">
                    <DraftNumberInput
                      label="Peak traffic"
                      required
                      suffix="req/s"
                      min={0.001}
                      value={scenario.sawtoothPeakRps}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { sawtoothPeakRps: value }
                        })
                      }
                    />
                    <DraftNumberInput
                      label="Ramp duration"
                      required
                      suffix="sec"
                      min={0.001}
                      value={scenario.rampDurationSeconds}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { rampDurationSeconds: value }
                        })
                      }
                    />
                  </div>
                )}
                {scenario.pattern === 'diurnal' && (
                  <div className="mt-4 rounded-md border border-nss-border bg-nss-panel p-3">
                    <DraftNumberInput
                      label="Daily peak multiplier"
                      required
                      suffix="× base"
                      min={1}
                      value={scenario.diurnalPeakMultiplier}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { diurnalPeakMultiplier: value }
                        })
                      }
                    />
                  </div>
                )}

                {!scenario.requestDistribution && (
                  <div className="mt-4 rounded-lg border border-nss-border bg-nss-panel p-4">
                    <div>
                      <p className="text-xs font-semibold text-nss-text">
                        Contended keyspace{' '}
                        <span className="font-normal text-nss-muted">(optional)</span>
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-nss-muted">
                        Use this to model hot products, seats, accounts, or cache keys.
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className="text-[11px] font-semibold text-nss-text">
                        Metadata field
                        <input
                          type="text"
                          placeholder="seatId"
                          value={scenario.keyspaceField ?? ''}
                          onChange={(event) =>
                            onAction({
                              type: 'update',
                              id: scenario.id,
                              changes: { keyspaceField: event.currentTarget.value }
                            })
                          }
                          className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 font-mono text-xs font-normal text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                        />
                      </label>
                      <DraftNumberInput
                        label="Distinct keys"
                        required={Boolean(scenario.keyspaceField?.trim())}
                        suffix="keys"
                        min={1}
                        value={scenario.keyspaceSize}
                        onChange={(value) =>
                          onAction({
                            type: 'update',
                            id: scenario.id,
                            changes: { keyspaceSize: value }
                          })
                        }
                      />
                      <DraftNumberInput
                        label="Hot-key skew"
                        suffix="Zipf"
                        value={scenario.keyspaceSkew}
                        onChange={(value) =>
                          onAction({
                            type: 'update',
                            id: scenario.id,
                            changes: { keyspaceSkew: value }
                          })
                        }
                      />
                    </div>
                    {errors.keyspace && (
                      <p className="mt-2 text-[10px] text-nss-danger">{errors.keyspace}</p>
                    )}
                  </div>
                )}

                <details className="mt-4 rounded-lg border border-nss-border bg-nss-panel p-4">
                  <summary className="cursor-pointer text-xs font-semibold text-nss-text">
                    Advanced workload
                  </summary>
                  <p className="mt-1 text-[10px] leading-4 text-nss-muted">
                    Configure a source node, custom request mix, geographic origins, and early stop
                    conditions. Imported values remain editable here.
                  </p>

                  <label className="mt-3 block text-[11px] font-semibold text-nss-text">
                    Source node ID{' '}
                    <span className="font-normal text-nss-muted">(optional override)</span>
                    <input
                      value={scenario.sourceNodeId ?? ''}
                      placeholder="client-1"
                      onChange={(event) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { sourceNodeId: event.currentTarget.value }
                        })
                      }
                      className="mt-1.5 block w-full rounded border border-nss-border bg-nss-input-bg px-2.5 py-2 font-mono text-xs font-normal"
                    />
                  </label>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="text-[11px] font-semibold text-nss-text">
                      Time resolution
                      <select
                        value={scenario.timeResolution ?? ''}
                        onChange={(event) =>
                          onAction({
                            type: 'update',
                            id: scenario.id,
                            changes: {
                              timeResolution: (event.currentTarget.value || undefined) as
                                | 'microsecond'
                                | 'millisecond'
                                | undefined
                            }
                          })
                        }
                        className="mt-1.5 block w-full rounded border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal"
                      >
                        <option value="">Use topology/default</option>
                        <option value="millisecond">Millisecond</option>
                        <option value="microsecond">Microsecond</option>
                      </select>
                    </label>
                    <DraftNumberInput
                      label="Default timeout"
                      suffix="ms"
                      min={0.001}
                      value={scenario.defaultTimeoutMs}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { defaultTimeoutMs: value }
                        })
                      }
                    />
                    <DraftNumberInput
                      label="Trace sampling"
                      suffix="%"
                      value={scenario.traceSampleRatePercent}
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: { traceSampleRatePercent: value }
                        })
                      }
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold text-nss-text">Custom request mix</p>
                      <p className="text-[10px] text-nss-muted">Weights must total 100%.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: {
                            requestDistribution: scenario.requestDistribution
                              ? undefined
                              : [
                                  {
                                    type: 'read',
                                    weight: (scenario.readPercent ?? 80) / 100,
                                    sizeBytes: scenario.requestSizeBytes ?? 512
                                  },
                                  {
                                    type: 'write',
                                    weight: 1 - (scenario.readPercent ?? 80) / 100,
                                    sizeBytes: scenario.requestSizeBytes ?? 512
                                  }
                                ]
                          }
                        })
                      }
                      className="rounded border border-nss-border px-2.5 py-1.5 text-[10px] font-semibold text-nss-text"
                    >
                      {scenario.requestDistribution ? 'Use simple read/write mix' : 'Customize mix'}
                    </button>
                  </div>
                  {scenario.requestDistribution && (
                    <div className="mt-2 space-y-2">
                      {scenario.requestDistribution.map((request, requestIndex) => (
                        <div
                          key={`${request.type}-${requestIndex}`}
                          className="grid gap-2 rounded border border-nss-border bg-nss-surface p-2 md:grid-cols-[1fr_0.7fr_0.8fr_auto]"
                        >
                          <label className="text-[10px] font-semibold text-nss-text">
                            Request type <RequiredIndicator />
                            <input
                              required
                              value={request.type}
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    requestDistribution: scenario.requestDistribution!.map(
                                      (item, index) =>
                                        index === requestIndex
                                          ? { ...item, type: event.currentTarget.value }
                                          : item
                                    )
                                  }
                                })
                              }
                              className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal"
                            />
                          </label>
                          <DraftNumberInput
                            label="Weight"
                            required
                            suffix="%"
                            value={request.weight * 100}
                            onChange={(value) =>
                              onAction({
                                type: 'update',
                                id: scenario.id,
                                changes: {
                                  requestDistribution: scenario.requestDistribution!.map(
                                    (item, index) =>
                                      index === requestIndex
                                        ? { ...item, weight: (value ?? 0) / 100 }
                                        : item
                                  )
                                }
                              })
                            }
                          />
                          <DraftNumberInput
                            label="Size"
                            required
                            suffix="bytes"
                            min={1}
                            value={request.sizeBytes}
                            onChange={(value) =>
                              onAction({
                                type: 'update',
                                id: scenario.id,
                                changes: {
                                  requestDistribution: scenario.requestDistribution!.map(
                                    (item, index) =>
                                      index === requestIndex
                                        ? { ...item, sizeBytes: value ?? 0 }
                                        : item
                                  )
                                }
                              })
                            }
                          />
                          <button
                            type="button"
                            aria-label="Remove request type"
                            onClick={() =>
                              onAction({
                                type: 'update',
                                id: scenario.id,
                                changes: {
                                  requestDistribution: scenario.requestDistribution!.filter(
                                    (_, index) => index !== requestIndex
                                  )
                                }
                              })
                            }
                            className="mt-4 flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                          >
                            <Trash2 size={12} />
                          </button>
                          <details className="rounded border border-nss-border bg-nss-panel p-2 md:col-span-4">
                            <summary className="cursor-pointer text-[10px] font-semibold text-nss-text">
                              Request keyspace and metadata
                            </summary>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              <label className="text-[10px] font-semibold">
                                Key field
                                <input
                                  value={request.keyspace?.field ?? ''}
                                  onChange={(event) =>
                                    onAction({
                                      type: 'update',
                                      id: scenario.id,
                                      changes: {
                                        requestDistribution: scenario.requestDistribution!.map(
                                          (item, index) =>
                                            index === requestIndex
                                              ? {
                                                  ...item,
                                                  keyspace: event.currentTarget.value
                                                    ? {
                                                        field: event.currentTarget.value,
                                                        size: item.keyspace?.size ?? 1,
                                                        ...(item.keyspace?.skew !== undefined
                                                          ? { skew: item.keyspace.skew }
                                                          : {})
                                                      }
                                                    : undefined
                                                }
                                              : item
                                        )
                                      }
                                    })
                                  }
                                  placeholder="accountId"
                                  className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal"
                                />
                              </label>
                              <DraftNumberInput
                                label="Distinct keys"
                                suffix="keys"
                                min={1}
                                value={request.keyspace?.size}
                                onChange={(value) =>
                                  onAction({
                                    type: 'update',
                                    id: scenario.id,
                                    changes: {
                                      requestDistribution: scenario.requestDistribution!.map(
                                        (item, index) =>
                                          index === requestIndex && item.keyspace
                                            ? {
                                                ...item,
                                                keyspace: { ...item.keyspace, size: value ?? 1 }
                                              }
                                            : item
                                      )
                                    }
                                  })
                                }
                              />
                              <DraftNumberInput
                                label="Hot-key skew"
                                suffix="Zipf"
                                value={request.keyspace?.skew}
                                onChange={(value) =>
                                  onAction({
                                    type: 'update',
                                    id: scenario.id,
                                    changes: {
                                      requestDistribution: scenario.requestDistribution!.map(
                                        (item, index) =>
                                          index === requestIndex && item.keyspace
                                            ? {
                                                ...item,
                                                keyspace: {
                                                  ...item.keyspace,
                                                  skew: value ?? undefined
                                                }
                                              }
                                            : item
                                      )
                                    }
                                  })
                                }
                              />
                            </div>
                            <div className="mt-3 space-y-2">
                              {Object.entries(request.metadata ?? {}).map(
                                ([metadataKey, metadataValue]) => (
                                  <div
                                    key={metadataKey}
                                    className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"
                                  >
                                    <input
                                      aria-label="Metadata key"
                                      value={metadataKey}
                                      onChange={(event) => {
                                        const next = { ...(request.metadata ?? {}) }
                                        delete next[metadataKey]
                                        next[event.currentTarget.value] = metadataValue
                                        onAction({
                                          type: 'update',
                                          id: scenario.id,
                                          changes: {
                                            requestDistribution: scenario.requestDistribution!.map(
                                              (item, index) =>
                                                index === requestIndex
                                                  ? { ...item, metadata: next }
                                                  : item
                                            )
                                          }
                                        })
                                      }}
                                      className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px]"
                                    />
                                    <input
                                      aria-label={`Metadata ${metadataKey} value`}
                                      value={formatStructuredValue(metadataValue)}
                                      onChange={(event) =>
                                        onAction({
                                          type: 'update',
                                          id: scenario.id,
                                          changes: {
                                            requestDistribution: scenario.requestDistribution!.map(
                                              (item, index) =>
                                                index === requestIndex
                                                  ? {
                                                      ...item,
                                                      metadata: {
                                                        ...(item.metadata ?? {}),
                                                        [metadataKey]: parseStructuredValue(
                                                          event.currentTarget.value
                                                        )
                                                      }
                                                    }
                                                  : item
                                            )
                                          }
                                        })
                                      }
                                      className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px]"
                                    />
                                    <button
                                      type="button"
                                      aria-label={`Remove metadata ${metadataKey}`}
                                      onClick={() => {
                                        const next = { ...(request.metadata ?? {}) }
                                        delete next[metadataKey]
                                        onAction({
                                          type: 'update',
                                          id: scenario.id,
                                          changes: {
                                            requestDistribution: scenario.requestDistribution!.map(
                                              (item, index) =>
                                                index === requestIndex
                                                  ? {
                                                      ...item,
                                                      metadata:
                                                        Object.keys(next).length > 0
                                                          ? next
                                                          : undefined
                                                    }
                                                  : item
                                            )
                                          }
                                        })
                                      }}
                                      className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                )
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  let keyIndex = Object.keys(request.metadata ?? {}).length + 1
                                  let key = `field-${keyIndex}`
                                  while (key in (request.metadata ?? {})) {
                                    keyIndex += 1
                                    key = `field-${keyIndex}`
                                  }
                                  onAction({
                                    type: 'update',
                                    id: scenario.id,
                                    changes: {
                                      requestDistribution: scenario.requestDistribution!.map(
                                        (item, index) =>
                                          index === requestIndex
                                            ? {
                                                ...item,
                                                metadata: { ...(item.metadata ?? {}), [key]: '' }
                                              }
                                            : item
                                      )
                                    }
                                  })
                                }}
                                className="flex items-center gap-1 rounded border border-nss-border px-2 py-1 text-[10px] font-semibold"
                              >
                                <Plus size={11} /> Add metadata
                              </button>
                            </div>
                          </details>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          onAction({
                            type: 'update',
                            id: scenario.id,
                            changes: {
                              requestDistribution: [
                                ...scenario.requestDistribution!,
                                {
                                  type: `request-${scenario.requestDistribution!.length + 1}`,
                                  weight: 0,
                                  sizeBytes: 512
                                }
                              ]
                            }
                          })
                        }
                        className="flex items-center gap-1 rounded border border-nss-border px-2 py-1 text-[10px] font-semibold"
                      >
                        <Plus size={11} /> Add request type
                      </button>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold text-nss-text">Traffic origins</p>
                      <p className="text-[10px] text-nss-muted">
                        Optional weighted client populations.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: {
                            origins: [
                              ...(scenario.origins ?? []),
                              {
                                id: `origin-${(scenario.origins?.length ?? 0) + 1}`,
                                label: 'Traffic origin',
                                weight: scenario.origins?.length ? 0 : 1,
                                location: { kind: 'region', regionId: '' }
                              }
                            ]
                          }
                        })
                      }
                      className="flex items-center gap-1 rounded border border-nss-border px-2 py-1 text-[10px] font-semibold"
                    >
                      <Plus size={11} /> Add origin
                    </button>
                  </div>
                  {(scenario.origins ?? []).map((origin, originIndex) => {
                    const patchOrigin = (changes: Partial<typeof origin>): void =>
                      onAction({
                        type: 'update',
                        id: scenario.id,
                        changes: {
                          origins: scenario.origins!.map((item, index) =>
                            index === originIndex ? { ...item, ...changes } : item
                          )
                        }
                      })
                    return (
                      <div
                        key={`${origin.id}-${originIndex}`}
                        className="mt-2 grid gap-2 rounded border border-nss-border bg-nss-surface p-2 md:grid-cols-[0.8fr_1fr_0.6fr_0.8fr_1fr_auto]"
                      >
                        <label className="text-[10px] font-semibold">
                          ID <RequiredIndicator />
                          <input
                            required
                            value={origin.id}
                            onChange={(event) => patchOrigin({ id: event.currentTarget.value })}
                            className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal"
                          />
                        </label>
                        <label className="text-[10px] font-semibold">
                          Label <RequiredIndicator />
                          <input
                            required
                            value={origin.label}
                            onChange={(event) => patchOrigin({ label: event.currentTarget.value })}
                            className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] font-normal"
                          />
                        </label>
                        <DraftNumberInput
                          label="Weight"
                          required
                          suffix="%"
                          value={origin.weight * 100}
                          onChange={(value) => patchOrigin({ weight: (value ?? 0) / 100 })}
                        />
                        <label className="text-[10px] font-semibold">
                          Location
                          <select
                            value={origin.location.kind}
                            onChange={(event) =>
                              patchOrigin({
                                location:
                                  event.currentTarget.value === 'coordinates'
                                    ? { kind: 'coordinates', latitude: 0, longitude: 0 }
                                    : { kind: 'region', regionId: '' }
                              })
                            }
                            className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] font-normal"
                          >
                            <option value="region">Region</option>
                            <option value="coordinates">Coordinates</option>
                          </select>
                        </label>
                        {origin.location.kind === 'region' ? (
                          <label className="text-[10px] font-semibold">
                            Region ID
                            <input
                              value={origin.location.regionId}
                              onChange={(event) =>
                                patchOrigin({
                                  location: { kind: 'region', regionId: event.currentTarget.value }
                                })
                              }
                              className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal"
                            />
                          </label>
                        ) : (
                          <div className="grid grid-cols-2 gap-1">
                            <DraftNumberInput
                              label="Latitude"
                              suffix="°"
                              value={origin.location.latitude}
                              min={-90}
                              onChange={(value) =>
                                patchOrigin({
                                  location: {
                                    kind: 'coordinates',
                                    latitude: value ?? 0,
                                    longitude:
                                      origin.location.kind === 'coordinates'
                                        ? origin.location.longitude
                                        : 0
                                  }
                                })
                              }
                            />
                            <DraftNumberInput
                              label="Longitude"
                              suffix="°"
                              value={origin.location.longitude}
                              min={-180}
                              onChange={(value) =>
                                patchOrigin({
                                  location: {
                                    kind: 'coordinates',
                                    latitude:
                                      origin.location.kind === 'coordinates'
                                        ? origin.location.latitude
                                        : 0,
                                    longitude: value ?? 0
                                  }
                                })
                              }
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          aria-label="Remove traffic origin"
                          onClick={() =>
                            onAction({
                              type: 'update',
                              id: scenario.id,
                              changes: {
                                origins:
                                  scenario.origins!.length === 1
                                    ? undefined
                                    : scenario.origins!.filter((_, index) => index !== originIndex)
                              }
                            })
                          }
                          className="mt-4 flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )
                  })}

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <label className="text-[10px] font-semibold text-nss-text">
                      Stop mode
                      <select
                        value={scenario.stopCondition?.mode ?? 'duration'}
                        onChange={(event) =>
                          onAction({
                            type: 'update',
                            id: scenario.id,
                            changes: {
                              stopCondition: {
                                ...scenario.stopCondition,
                                mode: event.currentTarget.value as 'duration' | 'requestBudget',
                                ...(event.currentTarget.value === 'requestBudget'
                                  ? { maxRequests: scenario.stopCondition?.maxRequests ?? 10000 }
                                  : {})
                              }
                            }
                          })
                        }
                        className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] font-normal"
                      >
                        <option value="duration">Duration</option>
                        <option value="requestBudget">Request budget</option>
                      </select>
                    </label>
                    {scenario.stopCondition?.mode === 'requestBudget' && (
                      <DraftNumberInput
                        label="Max requests"
                        suffix="requests"
                        min={1}
                        value={scenario.stopCondition.maxRequests}
                        onChange={(value) =>
                          onAction({
                            type: 'update',
                            id: scenario.id,
                            changes: {
                              stopCondition: {
                                ...scenario.stopCondition!,
                                maxRequests: value ?? undefined
                              }
                            }
                          })
                        }
                      />
                    )}
                    <DraftNumberInput
                      label="Halt utilization"
                      suffix="%"
                      value={
                        scenario.stopCondition?.haltOnSaturation?.utilization !== undefined
                          ? scenario.stopCondition.haltOnSaturation.utilization * 100
                          : null
                      }
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: {
                            stopCondition: {
                              mode: scenario.stopCondition?.mode ?? 'duration',
                              ...(scenario.stopCondition?.maxRequests
                                ? { maxRequests: scenario.stopCondition.maxRequests }
                                : {}),
                              haltOnSaturation: {
                                ...scenario.stopCondition?.haltOnSaturation,
                                utilization: value === null ? undefined : value / 100
                              }
                            }
                          }
                        })
                      }
                    />
                    <DraftNumberInput
                      label="Halt error rate"
                      suffix="%"
                      value={
                        scenario.stopCondition?.haltOnSaturation?.errorRate !== undefined
                          ? scenario.stopCondition.haltOnSaturation.errorRate * 100
                          : null
                      }
                      onChange={(value) =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: {
                            stopCondition: {
                              mode: scenario.stopCondition?.mode ?? 'duration',
                              ...(scenario.stopCondition?.maxRequests
                                ? { maxRequests: scenario.stopCondition.maxRequests }
                                : {}),
                              haltOnSaturation: {
                                ...scenario.stopCondition?.haltOnSaturation,
                                errorRate: value === null ? undefined : value / 100
                              }
                            }
                          }
                        })
                      }
                    />
                  </div>
                  {errors.pattern && (
                    <p className="mt-2 text-[10px] text-nss-danger">{errors.pattern}</p>
                  )}
                </details>

                <div className="mt-4 rounded-lg border border-nss-border bg-nss-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-nss-text">
                        <Zap size={13} aria-hidden="true" /> Failure injection
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-nss-muted">
                        Configure deterministic, probabilistic, or conditional faults without
                        editing the runtime JSON.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: {
                            faults: [
                              ...(scenario.faults ?? []),
                              createAuthoringFault(`fault-${(scenario.faults?.length ?? 0) + 1}`)
                            ]
                          }
                        })
                      }
                      className="flex items-center gap-1.5 rounded-md border border-nss-border px-2.5 py-1.5 text-[10px] font-semibold text-nss-text hover:border-nss-primary/40 hover:bg-nss-primary/5"
                    >
                      <Plus size={12} aria-hidden="true" /> Add fault
                    </button>
                  </div>
                  {(scenario.faults ?? []).length === 0 ? (
                    <p className="mt-3 rounded-md border border-dashed border-nss-border px-3 py-3 text-center text-[10px] text-nss-muted">
                      No failure in this grading run.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {(scenario.faults ?? []).map((fault) => (
                        <div
                          key={fault.id}
                          className="grid gap-2 rounded-md border border-nss-border bg-nss-surface p-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1fr_0.8fr_1fr_1fr_auto]"
                        >
                          <label className="text-[10px] font-semibold text-nss-text">
                            Target node ID <RequiredIndicator />
                            <input
                              required
                              type="text"
                              value={fault.targetId}
                              placeholder="api-1"
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    faults: scenario.faults!.map((item) =>
                                      item.id === fault.id
                                        ? { ...item, targetId: event.currentTarget.value }
                                        : item
                                    )
                                  }
                                })
                              }
                              className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal text-nss-text outline-none focus:border-nss-primary"
                            />
                          </label>
                          <label className="text-[10px] font-semibold text-nss-text">
                            Fault type <RequiredIndicator />
                            <input
                              required
                              type="text"
                              value={fault.faultType}
                              placeholder="crash"
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    faults: scenario.faults!.map((item) =>
                                      item.id === fault.id
                                        ? { ...item, faultType: event.currentTarget.value }
                                        : item
                                    )
                                  }
                                })
                              }
                              className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal"
                            />
                          </label>
                          <label className="text-[10px] font-semibold text-nss-text">
                            Timing <RequiredIndicator />
                            <select
                              required
                              value={fault.timing}
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    faults: scenario.faults!.map((item) =>
                                      item.id === fault.id
                                        ? {
                                            ...item,
                                            timing: event.currentTarget.value as typeof item.timing
                                          }
                                        : item
                                    )
                                  }
                                })
                              }
                              className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] font-normal"
                            >
                              <option value="deterministic">Deterministic</option>
                              <option value="probabilistic">Probabilistic</option>
                              <option value="conditional">Conditional</option>
                            </select>
                          </label>
                          <label className="text-[10px] font-semibold text-nss-text">
                            Behavior
                            <input
                              value={fault.mode}
                              placeholder="reject"
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    faults: scenario.faults!.map((item) =>
                                      item.id === fault.id
                                        ? {
                                            ...item,
                                            mode: event.currentTarget.value
                                          }
                                        : item
                                    )
                                  }
                                })
                              }
                              className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] font-normal text-nss-text"
                            />
                          </label>
                          <DraftNumberInput
                            label="Starts"
                            required={fault.timing === 'deterministic'}
                            suffix="sec"
                            value={fault.atSeconds}
                            onChange={(value) =>
                              onAction({
                                type: 'update',
                                id: scenario.id,
                                changes: {
                                  faults: scenario.faults!.map((item) =>
                                    item.id === fault.id ? { ...item, atSeconds: value } : item
                                  )
                                }
                              })
                            }
                          />
                          <label className="text-[10px] font-semibold text-nss-text">
                            Recovery <RequiredIndicator />
                            <select
                              required
                              value={fault.duration}
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    faults: scenario.faults!.map((item) =>
                                      item.id === fault.id
                                        ? {
                                            ...item,
                                            duration: event.currentTarget
                                              .value as typeof fault.duration
                                          }
                                        : item
                                    )
                                  }
                                })
                              }
                              className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] font-normal text-nss-text"
                            >
                              <option value="fixed">Recovers</option>
                              <option value="until">Until condition</option>
                              <option value="permanent">Permanent</option>
                            </select>
                          </label>
                          {fault.duration === 'fixed' ? (
                            <DraftNumberInput
                              label="Down for"
                              required
                              suffix="sec"
                              min={0.001}
                              value={fault.durationSeconds}
                              onChange={(value) =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    faults: scenario.faults!.map((item) =>
                                      item.id === fault.id
                                        ? { ...item, durationSeconds: value }
                                        : item
                                    )
                                  }
                                })
                              }
                            />
                          ) : (
                            <div />
                          )}
                          <button
                            type="button"
                            aria-label="Remove fault"
                            onClick={() =>
                              onAction({
                                type: 'update',
                                id: scenario.id,
                                changes: {
                                  faults: scenario.faults!.filter((item) => item.id !== fault.id)
                                }
                              })
                            }
                            className="mt-4 flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:text-nss-danger"
                          >
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                          <details className="rounded border border-nss-border bg-nss-panel p-2 md:col-span-2 xl:col-span-8">
                            <summary className="cursor-pointer text-[10px] font-semibold text-nss-text">
                              Custom fault parameters ({fault.extraParams.length})
                            </summary>
                            <div className="mt-2 space-y-2">
                              {fault.extraParams.map((param) => (
                                <div
                                  key={param.id}
                                  className="grid gap-2 sm:grid-cols-[1fr_0.7fr_1.5fr_auto]"
                                >
                                  <input
                                    aria-label="Fault parameter name"
                                    value={param.key}
                                    placeholder="probability"
                                    onChange={(event) =>
                                      onAction({
                                        type: 'update',
                                        id: scenario.id,
                                        changes: {
                                          faults: scenario.faults!.map((item) =>
                                            item.id === fault.id
                                              ? {
                                                  ...item,
                                                  extraParams: item.extraParams.map((entry) =>
                                                    entry.id === param.id
                                                      ? {
                                                          ...entry,
                                                          key: event.currentTarget.value
                                                        }
                                                      : entry
                                                  )
                                                }
                                              : item
                                          )
                                        }
                                      })
                                    }
                                    className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px]"
                                  />
                                  <select
                                    aria-label={`${param.key || 'Fault parameter'} type`}
                                    value={param.valueType}
                                    onChange={(event) =>
                                      onAction({
                                        type: 'update',
                                        id: scenario.id,
                                        changes: {
                                          faults: scenario.faults!.map((item) =>
                                            item.id === fault.id
                                              ? {
                                                  ...item,
                                                  extraParams: item.extraParams.map((entry) =>
                                                    entry.id === param.id
                                                      ? {
                                                          ...entry,
                                                          valueType: event.currentTarget
                                                            .value as typeof entry.valueType
                                                        }
                                                      : entry
                                                  )
                                                }
                                              : item
                                          )
                                        }
                                      })
                                    }
                                    className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                                  >
                                    <option value="string">Text</option>
                                    <option value="number">Number</option>
                                    <option value="boolean">Boolean</option>
                                    <option value="json">Structured</option>
                                  </select>
                                  {param.valueType === 'boolean' ? (
                                    <select
                                      aria-label={`${param.key || 'Fault parameter'} value`}
                                      value={param.value}
                                      onChange={(event) =>
                                        onAction({
                                          type: 'update',
                                          id: scenario.id,
                                          changes: {
                                            faults: scenario.faults!.map((item) =>
                                              item.id === fault.id
                                                ? {
                                                    ...item,
                                                    extraParams: item.extraParams.map((entry) =>
                                                      entry.id === param.id
                                                        ? {
                                                            ...entry,
                                                            value: event.currentTarget.value
                                                          }
                                                        : entry
                                                    )
                                                  }
                                                : item
                                            )
                                          }
                                        })
                                      }
                                      className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                                    >
                                      <option value="true">True</option>
                                      <option value="false">False</option>
                                    </select>
                                  ) : (
                                    <input
                                      aria-label={`${param.key || 'Fault parameter'} value`}
                                      value={param.value}
                                      onChange={(event) =>
                                        onAction({
                                          type: 'update',
                                          id: scenario.id,
                                          changes: {
                                            faults: scenario.faults!.map((item) =>
                                              item.id === fault.id
                                                ? {
                                                    ...item,
                                                    extraParams: item.extraParams.map((entry) =>
                                                      entry.id === param.id
                                                        ? {
                                                            ...entry,
                                                            value: event.currentTarget.value
                                                          }
                                                        : entry
                                                    )
                                                  }
                                                : item
                                            )
                                          }
                                        })
                                      }
                                      className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px]"
                                    />
                                  )}
                                  <button
                                    type="button"
                                    aria-label={`Remove fault parameter ${param.key}`}
                                    onClick={() =>
                                      onAction({
                                        type: 'update',
                                        id: scenario.id,
                                        changes: {
                                          faults: scenario.faults!.map((item) =>
                                            item.id === fault.id
                                              ? {
                                                  ...item,
                                                  extraParams: item.extraParams.filter(
                                                    (entry) => entry.id !== param.id
                                                  )
                                                }
                                              : item
                                          )
                                        }
                                      })
                                    }
                                    className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  onAction({
                                    type: 'update',
                                    id: scenario.id,
                                    changes: {
                                      faults: scenario.faults!.map((item) =>
                                        item.id === fault.id
                                          ? {
                                              ...item,
                                              extraParams: [
                                                ...item.extraParams,
                                                {
                                                  id: `param-${item.extraParams.length + 1}`,
                                                  key: '',
                                                  valueType: 'string',
                                                  value: ''
                                                }
                                              ]
                                            }
                                          : item
                                      )
                                    }
                                  })
                                }
                                className="flex items-center gap-1 rounded border border-nss-border px-2 py-1 text-[10px] font-semibold"
                              >
                                <Plus size={11} /> Add parameter
                              </button>
                            </div>
                          </details>
                        </div>
                      ))}
                    </div>
                  )}
                  {errors.pattern && (
                    <p className="mt-2 text-[10px] text-nss-danger">{errors.pattern}</p>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-nss-border bg-nss-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-nss-text">
                        <ShieldCheck size={13} aria-hidden="true" /> Scenario invariants
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-nss-muted">
                        Enforce a rule during this case, for example{' '}
                        <code>perNode.maxUtilization &lt;= 0.8</code>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onAction({
                          type: 'update',
                          id: scenario.id,
                          changes: {
                            invariants: [
                              ...(scenario.invariants ?? []),
                              {
                                id: `invariant-${(scenario.invariants?.length ?? 0) + 1}`,
                                description: '',
                                condition: 'perNode.maxUtilization <= 0.8'
                              }
                            ]
                          }
                        })
                      }
                      className="flex items-center gap-1.5 rounded-md border border-nss-border px-2.5 py-1.5 text-[10px] font-semibold text-nss-text hover:border-nss-primary/40"
                    >
                      <Plus size={12} /> Add invariant
                    </button>
                  </div>
                  {(scenario.invariants ?? []).length === 0 ? (
                    <p className="mt-3 rounded-md border border-dashed border-nss-border px-3 py-3 text-center text-[10px] text-nss-muted">
                      No scenario-specific invariant.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(scenario.invariants ?? []).map((invariant, invariantIndex) => {
                        const patchInvariant = (changes: Partial<typeof invariant>): void =>
                          onAction({
                            type: 'update',
                            id: scenario.id,
                            changes: {
                              invariants: scenario.invariants!.map((item, index) =>
                                index === invariantIndex ? { ...item, ...changes } : item
                              )
                            }
                          })
                        return (
                          <div
                            key={`${invariant.id}-${invariantIndex}`}
                            className="grid gap-2 rounded-md border border-nss-border bg-nss-surface p-3 md:grid-cols-[0.7fr_1.2fr_1.5fr_auto]"
                          >
                            <label className="text-[10px] font-semibold text-nss-text">
                              ID
                              <input
                                value={invariant.id}
                                onChange={(event) =>
                                  patchInvariant({ id: event.currentTarget.value })
                                }
                                className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold text-nss-text">
                              Description
                              <input
                                value={invariant.description}
                                onChange={(event) =>
                                  patchInvariant({ description: event.currentTarget.value })
                                }
                                className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] font-normal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold text-nss-text">
                              Condition
                              <input
                                value={invariant.condition}
                                onChange={(event) =>
                                  patchInvariant({ condition: event.currentTarget.value })
                                }
                                className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px] font-normal"
                              />
                            </label>
                            <button
                              type="button"
                              aria-label="Remove invariant"
                              onClick={() =>
                                onAction({
                                  type: 'update',
                                  id: scenario.id,
                                  changes: {
                                    invariants: scenario.invariants!.filter(
                                      (_, index) => index !== invariantIndex
                                    )
                                  }
                                })
                              }
                              className="mt-4 flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div
                  className={`mt-4 rounded-md border px-3 py-2.5 ${
                    summary
                      ? 'border-nss-primary/20 bg-nss-primary/5'
                      : 'border-nss-warning/30 bg-nss-warning/10'
                  }`}
                >
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      summary ? 'text-nss-primary' : 'text-nss-warning'
                    }`}
                  >
                    {summary ? 'Normalized runtime case' : 'Scenario incomplete'}
                  </p>
                  <output
                    data-testid="scenario-runtime-summary"
                    className="mt-1 block text-xs leading-5 text-nss-text"
                  >
                    {summary ?? 'Complete the highlighted fields before this scenario can run.'}
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
