/**
 * Shared "build the experiment a person described" step for chaos presets: one
 * preset, or several composed with offsets, each with optional overrides. Used
 * by the run dialog (preview + run), the question grader (an experiment test
 * case, built against the learner's topology at grading time) and Question
 * Studio (preview against the reference design).
 *
 * Never throws for a design that simply cannot run the experiment: a preset
 * that does not apply ({@link PresetUnavailableError}) or a definition that does
 * not compile comes back as `{ ok: false, reason }` in plain language.
 */

import type { TopologyJSON } from '../core/types'
import {
  ExperimentCompileError,
  compileExperiment,
  type CompiledExperiment
} from './chaosExperiment'
import { composeScenarios } from './composer'
import { CHAOS_PRESETS, getChaosPreset, tryBuildPreset, type ChaosPresetId } from './presets'
import type { ChaosExperimentDefinition } from './types'

/** One preset in an experiment, with its start offset and overrides. */
export interface PresetEntry {
  presetId: string
  /** Delay before this preset's first step, in whole seconds expressed as ms. */
  offsetMs: number
  options?: Record<string, unknown>
}

export type BuiltExperiment =
  | { ok: true; definition: ChaosExperimentDefinition; compiled: CompiledExperiment }
  | { ok: false; reason: string }

export function buildExperimentFromPresets(
  topology: TopologyJSON,
  entries: readonly PresetEntry[]
): BuiltExperiment {
  if (entries.length === 0) return { ok: false, reason: 'Pick an experiment.' }
  const definitions: Array<{ experiment: ChaosExperimentDefinition; offsetMs: number }> = []
  for (const entry of entries) {
    const built = tryBuildPreset(topology, entry.presetId, entry.options)
    if (built.ok === false) return { ok: false, reason: built.reason }
    definitions.push({
      experiment: built.definition,
      offsetMs: Math.max(0, Math.round(entry.offsetMs / 1000)) * 1000
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

// ─── Preset options ──────────────────────────────────────────────────────────

/**
 * How an option is entered and stored. `percent` is stored as a fraction (0.05)
 * and shown as a percentage; `node` / `zone` hold an id from the topology.
 */
export type PresetOptionKind = 'percent' | 'ms' | 'seconds' | 'multiplier' | 'node' | 'zone'

export interface PresetOptionField {
  key: string
  label: string
  kind: PresetOptionKind
  /** Default the preset uses when the option is left out, in display terms. */
  defaultText: string
  help: string
}

const STEADY_STATE_FIELDS: PresetOptionField[] = [
  {
    key: 'maxErrorRate',
    label: 'Steady-state error rate below',
    kind: 'percent',
    defaultText: '1%',
    help: 'Must hold before the fault and again after it.'
  },
  {
    key: 'maxP99Ms',
    label: 'Steady-state p99 below',
    kind: 'ms',
    defaultText: '500 ms',
    help: 'Worst 1-second p99 in the steady-state windows.'
  }
]

export const PRESET_OPTION_FIELDS: Record<ChaosPresetId, PresetOptionField[]> = {
  'az-outage': [
    {
      key: 'zoneId',
      label: 'Zone to take down',
      kind: 'zone',
      defaultText: 'the zone holding the most components',
      help: 'Pinning a zone id only works if learner designs use that exact id - leave it on automatic otherwise.'
    },
    {
      key: 'outageSeconds',
      label: 'Zone down for',
      kind: 'seconds',
      defaultText: '10 s',
      help: 'Whole seconds.'
    },
    {
      key: 'maxOutageErrorRate',
      label: 'Error budget while down',
      kind: 'percent',
      defaultText: '5%',
      help: 'Error rate allowed while the zone is down.'
    },
    ...STEADY_STATE_FIELDS
  ],
  'db-failover': [
    {
      key: 'primaryNodeId',
      label: 'Primary database',
      kind: 'node',
      defaultText: 'the database marked primary, else the first one',
      help: 'Pinning a node id only works if learner designs use that exact id.'
    },
    {
      key: 'replicaNodeId',
      label: 'Replica database',
      kind: 'node',
      defaultText: 'a database marked replica, else another one',
      help: 'Pinning a node id only works if learner designs use that exact id.'
    },
    ...STEADY_STATE_FIELDS
  ],
  'cache-stampede': [
    {
      key: 'cacheNodeId',
      label: 'Cache to flush',
      kind: 'node',
      defaultText: 'the first cache with a hit model and an origin',
      help: 'Pinning a node id only works if learner designs use that exact id.'
    },
    {
      key: 'originNodeId',
      label: 'Origin behind it',
      kind: 'node',
      defaultText: 'the database behind the cache, else its first downstream',
      help: 'Pinning a node id only works if learner designs use that exact id.'
    },
    {
      key: 'coldForMs',
      label: 'Cold for (declared-rate caches)',
      kind: 'ms',
      defaultText: '5000 ms',
      help: 'How long every request misses after the flush when the cache uses a declared hit rate.'
    },
    ...STEADY_STATE_FIELDS
  ],
  'traffic-spike': [
    {
      key: 'multiplier',
      label: 'Traffic multiplier',
      kind: 'multiplier',
      defaultText: '10x',
      help: 'Multiple of the base request rate during the spike (more than 1).'
    },
    {
      key: 'spikeSeconds',
      label: 'Spike length',
      kind: 'seconds',
      defaultText: '10 s',
      help: 'Whole seconds.'
    },
    ...STEADY_STATE_FIELDS
  ]
}

export function presetOptionFields(presetId: string): PresetOptionField[] {
  return PRESET_OPTION_FIELDS[presetId as ChaosPresetId] ?? []
}

/** Plain problems with a preset's options (unknown preset, unknown key, wrong type or range). */
export function validatePresetOptions(
  presetId: string,
  options: Record<string, unknown> | undefined
): string[] {
  const preset = getChaosPreset(presetId)
  if (!preset) {
    return [
      `Unknown experiment preset "${presetId}". Use one of: ${CHAOS_PRESETS.map((p) => p.id).join(', ')}.`
    ]
  }
  const fields = new Map(presetOptionFields(presetId).map((field) => [field.key, field]))
  const issues: string[] = []
  for (const [key, value] of Object.entries(options ?? {})) {
    const field = fields.get(key)
    if (!field) {
      issues.push(
        `${preset.name} has no option "${key}". Known options: ${[...fields.keys()].join(', ')}.`
      )
      continue
    }
    if (field.kind === 'node' || field.kind === 'zone') {
      if (typeof value !== 'string' || value.trim() === '') {
        issues.push(`${preset.name}: "${key}" must be a non-empty id.`)
      }
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(`${preset.name}: "${key}" must be a number.`)
      continue
    }
    if (field.kind === 'percent' && (value < 0 || value > 1)) {
      issues.push(`${preset.name}: "${key}" is a fraction between 0 and 1 (0.05 = 5%).`)
    } else if (field.kind === 'multiplier' && !(value > 1)) {
      issues.push(`${preset.name}: "${key}" must be greater than 1.`)
    } else if ((field.kind === 'ms' || field.kind === 'seconds') && !(value > 0)) {
      issues.push(`${preset.name}: "${key}" must be greater than zero.`)
    }
  }
  return issues
}
