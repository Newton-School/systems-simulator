import type { TopologyJSON } from '../../../../engine/core/types'
import {
  CHAOS_PRESETS,
  ExperimentCompileError,
  compileExperiment,
  composeScenarios,
  tryBuildPreset,
  type ChaosExperimentDefinition,
  type CompiledExperiment
} from '../../../../engine/scenarios'
import type { ExperimentEntry } from '@renderer/types/ui'

export const EXPERIMENT_PRESET_OPTIONS = CHAOS_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.name,
  summary: preset.summary
}))

export type ExperimentPreview =
  | { ok: true; definition: ChaosExperimentDefinition; compiled: CompiledExperiment }
  | { ok: false; reason: string }

/**
 * Build the experiment the run dialog describes: one preset, or several composed
 * with their offsets. Returns a plain reason instead of throwing, so the dialog
 * can show it and the run can refuse to start.
 */
export function buildExperimentForTopology(
  topology: TopologyJSON,
  entries: ExperimentEntry[]
): ExperimentPreview {
  if (entries.length === 0) return { ok: false, reason: 'Pick an experiment.' }
  const definitions: Array<{ experiment: ChaosExperimentDefinition; offsetMs: number }> = []
  for (const entry of entries) {
    const built = tryBuildPreset(topology, entry.presetId)
    if (built.ok === false) return { ok: false, reason: built.reason }
    definitions.push({
      experiment: built.definition,
      offsetMs: Math.max(0, Math.round(entry.offsetS)) * 1000
    })
  }
  try {
    const definition =
      definitions.length === 1 && definitions[0].offsetMs === 0
        ? definitions[0].experiment
        : composeScenarios(definitions)
    return { ok: true, definition, compiled: compileExperiment(topology, definition) }
  } catch (error) {
    if (error instanceof ExperimentCompileError)
      return { ok: false, reason: error.issues.join(' ') }
    if (error instanceof Error) return { ok: false, reason: error.message }
    throw error
  }
}

export function fmtExperimentTime(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`
}
