import { EdgeHop, RequestPhaseRecord, RequestSpan } from './core/events'
import { decomposeLatency, decomposePhaseRecord, PhaseKind } from './analysis/phaseTimeline'
import { microToMs, msToMicro } from './core/time'
import { ComponentNode, NodeState, SLOConfig } from './core/types'
import {
  ERROR_CAUSES,
  ErrorCause,
  TerminalState,
  WindowedLatencyAggregator,
  classifyRejectionCause
} from './metrics/windowedLatencyAggregator'

export type FailureObservationPoint = 'node' | 'edge'

/**
 * Streaming inter-event gap statistics (Welford) — for the coefficient of
 * variation of an arrival process. CV = 0 means perfectly even (a constant
 * source, D/D/1); CV ≈ 1 is Poisson. The point of measuring it: a constant
 * source (offered CV 0) becomes a jittered process at a downstream node
 * (arrival CV > 0) because the network varies each hop's transit — which is
 * why rejects appear even when offered load is below nominal capacity.
 * Deterministic (fixed arrival order per seed); no retention.
 */
export interface GapStats {
  lastUs: bigint | null
  count: number
  mean: number
  m2: number
}

export function newGapStats(): GapStats {
  return { lastUs: null, count: 0, mean: 0, m2: 0 }
}

/** Fold one event time into the gap stats (call only for the population you want). */
export function pushGap(stats: GapStats, tUs: bigint): void {
  if (stats.lastUs !== null && tUs > stats.lastUs) {
    const gap = Number(tUs - stats.lastUs)
    stats.count++
    const delta = gap - stats.mean
    stats.mean += delta / stats.count
    stats.m2 += delta * (gap - stats.mean)
  }
  stats.lastUs = tUs
}

/** Coefficient of variation of the gaps, or null when there aren't enough. */
export function gapCV(stats: GapStats): number | null {
  if (stats.count < 1 || stats.mean <= 0) return null
  const variance = stats.m2 / stats.count
  return Math.sqrt(Math.max(0, variance)) / stats.mean
}

export interface CompletedRequest {
  id: string
  status: 'success' | 'timeout' | 'rejected' | 'connection_reset' | 'error'
  totalLatency: number // ms
  path: string[]
  spans: RequestSpan[]
  hops?: EdgeHop[]
  phaseRecord?: RequestPhaseRecord
  createdAt: bigint
  completedAt: bigint
}

/**
 * Latency percentiles in milliseconds. Every field is `number | null`: `null`
 * means there were no successful samples (never fabricate `0`), and callers must
 * render it as "N/A". Values come from the windowed HDR aggregator — the same
 * source as the time-series — so cards and charts can never disagree.
 */
export interface LatencyPercentiles {
  p50: number | null
  p90: number | null
  p95: number | null
  p99: number | null
  min: number | null
  max: number | null
  mean: number | null
}

export interface ErrorLatencySummary {
  count: number
  /** Share of post-warmup terminal requests that failed with this cause. */
  errorRate: number
  /** Share of post-warmup failures represented by this cause. */
  shareOfErrors: number
  p50: number | null
  p95: number | null
  p99: number | null
}

export type TimeToErrorSummary = Record<ErrorCause, ErrorLatencySummary>

export interface LatencyWindowPoint {
  windowStartMs: number
  windowEndMs: number
  successCount: number
  errorCount: number
  errorRate: number
  p50: number | null
  p95: number | null
  p99: number | null
  dominantErrorCause: ErrorCause | null
}

/**
 * One component's share of terminated requests, split by cause — the "who
 * killed my request" Pareto. Sorted descending, the first entry is the failure
 * bottleneck: "API server killed 3,980 (node_failed)" answers *where requests
 * die*, and separates a full queue from a dead node from an edge drop.
 */
export interface FailureLocusEntry {
  /** node id or edge id. */
  locus: string
  locusKind: 'node' | 'edge'
  total: number
  byCause: Partial<Record<ErrorCause, number>>
  /** The cause responsible for the most failures at this locus. */
  dominantCause: ErrorCause
  /** total / all post-warmup failures. */
  shareOfFailures: number
}

/**
 * One component's mean contribution to end-to-end latency, over completed
 * requests. Sorted descending, the first entry is the latency bottleneck:
 * "client→api edge: 289ms (95%)" answers *where the time goes* without the
 * operator subtracting a node badge from a summary tray by hand.
 */
export interface LatencyDecompositionEntry {
  /** edgeId, nodeId, or 'unattributed'. */
  component: string
  label: string
  kind: PhaseKind
  /** Mean contribution to end-to-end latency per completed request (ms). */
  meanMs: number
  /** meanMs / mean end-to-end latency. */
  shareOfEndToEnd: number
}

export interface PerNodeMetrics {
  nodeLabel?: string
  totalArrived: number
  postWarmupArrived: number
  totalProcessed: number
  /** Requests processed (span completed) whose span.arrivalTime is post-warmup. */
  postWarmupProcessed: number
  totalRejected: number
  /** Requests rejected whose event time is post-warmup. */
  postWarmupRejected: number
  totalTimedOut: number
  /** Requests timed out whose event time is post-warmup. */
  postWarmupTimedOut: number
  totalConnectionReset: number
  /** Requests connection-reset whose event time is post-warmup. */
  postWarmupConnectionReset: number
  avgQueueLength: number
  avgServiceTime: number
  avgQueueWait: number
  avgTimeInSystem: number
  avgInSystem: number
  peakQueueLength: number
  peakInSystem: number
  finalInSystem: number
  utilization: number
  throughput: number
  errorRate: number
  availability: number
  /**
   * Coefficient of variation of inter-arrival gaps at this node (post-warmup).
   * 0 = perfectly even; a value above the offered CV means the network jittered
   * the arrival process on the way here — the mechanism behind sub-capacity
   * rejects. `null` when there weren't enough arrivals to measure.
   */
  arrivalCV: number | null
  /** Successful node-local samples in the terminal-gated latency window. */
  successLatencySamples: number
  /** Failed node-local samples in the terminal-gated latency window. */
  timeToErrorSamples: number
  /** Error rate paired with latencyNodeLocal/timeToErrorByCause. */
  latencyWindowErrorRate: number
  /** Termination-time window summaries for charting this node's scoped latency. */
  latencyWindows: LatencyWindowPoint[]
  latencyP50: number
  latencyP95: number
  latencyP99: number
  /** Node-local success latency percentiles (queue + service), null when no successful passes. */
  latencyNodeLocal: LatencyPercentiles
  /** Per-cause node-local time-to-error for failures terminated at this node. */
  timeToErrorByCause: TimeToErrorSummary
  cacheHits: number
  cacheMisses: number
  cacheHitRatio: number
  /** Rejections at this node, grouped by the reason each trait/queue gave — never collapsed into one count. */
  rejectionsByReason: Record<string, number>
  /** Generic counters any trait reports via payload.metricCounters (cacheHits/cacheMisses included for convenience). */
  traitCounters: Record<string, number>
  /**
   * Average items in system computed only over the post-warmup window.
   * Used for Little's Law verification so that λ, W, and L share the same window.
   */
  postWarmupAvgInSystem: number
  /**
   * Average time in system (queue wait + service) computed only over the
   * post-warmup window, using only spans whose arrivalTime is post-warmup.
   */
  postWarmupAvgTimeInSystem: number
}

export interface PerEdgeMetrics {
  edgeLabel: string
  sourceNodeId: string
  targetNodeId: string
  totalSuccessfulTransits: number
  totalFailedTerminals: number
  successLatencySamples: number
  timeToErrorSamples: number
  latencyWindowErrorRate: number
  transitLatency: LatencyPercentiles
  timeToErrorByCause: TimeToErrorSummary
  latencyWindows: LatencyWindowPoint[]
}

export interface SimulationSummary {
  totalRequests: number
  /** Requests injected by the workload generator after the warmup period. */
  postWarmupTotalRequests: number
  /** Successful requests whose createdAt is post-warmup. */
  postWarmupSuccessfulRequests: number
  /** Failed requests whose createdAt is post-warmup. */
  postWarmupFailedRequests: number
  successfulRequests: number
  failedRequests: number
  rejectedRequests: number
  timedOutRequests: number
  /** Requests terminated by a connection reset (kill -9 / recovery drop). */
  connectionResetRequests: number
  /** Successful post-warmup terminal samples used by the success-latency histogram. */
  successLatencySamples: number
  /** Failed post-warmup terminal samples used by the time-to-error panels. */
  timeToErrorSamples: number
  /** Terminal-window error rate paired with the latency panels. */
  latencyWindowErrorRate: number
  /** Termination-time latency windows for the system scope. */
  latencyWindows: LatencyWindowPoint[]
  duration: number // ms
  throughput: number // successful req / sec after warmup
  errorRate: number // post-warmup failed / post-warmup total
  latency: LatencyPercentiles
  timeToErrorByCause: TimeToErrorSummary
  /** Mean end-to-end latency split per component (edge transit / queue / service), bottleneck first. */
  latencyDecomposition: LatencyDecompositionEntry[]
  /** Failures grouped by the component that terminated them, bottleneck first. */
  failuresByLocus: FailureLocusEntry[]
  /**
   * CV of the offered (source-generated) inter-arrival process, post-warmup.
   * ~0 for a constant source, ~1 for Poisson. Compare against a node's
   * `arrivalCV` to see how much variance the network added. `null` if unmeasured.
   */
  offeredArrivalCV: number | null
}

interface InternalNodeMetrics {
  totalArrived: number
  postWarmupArrived: number
  totalProcessed: number
  totalRejected: number
  postWarmupRejected: number
  totalTimedOut: number
  postWarmupTimedOut: number
  totalConnectionReset: number
  postWarmupConnectionReset: number
  queueSamples: number
  queueLengthSum: number
  queueWaitSumMs: number
  serviceTimeSumMs: number
  inSystemSamples: number
  inSystemSum: number
  peakQueueLength: number
  peakInSystem: number
  finalInSystem: number
  /** ∫ activeWorkers dt (worker·µs) from the node — the utilization source of truth. */
  busyAreaUs: bigint
  /** Worker count, for the utilization denominator. */
  workers: number
  /** Streaming inter-arrival gap stats (post-warmup) → arrivalCV. */
  arrivalGaps: GapStats
  cacheHits: number
  cacheMisses: number
  rejectionsByReason: Record<string, number>
  traitCounters: Record<string, number>
  // Post-warmup-only accumulators (keyed on span.arrivalTime, not request.createdAt)
  postWarmupProcessed: number
  postWarmupQueueWaitSumMs: number
  postWarmupServiceTimeSumMs: number
  postWarmupInSystemSum: number
  postWarmupInSystemSamples: number
}

export interface NodeMetadata {
  label?: string
  slo?: SLOConfig
}

interface FailureMetricsContext {
  requestCreatedAt?: bigint
  nodeArrivalTime?: bigint
  edgeInTimeUs?: bigint
  edgeSourceNodeId?: string
  edgeTargetNodeId?: string
  observationPoint?: FailureObservationPoint
  completedSpans?: RequestSpan[]
  /** Absolute termination time (µs). Feeds the windowed latency aggregator. */
  terminationTimeUs?: bigint
  /** Which component terminated the request (node id or edge id). Feeds the failure Pareto. */
  locus?: string
  locusKind?: 'node' | 'edge'
}

interface EdgeMetadata {
  label: string
  sourceNodeId: string
  targetNodeId: string
}

export class MetricsCollector {
  private readonly warmupDurationMs: number
  private readonly warmupDurationUs: bigint

  /**
   * Single source of truth for latency statistics. Fed the full terminal stream
   * from inside the engine loop; the summary percentiles and any time-series
   * both read from here so they can never disagree.
   */
  private readonly latencyAggregator: WindowedLatencyAggregator
  /**
   * Per-node latency aggregators — same class as the system one, one scope down.
   * Fed node-local success latency (queue + service) from spans and node-local
   * time-to-error from failures terminated at the node. The node badge reads its
   * own instance; the tray reads the system one; the math is identical.
   */
  private readonly nodeLatencyAggregators = new Map<string, WindowedLatencyAggregator>()
  /** Per-edge latency aggregators — one scope per edge, same funnel and windowing. */
  private readonly edgeLatencyAggregators = new Map<string, WindowedLatencyAggregator>()
  private readonly perNode = new Map<string, InternalNodeMetrics>()
  private readonly nodeMetadata = new Map<string, NodeMetadata>()
  private readonly edgeMetadata = new Map<string, EdgeMetadata>()

  /** Per-component latency contributions summed over post-warmup completed requests. */
  private readonly decompositionByKey = new Map<
    string,
    { component: string; label: string; kind: PhaseKind; totalUs: bigint }
  >()
  private decomposedCompletedCount = 0

  /** Post-warmup failures grouped by terminating component and cause (the failure Pareto). */
  private readonly failureLocus = new Map<
    string,
    { locus: string; locusKind: 'node' | 'edge'; byCause: Map<ErrorCause, number>; total: number }
  >()

  private totalRequests = 0
  /** Requests whose createdAt >= warmup — used for the summary global count. */
  private postWarmupTotalRequests = 0
  private successfulRequests = 0
  private postWarmupSuccessfulRequests = 0
  private failedRequests = 0
  private rejectedRequests = 0
  private timedOutRequests = 0
  private connectionResetRequests = 0
  /** Offered (source) inter-generation gap stats → offeredArrivalCV. */
  private readonly offeredGaps: GapStats = newGapStats()

  constructor(config: {
    warmupDuration: number
    nodes?: Array<Pick<ComponentNode, 'id' | 'label' | 'slo'>>
    edges?: Array<{ id: string; source: string; target: string }>
  }) {
    this.warmupDurationMs = Math.max(0, config.warmupDuration)
    this.warmupDurationUs = msToMicro(this.warmupDurationMs)
    this.latencyAggregator = new WindowedLatencyAggregator(this.warmupDurationUs)
    for (const node of config.nodes ?? []) {
      this.nodeMetadata.set(node.id, {
        label: node.label,
        slo: node.slo
      })
    }
    for (const edge of config.edges ?? []) {
      this.edgeMetadata.set(edge.id, {
        label: `${edge.source}→${edge.target}`,
        sourceNodeId: edge.source,
        targetNodeId: edge.target
      })
    }
  }

  recordRequest(request: CompletedRequest): void {
    this.totalRequests++

    if (request.status === 'success') {
      this.successfulRequests++
      this.recordTerminalLatency('completed', request.createdAt, request.completedAt)
      this.accumulateLatencyDecomposition(request)
      if (request.createdAt >= this.warmupDurationUs) {
        this.postWarmupSuccessfulRequests++
        this.postWarmupTotalRequests++
      }
    } else {
      this.failedRequests++
      if (request.createdAt >= this.warmupDurationUs) {
        this.postWarmupTotalRequests++
      }
      if (request.status === 'rejected') {
        this.rejectedRequests++
      }
      if (request.status === 'timeout') {
        this.timedOutRequests++
      }
    }

    this.recordCompletedSpans(request.spans)
  }

  /**
   * Record that a request actually reached a node.
   *
   * This is the source of truth for per-node arrival counts. Terminal outcome
   * handlers must not backfill arrivals from spans or paths because a request
   * can arrive at a node and then fail later on a downstream edge.
   */
  recordNodeArrival(nodeId: string, arrivalTime: bigint): void {
    const node = this.ensureNodeMetrics(nodeId)
    node.totalArrived++
    if (this.isPostWarmup(arrivalTime)) {
      node.postWarmupArrived++
      // Measure the delivered arrival-process variance at this node.
      pushGap(node.arrivalGaps, arrivalTime)
    }
  }

  /**
   * Record a source-generated request so the offered (source) arrival-process
   * CV can be compared against what nodes actually receive.
   */
  recordGeneratedRequest(createdAt: bigint): void {
    if (this.isPostWarmup(createdAt)) {
      pushGap(this.offeredGaps, createdAt)
    }
  }

  /**
   * Record spans that already finished locally for a request that never
   * reached a terminal global outcome before the simulation stopped.
   *
   * This lets upstream nodes keep their processed counts when a request is
   * still queued, processing, or in-flight farther downstream at cutoff.
   */
  recordInFlightCompletedSpans(spans: RequestSpan[]): void {
    this.recordCompletedSpans(spans)
  }

  /**
   * Record a request rejection at a node.
   *
   * @param nodeId   Node where the rejection occurred.
   * @param reason   Human-readable rejection reason.
   * @param context.requestCreatedAt  Request creation time. Used for global summary gating.
   * @param context.nodeArrivalTime   Time the request reached this node. Used for per-node
   *                                  post-warmup arrival/rejection gating.
   */
  recordRejection(nodeId: string, reason: string, context: FailureMetricsContext = {}): void {
    const arrivalTime = context.nodeArrivalTime ?? context.requestCreatedAt
    const observationPoint = context.observationPoint ?? 'node'

    this.totalRequests++
    this.failedRequests++
    this.rejectedRequests++
    if (this.isPostWarmup(context.requestCreatedAt)) {
      this.postWarmupTotalRequests++
    }
    // Split the blended "rejected" bucket: a full queue (overload), a dead node,
    // and an edge drop are different failures and get their own cause.
    const rejectionCause = classifyRejectionCause(reason)
    this.recordTerminalLatency(rejectionCause, context.requestCreatedAt, context.terminationTimeUs)
    this.recordFailureLocus(rejectionCause, context)

    this.recordCompletedSpans(context.completedSpans ?? [], {
      excludeLastSpanAtNodeId: observationPoint === 'node' ? nodeId : undefined
    })

    if (observationPoint !== 'node') {
      return
    }

    const node = this.ensureNodeMetrics(nodeId)
    node.totalRejected++
    node.rejectionsByReason[reason] = (node.rejectionsByReason[reason] ?? 0) + 1
    if (this.isPostWarmup(arrivalTime)) {
      node.postWarmupRejected++
    }
  }

  /**
   * Record a request timeout at a node.
   *
   * @param context.requestCreatedAt  Request creation time. Used for global summary gating.
   * @param context.nodeArrivalTime   Time the request reached this node. Used for per-node
   *                                  post-warmup arrival/timeout gating.
   */
  recordTimeout(_requestId: string, nodeId: string, context: FailureMetricsContext = {}): void {
    const arrivalTime = context.nodeArrivalTime ?? context.requestCreatedAt
    const observationPoint = context.observationPoint ?? 'node'

    this.totalRequests++
    this.failedRequests++
    this.timedOutRequests++
    if (this.isPostWarmup(context.requestCreatedAt)) {
      this.postWarmupTotalRequests++
    }
    this.recordTerminalLatency('timeout', context.requestCreatedAt, context.terminationTimeUs)
    this.recordFailureLocus('timeout', context)

    this.recordCompletedSpans(context.completedSpans ?? [], {
      excludeLastSpanAtNodeId: observationPoint === 'node' ? nodeId : undefined
    })

    if (observationPoint !== 'node') {
      return
    }

    const node = this.ensureNodeMetrics(nodeId)
    node.totalTimedOut++
    if (this.isPostWarmup(arrivalTime)) {
      node.postWarmupTimedOut++
    }
  }

  /**
   * Record a terminal connection reset at a node — a queued/in-service request
   * killed at failure onset (kill -9) or dropped when a hung node recovered.
   * Counted as a failure, tracked separately from rejections and timeouts so
   * the per-cause breakdown never blends distinct failure shapes.
   */
  recordConnectionReset(
    _requestId: string,
    nodeId: string,
    context: FailureMetricsContext = {}
  ): void {
    const arrivalTime = context.nodeArrivalTime ?? context.requestCreatedAt
    const observationPoint = context.observationPoint ?? 'node'

    this.totalRequests++
    this.failedRequests++
    this.connectionResetRequests++
    if (this.isPostWarmup(context.requestCreatedAt)) {
      this.postWarmupTotalRequests++
    }
    this.recordTerminalLatency(
      'connection_reset',
      context.requestCreatedAt,
      context.terminationTimeUs
    )
    this.recordFailureLocus('connection_reset', context)

    this.recordCompletedSpans(context.completedSpans ?? [], {
      excludeLastSpanAtNodeId: observationPoint === 'node' ? nodeId : undefined
    })

    if (observationPoint !== 'node') {
      return
    }

    const node = this.ensureNodeMetrics(nodeId)
    node.totalConnectionReset++
    if (this.isPostWarmup(arrivalTime)) {
      node.postWarmupConnectionReset++
    }
  }

  /**
   * Records a per-node snapshot at `timestamp`.
   * Snapshots taken after the warmup window also accumulate into the
   * post-warmup L integrator so that Little's Law can compare L, λ, and W
   * over a consistent time window.
   */
  recordNodeSnapshot(nodeId: string, state: NodeState, timestamp: bigint): void {
    const node = this.ensureNodeMetrics(nodeId)

    node.queueLengthSum += state.queueLength
    node.queueSamples++
    node.peakQueueLength = Math.max(node.peakQueueLength, state.queueLength)
    node.inSystemSum += state.totalInSystem
    node.inSystemSamples++
    node.peakInSystem = Math.max(node.peakInSystem, state.totalInSystem)
    node.finalInSystem = state.totalInSystem

    // Utilization is NOT accumulated here — a point-sampled snapshot average
    // undersamples busy/idle toggles and lies. It comes from the node's
    // time-weighted busy-area integral via recordNodeBusyTime().

    // Only accumulate the post-warmup L integrator after warmup ends
    if (timestamp >= this.warmupDurationUs) {
      node.postWarmupInSystemSum += state.totalInSystem
      node.postWarmupInSystemSamples++
    }
  }

  /**
   * Record a node's finalized busy-area integral (worker·µs) and worker count —
   * the single source of truth for utilization. Called once at run end.
   */
  recordNodeBusyTime(nodeId: string, busyAreaUs: bigint, workers: number): void {
    const node = this.ensureNodeMetrics(nodeId)
    node.busyAreaUs = busyAreaUs
    node.workers = workers
  }

  /**
   * Merges any trait-reported counters (payload.metricCounters) into this
   * node's generic counter bag. cacheHits/cacheMisses additionally feed the
   * dedicated cacheHitRatio computation below.
   */
  recordNodeTraitCounters(nodeId: string, counters: Record<string, number>): void {
    const node = this.ensureNodeMetrics(nodeId)
    for (const [key, value] of Object.entries(counters)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue
      }
      node.traitCounters[key] = (node.traitCounters[key] ?? 0) + value
    }
    node.cacheHits += counters.cacheHits ?? 0
    node.cacheMisses += counters.cacheMisses ?? 0
  }

  recordEdgeTransit(
    edgeId: string,
    sourceNodeId: string,
    targetNodeId: string,
    transitLatencyUs: bigint,
    edgeOutUs: bigint
  ): void {
    this.ensureEdgeAggregator(edgeId, {
      label: `${sourceNodeId}→${targetNodeId}`,
      sourceNodeId,
      targetNodeId
    }).onTerminal('completed', transitLatencyUs, edgeOutUs)
  }

  generateSummary(duration: number): SimulationSummary {
    const effectiveDurationMs = Math.max(0, duration - this.warmupDurationMs)
    const throughput =
      effectiveDurationMs > 0 ? this.postWarmupSuccessfulRequests / (effectiveDurationMs / 1000) : 0
    const postWarmupFailedRequests = Math.max(
      0,
      this.postWarmupTotalRequests - this.postWarmupSuccessfulRequests
    )
    const errorRate =
      this.postWarmupTotalRequests > 0 ? postWarmupFailedRequests / this.postWarmupTotalRequests : 0
    const successLatencySamples = this.latencyAggregator.successSummary().count
    const timeToErrorByCause = this.getTimeToErrorByCause(
      this.latencyAggregator,
      successLatencySamples
    )
    const timeToErrorSamples = ERROR_CAUSES.reduce(
      (sum, cause) => sum + timeToErrorByCause[cause].count,
      0
    )
    const latencyWindowTotal = successLatencySamples + timeToErrorSamples
    const latencyWindowErrorRate =
      latencyWindowTotal > 0 ? timeToErrorSamples / latencyWindowTotal : 0

    return {
      totalRequests: this.totalRequests,
      postWarmupTotalRequests: this.postWarmupTotalRequests,
      postWarmupSuccessfulRequests: this.postWarmupSuccessfulRequests,
      postWarmupFailedRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      rejectedRequests: this.rejectedRequests,
      timedOutRequests: this.timedOutRequests,
      connectionResetRequests: this.connectionResetRequests,
      successLatencySamples,
      timeToErrorSamples,
      latencyWindowErrorRate,
      latencyWindows: this.latencyWindowsFromAggregator(this.latencyAggregator),
      duration,
      throughput,
      errorRate,
      latency: this.getLatencyPercentiles(),
      timeToErrorByCause,
      latencyDecomposition: this.buildLatencyDecomposition(),
      failuresByLocus: this.buildFailuresByLocus(),
      offeredArrivalCV: gapCV(this.offeredGaps)
    }
  }

  getPerNodeMetrics(durationMs = 0): Map<string, PerNodeMetrics> {
    const result = new Map<string, PerNodeMetrics>()
    const effectiveDurationMs = Math.max(0, durationMs - this.warmupDurationMs)
    const durationSec = effectiveDurationMs > 0 ? effectiveDurationMs / 1000 : 0
    const nodeIds = new Set<string>([...this.perNode.keys(), ...this.nodeMetadata.keys()])

    for (const nodeId of nodeIds) {
      const metrics = this.perNode.get(nodeId)
      const metadata = this.nodeMetadata.get(nodeId)
      const totalArrived = metrics?.totalArrived ?? 0
      const totalProcessed = metrics?.totalProcessed ?? 0
      const totalRejected = metrics?.totalRejected ?? 0
      const totalTimedOut = metrics?.totalTimedOut ?? 0
      const postWarmupArrived = metrics?.postWarmupArrived ?? 0
      const postWarmupRejected = metrics?.postWarmupRejected ?? 0
      const postWarmupTimedOut = metrics?.postWarmupTimedOut ?? 0
      const totalConnectionReset = metrics?.totalConnectionReset ?? 0
      const postWarmupConnectionReset = metrics?.postWarmupConnectionReset ?? 0
      const postWarmupFailed = postWarmupRejected + postWarmupTimedOut + postWarmupConnectionReset
      const errorRate = postWarmupArrived > 0 ? postWarmupFailed / postWarmupArrived : 0
      // Node-local latency from this node's own aggregator (queue + service),
      // the same histogram math as the system tray, one scope down.
      const nodeAggregator = this.nodeLatencyAggregators.get(nodeId)
      const latencyNodeLocal = this.latencyPercentilesFromAggregator(nodeAggregator)
      const successLatencySamples = nodeAggregator?.successSummary().count ?? 0
      const timeToErrorByCause = nodeAggregator
        ? this.getTimeToErrorByCause(nodeAggregator, successLatencySamples)
        : this.getTimeToErrorByCause(new WindowedLatencyAggregator(this.warmupDurationUs), 0)
      const timeToErrorSamples = ERROR_CAUSES.reduce(
        (sum, cause) => sum + timeToErrorByCause[cause].count,
        0
      )
      const latencyWindowTotal = successLatencySamples + timeToErrorSamples
      const latencyWindowErrorRate =
        latencyWindowTotal > 0 ? timeToErrorSamples / latencyWindowTotal : 0
      // Keep the flat p50/95/99 numbers (0 when no samples) for the table and SLO checks.
      const latencyP50 = latencyNodeLocal.p50 ?? 0
      const latencyP95 = latencyNodeLocal.p95 ?? 0
      const latencyP99 = latencyNodeLocal.p99 ?? 0
      const cacheHits = metrics?.cacheHits ?? 0
      const cacheMisses = metrics?.cacheMisses ?? 0
      const cacheHitRatio = cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : 0

      // Post-warmup W: sojourn time averaged over spans whose arrivalTime is post-warmup
      const pwProcessed = metrics?.postWarmupProcessed ?? 0
      const postWarmupAvgTimeInSystem =
        pwProcessed > 0
          ? ((metrics?.postWarmupQueueWaitSumMs ?? 0) +
              (metrics?.postWarmupServiceTimeSumMs ?? 0)) /
            pwProcessed
          : 0

      // Post-warmup L: time-average items in system over post-warmup snapshots
      const pwInSystemSamples = metrics?.postWarmupInSystemSamples ?? 0
      const postWarmupAvgInSystem =
        pwInSystemSamples > 0 ? (metrics?.postWarmupInSystemSum ?? 0) / pwInSystemSamples : 0

      result.set(nodeId, {
        nodeLabel: metadata?.label,
        totalArrived,
        postWarmupArrived,
        totalProcessed,
        postWarmupProcessed: pwProcessed,
        totalRejected,
        postWarmupRejected,
        totalTimedOut,
        postWarmupTimedOut,
        totalConnectionReset,
        postWarmupConnectionReset,
        avgQueueLength:
          metrics && metrics.queueSamples > 0 ? metrics.queueLengthSum / metrics.queueSamples : 0,
        avgServiceTime:
          metrics && metrics.totalProcessed > 0
            ? metrics.serviceTimeSumMs / metrics.totalProcessed
            : 0,
        avgQueueWait:
          metrics && metrics.totalProcessed > 0
            ? metrics.queueWaitSumMs / metrics.totalProcessed
            : 0,
        avgTimeInSystem:
          metrics && metrics.totalProcessed > 0
            ? (metrics.queueWaitSumMs + metrics.serviceTimeSumMs) / metrics.totalProcessed
            : 0,
        avgInSystem:
          metrics && metrics.inSystemSamples > 0
            ? metrics.inSystemSum / metrics.inSystemSamples
            : 0,
        peakQueueLength: metrics?.peakQueueLength ?? 0,
        peakInSystem: metrics?.peakInSystem ?? 0,
        finalInSystem: metrics?.finalInSystem ?? 0,
        // Time-weighted busy fraction: ∫activeWorkers dt / (duration × workers).
        utilization:
          metrics && metrics.workers > 0 && durationMs > 0
            ? Math.min(
                1,
                Math.max(
                  0,
                  Number(metrics.busyAreaUs) / (Number(msToMicro(durationMs)) * metrics.workers)
                )
              )
            : 0,
        throughput: durationSec > 0 ? pwProcessed / durationSec : 0,
        errorRate,
        availability: 1 - errorRate,
        arrivalCV: metrics ? gapCV(metrics.arrivalGaps) : null,
        successLatencySamples,
        timeToErrorSamples,
        latencyWindowErrorRate,
        latencyWindows: this.latencyWindowsFromAggregator(nodeAggregator),
        latencyP50,
        latencyP95,
        latencyP99,
        latencyNodeLocal,
        timeToErrorByCause,
        cacheHits,
        cacheMisses,
        cacheHitRatio,
        rejectionsByReason: { ...(metrics?.rejectionsByReason ?? {}) },
        traitCounters: { ...(metrics?.traitCounters ?? {}) },
        postWarmupAvgInSystem,
        postWarmupAvgTimeInSystem
      })
    }

    return result
  }

  getPerEdgeMetrics(): Map<string, PerEdgeMetrics> {
    const result = new Map<string, PerEdgeMetrics>()
    const edgeIds = new Set<string>([
      ...this.edgeMetadata.keys(),
      ...this.edgeLatencyAggregators.keys()
    ])

    for (const edgeId of edgeIds) {
      const metadata =
        this.edgeMetadata.get(edgeId) ??
        ({
          label: edgeId,
          sourceNodeId: 'unknown',
          targetNodeId: 'unknown'
        } satisfies EdgeMetadata)
      const edgeAggregator = this.edgeLatencyAggregators.get(edgeId)
      const transitLatency = this.latencyPercentilesFromAggregator(edgeAggregator)
      const successLatencySamples = edgeAggregator?.successSummary().count ?? 0
      const timeToErrorByCause = edgeAggregator
        ? this.getTimeToErrorByCause(edgeAggregator, successLatencySamples)
        : this.getTimeToErrorByCause(new WindowedLatencyAggregator(this.warmupDurationUs), 0)
      const timeToErrorSamples = ERROR_CAUSES.reduce(
        (sum, cause) => sum + timeToErrorByCause[cause].count,
        0
      )
      const latencyWindowTotal = successLatencySamples + timeToErrorSamples
      const latencyWindowErrorRate =
        latencyWindowTotal > 0 ? timeToErrorSamples / latencyWindowTotal : 0

      result.set(edgeId, {
        edgeLabel: metadata.label,
        sourceNodeId: metadata.sourceNodeId,
        targetNodeId: metadata.targetNodeId,
        totalSuccessfulTransits: successLatencySamples,
        totalFailedTerminals: timeToErrorSamples,
        successLatencySamples,
        timeToErrorSamples,
        latencyWindowErrorRate,
        transitLatency,
        timeToErrorByCause,
        latencyWindows: this.latencyWindowsFromAggregator(edgeAggregator)
      })
    }

    return result
  }

  getNodeMetadata(nodeId: string): NodeMetadata | undefined {
    return this.nodeMetadata.get(nodeId)
  }

  getAllNodeMetadata(): Map<string, NodeMetadata> {
    return new Map(this.nodeMetadata)
  }

  /**
   * Summary success-latency percentiles (ms), sourced from the windowed HDR
   * aggregator — the same source as the time-series. Returns `null` for every
   * field when there were no successful samples (never a fabricated 0); callers
   * render `null` as "N/A".
   */
  getLatencyPercentiles(): LatencyPercentiles {
    return this.latencyPercentilesFromAggregator(this.latencyAggregator)
  }

  /** Success-latency percentiles (ms) for any scope's aggregator; all null when empty. */
  private latencyPercentilesFromAggregator(
    agg: WindowedLatencyAggregator | undefined
  ): LatencyPercentiles {
    if (!agg) {
      return { p50: null, p90: null, p95: null, p99: null, min: null, max: null, mean: null }
    }
    const { sumUs, count } = agg.successSummary()
    return this.latencyPercentilesFromHist(agg.mergedSuccessHist(), sumUs, count)
  }

  /**
   * Post-warmup time-to-error percentiles (ms), split by cause so silent
   * failures, instant rejects, and connection resets never blend together.
   * Defaults to the system aggregator; pass a node aggregator for its scope.
   */
  getTimeToErrorByCause(
    agg: WindowedLatencyAggregator = this.latencyAggregator,
    successLatencySamples = agg.successSummary().count
  ): TimeToErrorSummary {
    const histByCause = agg.mergedErrorHistByCause()
    const totalErrors = ERROR_CAUSES.reduce((sum, cause) => sum + histByCause[cause].count(), 0)
    const totalTerminals = successLatencySamples + totalErrors

    const build = (cause: ErrorCause): ErrorLatencySummary => {
      const hist = histByCause[cause]
      const count = hist.count()
      return {
        count,
        errorRate: totalTerminals > 0 ? count / totalTerminals : 0,
        shareOfErrors: totalErrors > 0 ? count / totalErrors : 0,
        p50: this.quantileMs(hist, 0.5),
        p95: this.quantileMs(hist, 0.95),
        p99: this.quantileMs(hist, 0.99)
      }
    }

    return Object.fromEntries(
      ERROR_CAUSES.map((cause) => [cause, build(cause)])
    ) as TimeToErrorSummary
  }

  /** Access the windowed latency aggregator (time-series, per-cause breakdowns). */
  getWindowedLatency(): WindowedLatencyAggregator {
    return this.latencyAggregator
  }

  /**
   * Fold a completed request's per-component latency contributions into the
   * running decomposition (post-warmup, termination-time gated to match the
   * latency panels). Everything projects from the phase timeline — the edge
   * transit, queue wait, and service time are subtractions over one record.
   */
  private accumulateLatencyDecomposition(request: CompletedRequest): void {
    if (request.completedAt < this.warmupDurationUs) {
      return
    }
    const contributions = request.phaseRecord
      ? decomposePhaseRecord(request.phaseRecord)
      : decomposeLatency(request.createdAt, request.hops ?? [], request.spans, request.completedAt)
    this.decomposedCompletedCount++
    for (const c of contributions) {
      const key = `${c.kind}:${c.component}`
      const existing = this.decompositionByKey.get(key)
      if (existing) {
        existing.totalUs += c.us
      } else {
        this.decompositionByKey.set(key, {
          component: c.component,
          label: c.label,
          kind: c.kind,
          totalUs: c.us
        })
      }
    }
  }

  /** Build the sorted (bottleneck-first) per-component latency decomposition. */
  private buildLatencyDecomposition(): LatencyDecompositionEntry[] {
    const n = this.decomposedCompletedCount
    if (n === 0) {
      return []
    }
    const means = [...this.decompositionByKey.values()].map((e) => ({
      component: e.component,
      label: e.label,
      kind: e.kind,
      meanMs: Number(e.totalUs) / n / 1000
    }))
    const meanEndToEndMs = means.reduce((sum, e) => sum + e.meanMs, 0)
    return means
      .map((e) => ({
        ...e,
        shareOfEndToEnd: meanEndToEndMs > 0 ? e.meanMs / meanEndToEndMs : 0
      }))
      .sort((a, b) => b.meanMs - a.meanMs)
  }

  /**
   * Attribute one post-warmup failure to the component that terminated it. Gated
   * on termination time to match the time-to-error population, so the Pareto
   * totals reconcile exactly with `timeToErrorSamples`.
   */
  private recordFailureLocus(cause: ErrorCause, context: FailureMetricsContext): void {
    const t = context.terminationTimeUs
    if (t === undefined || t < this.warmupDurationUs) {
      return
    }
    const locus = context.locus
    if (!locus) {
      return
    }
    const locusKind = context.locusKind ?? 'node'
    const key = `${locusKind}:${locus}`
    let entry = this.failureLocus.get(key)
    if (!entry) {
      entry = { locus, locusKind, byCause: new Map(), total: 0 }
      this.failureLocus.set(key, entry)
    }
    entry.byCause.set(cause, (entry.byCause.get(cause) ?? 0) + 1)
    entry.total++

    // Feed the node's own aggregator its node-local time-to-error (terminal −
    // node arrival), so the node badge shows honest per-cause failure latencies.
    if (locusKind === 'node' && context.nodeArrivalTime !== undefined) {
      this.ensureNodeAggregator(locus).onTerminal(cause, t - context.nodeArrivalTime, t)
      return
    }

    // Edge-locus failures use the edge-local time spent since the request
    // entered the edge, not the full end-to-end lifetime.
    if (locusKind === 'edge' && context.edgeInTimeUs !== undefined) {
      this.ensureEdgeAggregator(locus, {
        label:
          this.edgeMetadata.get(locus)?.label ??
          `${context.edgeSourceNodeId ?? 'unknown'}→${context.edgeTargetNodeId ?? 'unknown'}`,
        sourceNodeId: context.edgeSourceNodeId ?? 'unknown',
        targetNodeId: context.edgeTargetNodeId ?? 'unknown'
      }).onTerminal(cause, t - context.edgeInTimeUs, t)
    }
  }

  /** Build the sorted (bottleneck-first) failure-by-locus Pareto. */
  private buildFailuresByLocus(): FailureLocusEntry[] {
    const totalFailures = [...this.failureLocus.values()].reduce((sum, e) => sum + e.total, 0)
    if (totalFailures === 0) {
      return []
    }
    return [...this.failureLocus.values()]
      .map((e) => {
        let dominantCause: ErrorCause = 'rejected'
        let dominantCount = -1
        const byCause: Partial<Record<ErrorCause, number>> = {}
        for (const [cause, count] of e.byCause) {
          byCause[cause] = count
          if (count > dominantCount) {
            dominantCount = count
            dominantCause = cause
          }
        }
        return {
          locus: e.locus,
          locusKind: e.locusKind,
          total: e.total,
          byCause,
          dominantCause,
          shareOfFailures: e.total / totalFailures
        }
      })
      .sort((a, b) => b.total - a.total)
  }

  /** Feed one terminal into the latency aggregator (the single funnel). */
  private recordTerminalLatency(
    state: TerminalState,
    createdAt: bigint | undefined,
    terminationTimeUs: bigint | undefined
  ): void {
    if (createdAt === undefined || terminationTimeUs === undefined) {
      return
    }
    this.latencyAggregator.onTerminal(state, terminationTimeUs - createdAt, terminationTimeUs)
  }

  private quantileMs(hist: { quantile: (q: number) => number | null }, q: number): number | null {
    const valueUs = hist.quantile(q)
    return valueUs === null ? null : valueUs / 1000
  }

  private latencyPercentilesFromHist(
    hist: { quantile: (q: number) => number | null },
    sumUs: bigint,
    count: number
  ): LatencyPercentiles {
    return {
      p50: this.quantileMs(hist, 0.5),
      p90: this.quantileMs(hist, 0.9),
      p95: this.quantileMs(hist, 0.95),
      p99: this.quantileMs(hist, 0.99),
      min: this.quantileMs(hist, 0),
      max: this.quantileMs(hist, 1),
      // Exact integer-µs mean; null when there is nothing to average.
      mean: count > 0 ? Number(sumUs) / count / 1000 : null
    }
  }

  private latencyWindowsFromAggregator(
    agg: WindowedLatencyAggregator | undefined
  ): LatencyWindowPoint[] {
    if (!agg) {
      return []
    }

    return agg.orderedWindows().map((window) => {
      const successCount = window.counts.completed
      const errorCount = ERROR_CAUSES.reduce((sum, cause) => sum + window.counts[cause], 0)
      const total = successCount + errorCount
      let dominantErrorCause: ErrorCause | null = null
      let dominantErrorCount = 0

      for (const cause of ERROR_CAUSES) {
        const count = window.counts[cause]
        if (count > dominantErrorCount) {
          dominantErrorCount = count
          dominantErrorCause = cause
        }
      }

      return {
        windowStartMs: window.windowStart / 1000,
        windowEndMs: (window.windowStart + 1_000_000) / 1000,
        successCount,
        errorCount,
        errorRate: total > 0 ? errorCount / total : 0,
        p50: this.quantileMs(window.successHist, 0.5),
        p95: this.quantileMs(window.successHist, 0.95),
        p99: this.quantileMs(window.successHist, 0.99),
        dominantErrorCause
      }
    })
  }

  private isPostWarmup(eventTime?: bigint): boolean {
    return eventTime !== undefined && eventTime >= this.warmupDurationUs
  }

  private recordCompletedSpans(
    spans: RequestSpan[],
    options: { excludeLastSpanAtNodeId?: string } = {}
  ): void {
    const { excludeLastSpanAtNodeId } = options
    const lastSpan = spans[spans.length - 1]
    const limit =
      excludeLastSpanAtNodeId && lastSpan?.nodeId === excludeLastSpanAtNodeId
        ? spans.length - 1
        : spans.length

    for (let i = 0; i < limit; i++) {
      const span = spans[i]
      const node = this.ensureNodeMetrics(span.nodeId)
      // Per-node post-warmup gate uses span.arrivalTime — the moment this request
      // reached this node in simulation time. Using request.createdAt instead
      // would miscount requests that straddle the warmup boundary.
      const isSpanPostWarmup = span.arrivalTime >= this.warmupDurationUs

      node.totalProcessed++
      node.queueWaitSumMs += microToMs(span.queueWait)
      node.serviceTimeSumMs += microToMs(span.serviceTime)
      // A completed span is a successful node-local pass — feed the node's own
      // aggregator its node-local latency (queue + service). Window-assigned by
      // departure time; the aggregator applies the warmup gate.
      this.ensureNodeAggregator(span.nodeId).onTerminal(
        'completed',
        span.queueWait + span.serviceTime,
        span.departureTime
      )

      if (isSpanPostWarmup) {
        node.postWarmupProcessed++
        node.postWarmupQueueWaitSumMs += microToMs(span.queueWait)
        node.postWarmupServiceTimeSumMs += microToMs(span.serviceTime)
      }
    }
  }

  /** Get (or lazily create) the per-node latency aggregator. */
  private ensureNodeAggregator(nodeId: string): WindowedLatencyAggregator {
    let agg = this.nodeLatencyAggregators.get(nodeId)
    if (!agg) {
      agg = new WindowedLatencyAggregator(this.warmupDurationUs)
      this.nodeLatencyAggregators.set(nodeId, agg)
    }
    return agg
  }

  private ensureEdgeAggregator(edgeId: string, metadata?: EdgeMetadata): WindowedLatencyAggregator {
    if (metadata && !this.edgeMetadata.has(edgeId)) {
      this.edgeMetadata.set(edgeId, metadata)
    }

    let agg = this.edgeLatencyAggregators.get(edgeId)
    if (!agg) {
      agg = new WindowedLatencyAggregator(this.warmupDurationUs)
      this.edgeLatencyAggregators.set(edgeId, agg)
    }
    return agg
  }

  private ensureNodeMetrics(nodeId: string): InternalNodeMetrics {
    const existing = this.perNode.get(nodeId)
    if (existing) {
      return existing
    }

    const created: InternalNodeMetrics = {
      totalArrived: 0,
      postWarmupArrived: 0,
      totalProcessed: 0,
      totalRejected: 0,
      postWarmupRejected: 0,
      totalTimedOut: 0,
      postWarmupTimedOut: 0,
      totalConnectionReset: 0,
      postWarmupConnectionReset: 0,
      queueSamples: 0,
      queueLengthSum: 0,
      queueWaitSumMs: 0,
      serviceTimeSumMs: 0,
      inSystemSamples: 0,
      inSystemSum: 0,
      peakQueueLength: 0,
      peakInSystem: 0,
      finalInSystem: 0,
      busyAreaUs: 0n,
      arrivalGaps: newGapStats(),
      workers: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rejectionsByReason: {},
      traitCounters: {},
      postWarmupProcessed: 0,
      postWarmupQueueWaitSumMs: 0,
      postWarmupServiceTimeSumMs: 0,
      postWarmupInSystemSum: 0,
      postWarmupInSystemSamples: 0
    }

    this.perNode.set(nodeId, created)
    return created
  }
}
