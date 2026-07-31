import type { SimulationOutput } from './output'

export const SIMULATION_VERDICT_VERSION = '1.0' as const

export interface SimulationVerdict {
  version: typeof SIMULATION_VERDICT_VERSION
  meta: {
    seed: string
    simulationDurationMs: number
    warmupDurationMs: number
    eventsProcessed: number
    reproducible: boolean
  }
  summary: {
    totalRequests: number
    postWarmupTotalRequests: number
    successfulRequests: number
    postWarmupSuccessfulRequests: number
    failedRequests: number
    postWarmupFailedRequests: number
    rejectedRequests: number
    timedOutRequests: number
    connectionResetRequests: number
    throughput: number
    errorRate: number
    latency: {
      p50: number | null
      p90: number | null
      p95: number | null
      p99: number | null
      min: number | null
      max: number | null
      mean: number | null
    }
  }
  perNode: Record<
    string,
    {
      nodeLabel: string
      totalArrived: number
      totalProcessed: number
      totalRejected: number
      totalTimedOut: number
      totalConnectionReset: number
      utilization: number
      throughput: number
      errorRate: number
      availability: number
      latencyP50: number
      latencyP95: number
      latencyP99: number
      avgQueueLength: number
      avgServiceTime: number
      peakQueueLength: number
    }
  >
  sloTargetCount: number
  sloBreaches: Array<{
    nodeId: string
    nodeLabel: string
    metric: 'latencyP99' | 'availability'
    target: number
    actual: number
    severity: 'warning' | 'critical'
  }>
  invariantViolations: Array<{
    invariantId: string
    invariantName: string
    violatedAt: number
    details: string
    rootCause?: string
    affectedComponents?: string[]
  }>
  conservation: Array<{
    nodeId: string
    nodeLabel?: string
    arrived: number
    processed: number
    rejected: number
    timedOut: number
    connectionReset: number
    inFlight: number
    balanced: boolean
  }>
  littlesLaw: Array<{
    nodeId: string
    observedL: number
    expectedL: number
    error: number
    withinTolerance: boolean
    lambda: number
    wSeconds: number
  }>
}

export function projectToVerdict(output: SimulationOutput): SimulationVerdict {
  return {
    version: SIMULATION_VERDICT_VERSION,
    meta: {
      seed: output.seed,
      simulationDurationMs: output.simulationDuration,
      warmupDurationMs: output.warmupDuration,
      eventsProcessed: output.eventsProcessed,
      reproducible: output.reproducible
    },
    summary: {
      totalRequests: output.summary.totalRequests,
      postWarmupTotalRequests: output.summary.postWarmupTotalRequests,
      successfulRequests: output.summary.successfulRequests,
      postWarmupSuccessfulRequests: output.summary.postWarmupSuccessfulRequests,
      failedRequests: output.summary.failedRequests,
      postWarmupFailedRequests: output.summary.postWarmupFailedRequests,
      rejectedRequests: output.summary.rejectedRequests,
      timedOutRequests: output.summary.timedOutRequests,
      connectionResetRequests: output.summary.connectionResetRequests,
      throughput: output.summary.throughput,
      errorRate: output.summary.errorRate,
      latency: {
        p50: output.summary.latency.p50,
        p90: output.summary.latency.p90,
        p95: output.summary.latency.p95,
        p99: output.summary.latency.p99,
        min: output.summary.latency.min,
        max: output.summary.latency.max,
        mean: output.summary.latency.mean
      }
    },
    perNode: Object.fromEntries(
      Object.entries(output.perNode).map(([nodeId, metrics]) => [
        nodeId,
        {
          nodeLabel: metrics.nodeLabel ?? nodeId,
          totalArrived: metrics.totalArrived,
          totalProcessed: metrics.totalProcessed,
          totalRejected: metrics.totalRejected,
          totalTimedOut: metrics.totalTimedOut,
          totalConnectionReset: metrics.totalConnectionReset,
          utilization: metrics.utilization,
          throughput: metrics.throughput,
          errorRate: metrics.errorRate,
          availability: metrics.availability,
          latencyP50: metrics.latencyP50,
          latencyP95: metrics.latencyP95,
          latencyP99: metrics.latencyP99,
          avgQueueLength: metrics.avgQueueLength,
          avgServiceTime: metrics.avgServiceTime,
          peakQueueLength: metrics.peakQueueLength
        }
      ])
    ),
    sloTargetCount: output.sloTargetCount,
    sloBreaches: output.sloBreaches.map((breach) => ({ ...breach })),
    invariantViolations: output.invariantViolations.map((violation) => ({
      invariantId: violation.invariantId,
      invariantName: violation.invariantName,
      violatedAt: violation.violatedAt,
      details: violation.details,
      ...(violation.rootCause ? { rootCause: violation.rootCause } : {}),
      ...(violation.affectedComponents
        ? { affectedComponents: [...violation.affectedComponents] }
        : {})
    })),
    conservation: output.conservationCheck.map((check) => ({
      nodeId: check.nodeId,
      ...(check.nodeLabel ? { nodeLabel: check.nodeLabel } : {}),
      arrived: check.postWarmupArrived,
      processed: check.postWarmupProcessed,
      rejected: check.postWarmupRejected,
      timedOut: check.postWarmupTimedOut,
      connectionReset: check.postWarmupConnectionReset,
      inFlight: check.inFlight,
      balanced: check.balanced
    })),
    littlesLaw: output.littlesLawCheck.map((check) => ({
      nodeId: check.nodeId,
      observedL: check.observedL,
      expectedL: check.expectedL,
      error: check.error,
      withinTolerance: check.withinTolerance,
      lambda: check.lambda,
      wSeconds: check.wSeconds
    }))
  }
}
