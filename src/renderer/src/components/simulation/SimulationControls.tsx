import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Square } from 'lucide-react'
import type { WorkloadProfile } from '../../../../engine/core/types'
import type { ScenarioState, SourceNodeOption } from '@renderer/types/ui'

type WorkloadOverride = NonNullable<ScenarioState['workloadOverride']>
type WorkloadPattern = WorkloadProfile['pattern']

const PATTERN_OPTIONS: { value: WorkloadPattern; label: string }[] = [
  { value: 'constant', label: 'Constant' },
  { value: 'poisson', label: 'Poisson' },
  { value: 'bursty', label: 'Bursty' },
  { value: 'spike', label: 'Spike' },
  { value: 'diurnal', label: 'Diurnal' },
  { value: 'sawtooth', label: 'Sawtooth' }
]

const CONTROL_BASE =
  'h-7 w-full rounded-md border border-nss-border bg-nss-input-bg text-nss-text text-xs font-sans px-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed focus:border-nss-primary'

const ACTION_BUTTON_BASE =
  'h-7 px-3 text-xs font-semibold font-sans rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

interface SimulationControlsProps {
  onRun: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  isRunning: boolean
  isPaused: boolean
  sourceNodes: SourceNodeOption[]
  scenario: ScenarioState
  onScenarioChange: (updater: (current: ScenarioState) => ScenarioState) => void
  disabled?: boolean
  savedSeeds: string[]
  onSaveSeed: (seed: string) => void
  onRemoveSeed: (seed: string) => void
}

function mergeWorkload(
  base: SourceNodeOption['workload'] | undefined,
  override: ScenarioState['workloadOverride']
): SourceNodeOption['workload'] | undefined {
  if (!base) return undefined

  return {
    ...base,
    ...override,
    ...(base.bursty || override?.bursty
      ? {
          bursty: {
            ...(base.bursty ?? { burstRps: 500, burstDuration: 2000, normalDuration: 8000 }),
            ...override?.bursty
          }
        }
      : {}),
    ...(base.spike || override?.spike
      ? {
          spike: {
            ...(base.spike ?? { spikeTime: 30_000, spikeRps: 1000, spikeDuration: 5000 }),
            ...override?.spike
          }
        }
      : {}),
    ...(base.sawtooth || override?.sawtooth
      ? {
          sawtooth: {
            ...(base.sawtooth ?? { peakRps: 300, rampDuration: 10_000 }),
            ...override?.sawtooth
          }
        }
      : {}),
    ...(base.diurnal || override?.diurnal
      ? {
          diurnal: {
            ...(base.diurnal ?? {
              peakMultiplier: 1,
              hourlyMultipliers: [
                0.6, 0.5, 0.45, 0.4, 0.4, 0.5, 0.7, 0.9, 1.1, 1.2, 1.15, 1.05, 1, 1.05, 1.1, 1.2,
                1.25, 1.3, 1.2, 1.05, 0.95, 0.85, 0.75, 0.65
              ]
            }),
            ...override?.diurnal
          }
        }
      : {})
  }
}

function updateWorkloadOverride(
  current: ScenarioState,
  updater: (override: WorkloadOverride) => WorkloadOverride
): ScenarioState {
  return {
    ...current,
    workloadOverride: updater({ ...(current.workloadOverride ?? {}) })
  }
}

export function SimulationControls({
  onRun,
  onPause,
  onResume,
  onStop,
  isRunning,
  isPaused,
  sourceNodes,
  scenario,
  onScenarioChange,
  disabled = false,
  savedSeeds,
  onSaveSeed,
  onRemoveSeed
}: SimulationControlsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [isCustomSeed, setIsCustomSeed] = useState(false)

  const handleSaveSeed = () => {
    const currentSeed = scenario.global.seed
    if (currentSeed && currentSeed !== 'default-seed' && !savedSeeds.includes(currentSeed)) {
      onSaveSeed(currentSeed)
    }
  }

  const selectedSource =
    sourceNodes.find((node) => node.id === scenario.selectedSourceNodeId) ?? sourceNodes[0]

  const effectiveWorkload = useMemo(
    () => mergeWorkload(selectedSource?.workload, scenario.workloadOverride),
    [selectedSource, scenario.workloadOverride]
  )

  useEffect(() => {
    if (!isOpen) return

    function onMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (isRunning || isPaused) setIsOpen(false)
  }, [isRunning, isPaused])

  const setGlobalField = (
    key: keyof ScenarioState['global'],
    value: ScenarioState['global'][keyof ScenarioState['global']]
  ) => {
    onScenarioChange((current) => ({
      ...current,
      global: {
        ...current.global,
        [key]: value
      }
    }))
  }

  const setWorkloadField = <K extends keyof WorkloadOverride>(
    key: K,
    value: WorkloadOverride[K]
  ) => {
    onScenarioChange((current) =>
      updateWorkloadOverride(current, (override) => ({ ...override, [key]: value }))
    )
  }

  const setNestedWorkloadField = <K extends keyof WorkloadOverride>(
    key: K,
    patch: Record<string, number>
  ) => {
    onScenarioChange((current) =>
      updateWorkloadOverride(current, (override) => ({
        ...override,
        [key]: {
          ...((override[key] as Record<string, number> | undefined) ?? {}),
          ...patch
        } as WorkloadOverride[K]
      }))
    )
  }

  const hasSourceNodes = sourceNodes.length > 0

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-1.5">
      {!isRunning && !isPaused && (
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          disabled={disabled}
          className={`${ACTION_BUTTON_BASE} flex items-center gap-1.5 bg-nss-primary text-white border-transparent hover:bg-nss-primary-hover`}
        >
          <Play size={12} className="fill-white" />
          Run
        </button>
      )}

      {isRunning && !isPaused && (
        <>
          <button
            onClick={onPause}
            className={`${ACTION_BUTTON_BASE} flex items-center gap-1.5 bg-nss-warning text-black border-transparent hover:bg-nss-warning/80`}
          >
            <Pause size={12} className="fill-black" />
            Pause
          </button>
          <button
            onClick={onStop}
            className={`${ACTION_BUTTON_BASE} flex items-center gap-1.5 bg-nss-surface text-nss-text border-nss-border hover:bg-nss-bg`}
          >
            <Square size={12} className="fill-current" />
            Stop
          </button>
        </>
      )}

      {isPaused && (
        <>
          <button
            onClick={onResume}
            className={`${ACTION_BUTTON_BASE} flex items-center gap-1.5 bg-nss-success text-black border-transparent hover:bg-nss-success/80`}
          >
            <Play size={12} className="fill-black" />
            Resume
          </button>
          <button
            onClick={onStop}
            className={`${ACTION_BUTTON_BASE} flex items-center gap-1.5 bg-nss-surface text-nss-text border-nss-border hover:bg-nss-bg`}
          >
            <Square size={12} className="fill-current" />
            Stop
          </button>
        </>
      )}

      {isOpen && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-nss-panel border border-nss-border rounded-lg shadow-2xl p-4 w-80 font-sans">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-nss-muted mb-2">
            Workload
          </p>

          <Field label="Source" className="mb-2">
            <select
              value={scenario.selectedSourceNodeId ?? ''}
              onChange={(event) =>
                onScenarioChange((current) => ({
                  ...current,
                  selectedSourceNodeId: event.target.value || undefined
                }))
              }
              className={CONTROL_BASE}
            >
              <option value="">Auto (first source)</option>
              {sourceNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <Field label="Pattern">
              <select
                value={effectiveWorkload?.pattern ?? 'poisson'}
                onChange={(event) =>
                  setWorkloadField('pattern', event.target.value as WorkloadPattern)
                }
                className={CONTROL_BASE}
                disabled={!hasSourceNodes}
              >
                {PATTERN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Base RPS">
              <NumberInput
                value={effectiveWorkload?.baseRps ?? 100}
                min={1}
                onChange={(value) => setWorkloadField('baseRps', value)}
                disabled={!hasSourceNodes}
              />
            </Field>
          </div>

          {effectiveWorkload?.pattern === 'bursty' && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              <Field label="Burst RPS">
                <NumberInput
                  value={effectiveWorkload.bursty?.burstRps ?? 500}
                  min={1}
                  onChange={(value) => setNestedWorkloadField('bursty', { burstRps: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
              <Field label="Burst ms">
                <NumberInput
                  value={effectiveWorkload.bursty?.burstDuration ?? 2000}
                  min={100}
                  onChange={(value) => setNestedWorkloadField('bursty', { burstDuration: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
              <Field label="Normal ms">
                <NumberInput
                  value={effectiveWorkload.bursty?.normalDuration ?? 8000}
                  min={100}
                  onChange={(value) => setNestedWorkloadField('bursty', { normalDuration: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
            </div>
          )}

          {effectiveWorkload?.pattern === 'spike' && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              <Field label="Spike at ms">
                <NumberInput
                  value={effectiveWorkload.spike?.spikeTime ?? 30_000}
                  min={0}
                  onChange={(value) => setNestedWorkloadField('spike', { spikeTime: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
              <Field label="Spike RPS">
                <NumberInput
                  value={effectiveWorkload.spike?.spikeRps ?? 1000}
                  min={1}
                  onChange={(value) => setNestedWorkloadField('spike', { spikeRps: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
              <Field label="Spike dur ms">
                <NumberInput
                  value={effectiveWorkload.spike?.spikeDuration ?? 5000}
                  min={100}
                  onChange={(value) => setNestedWorkloadField('spike', { spikeDuration: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
            </div>
          )}

          {effectiveWorkload?.pattern === 'sawtooth' && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <Field label="Peak RPS">
                <NumberInput
                  value={effectiveWorkload.sawtooth?.peakRps ?? 300}
                  min={1}
                  onChange={(value) => setNestedWorkloadField('sawtooth', { peakRps: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
              <Field label="Ramp ms">
                <NumberInput
                  value={effectiveWorkload.sawtooth?.rampDuration ?? 10_000}
                  min={100}
                  onChange={(value) => setNestedWorkloadField('sawtooth', { rampDuration: value })}
                  disabled={!hasSourceNodes}
                />
              </Field>
            </div>
          )}

          <div className="h-px bg-nss-border my-3" />

          <p className="text-[10px] font-semibold uppercase tracking-widest text-nss-muted mb-2">
            Timing
          </p>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <Field label="Duration (s)">
              <NumberInput
                value={Math.round(scenario.global.simulationDuration / 1000)}
                min={1}
                onChange={(value) => setGlobalField('simulationDuration', value * 1000)}
              />
            </Field>
            <Field label="Warmup (s)">
              <NumberInput
                value={Math.round(scenario.global.warmupDuration / 1000)}
                min={0}
                onChange={(value) => setGlobalField('warmupDuration', value * 1000)}
              />
            </Field>
          </div>

          <Field label="Seed" className="mb-3">
            {!isCustomSeed && (scenario.global.seed === 'default-seed' || savedSeeds.includes(scenario.global.seed)) ? (
              <select
                value={scenario.global.seed}
                onChange={(event) => {
                  const val = event.target.value
                  if (val === 'custom') {
                    setIsCustomSeed(true)
                    setGlobalField('seed', '')
                  } else {
                    setGlobalField('seed', val)
                  }
                }}
                className={CONTROL_BASE}
              >
                <option value="default-seed">default-seed</option>
                {savedSeeds.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value="custom">Custom...</option>
              </select>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scenario.global.seed}
                  onChange={(event) => setGlobalField('seed', event.target.value)}
                  className={CONTROL_BASE}
                  autoFocus
                  placeholder="Enter custom seed..."
                />
                {scenario.global.seed &&
                scenario.global.seed !== 'default-seed' &&
                !savedSeeds.includes(scenario.global.seed) ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleSaveSeed()
                      setIsCustomSeed(false)
                    }}
                    className={`${ACTION_BUTTON_BASE} bg-nss-surface text-nss-text border-nss-border hover:bg-nss-bg flex-shrink-0`}
                    title="Save this seed for future use"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomSeed(false)
                      if (!scenario.global.seed || (!savedSeeds.includes(scenario.global.seed) && scenario.global.seed !== 'default-seed')) {
                        setGlobalField('seed', 'default-seed')
                      }
                    }}
                    className={`${ACTION_BUTTON_BASE} bg-nss-surface text-nss-text border-nss-border hover:bg-nss-bg flex-shrink-0`}
                    title="Cancel custom seed"
                  >
                    X
                  </button>
                )}
              </div>
            )}
          </Field>

          <button
            onClick={() => {
              setIsOpen(false)
              onRun()
            }}
            disabled={disabled || !hasSourceNodes}
            className="w-full h-8 rounded-md bg-nss-primary text-white text-xs font-semibold hover:bg-nss-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start Simulation
          </button>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  className,
  children
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-nss-muted mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

function NumberInput({
  value,
  min,
  onChange,
  disabled = false
}: {
  value: number
  min: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
      className={CONTROL_BASE}
    />
  )
}
