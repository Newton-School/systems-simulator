/**
 * Design comparator: diff two simulation runs (e.g. "3 replicas vs 5 replicas",
 * "with cache vs without") on the headline metrics, plus per-node utilization
 * and latency for the components both designs share.
 *
 * Pure. Cost is included only when both designs pass their topology, and is
 * computed with `topologyCost` using each run's measured throughput/bytes, the
 * same way the header cost chip does post-run.
 *
 * Simulated metrics carry run-to-run noise, so a difference within
 * `TIE_TOLERANCE` (relative) is reported as a tie, never as a winner.
 */
import type { TopologyJSON } from '../core/types'
import { topologyCost, type CostRunContext } from './cost'
import type { SimulationOutput } from './output'

export type ComparisonMetricId =
  | 'latency.p50'
  | 'latency.p90'
  | 'latency.p95'
  | 'latency.p99'
  | 'throughput'
  | 'errorRate'
  | 'successfulRequests'
  | 'costPerHour'

export type ComparisonWinner = 'A' | 'B' | 'tie' | 'n/a'

export interface MetricComparison {
  metric: ComparisonMetricId
  label: string
  unit: 'ms' | 'req/s' | 'ratio' | 'count' | 'USD/hr'
  /** Which direction is better for this metric. */
  better: 'lower' | 'higher'
  /** `null` when the run produced no value (e.g. no successful requests for latency). */
  designA: number | null
  designB: number | null
  /** designB - designA, or `null` when either side is missing. */
  delta: number | null
  /** (delta / designA) * 100, or `null` when undefined (missing side, or A is 0 and B is not). */
  percentChange: number | null
  winner: ComparisonWinner
}

export interface NodeComparison {
  label: string
  onlyInA: boolean
  onlyInB: boolean
  utilizationA?: number
  utilizationB?: number
  /** B - A, utilization fraction (0..1). Only for nodes present in both. */
  utilizationDelta?: number
  /** B - A, mean time in system at the node (queue + service), ms. Only for nodes present in both. */
  latencyDelta?: number
}

export interface DesignComparison {
  designA: string
  designB: string
  metrics: MetricComparison[]
  perNode: Record<string, NodeComparison>
  /** One or two plain-English sentences on the most significant differences. */
  summary: string
}

export interface DesignInput {
  name: string
  output: SimulationOutput
  /** Optional: enables the cost comparison. */
  topology?: TopologyJSON
}

/** Relative difference at or below which two values are treated as equal (1%). */
export const TIE_TOLERANCE = 0.01

const METRICS: Array<{
  metric: ComparisonMetricId
  label: string
  unit: MetricComparison['unit']
  better: MetricComparison['better']
  read: (output: SimulationOutput) => number | null
}> = [
  {
    metric: 'latency.p50',
    label: 'P50 latency',
    unit: 'ms',
    better: 'lower',
    read: (o) => o.summary.latency.p50
  },
  {
    metric: 'latency.p90',
    label: 'P90 latency',
    unit: 'ms',
    better: 'lower',
    read: (o) => o.summary.latency.p90
  },
  {
    metric: 'latency.p95',
    label: 'P95 latency',
    unit: 'ms',
    better: 'lower',
    read: (o) => o.summary.latency.p95
  },
  {
    metric: 'latency.p99',
    label: 'P99 latency',
    unit: 'ms',
    better: 'lower',
    read: (o) => o.summary.latency.p99
  },
  {
    metric: 'throughput',
    label: 'Throughput',
    unit: 'req/s',
    better: 'higher',
    read: (o) => o.summary.throughput
  },
  {
    metric: 'errorRate',
    label: 'Error rate',
    unit: 'ratio',
    better: 'lower',
    read: (o) => o.summary.errorRate
  },
  {
    metric: 'successfulRequests',
    label: 'Successful requests',
    unit: 'count',
    better: 'higher',
    read: (o) => o.summary.successfulRequests
  }
]

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Measured run data for exact post-run cost (mirrors the header cost chip). */
export function costRunContextFromOutput(output: SimulationOutput): CostRunContext {
  return {
    nodeThroughput: Object.fromEntries(
      Object.entries(output.perNode).map(([id, m]) => [id, m.throughput])
    ),
    edgeBytes: Object.fromEntries(
      Object.entries(output.perEdge).map(([id, m]) => [id, m.bytesTransferred])
    ),
    durationSec: output.summary.postWarmupDurationSec
  }
}

export function compareMetric(
  spec: Pick<MetricComparison, 'metric' | 'label' | 'unit' | 'better'>,
  rawA: number | null | undefined,
  rawB: number | null | undefined
): MetricComparison {
  const designA = finiteOrNull(rawA)
  const designB = finiteOrNull(rawB)
  if (designA === null || designB === null) {
    return { ...spec, designA, designB, delta: null, percentChange: null, winner: 'n/a' }
  }
  const delta = designB - designA
  const percentChange = designA !== 0 ? (delta / Math.abs(designA)) * 100 : delta === 0 ? 0 : null
  const scale = Math.max(Math.abs(designA), Math.abs(designB))
  const isTie = scale === 0 || Math.abs(delta) / scale <= TIE_TOLERANCE
  const bBetter = spec.better === 'lower' ? delta < 0 : delta > 0
  return {
    ...spec,
    designA,
    designB,
    delta,
    percentChange,
    winner: isTie ? 'tie' : bBetter ? 'B' : 'A'
  }
}

function describe(m: MetricComparison, a: string, b: string): string | null {
  if (m.winner !== 'A' && m.winner !== 'B') return null
  const winnerName = m.winner === 'A' ? a : b
  const winVal = m.winner === 'A' ? m.designA! : m.designB!
  const loseVal = m.winner === 'A' ? m.designB! : m.designA!
  const name = m.label.charAt(0).toLowerCase() + m.label.slice(1)
  if (m.unit === 'ratio') {
    return `${winnerName} has a lower ${name} (${(winVal * 100).toFixed(1)}% vs ${(loseVal * 100).toFixed(1)}%)`
  }
  const relative = loseVal !== 0 ? Math.abs((winVal - loseVal) / loseVal) * 100 : null
  const direction =
    m.metric === 'costPerHour'
      ? 'is cheaper'
      : m.better === 'lower'
        ? `has lower ${name}`
        : `has higher ${name}`
  return relative !== null
    ? `${winnerName} ${direction} by ${relative.toFixed(0)}%`
    : `${winnerName} ${direction}`
}

function buildSummary(metrics: MetricComparison[], a: string, b: string): string {
  const decided = metrics.filter((m) => m.winner === 'A' || m.winner === 'B')
  if (decided.length === 0) {
    return `${a} and ${b} perform the same on every compared metric (within ${TIE_TOLERANCE * 100}%).`
  }
  // Most significant first: error-rate differences matter most, then the
  // largest relative swing.
  const weight = (m: MetricComparison): number => {
    if (m.metric === 'errorRate') return Number.POSITIVE_INFINITY
    const base = Math.min(Math.abs(m.designA!), Math.abs(m.designB!))
    const swing = Math.abs(m.delta!)
    return base > 0 ? swing / base : swing > 0 ? Number.MAX_VALUE : 0
  }
  const ranked = [...decided].sort((x, y) => weight(y) - weight(x))
  const lead = ranked[0]
  // Pair the lead with the most significant metric the *other* design wins, so
  // the summary names the trade-off when there is one.
  const counter = ranked.find((m) => m.winner !== lead.winner)
  const second = counter ?? ranked[1]
  const parts = [describe(lead, a, b), second ? describe(second, a, b) : null].filter(
    (part): part is string => part !== null
  )
  const joiner = counter ? ', but ' : ', and '
  const sentence = parts.join(joiner)
  const wins = { A: 0, B: 0 }
  for (const m of decided) wins[m.winner as 'A' | 'B'] += 1
  const tally =
    wins.A === 0 || wins.B === 0
      ? ` ${wins.A === 0 ? b : a} is better or equal on every compared metric.`
      : ` ${a} wins ${wins.A} metric${wins.A === 1 ? '' : 's'}, ${b} wins ${wins.B}.`
  return `${sentence}.${tally}`
}

/**
 * Compare two designs' simulation outputs. `delta` and `percentChange` are
 * always B relative to A.
 */
export function compareDesigns(designA: DesignInput, designB: DesignInput): DesignComparison {
  const metrics = METRICS.map((spec) =>
    compareMetric(spec, spec.read(designA.output), spec.read(designB.output))
  )

  if (designA.topology && designB.topology) {
    const costA = topologyCost(designA.topology, costRunContextFromOutput(designA.output))
    const costB = topologyCost(designB.topology, costRunContextFromOutput(designB.output))
    metrics.push(
      compareMetric(
        { metric: 'costPerHour', label: 'Cost', unit: 'USD/hr', better: 'lower' },
        costA.totalPerHour,
        costB.totalPerHour
      )
    )
  }

  const perNode: Record<string, NodeComparison> = {}
  const ids = new Set([
    ...Object.keys(designA.output.perNode),
    ...Object.keys(designB.output.perNode)
  ])
  for (const id of [...ids].sort()) {
    const a = designA.output.perNode[id]
    const b = designB.output.perNode[id]
    const label = a?.nodeLabel ?? b?.nodeLabel ?? id
    if (a && b) {
      const utilA = finiteOrNull(a.utilization)
      const utilB = finiteOrNull(b.utilization)
      const latA = finiteOrNull(a.postWarmupAvgTimeInSystem)
      const latB = finiteOrNull(b.postWarmupAvgTimeInSystem)
      perNode[id] = {
        label,
        onlyInA: false,
        onlyInB: false,
        ...(utilA !== null ? { utilizationA: utilA } : {}),
        ...(utilB !== null ? { utilizationB: utilB } : {}),
        ...(utilA !== null && utilB !== null ? { utilizationDelta: utilB - utilA } : {}),
        ...(latA !== null && latB !== null ? { latencyDelta: latB - latA } : {})
      }
    } else {
      perNode[id] = { label, onlyInA: Boolean(a), onlyInB: Boolean(b) }
    }
  }

  return {
    designA: designA.name,
    designB: designB.name,
    metrics,
    perNode,
    summary: buildSummary(metrics, designA.name, designB.name)
  }
}
