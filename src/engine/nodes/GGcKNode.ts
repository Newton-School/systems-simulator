import { createEvent, Request, RequestSpan } from '../core/events'
import {
  readServiceTimeDistributionOverride,
  readServiceTimeLatencyPenaltyMs
} from '../traits/serviceTimeOverride'
import {
  ComponentNode,
  DistributionConfig,
  EventScheduler,
  NodeMetrics,
  NodeState
} from '../core/types'
import { Distributions } from '../stochastic/distribution'
import { NodeFailureSpec } from './failure'

export type ArrivalResult =
  | { status: 'processed' }
  | { status: 'queued' }
  | { status: 'rejected'; reason: 'capacity_exceeded' | 'node_failed' }
  // Admitted into a failed node's silent limbo: no service is scheduled, the
  // client will burn its timeout. `blackhole` consumes no K slot; `hang` does.
  | { status: 'held'; heldKind: 'blackhole' | 'hang' }

export interface CompletionResult {
  nextRequest: Request | null
  completedSpan?: RequestSpan
}

/** A held/in-flight request whose fate is a terminal connection_reset. */
export interface ResetRequest {
  request: Request
  arrivalTime: bigint
}

/** Outcome of a NODE_FAIL onset the engine must turn into terminals. */
export interface FailOnsetResult {
  connectionResets: ResetRequest[]
}

/** Outcome of a NODE_RECOVER the engine must turn into terminals. */
export interface RecoverResult {
  connectionResets: ResetRequest[]
  resumed: Request[]
  started: Request[]
}

export class GGcKNode {
  private readonly id: string
  private readonly maxWorkers: number
  private readonly maxCapacity: number
  private readonly serviceDistribution: DistributionConfig
  private readonly discipline: 'fifo' | 'lifo' | 'priority' | 'wfq'

  private queue: Request[] = []
  private activeWorkers = 0
  private status: 'idle' | 'busy' | 'saturated' | 'failed' = 'idle'

  /** Active failure spec, if any. Present for degraded even though status stays operational. */
  private failureSpec: NodeFailureSpec | null = null

  private readonly arrivalTimes = new Map<string, bigint>()
  private readonly startTimes = new Map<string, bigint>()
  /** In-service request objects, so a failure onset can move/reset them. */
  private readonly inServiceRequests = new Map<string, Request>()

  /** Admitted by a hung server; occupies a K slot until its client times out. */
  private heldHang: Request[] = []
  /** Never admitted by a dead NIC; does NOT occupy a K slot. */
  private readonly heldBlackhole = new Set<string>()

  /**
   * Time-weighted busy area — the integral ∫ activeWorkers dt in worker·µs, the
   * SINGLE SOURCE OF TRUTH for utilization. Accrued at every worker-count change
   * (the only place that knows exactly when workers go busy/idle), never
   * point-sampled: at 8ms service a worker toggles ~120×/s, so any snapshot
   * cadence undersamples and a snapshot-average would lie.
   */
  private busyAreaUs = 0n
  private lastAccrualUs = 0n

  private metrics: NodeMetrics = {
    totalArrivals: 0,
    totalCompleted: 0,
    totalRejections: 0,
    totalQueueTime: 0n,
    totalServiceTime: 0n,
    maxQueueLength: 0
  }

  private readonly distributions: Distributions
  private readonly scheduler: EventScheduler

  constructor(config: ComponentNode, distributions: Distributions, scheduler: EventScheduler) {
    if (!config.queue) {
      throw new Error(`GGcKNode requires a 'queue' configuration for component '${config.id}'.`)
    }

    const { workers, capacity, discipline } = config.queue
    if (!Number.isInteger(workers) || workers < 1) {
      throw new Error(
        `GGcKNode for component '${config.id}' requires 'queue.workers' to be a positive integer (got ${workers}).`
      )
    }

    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `GGcKNode for component '${config.id}' requires 'queue.capacity' to be a positive integer (got ${capacity}).`
      )
    }

    if (capacity < workers) {
      throw new Error(
        `GGcKNode for component '${config.id}' requires 'queue.capacity' to be greater than or equal to 'queue.workers' (capacity=${capacity}, workers=${workers}).`
      )
    }

    this.id = config.id
    this.maxWorkers = workers
    this.maxCapacity = capacity
    this.discipline = discipline
    this.serviceDistribution = config.processing?.distribution ?? { type: 'constant', value: 10 }
    this.distributions = distributions
    this.scheduler = scheduler
  }

  /** Items occupying a K slot: queued + in-service + hang-held (NOT blackhole). */
  private inSystem(): number {
    return this.activeWorkers + this.queue.length + this.heldHang.length
  }

  handleArrival(request: Request, currentTime: bigint): ArrivalResult {
    this.accrueBusy(currentTime)
    this.metrics.totalArrivals++

    if (this.status === 'failed') {
      const mode = this.failureSpec?.mode ?? 'reject'

      if (mode === 'blackhole') {
        this.holdBlackhole(request, currentTime)
        return { status: 'held', heldKind: 'blackhole' }
      }

      if (mode === 'hang') {
        if (this.inSystem() < this.maxCapacity) {
          this.holdHang(request, currentTime)
          return { status: 'held', heldKind: 'hang' }
        }
        // A hung server's accept backlog is full; the overflow is silence.
        this.holdBlackhole(request, currentTime)
        return { status: 'held', heldKind: 'blackhole' }
      }

      // reject (and any unexpected mode) → instant node_failed.
      this.metrics.totalRejections++
      return { status: 'rejected', reason: 'node_failed' }
    }

    // Not failed. Degraded nodes admit normally; only the service sampler changes.
    if (this.inSystem() >= this.maxCapacity) {
      this.metrics.totalRejections++
      return { status: 'rejected', reason: 'capacity_exceeded' }
    }

    this.arrivalTimes.set(request.id, currentTime)

    if (this.activeWorkers < this.maxWorkers) {
      this.startProcessing(request, currentTime)
      this.updateStatus()
      return { status: 'processed' }
    }

    this.queue.push(request)
    this.metrics.maxQueueLength = Math.max(this.metrics.maxQueueLength, this.queue.length)
    this.updateStatus()
    return { status: 'queued' }
  }

  private holdBlackhole(request: Request, currentTime: bigint): void {
    this.heldBlackhole.add(request.id)
    this.arrivalTimes.set(request.id, currentTime)
  }

  private holdHang(request: Request, currentTime: bigint): void {
    this.heldHang.push(request)
    this.arrivalTimes.set(request.id, currentTime)
  }

  handleCompletion(request: Request, currentTime: bigint): CompletionResult {
    this.accrueBusy(currentTime)
    if (!this.startTimes.has(request.id)) {
      return { nextRequest: null }
    }

    if (this.activeWorkers > 0) {
      this.activeWorkers--
    }

    const startTime = this.startTimes.get(request.id) ?? currentTime
    const arrivalTime = this.arrivalTimes.get(request.id) ?? startTime
    const queueWait = startTime >= arrivalTime ? startTime - arrivalTime : 0n
    const serviceTime = currentTime >= startTime ? currentTime - startTime : 0n

    this.metrics.totalServiceTime += serviceTime
    this.metrics.totalCompleted++

    const completedSpan: RequestSpan = {
      nodeId: this.id,
      arrivalTime,
      queueWait,
      serviceTime,
      departureTime: currentTime
    }

    this.arrivalTimes.delete(request.id)
    this.startTimes.delete(request.id)
    this.inServiceRequests.delete(request.id)

    if (this.status === 'failed') {
      return { nextRequest: null, completedSpan }
    }

    let nextRequest: Request | null = null
    if (this.queue.length > 0) {
      const dequeued = this.dequeue()
      if (dequeued) {
        this.startProcessing(dequeued, currentTime)
        nextRequest = dequeued
      }
    }

    this.updateStatus()
    return { nextRequest, completedSpan }
  }

  /**
   * Remove a request that has reached a terminal timeout, returning its node
   * arrival time (or null if unknown here). Handles queued, in-service, and both
   * held sets. hang-held frees a K slot; blackhole-held has no slot to free.
   */
  cancelRequest(
    requestId: string,
    currentTime: bigint
  ): { arrivalTime: bigint | null; nextRequest: Request | null } {
    this.accrueBusy(currentTime)
    const arrivalTime = this.arrivalTimes.get(requestId) ?? null

    if (this.heldBlackhole.delete(requestId)) {
      this.arrivalTimes.delete(requestId)
      return { arrivalTime, nextRequest: null }
    }

    const hangIndex = this.heldHang.findIndex((request) => request.id === requestId)
    if (hangIndex >= 0) {
      this.heldHang.splice(hangIndex, 1) // frees a K slot via inSystem()
      this.arrivalTimes.delete(requestId)
      this.updateStatus()
      return { arrivalTime, nextRequest: null }
    }

    const queuedIndex = this.queue.findIndex((request) => request.id === requestId)
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1)
      this.arrivalTimes.delete(requestId)
      this.startTimes.delete(requestId)
      this.inServiceRequests.delete(requestId)
      this.updateStatus()
      return { arrivalTime, nextRequest: null }
    }

    if (this.startTimes.has(requestId)) {
      if (this.activeWorkers > 0) {
        this.activeWorkers--
      }

      this.arrivalTimes.delete(requestId)
      this.startTimes.delete(requestId)
      this.inServiceRequests.delete(requestId)

      let nextRequest: Request | null = null
      if (this.status !== 'failed' && this.queue.length > 0) {
        nextRequest = this.dequeue() ?? null
        if (nextRequest) {
          this.startProcessing(nextRequest, currentTime)
        }
      }

      this.updateStatus()
      return { arrivalTime, nextRequest }
    }

    return { arrivalTime: null, nextRequest: null }
  }

  /**
   * NODE_FAIL(spec) at time T. `degraded` only records the spec (the node keeps
   * serving). Otherwise the node becomes failed and its in-flight requests are
   * disposed per `inFlightPolicy`:
   *   - reset: kill -9 — bump both seqs (cancel their completion AND timeout),
   *     clear them, and return them for terminal connection_reset (latency T−arrival).
   *   - hang:  SIGSTOP — bump only completionSeq (their timeout clock keeps
   *     ticking), then move queued + in-service into heldHang.
   */
  fail(spec: NodeFailureSpec, currentTime: bigint): FailOnsetResult {
    this.accrueBusy(currentTime)
    this.failureSpec = spec

    if (spec.mode === 'degraded') {
      // No state-machine change; degraded nodes keep admitting and serving.
      return { connectionResets: [] }
    }

    this.status = 'failed'

    if (spec.inFlightPolicy === 'reset') {
      const connectionResets: ResetRequest[] = []
      const collect = (request: Request): void => {
        const arrivalTime = this.arrivalTimes.get(request.id) ?? currentTime
        request.completionSeq = (request.completionSeq ?? 0) + 1
        request.timeoutSeq = (request.timeoutSeq ?? 0) + 1
        connectionResets.push({ request, arrivalTime })
      }
      for (const request of this.queue) collect(request)
      for (const request of this.inServiceRequests.values()) collect(request)

      this.queue = []
      this.startTimes.clear()
      this.inServiceRequests.clear()
      this.activeWorkers = 0
      for (const reset of connectionResets) {
        this.arrivalTimes.delete(reset.request.id)
      }
      return { connectionResets }
    }

    // inFlightPolicy: 'hang' — SIGSTOP. In-service completions are cancelled
    // (their processing-complete becomes stale) but their timeout stays live.
    const held: Array<{ request: Request; arrivalTime: bigint }> = []
    for (const request of this.queue) {
      held.push({ request, arrivalTime: this.arrivalTimes.get(request.id) ?? currentTime })
    }
    for (const request of this.inServiceRequests.values()) {
      request.completionSeq = (request.completionSeq ?? 0) + 1
      held.push({ request, arrivalTime: this.arrivalTimes.get(request.id) ?? currentTime })
    }
    // Preserve arrival order so resume-recovery re-enqueues fairly.
    held.sort((a, b) =>
      a.arrivalTime < b.arrivalTime ? -1 : a.arrivalTime > b.arrivalTime ? 1 : 0
    )

    this.queue = []
    this.startTimes.clear()
    this.inServiceRequests.clear()
    this.activeWorkers = 0
    this.heldHang = held.map((entry) => entry.request)

    return { connectionResets: [] }
  }

  /**
   * NODE_RECOVER at time R. blackhole-held requests are left untouched — their
   * timeouts proceed and are never wrong. hang-held requests are disposed per
   * `recoveryPolicy`:
   *   - reset:  bump timeoutSeq (cancel their live timeout) and return them for
   *     terminal connection_reset (latency R−arrival).
   *   - resume: re-enqueue in arrival order, leave their timeouts live, and
   *     dispatch workers. Each resumed request races its original timeout via
   *     the seq mechanism.
   */
  recover(currentTime: bigint): RecoverResult {
    this.accrueBusy(currentTime)
    const spec = this.failureSpec
    this.failureSpec = null

    if (!spec || spec.mode === 'degraded') {
      // Degraded (or bare) recovery: nothing was held.
      if (this.status === 'failed') {
        this.status = 'idle'
        this.updateStatus()
      }
      return { connectionResets: [], resumed: [], started: [] }
    }

    this.status = 'idle'

    if (spec.recoveryPolicy === 'reset') {
      const connectionResets: ResetRequest[] = []
      for (const request of this.heldHang) {
        const arrivalTime = this.arrivalTimes.get(request.id) ?? currentTime
        request.timeoutSeq = (request.timeoutSeq ?? 0) + 1
        this.arrivalTimes.delete(request.id)
        connectionResets.push({ request, arrivalTime })
      }
      this.heldHang = []
      this.updateStatus()
      return { connectionResets, resumed: [], started: [] }
    }

    // resume — re-enqueue held requests in arrival order and dispatch workers.
    const resumed = [...this.heldHang]
    const started: Request[] = []
    this.heldHang = []
    for (const request of resumed) {
      this.queue.push(request)
    }
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      const next = this.dequeue()
      if (!next) break
      this.startProcessing(next, currentTime)
      started.push(next)
    }
    this.updateStatus()
    return { connectionResets: [], resumed, started }
  }

  getState(): NodeState {
    return {
      id: this.id,
      status: this.status,
      activeWorkers: this.activeWorkers,
      queueLength: this.queue.length,
      utilization: this.activeWorkers / this.maxWorkers,
      totalInSystem: this.inSystem()
    }
  }

  getMetrics(): NodeMetrics {
    return { ...this.metrics }
  }

  /**
   * Accrue busy-worker time up to `now` at the CURRENT activeWorkers, then mark
   * `now` as the last accrual point. Called at the top of every method that can
   * change activeWorkers, BEFORE the change — so each interval is attributed to
   * the worker count that actually held during it.
   */
  private accrueBusy(now: bigint): void {
    if (now <= this.lastAccrualUs) {
      return
    }
    this.busyAreaUs += BigInt(this.activeWorkers) * (now - this.lastAccrualUs)
    this.lastAccrualUs = now
  }

  /** Close the busy-area integral at the run horizon. Idempotent. */
  finalizeUtilization(nowUs: bigint): void {
    this.accrueBusy(nowUs)
  }

  /** ∫ activeWorkers dt (worker·µs) — divide by (duration × maxWorkers) for utilization. */
  getBusyAreaUs(): bigint {
    return this.busyAreaUs
  }

  /**
   * Debug-only invariant check, run at event boundaries by the engine when
   * enabled. Throws on: inSystem identity mismatch, K overflow, worker/in-service
   * desync, or a heldBlackhole id that also occupies a slot.
   */
  debugAssertInvariants(): void {
    if (this.activeWorkers !== this.startTimes.size) {
      throw new Error(
        `[${this.id}] worker desync: activeWorkers=${this.activeWorkers} inService=${this.startTimes.size}`
      )
    }
    if (this.startTimes.size !== this.inServiceRequests.size) {
      throw new Error(
        `[${this.id}] in-service map desync: startTimes=${this.startTimes.size} requests=${this.inServiceRequests.size}`
      )
    }
    const inSystem = this.inSystem()
    if (inSystem > this.maxCapacity) {
      throw new Error(`[${this.id}] inSystem ${inSystem} exceeds K ${this.maxCapacity}`)
    }
    for (const id of this.heldBlackhole) {
      if (this.startTimes.has(id) || this.queue.some((r) => r.id === id)) {
        throw new Error(`[${this.id}] heldBlackhole id ${id} also occupies a slot`)
      }
      if (this.heldHang.some((r) => r.id === id)) {
        throw new Error(`[${this.id}] heldBlackhole id ${id} also in heldHang`)
      }
    }
  }

  private startProcessing(request: Request, currentTime: bigint): void {
    this.activeWorkers++
    this.startTimes.set(request.id, currentTime)
    this.inServiceRequests.set(request.id, request)

    const arrivalTime = this.arrivalTimes.get(request.id) ?? currentTime
    this.metrics.totalQueueTime += currentTime - arrivalTime

    const serviceDistribution =
      readServiceTimeDistributionOverride(request) ?? this.serviceDistribution
    const rawServiceTimeMs = this.distributions.fromConfig(serviceDistribution)
    if (!Number.isFinite(rawServiceTimeMs)) {
      throw new Error(
        `Invalid service time generated for node ${this.id}: ${String(rawServiceTimeMs)}`
      )
    }
    let serviceTimeMs = Math.max(0, rawServiceTimeMs) + readServiceTimeLatencyPenaltyMs(request)

    // Degraded mode: a `fraction` of requests take `serviceTimeMultiplier`× as
    // long. Decided at service start; already-scheduled completions are untouched.
    const degradation =
      this.failureSpec?.mode === 'degraded' ? this.failureSpec.degradation : undefined
    if (degradation && this.distributions.random() < degradation.fraction) {
      serviceTimeMs *= degradation.serviceTimeMultiplier
    }

    const serviceTimeMicro = BigInt(Math.round(serviceTimeMs * 1000))

    this.scheduler.schedule(
      createEvent(
        'processing-complete',
        this.id,
        request.id,
        // Snapshot the completion generation so a later failure transition can
        // invalidate this in-service completion via the lazy-tombstone check.
        { request, completionSeq: request.completionSeq ?? 0 },
        currentTime + serviceTimeMicro
      )
    )
  }

  private dequeue(): Request | undefined {
    if (this.queue.length === 0) return undefined

    switch (this.discipline) {
      case 'fifo':
      case 'wfq':
        return this.queue.shift()
      case 'lifo':
        return this.queue.pop()
      case 'priority': {
        let bestIdx = 0
        for (let i = 1; i < this.queue.length; i++) {
          if (this.queue[i].priority < this.queue[bestIdx].priority) {
            bestIdx = i
          }
        }
        return this.queue.splice(bestIdx, 1)[0]
      }
      default: {
        const _exhaustive: never = this.discipline
        throw new Error(`Unknown queue discipline: ${_exhaustive}`)
      }
    }
  }

  private updateStatus(): void {
    if (this.status === 'failed') return

    if (this.activeWorkers === 0) {
      this.status = 'idle'
    } else if (this.activeWorkers >= this.maxWorkers && this.queue.length > 0) {
      this.status = 'saturated'
    } else {
      this.status = 'busy'
    }
  }
}
