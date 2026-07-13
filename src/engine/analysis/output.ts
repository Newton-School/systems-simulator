import { GlobalConfig } from '../core/types'
import type {
  CanonicalEventRecord,
  DebugEvent,
  EventCountsByType,
  RequestLifecycle
} from '../core/event-stream'
import { createEmptyEventCounts } from '../core/event-stream'
import { MetricsCollector, PerNodeMetrics, SimulationSummary } from '../metrics'
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
 * postWarmupArrived == postWarmupProcessed + postWarmupRejected + postWarmupTimedOut + inFlight
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
  /** postWarmupArrived − processed − rejected − timedOut */
  inFlight: number
  /** True when inFlight / postWarmupArrived < 5% (or postWarmupArrived == 0). */
  balanced: boolean
}

export interface SimulationOutput {
  summary: SimulationSummary
  perNode: Record<string, PerNodeMetrics>
  timeSeries: TimeSeriesSnapshot[]
  traces: RequestTrace[]
  causalGraph: CausalGraph | null
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
}

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
  }
): SimulationOutput {
  const summary = metrics.generateSummary(config.simulationDuration)
  const perNode = Object.fromEntries(
    metrics.getPerNodeMetrics(config.simulationDuration)
  ) as Record<string, PerNodeMetrics>
  const littlesLawCheck = calculateLittlesLaw(perNode, config)
  const sloBreaches = detectSLOBreaches(metrics, perNode)
  const warmupAdequacy = assessWarmupAdequacy(perNode, config)
  const conservationCheck = buildConservationCheck(perNode)

  return {
    summary,
    perNode,
    timeSeries: [...timeSeries],
    traces: tracer.getTraces(),
    causalGraph,
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
    debuggedLifecycle: debugData?.debuggedLifecycle ?? null
  }
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
 *   postWarmupArrived == postWarmupProcessed + postWarmupRejected + postWarmupTimedOut + inFlight
 *
 * All counters use the same node-level event-time gate so the identity must hold.
 * Large in-flight counts indicate requests were still queued at simulation cutoff.
 */
function buildConservationCheck(perNode: Record<string, PerNodeMetrics>): ConservationResult[] {
  return Object.entries(perNode).map(([nodeId, m]) => {
    const inFlight = Math.max(
      0,
      m.postWarmupArrived - m.postWarmupProcessed - m.postWarmupRejected - m.postWarmupTimedOut
    )
    const balanced = m.postWarmupArrived === 0 || inFlight / m.postWarmupArrived < 0.05
    return {
      nodeId,
      nodeLabel: m.nodeLabel,
      postWarmupArrived: m.postWarmupArrived,
      postWarmupProcessed: m.postWarmupProcessed,
      postWarmupRejected: m.postWarmupRejected,
      postWarmupTimedOut: m.postWarmupTimedOut,
      inFlight,
      balanced
    }
  })
}

function severityForRatio(ratio: number): 'warning' | 'critical' {
  return ratio >= 1.25 ? 'critical' : 'warning'
}
