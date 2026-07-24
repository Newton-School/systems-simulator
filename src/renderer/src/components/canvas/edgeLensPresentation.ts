import type { MetricLens, EdgeSimulationData } from '@renderer/types/ui'
import type { EdgeFlowState } from '@renderer/store/useStore'
import { EDGE_PATH_TYPE_HELP } from '@renderer/config/edgeSemantics'
import { failureRateLevelFromRatio } from '@renderer/utils/failureRatePresentation'
import type { EdgeDefaults } from '../../../../engine/defaults/edgeDefaults'
import type { EdgeFailureCause } from '../../../../engine/core/events'

/**
 * Projects the active metric lens onto a single edge. The edge does not decide
 * what to display — it renders the edge-side view of whatever lens is active,
 * mirroring the node-side `getLensCard` / `getPreRunMetric` split in
 * `nodePresentation.ts`. Pre-run lenses read declared capacity from config;
 * runtime lenses read measured behaviour from the post-warmup flow.
 */
export type EdgeSeverity = 'ok' | 'warn' | 'crit'

export interface EdgeLensProjection {
  /** Always-shown label text, e.g. "145 rps". Empty when the edge recedes. */
  headline: string
  /** On-select / hover detail, e.g. "offered 160" or "packet loss 3%". */
  sub?: string
  /** Drives STROKE COLOR — computed independently of the lens so a failing
   *  link stays red even under a non-error lens. */
  severity: EdgeSeverity
  /** True for node-first lenses: the edge dims to its identity and lets the
   *  nodes carry the lens. */
  recedes: boolean
  /** Tooltip explaining what the headline means. */
  why: string
}

export interface EdgeLensInput {
  lens: MetricLens
  /** Undefined before a run, or on edges that carried no traffic. */
  flow: EdgeFlowState | undefined
  /** The edge's explicit config (values the user set). */
  config: EdgeSimulationData
  /** Inferred defaults for any field the config leaves unset — resolved the
   *  same way the edge properties panel resolves them, so a default-only edge
   *  still shows a real number instead of receding. */
  defaults: EdgeDefaults
}

const FAILURE_CAUSE_LABELS: Record<EdgeFailureCause, string> = {
  connection_refused: 'saturation',
  deadline_exceeded: 'deadline',
  edge_error_rate: 'edge error',
  packet_loss: 'packet loss'
}

function fmtRps(rps: number): string {
  if (rps <= 0) return '0 rps'
  if (rps < 10) return `${rps.toFixed(1)} rps`
  return `${Math.round(rps)} rps`
}

function fmtPercent(ratio: number): string {
  const pct = Math.min(1, Math.max(0, ratio)) * 100
  if (pct > 0 && pct < 0.1) return '<0.1%'
  return `${pct.toFixed(1)}%`
}

function fmtMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)}ms` : `${Math.round(ms)}ms`
}

/**
 * Modeled typical transit for this hop, derived from the edge's latency config
 * (not measured). Median of the constant/log-normal distribution — the same
 * "median hop" the edge properties panel reports. Falls back to the inferred
 * default profile when the edge sets no explicit latency, so a default-only
 * edge still shows a real number.
 */
function modeledHopLatencyMs(config: EdgeSimulationData, defaults: EdgeDefaults): number {
  const type =
    config.latencyDistributionType ?? (config.latencyValue !== undefined ? 'constant' : undefined)
  if (type === 'constant' && config.latencyValue != null) {
    return config.latencyValue
  }
  // Median of a log-normal is e^mu (ms); mu comes from the edge or the default
  // path-type profile.
  const mu = config.latencyMu ?? defaults.latencyDistribution.mu
  return Math.exp(mu)
}

/** p50 over the retained sampled packet stream — same calc the Edge Results
 *  panel uses, so the label and the panel can never disagree. */
function edgeLatencyP50(flow: EdgeFlowState | undefined): number | null {
  if (!flow || flow.recent.length === 0) return null
  const latencies = flow.recent
    .filter((event) => event.status === 'success')
    .map((event) => event.latencyMs)
  if (latencies.length === 0) return null
  const sorted = [...latencies].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.5) - 1))
  return sorted[index] ?? null
}

/** Post-warmup failure ratio, falling back to the live windowed ratio. */
function postWarmupFailureRatio(flow: EdgeFlowState | undefined): number {
  if (!flow) return 0
  if (flow.totalPostWarmupAttempted > 0) {
    return flow.totalPostWarmupFailed / flow.totalPostWarmupAttempted
  }
  return flow.failureRatio
}

function edgeSeverity(flow: EdgeFlowState | undefined): EdgeSeverity {
  const level = failureRateLevelFromRatio(postWarmupFailureRatio(flow))
  return level === 'crit' ? 'crit' : level === 'warn' ? 'warn' : 'ok'
}

/**
 * In-flight ÷ max-concurrent via Little's Law (L = λ × W). Uses post-warmup
 * averages, so it is time-weighted rather than a point sample. Null when the
 * edge declares no concurrency cap or has no latency samples yet.
 */
function edgeUtilization(
  flow: EdgeFlowState | undefined,
  config: EdgeSimulationData,
  defaults: EdgeDefaults
): number | null {
  const cap = config.maxConcurrentRequests ?? defaults.maxConcurrentRequests
  if (!cap || cap <= 0 || !flow) return null
  const lambda = flow.avgPostWarmupSuccessPerSecond
  const w = edgeLatencyP50(flow)
  if (w == null) return null
  const inFlight = lambda * (w / 1000)
  return Math.min(inFlight / cap, 1)
}

/** The dominant failure cause as a labelled percentage, e.g. "packet loss 3%". */
function topFailureCause(flow: EdgeFlowState | undefined): string | undefined {
  if (!flow) return undefined
  const attempted =
    flow.totalPostWarmupAttempted > 0 ? flow.totalPostWarmupAttempted : flow.totalAttempted
  const counts =
    flow.totalPostWarmupAttempted > 0 ? flow.totalPostWarmupFailedByCause : flow.totalFailedByCause
  if (attempted <= 0) return undefined

  const top = Object.entries(counts)
    .filter((entry): entry is [EdgeFailureCause, number] => entry[1] > 0)
    .sort((a, b) => b[1] - a[1])[0]
  if (!top) return undefined

  const [cause, count] = top
  return `${FAILURE_CAUSE_LABELS[cause]} ${fmtPercent(count / attempted)}`
}

export function resolveEdgeLensProjection({
  lens,
  flow,
  config,
  defaults
}: EdgeLensInput): EdgeLensProjection {
  const severity = edgeSeverity(flow)
  const recede = (why: string): EdgeLensProjection => ({
    headline: '',
    severity,
    recedes: true,
    why
  })

  switch (lens) {
    // ── PRE-RUN: declared capacity, config value or its inferred default ──
    case 'concurrency': {
      const cap = config.maxConcurrentRequests ?? defaults.maxConcurrentRequests
      return {
        headline: `${cap} max`,
        severity,
        recedes: false,
        why: 'Link concurrency cap (max concurrent requests in transit)'
      }
    }

    case 'queueCapacity': {
      // Edges have no queue → node-first; surface pipe size as a quiet proxy.
      const bandwidth = config.bandwidth ?? defaults.bandwidth
      return {
        headline: `${bandwidth} Mbps`,
        severity,
        recedes: true,
        why: 'Edges have no queue; bandwidth shown as pipe capacity'
      }
    }

    case 'timeout': {
      // The edge cannot time out on its own — the deadline is enforced at the
      // node. Its honest contribution is the transit budget this hop consumes.
      const hopMs = modeledHopLatencyMs(config, defaults)
      const pathType = config.pathType ?? defaults.pathType
      return {
        headline: `~${fmtMs(hopMs)} hop`,
        sub: pathType ? EDGE_PATH_TYPE_HELP[pathType].title : undefined,
        severity,
        recedes: false,
        why: 'Modeled transit this hop adds to the deadline budget (enforced at the node)'
      }
    }

    // ── RUNTIME: measured behaviour, read from the post-warmup flow ────
    case 'traffic': {
      const rps = flow?.avgAttemptedPerSecond ?? 0
      return {
        headline: `${fmtRps(rps)} in`,
        severity,
        recedes: false,
        why: 'Offered request rate crossing this edge'
      }
    }

    case 'throughput': {
      const rps = flow?.avgPostWarmupSuccessPerSecond ?? 0
      const offered = flow?.avgAttemptedPerSecond ?? 0
      return {
        headline: fmtRps(rps),
        sub: offered > rps * 1.02 ? `offered ${fmtRps(offered)}` : undefined,
        severity,
        recedes: false,
        why: 'Successful requests delivered across this edge per second'
      }
    }

    case 'latency': {
      const p50 = edgeLatencyP50(flow)
      return {
        headline: p50 != null ? `${p50.toFixed(1)}ms` : '—',
        sub: p50 != null ? 'this hop only' : undefined,
        severity,
        recedes: false,
        why: 'Transit latency across this link (this hop only, not cumulative)'
      }
    }

    case 'saturation': {
      const util = edgeUtilization(flow, config, defaults)
      return util != null
        ? {
            headline: `${(util * 100).toFixed(0)}%`,
            severity,
            recedes: false,
            why: 'In-flight ÷ max concurrent (Little’s Law: λ × latency)'
          }
        : recede('No concurrency cap set on this edge')
    }

    case 'errors': {
      const ratio = postWarmupFailureRatio(flow)
      return {
        headline: `${fmtPercent(ratio)} fail`,
        sub: topFailureCause(flow),
        severity,
        recedes: false,
        why: 'Failures attributable to this hop'
      }
    }
  }
}
