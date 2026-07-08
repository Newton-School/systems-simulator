import { RequestSpan } from './core/events'
import { microToMs, msToMicro } from './core/time'
import { ComponentNode, NodeState, SLOConfig } from './core/types'

export interface CompletedRequest {
  id: string
  status: 'success' | 'timeout' | 'rejected' | 'error'
  totalLatency: number // ms
  path: string[]
  spans: RequestSpan[]
  createdAt: bigint
  completedAt: bigint
}

export interface LatencyPercentiles {
  p50: number
  p90: number
  p95: number
  p99: number
  min: number
  max: number
  mean: number
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
  avgQueueLength: number
  avgServiceTime: number
  avgQueueWait: number
  avgTimeInSystem: number
  avgInSystem: number
  peakQueueLength: number
  utilization: number
  throughput: number
  errorRate: number
  availability: number
  latencyP50: number
  latencyP95: number
  latencyP99: number
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

export interface SimulationSummary {
  totalRequests: number
  /** Requests injected by the workload generator after the warmup period. */
  postWarmupTotalRequests: number
  successfulRequests: number
  failedRequests: number
  rejectedRequests: number
  timedOutRequests: number
  duration: number // ms
  throughput: number // successful req / sec after warmup
  errorRate: number // post-warmup failed / post-warmup total
  latency: LatencyPercentiles
}

interface InternalNodeMetrics {
  totalArrived: number
  postWarmupArrived: number
  totalProcessed: number
  totalRejected: number
  postWarmupRejected: number
  totalTimedOut: number
  postWarmupTimedOut: number
  queueSamples: number
  queueLengthSum: number
  queueWaitSumMs: number
  serviceTimeSumMs: number
  inSystemSamples: number
  inSystemSum: number
  peakQueueLength: number
  utilizationSamples: number
  utilizationSum: number
  latencySamplesMs: number[]
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
}

export class MetricsCollector {
  private readonly warmupDurationMs: number
  private readonly warmupDurationUs: bigint

  private readonly successfulLatencies: number[] = []
  private readonly perNode = new Map<string, InternalNodeMetrics>()
  private readonly nodeMetadata = new Map<string, NodeMetadata>()

  private totalRequests = 0
  /** Requests whose createdAt >= warmup — used for the summary global count. */
  private postWarmupTotalRequests = 0
  private successfulRequests = 0
  private postWarmupSuccessfulRequests = 0
  private failedRequests = 0
  private rejectedRequests = 0
  private timedOutRequests = 0

  constructor(config: {
    warmupDuration: number
    nodes?: Array<Pick<ComponentNode, 'id' | 'label' | 'slo'>>
  }) {
    this.warmupDurationMs = Math.max(0, config.warmupDuration)
    this.warmupDurationUs = msToMicro(this.warmupDurationMs)
    for (const node of config.nodes ?? []) {
      this.nodeMetadata.set(node.id, {
        label: node.label,
        slo: node.slo
      })
    }
  }

  recordRequest(request: CompletedRequest): void {
    this.totalRequests++

    if (request.status === 'success') {
      this.successfulRequests++
      if (request.createdAt >= this.warmupDurationUs) {
        this.postWarmupSuccessfulRequests++
        this.postWarmupTotalRequests++
        this.successfulLatencies.push(request.totalLatency)
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

    for (const span of request.spans) {
      const node = this.ensureNodeMetrics(span.nodeId)
      // Per-node post-warmup gate uses span.arrivalTime — the moment this request
      // actually reached this node in simulation time. Using request.createdAt
      // instead would miscount: a request created just before warmup ends but
      // processed entirely post-warmup would be excluded, inflating L relative to λW.
      const isSpanPostWarmup = span.arrivalTime >= this.warmupDurationUs

      node.totalArrived++
      if (isSpanPostWarmup) {
        node.postWarmupArrived++
      }
      node.totalProcessed++
      node.queueWaitSumMs += microToMs(span.queueWait)
      node.serviceTimeSumMs += microToMs(span.serviceTime)
      node.latencySamplesMs.push(microToMs(span.queueWait + span.serviceTime))

      if (isSpanPostWarmup) {
        node.postWarmupProcessed++
        node.postWarmupQueueWaitSumMs += microToMs(span.queueWait)
        node.postWarmupServiceTimeSumMs += microToMs(span.serviceTime)
      }
    }

    // If spans are unavailable, path still gives visibility into arrivals.
    if (request.spans.length === 0 && request.path.length > 0) {
      const isPostWarmupByCreation = request.createdAt >= this.warmupDurationUs
      for (const nodeId of request.path) {
        const node = this.ensureNodeMetrics(nodeId)
        node.totalArrived++
        if (isPostWarmupByCreation) {
          node.postWarmupArrived++
        }
      }
    }
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

    this.totalRequests++
    this.failedRequests++
    this.rejectedRequests++
    if (this.isPostWarmup(context.requestCreatedAt)) {
      this.postWarmupTotalRequests++
    }

    const node = this.ensureNodeMetrics(nodeId)
    node.totalArrived++
    node.totalRejected++
    node.rejectionsByReason[reason] = (node.rejectionsByReason[reason] ?? 0) + 1
    if (this.isPostWarmup(arrivalTime)) {
      node.postWarmupArrived++
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

    this.totalRequests++
    this.failedRequests++
    this.timedOutRequests++
    if (this.isPostWarmup(context.requestCreatedAt)) {
      this.postWarmupTotalRequests++
    }

    const node = this.ensureNodeMetrics(nodeId)
    node.totalArrived++
    node.totalTimedOut++
    if (this.isPostWarmup(arrivalTime)) {
      node.postWarmupArrived++
      node.postWarmupTimedOut++
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

    const utilization = Number.isFinite(state.utilization) ? state.utilization : 0
    const clampedUtilization = Math.min(1, Math.max(0, utilization))
    node.utilizationSum += clampedUtilization
    node.utilizationSamples++

    // Only accumulate the post-warmup L integrator after warmup ends
    if (timestamp >= this.warmupDurationUs) {
      node.postWarmupInSystemSum += state.totalInSystem
      node.postWarmupInSystemSamples++
    }
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

    return {
      totalRequests: this.totalRequests,
      postWarmupTotalRequests: this.postWarmupTotalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      rejectedRequests: this.rejectedRequests,
      timedOutRequests: this.timedOutRequests,
      duration,
      throughput,
      errorRate,
      latency: this.getLatencyPercentiles()
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
      const postWarmupFailed = postWarmupRejected + postWarmupTimedOut
      const errorRate = postWarmupArrived > 0 ? postWarmupFailed / postWarmupArrived : 0
      const sortedLatencies = metrics?.latencySamplesMs
        ? [...metrics.latencySamplesMs].sort((a, b) => a - b)
        : []
      const latencyP50 = this.percentileSorted(sortedLatencies, 0.5)
      const latencyP95 = this.percentileSorted(sortedLatencies, 0.95)
      const latencyP99 = this.percentileSorted(sortedLatencies, 0.99)
      const cacheHits = metrics?.cacheHits ?? 0
      const cacheMisses = metrics?.cacheMisses ?? 0
      const cacheHitRatio =
        cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : 0

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
        utilization:
          metrics && metrics.utilizationSamples > 0
            ? metrics.utilizationSum / metrics.utilizationSamples
            : 0,
        throughput: durationSec > 0 ? pwProcessed / durationSec : 0,
        errorRate,
        availability: 1 - errorRate,
        latencyP50,
        latencyP95,
        latencyP99,
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

  getNodeMetadata(nodeId: string): NodeMetadata | undefined {
    return this.nodeMetadata.get(nodeId)
  }

  getAllNodeMetadata(): Map<string, NodeMetadata> {
    return new Map(this.nodeMetadata)
  }

  getLatencyPercentiles(): LatencyPercentiles {
    if (this.successfulLatencies.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 }
    }

    const sorted = [...this.successfulLatencies].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const mean = sorted.reduce((acc, value) => acc + value, 0) / sorted.length

    return {
      p50: this.percentileSorted(sorted, 0.5),
      p90: this.percentileSorted(sorted, 0.9),
      p95: this.percentileSorted(sorted, 0.95),
      p99: this.percentileSorted(sorted, 0.99),
      min,
      max,
      mean
    }
  }

  /** Compute percentile from a pre-sorted ascending array. */
  private percentileSorted(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0
    const idx = Math.floor(p * (sortedAsc.length - 1))
    return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, idx))]
  }

  private isPostWarmup(eventTime?: bigint): boolean {
    return eventTime !== undefined && eventTime >= this.warmupDurationUs
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
      queueSamples: 0,
      queueLengthSum: 0,
      queueWaitSumMs: 0,
      serviceTimeSumMs: 0,
      inSystemSamples: 0,
      inSystemSum: 0,
      peakQueueLength: 0,
      utilizationSamples: 0,
      utilizationSum: 0,
      latencySamplesMs: [],
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
