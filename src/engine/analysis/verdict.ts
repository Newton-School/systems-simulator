import { FEATURE_COUNTER_FAMILIES, type FeatureCounterFamily } from './featureCounterFamilies'
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
  /** Run-wide credential and scope decisions from authentication-capable nodes. */
  authentication: {
    attempts: number
    succeeded: number
    missingCredentials: number
    invalidCredentials: number
    expiredCredentials: number
    forbidden: number
  }
  /** API/content routing coverage and fallback correctness. */
  apiRouting?: {
    attempts: number
    matched: number
    unmatched: number
    fallbacks: number
    targetUnavailable: number
    rejects: number
    matchCoverage: number
    routedTargets: number
    busiestTargetRequests: number
  }
  /**
   * Run-wide read-consistency oracles, present only when at least one
   * datastore has a `consistencyModel` (absent otherwise, so a
   * `consistency.*` check never passes vacuously on an untracked design).
   * `staleReads` counts reads that returned an older version than the leader
   * had committed when the read arrived; `readYourWritesViolations` /
   * `monotonicReadViolations` count session-guarantee breaks (they need client
   * sessions on the workload). `linearizabilityViolations` is the number of
   * keys whose recorded history failed the single-key register check;
   * `linearizabilityOpsNotChecked` counts operations beyond the per-key /
   * key bound or whose search hit its budget, and `linearizableVerified` is 1
   * only when every recorded operation was checked and no key violated. Grade a
   * consistency lesson with e.g. `consistency.staleReads == 0`.
   */
  consistency?: {
    reads: number
    writes: number
    staleReads: number
    readYourWritesViolations: number
    monotonicReadViolations: number
    catchUpWaits: number
    catchUpWaitMs: number
    sessionlessReads: number
    linearizabilityKeysChecked: number
    linearizabilityViolations: number
    linearizabilityOpsChecked: number
    linearizabilityOpsNotChecked: number
    linearizableVerified: number
  }
  /** Accepted asynchronous work is conserved as delivered, retained/pending, or lost. */
  queue?: {
    accepted: number
    delivered: number
    pending: number
    dlqRouted: number
    lost: number
    redeliveries: number
    noLoss: number
    maxQueueDepth: number
    maxAvgQueueLength: number
    capacityRejected: number
  }
  /** Finite delivery-partner pool outcomes and accumulated availability wait. */
  partners?: {
    requests: number
    queuedForAvailability: number
    assignments: number
    assignmentFailures: number
    waits: number
    waitMs: number
  }
  /** Kafka-like broker state and lifecycle counters. */
  stream?: {
    brokers: number
    consumerGroupBrokers: number
    appends: number
    partitions: number
    consumerGroups: number
    consumerMembers: number
    consumerGroupAppends: number
    expectedGroupDeliveries: number
    groupsWithDeliveries: number
    groupDeliveries: number
    minGroupDeliveries: number
    maxGroupDeliveries: number
    groupFanoutCoverage: number
    retainedRecords: number
    totalLag: number
    maxPartitionLag: number
    offsetCommits: number
    rebalances: number
    replayReads: number
    retentionExpired: number
    unavailable: number
  }
  /** Key-routing skew and hot-shard remediation outcomes. */
  sharding?: {
    routingAttempts: number
    routedRequests: number
    distinctKeys: number
    missingKeys: number
    fallbackRoutes: number
    missingKeyRejects: number
    keyCoverage: number
    shardTargets: number
    maxShardRequests: number
    minShardRequests: number
    skewRatio: number
    hotDetections: number
    rebalances: number
    splits: number
    migratedKeys: number
  }
  /** Finite capacity and committed growth across storage-capacity-enabled nodes. */
  storage?: {
    nodes: number
    capacityGb: number
    initialUsedGb: number
    usedGb: number
    freeGb: number
    utilization: number
    maxNodeUtilization: number
    writeAttempts: number
    writesCommitted: number
    writtenGb: number
    writeFailures: number
    fullRejects: number
  }
  /**
   * Cache lookups counted across every node that served one (hits and misses
   * the cache trait reported). `hitRatio` is lookup-weighted across all caches
   * (sum of hits / sum of lookups), so a CDN miss that then hits Redis counts
   * one miss and one hit. `minHitRatio` / `maxHitRatio` are the worst and best
   * single cache. Counted over the whole run, never a point sample. Absent when
   * no cache lookup happened, so `cache.*` never grades a cacheless design.
   */
  cache?: {
    lookups: number
    hits: number
    misses: number
    hitRatio: number
    minHitRatio: number
    maxHitRatio: number
  }
  /**
   * Request collapsing (single-flight) on caches with `requestCollapsing` on.
   * `leaders` are misses that made the one downstream fetch for their key,
   * `collapsedMisses` waited behind a leader instead of calling downstream, and
   * `followersServed` / `followersFailed` are how those waiters ended. `noKey`
   * counts misses that could not collapse because the request had no key.
   * Absent when no cache has collapsing on.
   */
  collapse?: {
    leaders: number
    collapsedMisses: number
    followersServed: number
    followersFailed: number
    noKey: number
  }
  /**
   * Change-stream ordering on Event Streams with `changeStreamOrdering` on.
   * `orderViolations` counts consumers applying an older change for an entity
   * after a newer one; `waitedForOrder` counts deliveries held by per-partition
   * or per-key ordered consumption. Absent when no stream tracks ordering.
   */
  changeStream?: {
    captured: number
    applied: number
    orderViolations: number
    waitedForOrder: number
    failed: number
    noKey: number
  }
  /**
   * Fire-and-forget telemetry ingest on collectors with `telemetryAsyncIngest`
   * on. `offered` = ingested + dropped (events that reached the ingest check);
   * `sampledOut` events were never exported. `dropRate` = dropped / offered,
   * absent when nothing was offered. Absent when no collector ingests async.
   */
  telemetry?: {
    offered: number
    ingested: number
    dropped: number
    droppedOverIngest: number
    droppedBufferFull: number
    sampledOut: number
    dropRate?: number
  }
  /**
   * Cluster scheduling (bin-packing onto Kubernetes Cluster nodes), summed over
   * every cluster and scheduled workload. Replica and pending figures are
   * time-weighted means over the run (integral / duration), not end-of-run
   * snapshots. `readyRatio` = avgReadyReplicas / avgDesiredReplicas and
   * `minWorkloadReadyRatio` is the worst single workload. Recovery times are
   * absent until a lost pod is replaced. Absent when nothing is scheduled.
   */
  cluster?: {
    avgReadyReplicas: number
    avgDesiredReplicas: number
    readyRatio?: number
    minWorkloadReadyRatio?: number
    avgPendingPods: number
    peakPendingPods: number
    pendingPodSeconds: number
    podsLost: number
    podsRecovered: number
    podsUnrecovered: number
    meanRecoveryMs?: number
    maxRecoveryMs?: number
  }
  /**
   * Edge transport counters, summed (or maxed) across every edge, post-warmup.
   * `slots` is the in-flight cap every edge carries (maxConcurrentRequests):
   * zero when the cap never bound; absent only for a design with no edges or an
   * analytic run. `connections` (edge connection model) and `batching` (Kafka
   * producer batching) appear only when at least one edge used them.
   */
  edges?: {
    slots: {
      waited: number
      timedOutWaiting: number
      refused: number
      maxPeakWaiting: number
    }
    connections?: {
      opened: number
      resumed: number
      reused: number
      waited: number
      closedIdle: number
    }
    batching?: {
      batchesSent: number
      recordsSent: number
      meanRecordsPerBatch: number
    }
  }
  /**
   * Region / AZ / Subnet outages that actually took components down in this
   * run. `componentsFailed` is distinct components failed by a domain outage,
   * `outages` distinct domains, `componentDowntimeMs` the summed length of
   * those failure windows. Absent when no domain outage fired.
   */
  faultDomains?: {
    outages: number
    componentsFailed: number
    componentDowntimeMs: number
  }
  sloTargetCount: number
  /** Error-budget burn for nodes with an SLO budget or availability target. */
  sloStatus?: Array<{
    nodeId: string
    nodeLabel: string
    errorRate: number
    errorBudget: number
    burnRate: number
    withinBudget: boolean
  }>
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

function sumAuthenticationCounters(output: SimulationOutput): SimulationVerdict['authentication'] {
  return {
    attempts: sumTraitCounter(output, 'authAttempts'),
    succeeded: sumTraitCounter(output, 'authSucceeded'),
    missingCredentials: sumTraitCounter(output, 'authMissingCredentials'),
    invalidCredentials: sumTraitCounter(output, 'authInvalidCredentials'),
    expiredCredentials: sumTraitCounter(output, 'authExpiredCredentials'),
    forbidden: sumTraitCounter(output, 'authForbidden')
  }
}

/** Run-wide consistency oracles (see the consistency-model capability). */
function projectConsistency(
  report: NonNullable<SimulationOutput['consistency']>
): NonNullable<SimulationVerdict['consistency']> {
  return {
    reads: report.reads,
    writes: report.writes,
    staleReads: report.staleReads,
    readYourWritesViolations: report.readYourWritesViolations,
    monotonicReadViolations: report.monotonicReadViolations,
    catchUpWaits: report.catchUpWaits,
    catchUpWaitMs: report.catchUpWaitMs,
    sessionlessReads: report.sessionlessReads,
    linearizabilityKeysChecked: report.linearizability.keysChecked,
    linearizabilityViolations: report.linearizability.keysViolating,
    linearizabilityOpsChecked: report.linearizability.opsChecked,
    linearizabilityOpsNotChecked: report.linearizability.opsNotChecked,
    linearizableVerified: report.linearizability.verified ? 1 : 0
  }
}

/** True when any node carries a counter of this family (seeded at zero when enabled). */
function familyInUse(output: SimulationOutput, id: FeatureCounterFamily['id']): boolean {
  const family = FEATURE_COUNTER_FAMILIES.find((entry) => entry.id === id)
  if (!family) return false
  return Object.values(output.perNode).some((metrics) =>
    family.counters.some((counter) => metrics.traitCounters?.[counter] !== undefined)
  )
}

/** Lookup-weighted cache hit ratio plus the worst / best single cache. */
function projectCache(output: SimulationOutput): SimulationVerdict['cache'] {
  let hits = 0
  let misses = 0
  let minHitRatio = Number.POSITIVE_INFINITY
  let maxHitRatio = Number.NEGATIVE_INFINITY
  for (const metrics of Object.values(output.perNode)) {
    const nodeLookups = metrics.cacheHits + metrics.cacheMisses
    if (!(nodeLookups > 0)) continue
    hits += metrics.cacheHits
    misses += metrics.cacheMisses
    const ratio = metrics.cacheHits / nodeLookups
    minHitRatio = Math.min(minHitRatio, ratio)
    maxHitRatio = Math.max(maxHitRatio, ratio)
  }
  const lookups = hits + misses
  if (lookups === 0) return undefined
  return { lookups, hits, misses, hitRatio: hits / lookups, minHitRatio, maxHitRatio }
}

function projectCollapse(output: SimulationOutput): SimulationVerdict['collapse'] {
  if (!familyInUse(output, 'collapse')) return undefined
  return {
    leaders: sumTraitCounter(output, 'collapseLeaders'),
    collapsedMisses: sumTraitCounter(output, 'collapsedMisses'),
    followersServed: sumTraitCounter(output, 'collapsedFollowersServed'),
    followersFailed: sumTraitCounter(output, 'collapsedFollowersFailed'),
    noKey: sumTraitCounter(output, 'collapseNoKey')
  }
}

function projectQueue(output: SimulationOutput): SimulationVerdict['queue'] {
  if (!familyInUse(output, 'queue')) return undefined
  const { accepted, delivered, lost } = output.acceptedWorkConservation
  const pending = Math.max(0, accepted - delivered - lost)
  const queueNodes = Object.values(output.perNode).filter(
    (metrics) => metrics.traitCounters?.queueAccepted !== undefined
  )
  return {
    accepted,
    delivered,
    pending,
    dlqRouted: sumTraitCounter(output, 'queueDlqMoves'),
    lost,
    redeliveries: sumTraitCounter(output, 'queueRedeliveries'),
    noLoss: lost === 0 ? 1 : 0,
    maxQueueDepth: Math.max(0, ...queueNodes.map((metrics) => metrics.peakQueueLength)),
    maxAvgQueueLength: Math.max(0, ...queueNodes.map((metrics) => metrics.avgQueueLength)),
    capacityRejected: queueNodes.reduce(
      (sum, metrics) =>
        sum +
        (metrics.rejectionsByReason?.capacity_exceeded ?? 0) +
        (metrics.rejectionsByReason?.oom ?? 0),
      0
    )
  }
}

function projectPartners(output: SimulationOutput): SimulationVerdict['partners'] {
  if (!familyInUse(output, 'partners')) return undefined
  return {
    requests: sumTraitCounter(output, 'partnerRequests'),
    queuedForAvailability: sumTraitCounter(output, 'partnerQueuedForAvailability'),
    assignments: sumTraitCounter(output, 'partnerAssignments'),
    assignmentFailures: sumTraitCounter(output, 'partnerAssignmentFailures'),
    waits: sumTraitCounter(output, 'partnerWaits'),
    waitMs: sumTraitCounter(output, 'partnerWaitMs')
  }
}

function projectStream(output: SimulationOutput): SimulationVerdict['stream'] {
  if (!familyInUse(output, 'stream')) return undefined
  let partitions = 0
  let retainedRecords = 0
  let totalLag = 0
  let maxPartitionLag = 0
  let consumerGroupBrokers = 0
  let consumerGroups = 0
  let consumerMembers = 0
  let consumerGroupAppends = 0
  let expectedGroupDeliveries = 0
  for (const broker of output.streamProjection) {
    partitions += broker.partitions.length
    retainedRecords += broker.partitions.reduce(
      (sum, partition) => sum + partition.retainedRecords,
      0
    )
    if (broker.consumerGroupMode) {
      consumerGroupBrokers++
      consumerGroups += broker.groups.length
      consumerMembers += broker.groups.reduce((sum, group) => sum + group.members.length, 0)
      const brokerAppends = output.perNode[broker.nodeId]?.traitCounters?.streamAppends ?? 0
      consumerGroupAppends += brokerAppends
      expectedGroupDeliveries += brokerAppends * broker.groups.length
    }
    for (const group of broker.consumerGroupMode ? broker.groups : []) {
      for (const lag of Object.values(group.lag)) {
        totalLag += lag
        maxPartitionLag = Math.max(maxPartitionLag, lag)
      }
    }
  }
  const perGroupDeliveries: number[] = []
  for (const metrics of Object.values(output.perNode)) {
    for (const [counter, value] of Object.entries(metrics.traitCounters ?? {})) {
      if (counter.startsWith('streamGroupDelivery:')) perGroupDeliveries.push(value)
    }
  }
  const appends = sumTraitCounter(output, 'streamAppends')
  const groupDeliveries = sumTraitCounter(output, 'streamGroupDeliveries')
  return {
    brokers: output.streamProjection.length,
    consumerGroupBrokers,
    appends,
    partitions,
    consumerGroups,
    consumerMembers,
    consumerGroupAppends,
    expectedGroupDeliveries,
    groupsWithDeliveries: perGroupDeliveries.length,
    groupDeliveries,
    minGroupDeliveries: perGroupDeliveries.length > 0 ? Math.min(...perGroupDeliveries) : 0,
    maxGroupDeliveries: perGroupDeliveries.length > 0 ? Math.max(...perGroupDeliveries) : 0,
    groupFanoutCoverage:
      expectedGroupDeliveries > 0 ? groupDeliveries / expectedGroupDeliveries : 0,
    retainedRecords,
    totalLag,
    maxPartitionLag,
    offsetCommits: sumTraitCounter(output, 'streamOffsetCommits'),
    rebalances: sumTraitCounter(output, 'streamConsumerRebalances'),
    replayReads: sumTraitCounter(output, 'streamReplayReads'),
    retentionExpired: sumTraitCounter(output, 'streamRetentionExpired'),
    unavailable: sumTraitCounter(output, 'streamBrokerUnavailable')
  }
}

function projectSharding(output: SimulationOutput): SimulationVerdict['sharding'] {
  if (!familyInUse(output, 'sharding')) return undefined
  const targetLoads = new Map<string, number>()
  for (const metrics of Object.values(output.perNode)) {
    for (const [counter, value] of Object.entries(metrics.traitCounters ?? {})) {
      if (!counter.startsWith('shardTarget:')) continue
      const target = counter.slice('shardTarget:'.length)
      targetLoads.set(target, (targetLoads.get(target) ?? 0) + value)
    }
  }
  const loads = [...targetLoads.values()]
  const maxShardRequests = loads.length > 0 ? Math.max(...loads) : 0
  const minShardRequests = loads.length > 0 ? Math.min(...loads) : 0
  return {
    routingAttempts: sumTraitCounter(output, 'shardRoutingAttempts'),
    routedRequests: sumTraitCounter(output, 'shardRoutedRequests'),
    distinctKeys: sumTraitCounter(output, 'shardDistinctKeys'),
    missingKeys: sumTraitCounter(output, 'shardMissingKeys'),
    fallbackRoutes: sumTraitCounter(output, 'shardFallbackRoutes'),
    missingKeyRejects: sumTraitCounter(output, 'shardMissingKeyRejects'),
    keyCoverage:
      sumTraitCounter(output, 'shardRoutingAttempts') > 0
        ? 1 -
          sumTraitCounter(output, 'shardMissingKeys') /
            sumTraitCounter(output, 'shardRoutingAttempts')
        : 0,
    shardTargets: loads.length,
    maxShardRequests,
    minShardRequests,
    skewRatio: minShardRequests > 0 ? maxShardRequests / minShardRequests : maxShardRequests,
    hotDetections: sumTraitCounter(output, 'hotShardDetections'),
    rebalances: sumTraitCounter(output, 'shardRebalances'),
    splits: sumTraitCounter(output, 'shardSplits'),
    migratedKeys: sumTraitCounter(output, 'shardKeysMigrated')
  }
}

function projectStorage(output: SimulationOutput): SimulationVerdict['storage'] {
  if (!familyInUse(output, 'storage')) return undefined
  let nodes = 0
  let capacityGb = 0
  let initialUsedGb = 0
  let maxNodeUtilization = 0
  for (const metrics of Object.values(output.perNode)) {
    const counters = metrics.traitCounters ?? {}
    if (counters.storageCapacityGb === undefined) continue
    nodes++
    const nodeCapacity = counters.storageCapacityGb
    const nodeInitial = counters.storageInitialUsedGb ?? 0
    const nodeWrittenGb = (counters.storageBytesWritten ?? 0) / 1_000_000_000
    const nodeUsed = nodeInitial + nodeWrittenGb
    capacityGb += nodeCapacity
    initialUsedGb += nodeInitial
    if (nodeCapacity > 0) maxNodeUtilization = Math.max(maxNodeUtilization, nodeUsed / nodeCapacity)
  }
  const writtenGb = sumTraitCounter(output, 'storageBytesWritten') / 1_000_000_000
  const usedGb = initialUsedGb + writtenGb
  return {
    nodes,
    capacityGb,
    initialUsedGb,
    usedGb,
    freeGb: Math.max(0, capacityGb - usedGb),
    utilization: capacityGb > 0 ? usedGb / capacityGb : 0,
    maxNodeUtilization,
    writeAttempts: sumTraitCounter(output, 'storageWriteAttempts'),
    writesCommitted: sumTraitCounter(output, 'storageWritesCommitted'),
    writtenGb,
    writeFailures: sumTraitCounter(output, 'storageWriteFailures'),
    fullRejects: sumTraitCounter(output, 'storageFullRejects')
  }
}

function projectApiRouting(output: SimulationOutput): SimulationVerdict['apiRouting'] {
  if (!familyInUse(output, 'contentRouting')) return undefined
  const targetLoads = new Map<string, number>()
  for (const metrics of Object.values(output.perNode)) {
    for (const [counter, value] of Object.entries(metrics.traitCounters ?? {})) {
      if (!counter.startsWith('contentRouteTarget:')) continue
      const target = counter.slice('contentRouteTarget:'.length)
      targetLoads.set(target, (targetLoads.get(target) ?? 0) + value)
    }
  }
  const attempts = sumTraitCounter(output, 'contentRouteAttempts')
  const matched = sumTraitCounter(output, 'contentRouteMatched')
  return {
    attempts,
    matched,
    unmatched: sumTraitCounter(output, 'contentRouteUnmatched'),
    fallbacks: sumTraitCounter(output, 'contentRouteFallbacks'),
    targetUnavailable: sumTraitCounter(output, 'contentRouteTargetUnavailable'),
    rejects: sumTraitCounter(output, 'contentRouteRejects'),
    matchCoverage: attempts > 0 ? matched / attempts : 0,
    routedTargets: targetLoads.size,
    busiestTargetRequests: Math.max(0, ...targetLoads.values())
  }
}

function projectChangeStream(output: SimulationOutput): SimulationVerdict['changeStream'] {
  if (!familyInUse(output, 'changeStream')) return undefined
  return {
    captured: sumTraitCounter(output, 'changeEventsCaptured'),
    applied: sumTraitCounter(output, 'changeEventsApplied'),
    orderViolations: sumTraitCounter(output, 'changeOrderViolations'),
    waitedForOrder: sumTraitCounter(output, 'changeEventsWaitedForOrder'),
    failed: sumTraitCounter(output, 'changeEventsFailed'),
    noKey: sumTraitCounter(output, 'changeEventsNoKey')
  }
}

function projectTelemetry(output: SimulationOutput): SimulationVerdict['telemetry'] {
  if (!familyInUse(output, 'telemetry')) return undefined
  const ingested = sumTraitCounter(output, 'telemetryIngested')
  const dropped = sumTraitCounter(output, 'telemetryDropped')
  const offered = ingested + dropped
  return {
    offered,
    ingested,
    dropped,
    droppedOverIngest: sumTraitCounter(output, 'telemetryDroppedOverIngest'),
    droppedBufferFull: sumTraitCounter(output, 'telemetryDroppedBufferFull'),
    sampledOut: sumTraitCounter(output, 'telemetrySampledOut'),
    ...(offered > 0 ? { dropRate: dropped / offered } : {})
  }
}

function projectCluster(output: SimulationOutput): SimulationVerdict['cluster'] {
  const clusters = output.clusterProjection ?? []
  if (clusters.length === 0) return undefined
  let avgReadyReplicas = 0
  let avgDesiredReplicas = 0
  let minWorkloadReadyRatio = Number.POSITIVE_INFINITY
  let avgPendingPods = 0
  let peakPendingPods = 0
  let pendingPodSeconds = 0
  let podsLost = 0
  let podsRecovered = 0
  let recoveryMsTotal = 0
  let maxRecoveryMs = Number.NEGATIVE_INFINITY
  for (const cluster of clusters) {
    avgPendingPods += cluster.avgPendingPods
    peakPendingPods = Math.max(peakPendingPods, cluster.peakPendingPods)
    podsLost += cluster.podsLost
    podsRecovered += cluster.podsRecovered
    if (cluster.meanRecoveryMs !== null) {
      recoveryMsTotal += cluster.meanRecoveryMs * cluster.podsRecovered
    }
    if (cluster.maxRecoveryMs !== null)
      maxRecoveryMs = Math.max(maxRecoveryMs, cluster.maxRecoveryMs)
    for (const workload of cluster.workloads) {
      avgReadyReplicas += workload.avgReadyReplicas
      avgDesiredReplicas += workload.avgDesiredReplicas
      pendingPodSeconds += workload.pendingPodSeconds
      if (workload.avgDesiredReplicas > 0) {
        minWorkloadReadyRatio = Math.min(
          minWorkloadReadyRatio,
          workload.avgReadyReplicas / workload.avgDesiredReplicas
        )
      }
    }
  }
  return {
    avgReadyReplicas,
    avgDesiredReplicas,
    ...(avgDesiredReplicas > 0 ? { readyRatio: avgReadyReplicas / avgDesiredReplicas } : {}),
    ...(Number.isFinite(minWorkloadReadyRatio) ? { minWorkloadReadyRatio } : {}),
    avgPendingPods,
    peakPendingPods,
    pendingPodSeconds,
    podsLost,
    podsRecovered,
    podsUnrecovered: Math.max(0, podsLost - podsRecovered),
    ...(podsRecovered > 0 ? { meanRecoveryMs: recoveryMsTotal / podsRecovered } : {}),
    ...(Number.isFinite(maxRecoveryMs) ? { maxRecoveryMs } : {})
  }
}

function projectEdges(output: SimulationOutput): SimulationVerdict['edges'] {
  const edges = Object.values(output.perEdge ?? {})
  // The fluid tier does not model edge slots, connections or batching.
  if (edges.length === 0 || output.evaluationMode === 'analytic') return undefined
  const slots = { waited: 0, timedOutWaiting: 0, refused: 0, maxPeakWaiting: 0 }
  let connections: NonNullable<SimulationVerdict['edges']>['connections']
  let batchesSent = 0
  let recordsSent = 0
  for (const edge of edges) {
    if (edge.slots) {
      slots.waited += edge.slots.waited
      slots.timedOutWaiting += edge.slots.timedOutWaiting
      slots.refused += edge.slots.refused
      slots.maxPeakWaiting = Math.max(slots.maxPeakWaiting, edge.slots.peakWaiting)
    }
    if (edge.connections) {
      connections ??= { opened: 0, resumed: 0, reused: 0, waited: 0, closedIdle: 0 }
      connections.opened += edge.connections.opened
      connections.resumed += edge.connections.resumed
      connections.reused += edge.connections.reused
      connections.waited += edge.connections.waited
      connections.closedIdle += edge.connections.closedIdle
    }
    if (edge.batching) {
      batchesSent += edge.batching.batchesSent
      recordsSent += edge.batching.recordsSent
    }
  }
  return {
    slots,
    ...(connections ? { connections } : {}),
    ...(batchesSent > 0
      ? { batching: { batchesSent, recordsSent, meanRecordsPerBatch: recordsSent / batchesSent } }
      : {})
  }
}

function projectFaultDomains(output: SimulationOutput): SimulationVerdict['faultDomains'] {
  const windows = (output.statusTimeline ?? []).filter((window) => window.faultDomain)
  if (windows.length === 0) return undefined
  return {
    outages: new Set(windows.map((window) => window.faultDomain?.id)).size,
    componentsFailed: new Set(windows.map((window) => window.componentId)).size,
    componentDowntimeMs: windows.reduce(
      (total, window) => total + Math.max(0, window.endMs - window.startMs),
      0
    )
  }
}

/** Adds `key: value` only when the value is defined (absent families stay absent). */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
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
    authentication: sumAuthenticationCounters(output),
    ...optional('apiRouting', projectApiRouting(output)),
    ...optional('queue', projectQueue(output)),
    ...optional('partners', projectPartners(output)),
    ...optional('stream', projectStream(output)),
    ...optional('sharding', projectSharding(output)),
    ...optional('storage', projectStorage(output)),
    ...(output.consistency ? { consistency: projectConsistency(output.consistency) } : {}),
    ...optional('cache', projectCache(output)),
    ...optional('collapse', projectCollapse(output)),
    ...optional('changeStream', projectChangeStream(output)),
    ...optional('telemetry', projectTelemetry(output)),
    ...optional('cluster', projectCluster(output)),
    ...optional('edges', projectEdges(output)),
    ...optional('faultDomains', projectFaultDomains(output)),
    sloTargetCount: output.sloTargetCount,
    sloBreaches: output.sloBreaches.map((breach) => ({ ...breach })),
    sloStatus: output.sloStatus?.map((status) => ({ ...status })),
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
