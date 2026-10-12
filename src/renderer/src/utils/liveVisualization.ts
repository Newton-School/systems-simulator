import type { TimeSeriesSnapshot } from '../../../engine/analysis/output'

/**
 * Live canvas styling derived from MEASURED run telemetry (issue #70).
 *
 * Honesty rules:
 * - Utilization and node throughput are time-weighted over a trailing window,
 *   computed by differencing the cumulative integrals the engine puts on every
 *   snapshot (`busyAreaUs / capacityAreaUs`, `completedTotal`). They are never a
 *   single snapshot's instantaneous value presented as an average.
 * - Queue fill is a level, shown as the current value ("now").
 * - Edge throughput is the windowed count rate the edge-flow store already
 *   measures; edge latency is the median of the recent measured hop latencies.
 * - Anything we cannot measure is null and simply not drawn.
 */

export const LIVE_UTILIZATION_COLORS = {
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#ef4444'
} as const

/** Trailing window for time-weighted node metrics (simulated ms). */
export const LIVE_WINDOW_MS = 5_000

export type LiveNodeStatusIcon = 'healthy' | 'degraded' | 'failed'

export interface NodeVisualStyle {
  /** Tinted fill for the live indicator, derived from `color`. */
  backgroundColor: string
  borderColor: string
  /** Utilization band colour (green / yellow / orange / red). */
  color: string
  /** Waiting-room fill 0-100 right now, or null when the queue is unbounded. */
  queueFillPercent: number | null
  statusIcon: LiveNodeStatusIcon
  /** e.g. "950 rps | 72% busy". Only measured values appear. */
  overlayText: string
  /** Time-weighted utilization over `windowMs`, 0-1, or null before any data. */
  utilization: number | null
  /** Completed requests per second over `windowMs`, or null before any data. */
  throughputRps: number | null
  /** Simulated span the windowed values cover. */
  windowMs: number
}

export interface EdgeVisualStyle {
  strokeWidth: number
  /** null when there is no latency expectation to compare against. */
  strokeColor: string | null
  animated: boolean
  /** Median recent hop latency, e.g. "1.2ms"; empty when unmeasured. */
  labelText: string
  throughputRps: number
  latencyP50Ms: number | null
}

export interface LiveVisualization {
  nodeStyles: Map<string, NodeVisualStyle>
  edgeStyles: Map<string, EdgeVisualStyle>
  /** Simulated time (ms) of the newest snapshot the styles reflect. */
  atMs: number
}

export interface LiveEdgeInput {
  /** Windowed attempts per second on this edge (edge-flow store). */
  throughputRps: number
  /** Recent measured hop latencies (ms). */
  recentLatenciesMs: number[]
  /** Configured mean hop latency (ms); <= 0 or undefined = no expectation. */
  expectedLatencyMs?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function utilizationColor(utilization: number | null, failed: boolean): string {
  if (failed) return LIVE_UTILIZATION_COLORS.red
  if (utilization === null) return LIVE_UTILIZATION_COLORS.green
  if (utilization > 0.95) return LIVE_UTILIZATION_COLORS.red
  if (utilization >= 0.85) return LIVE_UTILIZATION_COLORS.orange
  if (utilization >= 0.6) return LIVE_UTILIZATION_COLORS.yellow
  return LIVE_UTILIZATION_COLORS.green
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Green → red as `ratio` (observed ÷ expected latency) goes from 1 to 4. */
export function latencyRatioColor(ratio: number): string {
  const t = clamp((ratio - 1) / 3, 0, 1)
  const [r1, g1, b1] = hexToRgb(LIVE_UTILIZATION_COLORS.green)
  const [r2, g2, b2] = hexToRgb(LIVE_UTILIZATION_COLORS.red)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hex(mix(r1, r2))}${hex(mix(g1, g2))}${hex(mix(b1, b2))}`
}

function median(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return null
  const sorted = [...finite].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function formatRps(rps: number): string {
  if (rps >= 10_000) return `${Math.round(rps / 1000)}k`
  if (rps >= 1_000) return `${(rps / 1000).toFixed(1)}k`
  if (rps >= 10) return `${Math.round(rps)}`
  return rps.toFixed(1)
}

/**
 * Pick the window baseline: the oldest snapshot inside the trailing window
 * (other than the latest). With a single snapshot the baseline is t=0, where
 * every cumulative integral is zero by construction.
 */
function windowBaseline(
  snapshots: TimeSeriesSnapshot[],
  latest: TimeSeriesSnapshot,
  windowMs: number
): TimeSeriesSnapshot | null {
  for (let i = 0; i < snapshots.length - 1; i++) {
    const candidate = snapshots[i]
    if (
      candidate.timestamp >= latest.timestamp - windowMs &&
      candidate.timestamp < latest.timestamp
    ) {
      return candidate
    }
  }
  return null
}

export function computeLiveVisualization(
  snapshots: TimeSeriesSnapshot[],
  edges: Record<string, LiveEdgeInput> = {},
  windowMs = LIVE_WINDOW_MS,
  /** Traffic sources generate rather than serve; they get no node style. */
  sourceNodeIds: ReadonlySet<string> = new Set()
): LiveVisualization {
  const nodeStyles = new Map<string, NodeVisualStyle>()
  const edgeStyles = new Map<string, EdgeVisualStyle>()
  const latest = snapshots[snapshots.length - 1]
  if (!latest) {
    return { nodeStyles, edgeStyles, atMs: 0 }
  }

  const baseline = windowBaseline(snapshots, latest, windowMs)
  const baselineAtMs = baseline?.timestamp ?? 0
  const spanMs = latest.timestamp - baselineAtMs

  for (const [nodeId, now] of Object.entries(latest.node)) {
    if (sourceNodeIds.has(nodeId)) continue
    const before = baseline?.node[nodeId]
    let utilization: number | null = null
    let throughputRps: number | null = null
    if (spanMs > 0) {
      if (now.busyAreaUs !== undefined && now.capacityAreaUs !== undefined) {
        const busy = now.busyAreaUs - (before?.busyAreaUs ?? 0)
        const capacity = now.capacityAreaUs - (before?.capacityAreaUs ?? 0)
        utilization = capacity > 0 ? clamp(busy / capacity, 0, 1) : null
      }
      if (now.completedTotal !== undefined) {
        throughputRps = (now.completedTotal - (before?.completedTotal ?? 0)) / (spanMs / 1000)
      }
    }

    const failed = now.status === 'failed'
    const waitingRoom =
      now.capacity !== undefined && now.workers !== undefined ? now.capacity - now.workers : null
    const queueFillPercent =
      waitingRoom !== null && waitingRoom > 0
        ? clamp((now.queueLength / waitingRoom) * 100, 0, 100)
        : null
    const color = utilizationColor(utilization, failed)
    const statusIcon: LiveNodeStatusIcon = failed
      ? 'failed'
      : (utilization !== null && utilization >= 0.85) || now.status === 'saturated'
        ? 'degraded'
        : 'healthy'

    const parts: string[] = []
    if (failed) parts.push('failed')
    if (throughputRps !== null) parts.push(`${formatRps(throughputRps)} rps`)
    if (utilization !== null) parts.push(`${Math.round(utilization * 100)}% busy`)
    if (queueFillPercent !== null && now.queueLength > 0) {
      parts.push(`q ${now.queueLength}`)
    }

    nodeStyles.set(nodeId, {
      backgroundColor: `${color}1f`,
      borderColor: color,
      color,
      queueFillPercent,
      statusIcon,
      overlayText: parts.join(' | '),
      utilization,
      throughputRps,
      windowMs: spanMs
    })
  }

  const maxThroughput = Math.max(0, ...Object.values(edges).map((edge) => edge.throughputRps))
  for (const [edgeId, edge] of Object.entries(edges)) {
    const p50 = median(edge.recentLatenciesMs)
    const expected = edge.expectedLatencyMs
    const strokeColor =
      p50 !== null && expected !== undefined && expected > 0
        ? latencyRatioColor(p50 / expected)
        : null
    edgeStyles.set(edgeId, {
      strokeWidth: maxThroughput > 0 ? clamp((edge.throughputRps / maxThroughput) * 6, 1, 8) : 1,
      strokeColor,
      animated: edge.throughputRps > 0,
      labelText: p50 === null ? '' : `${p50 < 10 ? p50.toFixed(1) : Math.round(p50)}ms`,
      throughputRps: edge.throughputRps,
      latencyP50Ms: p50
    })
  }

  return { nodeStyles, edgeStyles, atMs: latest.timestamp }
}
