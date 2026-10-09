import { CheckCircle2, CircleDashed, Eye, Plus, X, XCircle } from 'lucide-react'
import type { AssertionResult, CheckResult, ExperimentResult } from '../../../../engine/scenarios'
import { describeAssertion, formatMetricValue } from '../../../../engine/scenarios'
import type { ExperimentEntry, ScenarioState } from '@renderer/types/ui'
import {
  EXPERIMENT_PRESET_OPTIONS,
  fmtExperimentTime,
  type ExperimentPreview
} from './chaosExperimentModel'

const CONTROL_BASE =
  'h-7 w-full rounded-md border border-nss-border bg-nss-input-bg text-nss-text text-xs font-sans px-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed focus:border-nss-primary'
const SECTION_TITLE = 'text-[11px] font-semibold text-nss-muted uppercase tracking-wider'
const SURFACE_CARD = 'bg-nss-surface border border-nss-border rounded-md'

// ─── Run dialog section ──────────────────────────────────────────────────────

interface ExperimentSetupProps {
  entries: ExperimentEntry[]
  preview: ExperimentPreview | null
  onScenarioChange: (updater: (current: ScenarioState) => ScenarioState) => void
}

/**
 * Pick a chaos experiment preset (or compose several with offsets) and see its
 * timeline and assertions before running. Lives in the run dialog.
 */
export function ExperimentSetupSection({
  entries,
  preview,
  onScenarioChange
}: ExperimentSetupProps) {
  const setEntries = (next: ExperimentEntry[]) =>
    onScenarioChange((current) => {
      const updated = { ...current }
      if (next.length > 0) updated.experiment = next
      else delete updated.experiment
      return updated
    })

  const firstPreset = entries[0]?.presetId ?? ''
  const unused = EXPERIMENT_PRESET_OPTIONS.filter(
    (option) => !entries.some((entry) => entry.presetId === option.value)
  )

  return (
    <div className="space-y-2" data-testid="experiment-setup">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
        Experiment
      </label>
      <select
        aria-label="Chaos experiment"
        value={firstPreset}
        onChange={(event) =>
          setEntries(
            event.target.value
              ? [{ presetId: event.target.value, offsetS: 0 }, ...entries.slice(1)]
              : []
          )
        }
        className={CONTROL_BASE}
      >
        <option value="">None - run the workload as configured</option>
        {EXPERIMENT_PRESET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {entries.length > 0 && (
        <p className="text-[10px] leading-snug text-nss-muted">
          {EXPERIMENT_PRESET_OPTIONS.find((option) => option.value === firstPreset)?.summary}
        </p>
      )}

      {entries.slice(1).map((entry, offsetIndex) => {
        const index = offsetIndex + 1
        return (
          <div key={`${entry.presetId}-${index}`} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-nss-muted mb-1">
                Then
              </label>
              <select
                aria-label={`Composed experiment ${index + 1}`}
                value={entry.presetId}
                onChange={(event) =>
                  setEntries(
                    entries.map((existing, i) =>
                      i === index ? { ...existing, presetId: event.target.value } : existing
                    )
                  )
                }
                className={CONTROL_BASE}
              >
                {EXPERIMENT_PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-nss-muted mb-1">
                After (s)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                aria-label={`Offset for composed experiment ${index + 1}`}
                value={entry.offsetS}
                onChange={(event) =>
                  setEntries(
                    entries.map((existing, i) =>
                      i === index
                        ? {
                            ...existing,
                            offsetS: Math.max(0, Math.round(Number(event.target.value) || 0))
                          }
                        : existing
                    )
                  )
                }
                className={CONTROL_BASE}
              />
            </div>
            <button
              type="button"
              onClick={() => setEntries(entries.filter((_, i) => i !== index))}
              aria-label="Remove composed experiment"
              title="Remove"
              className="mb-1.5 text-nss-muted hover:text-nss-text"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}

      {entries.length > 0 && unused.length > 0 && (
        <button
          type="button"
          onClick={() => setEntries([...entries, { presetId: unused[0].value, offsetS: 5 }])}
          className="flex items-center gap-1 text-[11px] font-semibold text-nss-primary hover:underline"
        >
          <Plus size={12} />
          Compose another experiment
        </button>
      )}

      {entries.length > 0 && preview && preview.ok === false && (
        <p
          role="alert"
          className="rounded-md border border-nss-warning/20 bg-nss-warning/10 px-2 py-1.5 text-[11px] leading-snug text-nss-warning"
        >
          {preview.reason}
        </p>
      )}

      {entries.length > 0 && preview?.ok && <ExperimentPlanPreview preview={preview} />}
    </div>
  )
}

function ExperimentPlanPreview({ preview }: { preview: Extract<ExperimentPreview, { ok: true }> }) {
  const { plan } = preview.compiled
  return (
    <div className={`${SURFACE_CARD} p-2 space-y-2`}>
      <p className="text-[10px] text-nss-muted">
        Runs for {fmtExperimentTime(plan.durationMs)} (overrides the duration and warmup above).
      </p>
      <ol className="space-y-0.5 text-[11px] text-nss-text">
        {plan.timeline
          .filter((entry) => entry.type !== 'wait')
          .map((entry, index) => (
            <li key={index} className="flex gap-2">
              <span className="w-9 shrink-0 tabular-nums text-nss-muted">
                {fmtExperimentTime(entry.atMs)}
              </span>
              <span>{entry.label}</span>
            </li>
          ))}
      </ol>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
          Steady state
        </p>
        <ul className="text-[11px] text-nss-text">
          {preview.definition.steadyState.map((assertion, index) => (
            <li key={index}>{describeAssertion(assertion)}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ─── Result panel ────────────────────────────────────────────────────────────

const VERDICT_TONE: Record<ExperimentResult['verdict'], { text: string; className: string }> = {
  passed: { text: 'Passed', className: 'border-nss-success/30 bg-nss-success/10 text-nss-success' },
  failed: { text: 'Failed', className: 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger' },
  'not-stable': {
    text: 'Not stable',
    className: 'border-nss-warning/30 bg-nss-warning/10 text-nss-warning'
  },
  inconclusive: {
    text: 'Inconclusive',
    className: 'border-nss-border bg-nss-surface text-nss-muted'
  }
}

function StatusIcon({ status }: { status: AssertionResult['status'] | CheckResult['status'] }) {
  if (status === 'pass')
    return <CheckCircle2 size={13} className="shrink-0 text-nss-success" aria-label="pass" />
  if (status === 'fail' || status === 'no-data')
    return <XCircle size={13} className="shrink-0 text-nss-danger" aria-label="fail" />
  if (status === 'observed')
    return <Eye size={13} className="shrink-0 text-nss-muted" aria-label="observed" />
  return <CircleDashed size={13} className="shrink-0 text-nss-muted" aria-label="skipped" />
}

function measuredText(result: AssertionResult): string {
  if (result.actual === null) return result.status === 'skipped' ? '-' : 'no data'
  return formatMetricValue(result.assertion.metric, result.actual)
}

/** Assertions pass / fail with their measured values, check by check. */
export function ExperimentResultPanel({
  result,
  nodeLabel
}: {
  result: ExperimentResult
  nodeLabel?: (nodeId: string) => string
}) {
  const tone = VERDICT_TONE[result.verdict]
  return (
    <div className="space-y-2" data-testid="experiment-result">
      <div className="flex items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>Experiment - {result.name}</h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone.className}`}
        >
          {tone.text}
        </span>
      </div>
      <p className="text-xs text-nss-text">{result.summary}</p>

      <div className="space-y-2">
        {result.checks.map((check) => (
          <div key={check.id} className={`${SURFACE_CARD} p-2`}>
            <div className="mb-1 flex items-center gap-1.5">
              <StatusIcon status={check.status} />
              <span className="text-xs font-semibold text-nss-text">{check.label}</span>
              <span className="ml-auto text-[10px] tabular-nums text-nss-muted">
                {fmtExperimentTime(check.fromMs)} - {fmtExperimentTime(check.toMs)}
              </span>
            </div>
            <ul className="space-y-0.5">
              {check.assertions.map((assertion, index) => (
                <li
                  key={index}
                  className="flex items-center gap-1.5 text-[11px]"
                  title={assertion.detail}
                >
                  <StatusIcon status={assertion.status} />
                  <span className="text-nss-text">
                    {nodeLabel
                      ? describeAssertion(assertion.assertion, nodeLabel)
                      : assertion.label}
                  </span>
                  <span
                    className={`ml-auto tabular-nums ${
                      assertion.status === 'fail' || assertion.status === 'no-data'
                        ? 'text-nss-danger'
                        : 'text-nss-muted'
                    }`}
                  >
                    {measuredText(assertion)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {result.notes.length > 0 && (
        <details className="text-[11px] text-nss-muted">
          <summary className="cursor-pointer select-none">What this experiment models</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[10px] text-nss-muted">
        Measured from 1-second windows; latency is the worst second in each window.
      </p>
    </div>
  )
}
