/**
 * Resolves a workload's {@link WorkloadStopCondition} into concrete run bounds
 * that both the discrete engine and the analytic fluid model consume the same way.
 *
 * The engine's run horizon is a hard time bound (`simulationDurationUs`), so
 * "run until N requests" is realised by (a) gating the workload generator to stop
 * emitting after N source requests and (b) giving the engine a horizon large
 * enough that all N arrive and drain — the run then ends naturally when the event
 * queue empties. That horizon is `effectiveDurationMs`.
 */

import type { TopologyJSON, WorkloadProfile } from './types'

export type StopReason = 'duration' | 'request-budget' | 'saturation'

export interface ResolvedStopCondition {
  mode: 'duration' | 'requestBudget'
  /** Source-request cap, or `null` for pure duration mode. */
  maxRequests: number | null
  /** Run horizon in ms (the derived window for request-budget mode). */
  effectiveDurationMs: number
  /** Utilization threshold for early abort, or `null` when not guarded. */
  haltUtilization: number | null
  /** System error-rate threshold for early abort, or `null` when not guarded. */
  haltErrorRate: number | null
}

/** Default early-abort utilization when `haltOnSaturation` is set without a value. */
export const DEFAULT_HALT_UTILIZATION = 1.0

/**
 * Extra time added past the estimated emit time in request-budget mode, so the
 * last requests have room to travel the graph and drain before the horizon.
 */
function drainMarginMs(topology: TopologyJSON): number {
  return Math.max(topology.global?.defaultTimeout ?? 30_000, 1_000)
}

export function resolveStopCondition(
  topology: TopologyJSON,
  workload: WorkloadProfile | undefined = topology.workload
): ResolvedStopCondition {
  const durationMs = topology.global?.simulationDuration ?? 0
  const stop = workload?.stopCondition
  const halt = stop?.haltOnSaturation

  const haltUtilization = halt ? (halt.utilization ?? DEFAULT_HALT_UTILIZATION) : null
  const haltErrorRate = halt?.errorRate ?? null

  if (stop?.mode === 'requestBudget' && stop.maxRequests && stop.maxRequests > 0) {
    const rate = Math.max(1, workload?.baseRps ?? 1)
    // Upper bound on time to emit N at the (floor) base rate, plus drain margin.
    const emitMs = (stop.maxRequests / rate) * 1000
    return {
      mode: 'requestBudget',
      maxRequests: Math.floor(stop.maxRequests),
      effectiveDurationMs: Math.ceil(emitMs) + drainMarginMs(topology),
      haltUtilization,
      haltErrorRate
    }
  }

  return {
    mode: 'duration',
    maxRequests: null,
    effectiveDurationMs: durationMs,
    haltUtilization,
    haltErrorRate
  }
}
