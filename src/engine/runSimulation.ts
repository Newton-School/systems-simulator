/**
 * Single entry point that runs a topology and returns a {@link SimulationOutput},
 * automatically choosing between the discrete-event engine and the analytic fluid
 * model based on how much load the run would generate.
 *
 * - `discrete` — the full per-request `SimulationEngine`. Faithful to retries,
 *   circuit breakers, queue jitter and every trait, but O(events).
 * - `analytic` — the rate-based {@link runFluidSimulation}. O(nodes+edges),
 *   answers the steady-state throughput/utilization/headroom questions at any
 *   scale, but does not model per-request behaviour.
 * - `auto` (default) — simulate when the estimated event count is affordable,
 *   compute when it is not (see {@link shouldUseFluidModel}).
 *
 * Grading, the CLI and the worker all go through here, so a flash-sale question at
 * 1,000,000 rps grades in milliseconds instead of hanging the event loop.
 */

import { SimulationEngine } from './engine'
import type { SimulationEngineOptions } from './engine'
import type { SimulationOutput } from './analysis/output'
import { runFluidSimulation } from './analysis/fluidSimulation'
import { shouldUseFluidModel, DEFAULT_MAX_SIMULATED_EVENTS } from './analysis/fluidModel'
import type { TopologyJSON } from './core/types'

export type EvaluationMode = 'auto' | 'discrete' | 'analytic'

export interface RunSimulationOptions {
  /** How to evaluate. Defaults to `auto`. */
  mode?: EvaluationMode
  /** Event-count ceiling above which `auto` switches to the fluid model. */
  maxSimulatedEvents?: number
  /** Options forwarded to the discrete-event engine when it runs. */
  engineOptions?: SimulationEngineOptions
}

/** Resolve which evaluation path a run will take, without running it. */
export function resolveEvaluationMode(
  topology: TopologyJSON,
  options: RunSimulationOptions = {}
): 'discrete' | 'analytic' {
  const mode = options.mode ?? 'auto'
  if (mode !== 'auto') return mode
  return shouldUseFluidModel(topology, options.maxSimulatedEvents ?? DEFAULT_MAX_SIMULATED_EVENTS)
    ? 'analytic'
    : 'discrete'
}

export function runSimulation(
  topology: TopologyJSON,
  options: RunSimulationOptions = {}
): SimulationOutput {
  if (resolveEvaluationMode(topology, options) === 'analytic') {
    return runFluidSimulation(topology)
  }
  return new SimulationEngine(topology, options.engineOptions).run()
}
