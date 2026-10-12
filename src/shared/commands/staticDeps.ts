import type { SimulationOutput } from '../../engine/analysis/output'
import type { TopologyJSON } from '../../engine/core/types'
import type { Palette } from '../ansi'
import type { CommandDeps, SimulationStateView, ValidationView } from './types'

export interface StaticDepsOptions {
  palette: Palette
  validate: (topology: TopologyJSON) => ValidationView
  /** Runs the topology to completion (the sim cli passes `runSimulation`). */
  runner?: (topology: TopologyJSON) => SimulationOutput
  /** Pre-computed results (tests). */
  results?: SimulationOutput
}

/**
 * Deps over a fixed TopologyJSON, for `sim shell` and tests: read-only model
 * commands, and `run` executes synchronously to completion. There is no live
 * run to pause or step, and no canvas to edit, so those members are absent.
 */
export function createStaticDeps(topology: TopologyJSON, options: StaticDepsOptions): CommandDeps {
  let results: SimulationOutput | null = options.results ?? null
  let error: string | null = null
  const state = (): SimulationStateView => ({
    status: error ? 'error' : results ? 'complete' : 'idle',
    progress: results ? 100 : 0,
    eventsProcessed: results?.eventsProcessed ?? 0,
    playbackSpeed: 'max',
    stopped: false,
    error,
    snapshot: null,
    results,
    runTopology: results ? topology : null
  })
  return {
    palette: options.palette,
    host: 'cli',
    topology: () => ({ topology, errors: [] }),
    validate: options.validate,
    sim: {
      state,
      run: () => {
        if (!options.runner) return 'Running is not available here.'
        const validation = options.validate(topology)
        if (!validation.valid) {
          return `Topology is invalid: ${validation.errors.map((e) => e.message).join('; ')}`
        }
        try {
          results = options.runner(topology)
          error = null
          return null
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
          return `Run failed: ${error}`
        }
      }
    }
  }
}
