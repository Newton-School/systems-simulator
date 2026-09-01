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
      /**
       * Count-style metrics any capability trait reported for this node via
       * `payload.metricCounters` (e.g. `reservationOversells`). Addressable in a
       * rubric as `perNode.<nodeId>.traitCounters.<counter>`.
       */
      traitCounters: Record<string, number>
    }
  >
  /**
   * Run-wide reservation/inventory tallies, summed across every reservation
   * authority in the graph. `oversells` is the count of times a key was
   * committed by a second, independent authority — the double-booking signal.
   * Zero for a correct single-authority design; positive when writes for one key
   * reach more than one uncoordinated reservation node. Grade with a rubric
   * simulation check `reservations.oversells == 0`.
   */
  reservations: {
    commits: number
    conflicts: number
    oversells: number
  }
  /**
   * Run-wide distributed-lock tallies, summed across every `distributed-lock`
   * node. `contentions` is how many acquire attempts were rejected because
   * another request still held the lease — the mutual-exclusion pressure signal.
   * Grade with e.g. `locks.contentions < N`, or `locks.acquires > 0` to prove the
   * lock is on the path. `keyless` counts requests that reached the lock without a
   * lock key (usually an authoring/wiring mistake).
   */
  locks: {
    acquires: number
    contentions: number
    keyless: number
  }
  /**
   * Run-wide retry tallies, summed across every caller node with a retry policy.
   * `attempts` is total retry re-entries; `budgetExhausted` is how many requests
   * gave up after burning their retry budget. Grade retry-amplification lessons
   * with e.g. `retries.attempts < N` or `retries.budgetExhausted == 0`.
   */
  retries: {
    attempts: number
    budgetExhausted: number
  }
  /**
   * Run-wide rate-limiter tallies, summed across every rate-limiter node.
   * `admitted`/`rejected` are the admission-control decisions. `breaches` is the
   * key signal: how many admits pushed the true rolling-window count for a key
   * above the contracted `limit` — non-zero means the limit was violated, either
   * by two uncoordinated local limiters or by a fixed-window edge burst. Grade
   * the rate-limiter correctness lesson with `rateLimit.breaches == 0`.
   * `keyless` counts requests that reached a per-key limiter without the key
   * field (usually a wiring mistake).
   */
  rateLimit: {
    admitted: number
    rejected: number
    breaches: number
    keyless: number
  }
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

/**
 * Sums one trait counter across every node, so a rubric can grade a run-wide
 * total without knowing which node id reported it. Capability traits report
 * these via `payload.metricCounters` (and the engine for retry counters); they
 * land in each node's `traitCounters`.
 */
function sumTraitCounter(output: SimulationOutput, counter: string): number {
  let total = 0
  for (const metrics of Object.values(output.perNode)) {
    total += metrics.traitCounters?.[counter] ?? 0
  }
  return total
}

/** Run-wide reservation tallies (see the reservation-store capability). */
function sumReservationCounters(output: SimulationOutput): SimulationVerdict['reservations'] {
  return {
    commits: sumTraitCounter(output, 'reservationCommits'),
    conflicts: sumTraitCounter(output, 'reservationConflicts'),
    oversells: sumTraitCounter(output, 'reservationOversells')
  }
}

/** Run-wide distributed-lock tallies (see the lock-lease capability). */
function sumLockCounters(output: SimulationOutput): SimulationVerdict['locks'] {
  return {
    acquires: sumTraitCounter(output, 'lockAcquires'),
    contentions: sumTraitCounter(output, 'lockContentions'),
    keyless: sumTraitCounter(output, 'lockKeyless')
  }
}

/** Run-wide retry tallies (see the retry-backoff capability). */
function sumRetryCounters(output: SimulationOutput): SimulationVerdict['retries'] {
  return {
    attempts: sumTraitCounter(output, 'retryAttempts'),
    budgetExhausted: sumTraitCounter(output, 'retryBudgetExhausted')
  }
}

/** Run-wide rate-limiter tallies (see the rate-limiter capability). */
function sumRateLimitCounters(output: SimulationOutput): SimulationVerdict['rateLimit'] {
  return {
    admitted: sumTraitCounter(output, 'rateAdmitted'),
    rejected: sumTraitCounter(output, 'rateRejected'),
    breaches: sumTraitCounter(output, 'rateLimitBreaches'),
    keyless: sumTraitCounter(output, 'rateKeyless')
  }
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
          peakQueueLength: metrics.peakQueueLength,
          traitCounters: { ...metrics.traitCounters }
        }
      ])
    ),
    reservations: sumReservationCounters(output),
    locks: sumLockCounters(output),
    retries: sumRetryCounters(output),
    rateLimit: sumRateLimitCounters(output),
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
