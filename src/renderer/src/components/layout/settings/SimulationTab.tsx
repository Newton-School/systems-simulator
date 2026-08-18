import { useMemo } from 'react'
import type { CanvasNodeDataV2 } from '../../../../../engine/catalog/nodeSpecTypes'
import { hasWorkloadSourceConfig } from '../../../../../engine/catalog/sourceNodeSemantics'
import useStore from '@renderer/store/useStore'
import { mergeWorkloadDefaults } from '@renderer/utils/workloadDefaults'
import type { FaultTargetOption, ScenarioState, SourceNodeOption } from '@renderer/types/ui'
import {
  buildFault,
  FAILURE_MODE_OPTIONS,
  PATTERN_OPTIONS,
  readFault,
  type SimpleFault,
  type WorkloadPattern
} from '@renderer/components/simulation/simulationControlModel'
import {
  NumberField,
  SectionLabel,
  SelectField,
  SettingRow,
  TextField,
  Toggle
} from './SettingsControls'

const AUTO_SOURCE_VALUE = '__AUTO__'

function updateWorkloadOverride(
  current: ScenarioState,
  updater: (override: NonNullable<ScenarioState['workloadOverride']>) => NonNullable<ScenarioState['workloadOverride']>
): ScenarioState {
  return {
    ...current,
    workloadOverride: updater({ ...(current.workloadOverride ?? {}) })
  }
}

export function SimulationTab(): React.JSX.Element {
  const nodes = useStore((s) => s.nodes)
  const scenario = useStore((s) => s.scenario)
  const updateScenario = useStore((s) => s.updateScenario)

  const sourceNodes = useMemo<SourceNodeOption[]>(
    () =>
      nodes
        .filter((node) => hasWorkloadSourceConfig(node.data as Partial<CanvasNodeDataV2>))
        .map((node) => {
          const data = node.data as CanvasNodeDataV2
          return {
            id: node.id,
            label: data.label && data.label.trim().length > 0 ? `${data.label} (${node.id})` : node.id,
            workload: data.source?.defaultWorkload ?? {
              pattern: 'constant',
              baseRps: 100,
              bursty: { burstRps: 500, burstDuration: 2000, normalDuration: 8000 },
              spike: { spikeTime: 30_000, spikeRps: 1000, spikeDuration: 5000 },
              sawtooth: { peakRps: 300, rampDuration: 10_000 }
            }
          }
        }),
    [nodes]
  )

  const faultTargets = useMemo<FaultTargetOption[]>(
    () =>
      nodes
        .filter((node) => {
          const data = node.data as CanvasNodeDataV2
          return data.profile !== 'source' && data.structuralRole !== 'composite'
        })
        .map((node) => {
          const data = node.data as CanvasNodeDataV2
          return {
            id: node.id,
            label: data.label && data.label.trim().length > 0 ? `${data.label} (${node.id})` : node.id
          }
        }),
    [nodes]
  )

  const selectedSource =
    sourceNodes.find((node) => node.id === scenario.selectedSourceNodeId) ?? sourceNodes[0]
  const effectiveWorkload = useMemo(
    () =>
      selectedSource?.workload
        ? mergeWorkloadDefaults(selectedSource.workload, scenario.workloadOverride)
        : undefined,
    [scenario.workloadOverride, selectedSource]
  )

  const currentFault = scenario.faults?.[0]
  const faultEnabled = Boolean(currentFault)
  const fault: SimpleFault = currentFault
    ? readFault(currentFault)
    : { targetId: faultTargets[0]?.id ?? '', atS: 5, durationS: 10, mode: 'blackhole' }

  const setGlobalField = (
    key: keyof ScenarioState['global'],
    value: ScenarioState['global'][keyof ScenarioState['global']]
  ) => {
    updateScenario((current) => ({
      ...current,
      global: {
        ...current.global,
        [key]: value
      }
    }))
  }

  const setWorkloadField = <K extends keyof NonNullable<ScenarioState['workloadOverride']>>(
    key: K,
    value: NonNullable<ScenarioState['workloadOverride']>[K]
  ) => {
    updateScenario((current) =>
      updateWorkloadOverride(current, (override) => ({ ...override, [key]: value }))
    )
  }

  const patchFault = (patch: Partial<SimpleFault>) => {
    updateScenario((current) => {
      const base = current.faults?.[0]
        ? readFault(current.faults[0])
        : { targetId: faultTargets[0]?.id ?? '', atS: 5, durationS: 10, mode: 'blackhole' as const }
      const next = { ...base, ...patch }
      return { ...current, faults: next.targetId ? [buildFault(next)] : [] }
    })
  }

  const toggleFault = (enabled: boolean) => {
    updateScenario((current) => {
      if (!enabled) return { ...current, faults: [] }
      const target = current.faults?.[0] ? readFault(current.faults[0]).targetId : faultTargets[0]?.id
      return target
        ? {
            ...current,
            faults: [
              buildFault({
                targetId: target,
                atS: fault.atS,
                durationS: fault.durationS,
                mode: fault.mode
              })
            ]
          }
        : current
    })
  }

  return (
    <div className="space-y-1">
      <SettingRow
        label="Run duration"
        hint="How long the simulated clock runs before the worker drains and results are finalized."
      >
        <NumberField
          value={Math.round(scenario.global.simulationDuration / 1000)}
          min={1}
          suffix="sec"
          onChange={(value) => setGlobalField('simulationDuration', value * 1000)}
        />
      </SettingRow>

      <SettingRow
        label="Warmup duration"
        hint="Warmup traffic is excluded from the post-warmup metrics and scorecards."
      >
        <NumberField
          value={Math.round(scenario.global.warmupDuration / 1000)}
          min={0}
          suffix="sec"
          onChange={(value) => setGlobalField('warmupDuration', value * 1000)}
        />
      </SettingRow>

      <SettingRow
        label="Seed"
        hint="Controls deterministic replay. The actual seed used is shown in the results footer after a run."
      >
        <TextField
          value={scenario.global.seed}
          placeholder="default-seed"
          onChange={(value) => setGlobalField('seed', value)}
        />
      </SettingRow>

      <SettingRow
        label="Randomize seed each run"
        hint="Generate a fresh seed before every run, while still recording the exact seed used for reproducibility."
      >
        <Toggle
          checked={scenario.randomizeSeedEachRun === true}
          onChange={(randomizeSeedEachRun) =>
            updateScenario((current) => ({ ...current, randomizeSeedEachRun }))
          }
        />
      </SettingRow>

      <SectionLabel>Workload</SectionLabel>

      <SettingRow
        label="Source node"
        hint="Auto picks the first workload-configured source on the canvas."
      >
        <SelectField
          value={scenario.selectedSourceNodeId ?? AUTO_SOURCE_VALUE}
          disabled={sourceNodes.length === 0}
          options={[
            { value: AUTO_SOURCE_VALUE, label: 'Auto (first source)' },
            ...sourceNodes.map((node) => ({ value: node.id, label: node.label }))
          ]}
          onChange={(value) =>
            updateScenario((current) => ({
              ...current,
              selectedSourceNodeId: value === AUTO_SOURCE_VALUE ? undefined : value
            }))
          }
        />
      </SettingRow>

      <SettingRow
        label="Workload pattern"
        hint="Sets the default arrival shape. Pattern-specific fine-tuning remains available in the Run popover."
      >
        <SelectField
          value={effectiveWorkload?.pattern ?? 'constant'}
          disabled={sourceNodes.length === 0}
          options={PATTERN_OPTIONS}
          onChange={(value) => setWorkloadField('pattern', value as WorkloadPattern)}
        />
      </SettingRow>

      <SettingRow label="Base RPS" hint="Offered steady-state request rate before burst/spike multipliers.">
        <NumberField
          value={effectiveWorkload?.baseRps ?? 100}
          min={1}
          suffix="rps"
          onChange={(value) => setWorkloadField('baseRps', value)}
        />
      </SettingRow>

      <SectionLabel>Chaos</SectionLabel>

      <SettingRow
        label="Inject a fault by default"
        hint={
          faultTargets.length === 0
            ? 'Add a non-source runtime component before enabling a fault preset.'
            : 'Keeps a default scheduled fault attached to this topology until you turn it off.'
        }
        disabled={faultTargets.length === 0}
      >
        <Toggle
          checked={faultEnabled}
          disabled={faultTargets.length === 0}
          onChange={toggleFault}
        />
      </SettingRow>

      {faultEnabled && faultTargets.length > 0 && (
        <>
          <SettingRow label="Fault target" hint="Which runtime component the injected failure applies to.">
            <SelectField
              value={fault.targetId}
              options={faultTargets.map((target) => ({ value: target.id, label: target.label }))}
              onChange={(value) => patchFault({ targetId: value })}
            />
          </SettingRow>

          <SettingRow label="Fault mode" hint="What kind of failure the simulator injects when the timer fires.">
            <SelectField
              value={fault.mode}
              options={FAILURE_MODE_OPTIONS}
              onChange={(value) => patchFault({ mode: value })}
            />
          </SettingRow>

          <SettingRow label="Fail at" hint="Simulated second when the failure begins.">
            <NumberField
              value={fault.atS}
              min={0}
              suffix="sec"
              onChange={(value) => patchFault({ atS: value })}
            />
          </SettingRow>

          <SettingRow
            label="Recover after"
            hint="How long the failure lasts. Use 0 for a permanent failure until the run ends."
          >
            <NumberField
              value={fault.durationS}
              min={0}
              suffix="sec"
              onChange={(value) => patchFault({ durationS: value })}
            />
          </SettingRow>
        </>
      )}
    </div>
  )
}
