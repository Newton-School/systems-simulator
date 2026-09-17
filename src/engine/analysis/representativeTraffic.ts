/**
 * Turns an analytic {@link FluidEvaluation} into a small, capped stream of
 * representative {@link EdgeFlowEvent}s for the canvas animation.
 *
 * At flash-sale scale the real traffic is millions of requests per second — far
 * too many to draw, and the fluid path never created per-request objects anyway.
 * The animation is purely illustrative, so we emit a fixed visual budget of dots
 * whose *relative* density across edges matches the computed flow, and whose
 * success/failure mix matches the computed drop rate. Each dot therefore stands
 * for many real requests; that scale is reported as `requestsPerDot` so the UI
 * can label it honestly ("1 dot ≈ 25,000 req/s").
 *
 * The dots are cosmetic and must never be read back as a metric — the exact
 * numbers live in the {@link FluidEvaluation} / SimulationOutput, not in the dot
 * count. This generator is deterministic (evenly spaced, no RNG) so a given
 * topology always animates the same way.
 */

import type { EdgeFlowEvent, EdgeFlowStatus } from '../core/events'
import type { EdgeDefinition, TopologyJSON } from '../core/types'
import { distributionMean, type FluidEvaluation } from './fluidModel'

export interface RepresentativeTrafficOptions {
  /** Total dots per second across the whole graph (visual budget). Default 40. */
  dotsPerSecond?: number
  /** Hard cap on emitted events regardless of duration/flow. Default 4000. */
  maxEvents?: number
  /** Simulated window to spread dots across (ms). Defaults to the topology's duration. */
  durationMs?: number
}

export interface RepresentativeTraffic {
  events: EdgeFlowEvent[]
  /**
   * How many real requests/second one dot represents. `0` when there is no flow.
   * Surface this in the UI so viewers know the animation is scaled, not literal.
   */
  requestsPerDot: number
}

const DEFAULT_DOTS_PER_SECOND = 40
const DEFAULT_MAX_EVENTS = 4000

/** Mean transit latency of an edge (ms), for spacing dot start/complete times. */
function edgeLatencyMs(edge: EdgeDefinition): number {
  const mean = distributionMean(edge.latency?.distribution)
  return Number.isFinite(mean) && mean > 0 ? mean : 1
}

export function generateRepresentativeTraffic(
  topology: TopologyJSON,
  fluid: FluidEvaluation,
  options: RepresentativeTrafficOptions = {}
): RepresentativeTraffic {
  const dotsPerSecond = options.dotsPerSecond ?? DEFAULT_DOTS_PER_SECOND
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const durationMs = Math.max(1, options.durationMs ?? topology.global?.simulationDuration ?? 1000)
  const durationSec = durationMs / 1000

  // Total flow crossing all edges — the basis for the shared dot scale.
  const totalFlowRps = Object.values(fluid.perEdge).reduce((sum, e) => sum + e.flowRps, 0)
  if (totalFlowRps <= 0 || dotsPerSecond <= 0) {
    return { events: [], requestsPerDot: 0 }
  }

  // One shared scale for every edge: requests/second represented by one dot.
  let requestsPerDot = totalFlowRps / dotsPerSecond

  // Respect the hard cap: if the visual budget over the whole window would exceed
  // maxEvents, coarsen the scale (fewer dots, each worth more) so we stay bounded.
  const projectedEvents = (totalFlowRps / requestsPerDot) * durationSec
  if (projectedEvents > maxEvents) {
    requestsPerDot = (totalFlowRps * durationSec) / maxEvents
  }

  const events: EdgeFlowEvent[] = []
  let sequence = 0

  for (const edge of topology.edges) {
    const flow = fluid.perEdge[edge.id]?.flowRps ?? 0
    if (flow <= 0) continue

    // Dots for this edge across the whole window, proportional to its flow.
    const dotCount = Math.round((flow / requestsPerDot) * durationSec)
    if (dotCount <= 0) continue

    const latency = edgeLatencyMs(edge)

    // Failure share on this edge: the fraction of the target node's offered load
    // that the node sheds (representative of drops downstream of this hop).
    const target = fluid.perNode[edge.target]
    const failFraction = target && target.offeredRps > 0 ? target.droppedRps / target.offeredRps : 0

    for (let i = 0; i < dotCount; i++) {
      // Evenly space starts across the window; deterministic, no RNG.
      const startedAtMs = (durationMs * i) / dotCount
      // Deterministically mark the first `failFraction` of dots as failures so
      // the visible success/failure mix matches the computed drop rate.
      const isFailure = dotCount > 0 && i < Math.round(failFraction * dotCount)
      const status: EdgeFlowStatus = isFailure ? 'edge-error' : 'success'
      events.push({
        sequence: sequence++,
        requestId: `fluid-${edge.id}-${i}`,
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        startedAtMs,
        completedAtMs: startedAtMs + latency,
        latencyMs: latency,
        status,
        ...(isFailure ? { failureCause: 'edge_error_rate' as const } : {})
      })
    }
  }

  events.sort((a, b) => a.startedAtMs - b.startedAtMs || a.sequence - b.sequence)
  return { events, requestsPerDot }
}
