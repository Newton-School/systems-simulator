import { useMemo } from 'react'
import { FlaskConical, Plus, X } from 'lucide-react'
import type { TopologyJSON } from '../../../../engine/core/types'
import {
  buildExperimentFromPresets,
  presetOptionFields,
  type ChaosPresetId,
  type PresetOptionField
} from '../../../../engine/scenarios'
import {
  experimentPresetEntries,
  type QuestionCaseExperiment,
  type QuestionCaseExperimentPreset
} from '../../../../engine/analysis/questionExperiment'
import { EXPERIMENT_PRESET_OPTIONS } from '../simulation/chaosExperimentModel'
import { ExperimentPlanPreview } from '../simulation/ChaosExperimentPanel'
import { AUTHORING_SELECT_CLASS, DraftNumberInput } from './authoringInputs'

interface ChaosExperimentCaseEditorProps {
  experiment: QuestionCaseExperiment
  /** Reference (or scaffold) design with this case's traffic merged in, for the preview. */
  previewTopology: TopologyJSON | null
  previewSource: string | null
  onChange: (next: QuestionCaseExperiment) => void
}

function optionValue(
  preset: QuestionCaseExperimentPreset,
  key: string
): string | number | undefined {
  return preset.options?.[key]
}

function withOption(
  preset: QuestionCaseExperimentPreset,
  key: string,
  value: string | number | null
): QuestionCaseExperimentPreset {
  const options = { ...(preset.options ?? {}) }
  if (value === null || value === '') delete options[key]
  else options[key] = value
  const { options: _drop, ...rest } = preset
  void _drop
  return Object.keys(options).length > 0 ? { ...rest, options } : rest
}

function TargetOptionInput({
  field,
  value,
  topology,
  onChange
}: {
  field: PresetOptionField
  value: string | undefined
  topology: TopologyJSON | null
  onChange: (value: string | null) => void
}): React.JSX.Element {
  const choices =
    field.kind === 'zone'
      ? (topology?.locations ?? [])
          .filter((location) => location.kind === 'availability-zone')
          .map((location) => ({ id: location.id, label: location.label || location.id }))
      : (topology?.nodes ?? [])
          .filter((node) => node.role !== 'source')
          .map((node) => ({ id: node.id, label: node.label || node.id }))
  return (
    <label className="text-[11px] font-semibold text-nss-text">
      {field.label}
      <select
        aria-label={field.label}
        value={value ?? ''}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        className={AUTHORING_SELECT_CLASS}
      >
        <option value="">Automatic - {field.defaultText}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label === choice.id ? choice.id : `${choice.label} (${choice.id})`}
          </option>
        ))}
        {value && !choices.some((choice) => choice.id === value) && (
          <option value={value}>{value} (not in the reference design)</option>
        )}
      </select>
      <span className="mt-1 block text-[10px] font-normal leading-4 text-nss-muted">
        {field.help}
      </span>
    </label>
  )
}

function PresetOptionsEditor({
  preset,
  topology,
  onChange
}: {
  preset: QuestionCaseExperimentPreset
  topology: TopologyJSON | null
  onChange: (next: QuestionCaseExperimentPreset) => void
}): React.JSX.Element {
  const fields = presetOptionFields(preset.presetId)
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {fields.map((field) => {
        const raw = optionValue(preset, field.key)
        if (field.kind === 'node' || field.kind === 'zone') {
          return (
            <TargetOptionInput
              key={field.key}
              field={field}
              value={typeof raw === 'string' ? raw : undefined}
              topology={topology}
              onChange={(value) => onChange(withOption(preset, field.key, value))}
            />
          )
        }
        const numeric = typeof raw === 'number' ? raw : null
        const percent = field.kind === 'percent'
        return (
          <DraftNumberInput
            key={field.key}
            label={field.label}
            suffix={
              percent ? '%' : field.kind === 'ms' ? 'ms' : field.kind === 'seconds' ? 'sec' : 'x'
            }
            value={percent && numeric !== null ? Number((numeric * 100).toFixed(6)) : numeric}
            placeholder={field.defaultText}
            onChange={(value) =>
              onChange(
                withOption(
                  preset,
                  field.key,
                  value === null ? null : percent ? Number((value / 100).toFixed(8)) : value
                )
              )
            }
          />
        )
      })}
    </div>
  )
}

/**
 * The "Chaos experiment" option on a grading scenario: preset (or a composed
 * list with offsets), preset options, and the steady-state preview the run
 * dialog shows, built against the reference design.
 */
export function ChaosExperimentCaseEditor({
  experiment,
  previewTopology,
  previewSource,
  onChange
}: ChaosExperimentCaseEditorProps): React.JSX.Element {
  const preview = useMemo(
    () =>
      previewTopology
        ? buildExperimentFromPresets(previewTopology, experimentPresetEntries(experiment))
        : null,
    [previewTopology, experiment]
  )
  const setPreset = (index: number, next: QuestionCaseExperimentPreset) =>
    onChange({
      ...experiment,
      presets: experiment.presets.map((preset, i) => (i === index ? next : preset))
    })
  const unused = EXPERIMENT_PRESET_OPTIONS.filter(
    (option) => !experiment.presets.some((preset) => preset.presetId === option.value)
  )

  return (
    <div className="space-y-3" data-testid="chaos-experiment-case">
      <p className="text-[10px] leading-4 text-nss-muted">
        At grading time the experiment is built against each learner&apos;s own design and run once.
        The case passes only when the experiment verdict is <strong>Passed</strong>: the steady
        state holds before the fault, every check during it holds, and the steady state returns. A
        design the experiment cannot apply to (for example no availability zones for an AZ outage)
        fails the case with the reason. The shared rubric metric checks do not run on this case.
      </p>

      {experiment.presets.map((preset, index) => {
        const option = EXPERIMENT_PRESET_OPTIONS.find((entry) => entry.value === preset.presetId)
        return (
          <div
            key={`${preset.presetId}-${index}`}
            className="space-y-3 rounded-md border border-nss-border bg-nss-surface p-3"
          >
            <div className="flex items-end gap-3">
              <label className="flex-1 text-[11px] font-semibold text-nss-text">
                {index === 0 ? 'Experiment' : 'Then compose'}
                <select
                  aria-label={
                    index === 0 ? 'Chaos experiment preset' : `Composed experiment ${index + 1}`
                  }
                  value={preset.presetId}
                  onChange={(event) =>
                    setPreset(index, {
                      presetId: event.currentTarget.value as ChaosPresetId,
                      ...(preset.offsetSeconds ? { offsetSeconds: preset.offsetSeconds } : {})
                    })
                  }
                  className={AUTHORING_SELECT_CLASS}
                >
                  {EXPERIMENT_PRESET_OPTIONS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              {index > 0 && (
                <div className="w-32">
                  <DraftNumberInput
                    label="Starts after"
                    suffix="sec"
                    value={preset.offsetSeconds ?? 0}
                    onChange={(value) => {
                      const seconds = Math.max(0, Math.round(value ?? 0))
                      const { offsetSeconds: _drop, ...rest } = preset
                      void _drop
                      setPreset(index, seconds > 0 ? { ...rest, offsetSeconds: seconds } : rest)
                    }}
                  />
                </div>
              )}
              {index > 0 && (
                <button
                  type="button"
                  aria-label="Remove composed experiment"
                  onClick={() =>
                    onChange({
                      ...experiment,
                      presets: experiment.presets.filter((_, i) => i !== index)
                    })
                  }
                  className="mb-1.5 flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
            {option && <p className="text-[10px] leading-4 text-nss-muted">{option.summary}</p>}
            <details>
              <summary className="cursor-pointer text-[10px] font-semibold text-nss-text">
                Options ({Object.keys(preset.options ?? {}).length} set)
              </summary>
              <div className="mt-2">
                <PresetOptionsEditor
                  preset={preset}
                  topology={previewTopology}
                  onChange={(next) => setPreset(index, next)}
                />
              </div>
            </details>
          </div>
        )
      })}

      <div className="flex flex-wrap items-end gap-3">
        {unused.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...experiment,
                presets: [...experiment.presets, { presetId: unused[0].value, offsetSeconds: 5 }]
              })
            }
            className="flex items-center gap-1.5 rounded-md border border-nss-border px-2.5 py-1.5 text-[10px] font-semibold text-nss-text hover:border-nss-primary/40 hover:bg-nss-primary/5"
          >
            <Plus size={12} aria-hidden="true" /> Compose another experiment
          </button>
        )}
        <div className="w-32">
          <DraftNumberInput
            label="Points"
            suffix="pts"
            min={1}
            value={experiment.points ?? 1}
            onChange={(value) => {
              const points = Math.max(1, Math.round(value ?? 1))
              const { points: _drop, ...rest } = experiment
              void _drop
              onChange(points === 1 ? rest : { ...rest, points })
            }}
          />
        </div>
      </div>

      <div className="rounded-md border border-nss-border bg-nss-panel p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-nss-text">
          <FlaskConical size={13} aria-hidden="true" /> Preview on the{' '}
          {previewSource ?? 'reference'} design
        </p>
        {!preview ? (
          <p className="mt-1 text-[10px] leading-4 text-nss-muted">
            Add a reference design to preview the timeline and the steady state.
          </p>
        ) : preview.ok === false ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-nss-warning/20 bg-nss-warning/10 px-2 py-1.5 text-[11px] leading-snug text-nss-warning"
          >
            The {previewSource ?? 'reference'} design cannot run this experiment: {preview.reason}{' '}
            Learner designs that look like it would fail this case.
          </p>
        ) : (
          <div className="mt-2">
            <ExperimentPlanPreview
              preview={preview}
              durationNote="the experiment sets this case's run length and warmup"
            />
          </div>
        )}
      </div>
    </div>
  )
}
