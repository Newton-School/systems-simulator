import type { TopologyJSON } from '../../../../engine/core/types'
import {
  CHAOS_PRESETS,
  buildExperimentFromPresets,
  type BuiltExperiment
} from '../../../../engine/scenarios'
import type { ExperimentEntry } from '@renderer/types/ui'

export const EXPERIMENT_PRESET_OPTIONS = CHAOS_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.name,
  summary: preset.summary
}))

export type ExperimentPreview = BuiltExperiment

/**
 * Build the experiment the run dialog describes: one preset, or several composed
 * with their offsets. Returns a plain reason instead of throwing, so the dialog
 * can show it and the run can refuse to start.
 */
export function buildExperimentForTopology(
  topology: TopologyJSON,
  entries: ExperimentEntry[]
): ExperimentPreview {
  return buildExperimentFromPresets(
    topology,
    entries.map((entry) => ({
      presetId: entry.presetId,
      offsetMs: Math.max(0, Math.round(entry.offsetS)) * 1000
    }))
  )
}

export function fmtExperimentTime(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`
}
