import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, Square, X } from 'lucide-react'
import type { FaultSpec, WorkloadProfile } from '../../../../engine/core/types'
import type { FaultTargetOption, ScenarioState, SourceNodeOption } from '@renderer/types/ui'
import { mergeWorkloadDefaults } from '@renderer/utils/workloadDefaults'

type WorkloadOverride = NonNullable<ScenarioState['workloadOverride']>
type WorkloadPattern = WorkloadProfile['pattern']

type FailureMode = 'blackhole' | 'hang' | 'reject' | 'degraded'
const FAILURE_MODE_OPTIONS: { value: FailureMode; label: string }[] = [
  { value: 'blackhole', label: 'Blackhole (silent, walls at timeout)' },
  { value: 'hang', label: 'Hang (accept then freeze)' },
  { value: 'reject', label: 'Reject (instant node_failed)' },
  { value: 'degraded', label: 'Degraded (slower service)' }
]

interface SimpleFault {
  targetId: string
  atS: number
  durationS: number
  mode: FailureMode
}

function readFault(fault: FaultSpec): SimpleFault {
  const params = (fault.params ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && v >= 0 ? v : 0)
  const mode = typeof params.mode === 'string' ? (params.mode as FailureMode) : 'blackhole'
  return {
    targetId: fault.targetId,
    atS: Math.round(num(params.atMs) / 1000),
    durationS: Math.round(num(params.durationMs) / 1000),
    mode
  }
}

function buildFault(simple: SimpleFault): FaultSpec {
  return {
    targetId: simple.targetId,
    faultType: 'chaos',
    timing: 'deterministic',
    duration: simple.durationS > 0 ? 'fixed' : 'permanent',
    params: {
      atMs: Math.max(0, simple.atS) * 1000,
      durationMs: Math.max(0, simple.durationS) * 1000,
      mode: simple.mode,
      inFlightPolicy: 'hang',
      recoveryPolicy: 'reset',
      ...(simple.mode === 'degraded'
        ? { degradation: { fraction: 0.3, serviceTimeMultiplier: 10 } }
        : {})
    }
  }
}

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
  onReset: () => void
  isPostRun: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  isRunning: boolean
  isPaused: boolean
  sourceNodes: SourceNodeOption[]
  faultTargets: FaultTargetOption[]
  scenario: ScenarioState
  onScenarioChange: (updater: (current: ScenarioState) => ScenarioState) => void
  disabled?: boolean
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
  onReset,
  isPostRun,
  onPause,
  onResume,
  onStop,
  isRunning,
  isPaused,
  sourceNodes,
  faultTargets,
  scenario,
  onScenarioChange,
  disabled = false
}: SimulationControlsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const selectedSource =
    sourceNodes.find((node) => node.id === scenario.selectedSourceNodeId) ?? sourceNodes[0]

  const effectiveWorkload = useMemo(
    () =>
      selectedSource?.workload
        ? mergeWorkloadDefaults(selectedSource.workload, scenario.workloadOverride)
        : undefined,
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

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
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

  // Single injected fault, derived from / written back to scenario.faults[0].
  const currentFault = scenario.faults?.[0]
  const faultEnabled = Boolean(currentFault)
  const fault: SimpleFault = currentFault
    ? readFault(currentFault)
    : { targetId: faultTargets[0]?.id ?? '', atS: 5, durationS: 10, mode: 'blackhole' }

  const patchFault = (patch: Partial<SimpleFault>): void => {
    onScenarioChange((current) => {
      const base = current.faults?.[0]
        ? readFault(current.faults[0])
        : { targetId: faultTargets[0]?.id ?? '', atS: 5, durationS: 10, mode: 'blackhole' as const }
      const next = { ...base, ...patch }
      return { ...current, faults: next.targetId ? [buildFault(next)] : [] }
    })
  }

  const toggleFault = (enabled: boolean): void => {
    onScenarioChange((current) => {
      if (!enabled) return { ...current, faults: [] }
      const target = faultTargets[0]?.id
      return target
        ? {
            ...current,
            faults: [buildFault({ targetId: target, atS: 5, durationS: 10, mode: 'blackhole' })]
          }
        : current
    })
  }

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-1.5">
      {!isRunning && !isPaused && (
        <>
          {isPostRun && (
            <button
              onClick={onReset}
              title="Clear results and return to setup"
              className={`${ACTION_BUTTON_BASE} flex items-center gap-1.5 bg-nss-surface text-nss-text border-nss-border hover:bg-nss-bg`}
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
          <button
            onClick={() => setIsOpen((prev) => !prev)}
            disabled={disabled}
            className={`${ACTION_BUTTON_BASE} flex items-center gap-1.5 bg-nss-primary text-white border-transparent hover:bg-nss-primary-hover`}
          >
            <Play size={12} className="fill-white" />
            {isPostRun ? 'Run again' : 'Run'}
          </button>
        </>
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
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-nss-muted">
              Workload
            </p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close workload tray"
              title="Close"
              className="text-nss-muted hover:text-nss-text transition-colors"
            >
              <X size={14} />
            </button>
          </div>

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
            <input
              type="text"
              value={scenario.global.seed}
              onChange={(event) => setGlobalField('seed', event.target.value)}
              className={CONTROL_BASE}
            />
          </Field>

          <div className="h-px bg-nss-border my-3" />

          <label className="flex items-center justify-between mb-2 cursor-pointer">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-nss-muted">
              Chaos - inject a failure
            </span>
            <input
              type="checkbox"
              checked={faultEnabled}
              disabled={faultTargets.length === 0}
              onChange={(event) => toggleFault(event.target.checked)}
              className="accent-nss-danger"
            />
          </label>
          {faultTargets.length === 0 ? (
            <p className="text-[10px] text-nss-muted mb-3">
              Add a non-source component to target with a fault.
            </p>
          ) : (
            faultEnabled && (
              <div className="space-y-2 mb-3">
                <Field label="Target">
                  <select
                    value={fault.targetId}
                    onChange={(event) => patchFault({ targetId: event.target.value })}
                    className={CONTROL_BASE}
                  >
                    {faultTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Mode">
                  <select
                    value={fault.mode}
                    onChange={(event) => patchFault({ mode: event.target.value as FailureMode })}
                    className={CONTROL_BASE}
                  >
                    {FAILURE_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Fail at (s)">
                    <NumberInput
                      value={fault.atS}
                      min={0}
                      onChange={(value) => patchFault({ atS: value })}
                    />
                  </Field>
                  <Field label="Duration (s, 0 = never recovers)">
                    <NumberInput
                      value={fault.durationS}
                      min={0}
                      onChange={(value) => patchFault({ durationS: value })}
                    />
                  </Field>
                </div>
              </div>
            )
          )}

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
