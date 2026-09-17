/**
 * Adapts an analytic {@link evaluateFluidModel} result into a full
 * {@link SimulationOutput}, so grading, invariants and the UI consume a
 * fluid-computed run exactly as they consume a discrete-event run.
 *
 * The trick: build a correctly-shaped, zeroed output from a fresh
 * `MetricsCollector` (which emits a valid entry for every registered node even
 * with no events), then overlay the steady-state numbers the fluid model
 * computed — per-node utilization / throughput / error rate, and the run summary.
 * Everything the fluid model does not model (latency percentiles, queue lengths,
 * per-request traces) stays at its zeroed default, which is honest: those are not
 * derivable from rates alone.
 *
 * The headroom rule ("no node over 80%") is asserted with an ordinary
 * `InvariantCheck` — `perNode.maxUtilization <= 0.8` — which `resolveMetric`
 * already understands. Because we populate `perNode[*].utilization`, that
 * invariant evaluates against the fluid result with no special-casing.
 */

import { detectSinglePointsOfFailure } from './singlePointOfFailure'
import { evaluateInvariantViolations } from './invariants'
import { generateSimulationOutput, type SimulationOutput } from './output'
import { evaluateFluidModel, type FluidModelOptions } from './fluidModel'
import { generateRepresentativeTraffic } from './representativeTraffic'
import { approxResponsePercentileMs as approxPct } from './queueingLatency'
import { MetricsCollector } from '../metrics'
import { RequestTracer } from '../tracer'
import type { TopologyJSON } from '../core/types'

/**
 * Run a topology through the analytic fluid model and return a `SimulationOutput`.
 * `options` is forwarded to {@link evaluateFluidModel} (headroom target, offered
 * rate override).
 */
export function runFluidSimulation(
  topology: TopologyJSON,
  options: FluidModelOptions = {}
): SimulationOutput {
  const fluid = evaluateFluidModel(topology, options)

  // A fresh collector registered with the topology's nodes/edges yields a fully
  // valid, zeroed output shape — one perNode entry per node — which we then
  // overlay with the fluid numbers.
  const metrics = new MetricsCollector({
    warmupDuration: topology.global.warmupDuration ?? 0,
    nodes: topology.nodes.map((n) => ({ id: n.id, label: n.label, slo: n.slo })),
    edges: topology.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
  })
  const tracer = new RequestTracer({ sampleRate: 0 })

  const base = generateSimulationOutput(metrics, tracer, [], null, [], topology.global, 0)

  const durationSec = Math.max(0, base.summary.postWarmupDurationSec)
  // Latency ceiling for unstable (ρ ≥ 1) nodes: a request that can never clear the
  // queue instead burns its timeout, so report that rather than Infinity (which
  // would not survive JSON transport or chart rendering).
  const timeoutMs = topology.global.defaultTimeout ?? 30_000
  const finiteMs = (ms: number): number => (Number.isFinite(ms) ? ms : timeoutMs)

  let bottleneckResponseMs = 0

  // Overlay per-node steady-state numbers. Rates are the ground truth; counts are
  // rate × window so downstream count-based views stay internally consistent.
  for (const node of topology.nodes) {
    const f = fluid.perNode[node.id]
    const entry = base.perNode[node.id]
    if (!f || !entry) continue

    const arrived = f.offeredRps * durationSec
    const processed = f.servedRps * durationSec
    const dropped = f.droppedRps * durationSec
    const errorRate = f.offeredRps > 0 ? f.droppedRps / f.offeredRps : 0

    entry.utilization = f.utilization
    entry.workerUtilization = f.utilization
    entry.throughput = f.servedRps
    entry.errorRate = errorRate
    entry.availability = 1 - errorRate
    entry.totalArrived = arrived
    entry.postWarmupArrived = arrived
    entry.totalProcessed = processed
    entry.postWarmupProcessed = processed
    entry.totalRejected = dropped
    entry.postWarmupRejected = dropped

    if (f.latency) {
      const p50 = finiteMs(f.latency.p50Ms)
      const p95 = finiteMs(f.latency.p95Ms)
      const p99 = finiteMs(f.latency.p99Ms)
      entry.latencyP50 = p50
      entry.latencyP95 = p95
      entry.latencyP99 = p99
      entry.latencyNodeLocal = {
        p50,
        p90: p95,
        p95,
        p99,
        min: 0,
        max: p99,
        mean: finiteMs(f.latency.meanResponseMs)
      }
      if (finiteMs(f.latency.meanResponseMs) > bottleneckResponseMs) {
        bottleneckResponseMs = finiteMs(f.latency.meanResponseMs)
      }
    }
  }

  // Overlay the run summary from the aggregate flow.
  const totalArrived = fluid.offeredRps * durationSec
  base.summary.totalRequests = totalArrived
  base.summary.postWarmupTotalRequests = totalArrived
  base.summary.successfulRequests = fluid.servedRps * durationSec
  base.summary.postWarmupSuccessfulRequests = fluid.servedRps * durationSec
  base.summary.failedRequests = fluid.droppedRps * durationSec
  base.summary.postWarmupFailedRequests = fluid.droppedRps * durationSec
  base.summary.rejectedRequests = fluid.droppedRps * durationSec
  base.summary.throughput = fluid.servedRps
  base.summary.errorRate = fluid.dropRate

  // System latency is dominated by the busiest node on the path; report that
  // node's response distribution as the run-level latency (bottleneck-dominated
  // approximation, consistent with the per-node figures above).
  if (bottleneckResponseMs > 0) {
    base.summary.latency = {
      p50: approxPct(bottleneckResponseMs, 0.5),
      p90: approxPct(bottleneckResponseMs, 0.9),
      p95: approxPct(bottleneckResponseMs, 0.95),
      p99: approxPct(bottleneckResponseMs, 0.99),
      min: 0,
      max: approxPct(bottleneckResponseMs, 0.99),
      mean: bottleneckResponseMs
    }
  }

  const representative = generateRepresentativeTraffic(topology, fluid)

  return {
    ...base,
    invariantViolations: evaluateInvariantViolations(topology.invariants, base),
    singlePointsOfFailure: detectSinglePointsOfFailure(topology),
    evaluationMode: 'analytic',
    requestsPerDot: representative.requestsPerDot
  }
}

/**
 * Representative edge-flow dots for an analytic run's canvas animation. Kept
 * separate from {@link runFluidSimulation} so the worker can stream the dots
 * without threading them through the (metric-only) `SimulationOutput`.
 */
export function fluidRepresentativeTraffic(
  topology: TopologyJSON,
  options: FluidModelOptions = {}
) {
  return generateRepresentativeTraffic(topology, evaluateFluidModel(topology, options))
}
