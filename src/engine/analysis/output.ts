import { GlobalConfig } from '../core/types'
import type {
  CanonicalEventRecord,
  DebugEvent,
  EventCountsByType,
  RequestLifecycle,
  RequestOutcomeRecord
} from '../core/event-stream'
import { createEmptyEventCounts } from '../core/event-stream'
import {
  createEmptyRequestOutcomeBreakdown,
  type RequestOutcomeFamily
} from '../core/requestOutcomeSemantics'
import {
  DELIVERY_TIMELINE_STATES,
  IDEMPOTENCY_TIMELINE_STATES,
  LOCK_TIMELINE_STATES,
  QUEUE_DELIVERY_SEMANTICS,
  REQUEST_TIMELINE_STATES,
  RESERVATION_TIMELINE_STATES,
  type DeliveryGuarantee,
  type DeliveryTimelineState,
  type IdempotencyTimelineState,
  type LockTimelineState,
  type QueueDeliverySemantics,
  type RequestTimelineState,
  type ReservationTimelineState
} from '../core/simulationSemantics'
import { MetricsCollector, PerEdgeMetrics, PerNodeMetrics, SimulationSummary } from '../metrics'
import { RequestTrace, RequestTracer } from '../tracer'

export interface TimeSeriesSnapshot {
  timestamp: number
  node: Record<
    string,
    {
      queueLength: number
      activeWorkers: number
      totalInSystem: number
      utilization: number
      status: string
    }
  >
}

export interface CausalGraph {
  rootCauses: Array<{
    nodeId: string
    event: string
    time: number
  }>
  propagation: Array<{
    from: string
    to: string
    effect: string
    time: number
  }>
  impactSummary: {
    totalNodesAffected: number
    cascadeDepth: number
    timeToFullCascade: number
  }
}

export interface InvariantViolation {
  invariantId: string
  invariantName: string
  violatedAt: number
  details: string
  rootCause?: string
  affectedComponents?: string[]
}

export interface SLOBreach {
  nodeId: string
  nodeLabel: string
  metric: 'latencyP99' | 'availability'
  target: number
  actual: number
  severity: 'warning' | 'critical'
}

export interface LittlesLawResult {
  nodeId: string
  /** Observed time-average items in system (post-warmup window). */
  observedL: number
  /** Expected L = λ × W (all three measured over the post-warmup window). */
  expectedL: number
  /** |observedL − expectedL| / max(expectedL, ε) */
  error: number
  withinTolerance: boolean
  /** Arrival rate (req/s) over the post-warmup window. */
  lambda: number
  /** Mean sojourn time (seconds) over the post-warmup window. */
  wSeconds: number
}

/**
 * Heuristic adequacy assessment for the warmup period.
 * A warmup that is too short contaminates steady-state metrics with
 * transient ramp-up behaviour, causing inflated Little's Law errors.
 */
export interface WarmupAdequacy {
  adequate: boolean
  warmupMs: number
  /** Minimum recommended warmup = 10 × max per-node p99 latency. */
  recommendedWarmupMs: number
  reason: string
}

/**
 * Per-node conservation check using the post-warmup window only.
 * postWarmupArrived
 *   == postWarmupProcessed
 *    + postWarmupRejected
 *    + postWarmupTimedOut
 *    + postWarmupConnectionReset
 *    + inFlight
 *
 * All four counters use the same time domain (node-level event time ≥ warmup),
 * so an `inFlight` > 5% of arrivals is a genuine imbalance — typically requests
 * still queued when the simulation clock hit the duration limit.
 */
export interface ConservationResult {
  nodeId: string
  nodeLabel?: string
  postWarmupArrived: number
  postWarmupProcessed: number
  postWarmupRejected: number
  postWarmupTimedOut: number
  postWarmupConnectionReset: number
  /** postWarmupArrived − processed − rejected − timedOut − connectionReset */
  inFlight: number
  /** True when inFlight / postWarmupArrived < 5% (or postWarmupArrived == 0). */
  balanced: boolean
}

/**
 * A component's failure/recovery interval — a first-class run artifact. A
 * `node-failure` opens the window; the matching `node-recovery` closes it;
 * windows still open at cutoff close at the simulation horizon. Shading these
 * on a time axis partitions every metric into before / during / after and makes
 * the survivor-bias trap self-evident (successes cluster left of the band).
 */
export interface StatusWindow {
  componentId: string
  /** Failure mode active during the window (reject | blackhole | hang | degraded). */
  mode: string
  startMs: number
  endMs: number
}

export type RuntimeDeliveryGuarantee = Exclude<DeliveryGuarantee, 'best-effort' | 'exactly-once'>

export interface RuntimeSemanticsSummary {
  queuedOutcomes: number
  retriedOutcomes: number
  downgradedQueuedOutcomes: number
  configuredDeliverySemantics: Record<QueueDeliverySemantics, number>
  runtimeDeliveryGuarantees: Record<RuntimeDeliveryGuarantee, number>
  transitionCounts: {
    request: Record<RequestTimelineState, number>
    delivery: Record<DeliveryTimelineState, number>
    idempotency: Record<IdempotencyTimelineState, number>
    lock: Record<LockTimelineState, number>
    reservation: Record<ReservationTimelineState, number>
  }
  affectedOutcomeCounts: {
    producerAcked: number
    releasedToConsumer: number
    redeliveryScheduled: number
    dlqRouted: number
    duplicateSuppressed: number
    lockContended: number
    reservationOversold: number
  }
}

export interface SimulationOutput {
  summary: SimulationSummary
  perNode: Record<string, PerNodeMetrics>
  perEdge: Record<string, PerEdgeMetrics>
  timeSeries: TimeSeriesSnapshot[]
  /** Component failure/recovery intervals (ms), for shading outage windows. */
  statusTimeline: StatusWindow[]
  traces: RequestTrace[]
  causalGraph: CausalGraph | null
  /** Number of explicitly configured SLO targets evaluated for this run. */
  sloTargetCount: number
  sloBreaches: SLOBreach[]
  invariantViolations: InvariantViolation[]
  littlesLawCheck: LittlesLawResult[]
  warmupAdequacy: WarmupAdequacy
  conservationCheck: ConservationResult[]
  seed: string
  reproducible: true
  eventsProcessed: number
  /** Canonical replay events retained for UI inspection. Large runs may be capped. */
  eventStream: CanonicalEventRecord[]
  /** Aggregate counts across the full canonical event stream, including truncated events. */
  eventCountsByType: EventCountsByType
  /** Total simulation duration in ms (including warmup). */
  simulationDuration: number
  /** Warmup period in ms (excluded from metrics). */
  warmupDuration: number
  /** Full or filtered debug event stream captured during the run. */
  eventLog: DebugEvent[] | null
  /** Lifecycle assembled for a focused debug request, when one was selected. */
  debuggedLifecycle: RequestLifecycle | null
  /**
   * Per-request outcome rows retained for UI inspection. Engine-side callers may
   * keep this complete; worker/UI payloads may sample it for very large runs.
   */
  requestOutcomes: RequestOutcomeRecord[]
  /** Total outcome rows before any UI transport sampling. */
  requestOutcomeTotal: number
  /** Exact counts by request outcome family across the full run. */
  requestOutcomeBreakdown: Record<RequestOutcomeFamily, number>
  /** True when `requestOutcomes` is a sampled subset of the total outcome ledger. */
  requestOutcomesSampled: boolean
  /** Exact run-level semantics summary computed before any worker-side sampling. */
  runtimeSemanticsSummary: RuntimeSemanticsSummary
}

const RUNTIME_DELIVERY_GUARANTEES = [
  'at-most-once',
  'at-least-once',
  'effectively-once'
] as const satisfies readonly RuntimeDeliveryGuarantee[]

export function generateSimulationOutput(
  metrics: MetricsCollector,
  tracer: RequestTracer,
  timeSeries: TimeSeriesSnapshot[],
  causalGraph: CausalGraph | null,
  invariantViolations: InvariantViolation[],
  config: GlobalConfig,
  eventsProcessed: number,
  eventStream: CanonicalEventRecord[] = [],
  eventCountsByType: EventCountsByType = createEmptyEventCounts(),
  debugData?: {
    eventLog?: DebugEvent[] | null
    debuggedLifecycle?: RequestLifecycle | null
    statusTimeline?: StatusWindow[]
    requestOutcomes?: RequestOutcomeRecord[]
    requestOutcomeTotal?: number
    requestOutcomeBreakdown?: Record<RequestOutcomeFamily, number>
    requestOutcomesSampled?: boolean
  }
): SimulationOutput {
  const summary = metrics.generateSummary(config.simulationDuration)
  const perNode = Object.fromEntries(
    metrics.getPerNodeMetrics(config.simulationDuration)
  ) as Record<string, PerNodeMetrics>
  const perEdge = Object.fromEntries(metrics.getPerEdgeMetrics()) as Record<string, PerEdgeMetrics>
  const littlesLawCheck = calculateLittlesLaw(perNode, config)
  const sloBreaches = detectSLOBreaches(metrics, perNode)
  const sloTargetCount = countSLOTargets(metrics, perNode)
  const warmupAdequacy = assessWarmupAdequacy(perNode, config)
  const conservationCheck = buildConservationCheck(perNode)

  const requestOutcomes = debugData?.requestOutcomes ?? []
  const runtimeSemanticsSummary = buildRuntimeSemanticsSummary(requestOutcomes)

  return {
    summary,
    perNode,
    perEdge,
    timeSeries: [...timeSeries],
    statusTimeline: debugData?.statusTimeline ?? [],
    traces: tracer.getTraces(),
    causalGraph,
    sloTargetCount,
    sloBreaches,
    invariantViolations: [...invariantViolations],
    littlesLawCheck,
    warmupAdequacy,
    conservationCheck,
    seed: config.seed,
    reproducible: true,
    eventsProcessed,
    eventStream: [...eventStream],
    eventCountsByType: { ...eventCountsByType },
    simulationDuration: config.simulationDuration,
    warmupDuration: config.warmupDuration,
    eventLog: debugData?.eventLog ?? null,
    debuggedLifecycle: debugData?.debuggedLifecycle ?? null,
    requestOutcomes,
    requestOutcomeTotal: debugData?.requestOutcomeTotal ?? requestOutcomes.length,
    requestOutcomeBreakdown:
      debugData?.requestOutcomeBreakdown ?? createEmptyRequestOutcomeBreakdown(),
    requestOutcomesSampled: debugData?.requestOutcomesSampled ?? false,
    runtimeSemanticsSummary
  }
}

function createCountRecord<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>
}

function buildRuntimeSemanticsSummary(
  requestOutcomes: readonly RequestOutcomeRecord[]
): RuntimeSemanticsSummary {
  const summary: RuntimeSemanticsSummary = {
    queuedOutcomes: 0,
    retriedOutcomes: 0,
    downgradedQueuedOutcomes: 0,
    configuredDeliverySemantics: createCountRecord(QUEUE_DELIVERY_SEMANTICS),
    runtimeDeliveryGuarantees: createCountRecord(RUNTIME_DELIVERY_GUARANTEES),
    transitionCounts: {
      request: createCountRecord(REQUEST_TIMELINE_STATES),
      delivery: createCountRecord(DELIVERY_TIMELINE_STATES),
      idempotency: createCountRecord(IDEMPOTENCY_TIMELINE_STATES),
      lock: createCountRecord(LOCK_TIMELINE_STATES),
      reservation: createCountRecord(RESERVATION_TIMELINE_STATES)
    },
    affectedOutcomeCounts: {
      producerAcked: 0,
      releasedToConsumer: 0,
      redeliveryScheduled: 0,
      dlqRouted: 0,
      duplicateSuppressed: 0,
      lockContended: 0,
      reservationOversold: 0
    }
  }

  for (const row of requestOutcomes) {
    if (row.semantics.delivery) {
      summary.queuedOutcomes += 1
      summary.configuredDeliverySemantics[row.semantics.delivery.configuredSemantics] += 1
      summary.runtimeDeliveryGuarantees[row.semantics.delivery.runtimeGuarantee] += 1
      if (row.semantics.delivery.downgradedFromConfigured) {
        summary.downgradedQueuedOutcomes += 1
      }
    }

    if (row.attempts > 1) {
      summary.retriedOutcomes += 1
    }

    let producerAcked = false
    let releasedToConsumer = false
    let redeliveryScheduled = false
    let dlqRouted = false
    let duplicateSuppressed = false
    let lockContended = false
    let reservationOversold = false

    for (const transition of row.stateTimeline) {
      switch (transition.scope) {
        case 'request':
          summary.transitionCounts.request[transition.state as RequestTimelineState] += 1
          break
        case 'delivery':
          summary.transitionCounts.delivery[transition.state as DeliveryTimelineState] += 1
          if (transition.state === 'producer-acked') {
            producerAcked = true
          } else if (transition.state === 'released-to-consumer') {
            releasedToConsumer = true
          } else if (transition.state === 'redelivery-scheduled') {
            redeliveryScheduled = true
          } else if (transition.state === 'dlq-routed') {
            dlqRouted = true
          }
          break
        case 'idempotency':
          summary.transitionCounts.idempotency[transition.state as IdempotencyTimelineState] += 1
          if (transition.state === 'deduped') {
            duplicateSuppressed = true
          }
          break
        case 'lock':
          summary.transitionCounts.lock[transition.state as LockTimelineState] += 1
          if (transition.state === 'contended') {
            lockContended = true
          }
          break
        case 'reservation':
          summary.transitionCounts.reservation[transition.state as ReservationTimelineState] += 1
          if (transition.state === 'oversold') {
            reservationOversold = true
          }
          break
      }
    }

    if (producerAcked) {
      summary.affectedOutcomeCounts.producerAcked += 1
    }
    if (releasedToConsumer) {
      summary.affectedOutcomeCounts.releasedToConsumer += 1
    }
    if (redeliveryScheduled) {
      summary.affectedOutcomeCounts.redeliveryScheduled += 1
    }
    if (dlqRouted) {
      summary.affectedOutcomeCounts.dlqRouted += 1
    }
    if (duplicateSuppressed) {
      summary.affectedOutcomeCounts.duplicateSuppressed += 1
    }
    if (lockContended) {
      summary.affectedOutcomeCounts.lockContended += 1
    }
    if (reservationOversold) {
      summary.affectedOutcomeCounts.reservationOversold += 1
    }
  }

  return summary
}

function countSLOTargets(
  metrics: MetricsCollector,
  perNode: Record<string, PerNodeMetrics>
): number {
  let count = 0
  for (const nodeId of Object.keys(perNode)) {
    const slo = metrics.getNodeMetadata(nodeId)?.slo
    if (!slo) {
      continue
    }
    if (typeof slo.latencyP99 === 'number') {
      count++
    }
    if (typeof slo.availabilityTarget === 'number') {
      count++
    }
  }
  return count
}

function detectSLOBreaches(
  metrics: MetricsCollector,
  perNode: Record<string, PerNodeMetrics>
): SLOBreach[] {
  const breaches: SLOBreach[] = []

  for (const [nodeId, nodeMetrics] of Object.entries(perNode)) {
    const metadata = metrics.getNodeMetadata(nodeId)
    const slo = metadata?.slo
    if (!slo) {
      continue
    }

    const nodeLabel = metadata?.label ?? nodeMetrics.nodeLabel ?? nodeId

    if (typeof slo.latencyP99 === 'number' && nodeMetrics.latencyP99 > slo.latencyP99) {
      breaches.push({
        nodeId,
        nodeLabel,
        metric: 'latencyP99',
        target: slo.latencyP99,
        actual: nodeMetrics.latencyP99,
        severity: severityForRatio(nodeMetrics.latencyP99 / Math.max(slo.latencyP99, 0.0001))
      })
    }

    if (
      typeof slo.availabilityTarget === 'number' &&
      nodeMetrics.availability < slo.availabilityTarget
    ) {
      breaches.push({
        nodeId,
        nodeLabel,
        metric: 'availability',
        target: slo.availabilityTarget,
        actual: nodeMetrics.availability,
        severity: severityForRatio(
          slo.availabilityTarget / Math.max(nodeMetrics.availability, 0.0001)
        )
      })
    }
  }

  return breaches
}

/**
 * Calculate Little's Law (L = λW) for each node using exclusively the
 * post-warmup window so that all three quantities share the same time domain.
 *
 * - λ  = postWarmupArrived / effectiveDurationSec
 * - W  = postWarmupAvgTimeInSystem (ms → s)
 * - L  = postWarmupAvgInSystem
 */
function calculateLittlesLaw(
  perNode: Record<string, PerNodeMetrics>,
  config: GlobalConfig
): LittlesLawResult[] {
  const durationSec = Math.max(0.001, (config.simulationDuration - config.warmupDuration) / 1000)

  return Object.entries(perNode).map(([nodeId, metrics]) => {
    const lambda = metrics.postWarmupArrived / durationSec
    const wSeconds = metrics.postWarmupAvgTimeInSystem / 1000
    const expectedL = lambda * wSeconds
    // const observedL = metrics.postWarmupAvgInSystem
    // const error = Math.abs(observedL - expectedL) / Math.max(expectedL, 0.001)

    const observedL = metrics.postWarmupAvgInSystem
    const absoluteError = Math.abs(observedL - expectedL)
    const error = absoluteError / Math.max(expectedL, 0.001)

    return {
      nodeId,
      observedL,
      expectedL,
      error,
      withinTolerance: error <= 0.1 || absoluteError <= 0.5, // ← dual guard,
      lambda,
      wSeconds
    }
  })
}

/**
 * Warn when warmup duration is less than 10× the maximum per-node p99 latency.
 * This heuristic guards against transient ramp-up contaminating steady-state metrics.
 */
function assessWarmupAdequacy(
  perNode: Record<string, PerNodeMetrics>,
  config: GlobalConfig
): WarmupAdequacy {
  const WARMUP_MULTIPLIER = 10
  const warmupMs = config.warmupDuration

  // Find the largest p99 latency across all nodes that received traffic
  let maxP99Ms = 0
  for (const m of Object.values(perNode)) {
    if (m.postWarmupArrived > 0 && m.latencyP99 > maxP99Ms) {
      maxP99Ms = m.latencyP99
    }
  }

  const recommendedWarmupMs = Math.ceil(maxP99Ms * WARMUP_MULTIPLIER)

  if (maxP99Ms === 0) {
    return {
      adequate: true,
      warmupMs,
      recommendedWarmupMs: warmupMs,
      reason: 'No traffic observed — adequacy cannot be assessed.'
    }
  }

  const actualRatio = warmupMs / maxP99Ms

  if (warmupMs >= recommendedWarmupMs) {
    return {
      adequate: true,
      warmupMs,
      recommendedWarmupMs,
      reason: `Warmup ${warmupMs}ms = ${actualRatio.toFixed(1)}× max p99 (${maxP99Ms.toFixed(1)}ms) — threshold ≥10×. Steady-state window looks clean.`
    }
  }

  return {
    adequate: false,
    warmupMs,
    recommendedWarmupMs,
    reason: `Warmup ${warmupMs}ms = ${actualRatio.toFixed(1)}× max p99 (${maxP99Ms.toFixed(1)}ms) — threshold ≥10×. Transient phase may contaminate metrics. Recommend warmup ≥ ${recommendedWarmupMs}ms.`
  }
}

/**
 * Verify conservation over the post-warmup window:
 *   postWarmupArrived
 *     == postWarmupProcessed
 *      + postWarmupRejected
 *      + postWarmupTimedOut
 *      + postWarmupConnectionReset
 *      + inFlight
 *
 * All counters use the same node-level event-time gate so the identity must hold.
 * Large in-flight counts indicate requests were still queued at simulation cutoff.
 */
function buildConservationCheck(perNode: Record<string, PerNodeMetrics>): ConservationResult[] {
  return Object.entries(perNode).map(([nodeId, m]) => {
    const inFlight = Math.max(
      0,
      m.postWarmupArrived -
        m.postWarmupProcessed -
        m.postWarmupRejected -
        m.postWarmupTimedOut -
        m.postWarmupConnectionReset
    )
    const balanced = m.postWarmupArrived === 0 || inFlight / m.postWarmupArrived < 0.05
    return {
      nodeId,
      nodeLabel: m.nodeLabel,
      postWarmupArrived: m.postWarmupArrived,
      postWarmupProcessed: m.postWarmupProcessed,
      postWarmupRejected: m.postWarmupRejected,
      postWarmupTimedOut: m.postWarmupTimedOut,
      postWarmupConnectionReset: m.postWarmupConnectionReset,
      inFlight,
      balanced
    }
  })
}

function severityForRatio(ratio: number): 'warning' | 'critical' {
  return ratio >= 1.25 ? 'critical' : 'warning'
}
