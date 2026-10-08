import { parse } from 'node:path'
import type { TopologyJSON } from '../../engine/core/types'
import {
  compareDesigns,
  type DesignComparison,
  type MetricComparison
} from '../../engine/analysis/designComparator'
import type { SimulationOutput } from '../../engine/analysis/output'
import { runSimulation, type EvaluationMode } from '../../engine/runSimulation'
import { padEndVisible, padStartVisible, truncate, type Palette } from '../ansi'

export interface CompareDesignInput {
  file: string
  topology: TopologyJSON
}

export interface CompareReport {
  /** Seed both designs ran with (the same seed keeps the comparison fair). */
  seed: string
  designs: Array<{
    side: 'A' | 'B'
    file: string
    name: string
    topologyId: string
    evaluationMode: 'discrete' | 'analytic'
  }>
  comparison: DesignComparison
}

export type DesignRunner = (topology: TopologyJSON) => SimulationOutput

export function defaultDesignRunner(mode: EvaluationMode = 'auto'): DesignRunner {
  return (topology) => runSimulation(topology, { mode })
}

/** Display names for the two designs: topology name, falling back to the file name. */
export function designNames(a: CompareDesignInput, b: CompareDesignInput): [string, string] {
  const nameOf = (d: CompareDesignInput) => d.topology.name?.trim() || parse(d.file).name
  const nameA = nameOf(a)
  const nameB = nameOf(b)
  if (nameA !== nameB) return [nameA, nameB]
  return [`${nameA} (A)`, `${nameB} (B)`]
}

/**
 * Run both designs with the same seed (`seed`, or design A's own seed) and diff
 * them with `compareDesigns`. Cost is included because both topologies are passed.
 */
export function runCompare(
  a: CompareDesignInput,
  b: CompareDesignInput,
  options: { seed?: string; runner?: DesignRunner } = {}
): CompareReport {
  const seed = options.seed ?? a.topology.global.seed
  const runner = options.runner ?? defaultDesignRunner()
  const withSeed = (t: TopologyJSON): TopologyJSON => ({ ...t, global: { ...t.global, seed } })
  const topologyA = withSeed(a.topology)
  const topologyB = withSeed(b.topology)
  const outputA = runner(topologyA)
  const outputB = runner(topologyB)
  const [nameA, nameB] = designNames(a, b)
  const comparison = compareDesigns(
    { name: nameA, output: outputA, topology: topologyA },
    { name: nameB, output: outputB, topology: topologyB }
  )
  return {
    seed,
    designs: [
      {
        side: 'A',
        file: a.file,
        name: nameA,
        topologyId: a.topology.id,
        evaluationMode: outputA.evaluationMode ?? 'discrete'
      },
      {
        side: 'B',
        file: b.file,
        name: nameB,
        topologyId: b.topology.id,
        evaluationMode: outputB.evaluationMode ?? 'discrete'
      }
    ],
    comparison
  }
}

export function formatMetricValue(m: Pick<MetricComparison, 'unit'>, value: number | null): string {
  if (value === null) return 'N/A'
  switch (m.unit) {
    case 'ms':
      if (value < 1) return `${(value * 1000).toFixed(0)}us`
      if (value < 1000) return `${value.toFixed(1)}ms`
      return `${(value / 1000).toFixed(2)}s`
    case 'req/s':
      return `${value.toFixed(1)}/s`
    case 'ratio':
      return `${(value * 100).toFixed(2)}%`
    case 'count':
      return Math.round(value).toLocaleString('en-US')
    case 'USD/hr':
      return `$${value.toFixed(4)}/hr`
  }
}

function formatPercentChange(value: number | null): string {
  if (value === null) return 'N/A'
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${value > 0 ? '+' : ''}${rounded}%`
}

export function formatCompareReport(report: CompareReport, c: Palette): string {
  const { comparison } = report
  const [a, b] = report.designs
  const lines: string[] = []
  lines.push(`${c.bold}Compare${c.reset} ${c.dim}seed ${report.seed}${c.reset}`)
  lines.push(`  A  ${a.name} ${c.dim}(${a.file}, ${a.evaluationMode})${c.reset}`)
  lines.push(`  B  ${b.name} ${c.dim}(${b.file}, ${b.evaluationMode})${c.reset}`)
  if (a.evaluationMode !== b.evaluationMode) {
    lines.push(
      `${c.yellow}  Designs ran under different evaluation modes; pass --mode to force one.${c.reset}`
    )
  }
  lines.push('')

  const header =
    `  ${'Metric'.padEnd(20)}  ${'Design A'.padStart(12)}  ${'Design B'.padStart(12)}` +
    `  ${'Delta'.padStart(8)}  Winner`
  lines.push(`${c.bold}${header}${c.reset}`)
  lines.push(`  ${'-'.repeat(header.length - 2)}`)
  for (const m of comparison.metrics) {
    const winner =
      m.winner === 'A' || m.winner === 'B'
        ? `${c.green}${m.winner}${c.reset}`
        : `${c.dim}${m.winner}${c.reset}`
    lines.push(
      `  ${m.label.padEnd(20)}` +
        `  ${formatMetricValue(m, m.designA).padStart(12)}` +
        `  ${formatMetricValue(m, m.designB).padStart(12)}` +
        `  ${formatPercentChange(m.percentChange).padStart(8)}` +
        `  ${winner}`
    )
  }

  const shared = Object.entries(comparison.perNode).filter(([, n]) => !n.onlyInA && !n.onlyInB)
  const onlyA = Object.entries(comparison.perNode).filter(([, n]) => n.onlyInA)
  const onlyB = Object.entries(comparison.perNode).filter(([, n]) => n.onlyInB)
  if (shared.length > 0) {
    lines.push('')
    lines.push(
      `${c.bold}Shared components${c.reset} ${c.dim}(utilization, time in system)${c.reset}`
    )
    const labelW = Math.min(28, Math.max(9, ...shared.map(([, n]) => n.label.length)))
    lines.push(
      `${c.bold}  ${'Component'.padEnd(labelW)}  ${'Util A'.padStart(7)}  ${'Util B'.padStart(7)}` +
        `  ${'Latency delta'.padStart(13)}${c.reset}`
    )
    for (const [, n] of shared) {
      const pct = (v: number | undefined) => (v === undefined ? 'N/A' : `${(v * 100).toFixed(1)}%`)
      const latency =
        n.latencyDelta === undefined
          ? 'N/A'
          : n.latencyDelta === 0
            ? '0'
            : `${n.latencyDelta > 0 ? '+' : n.latencyDelta < 0 ? '-' : ''}${formatMetricValue({ unit: 'ms' }, Math.abs(n.latencyDelta))}`
      lines.push(
        `  ${padEndVisible(truncate(n.label, labelW), labelW)}` +
          `  ${padStartVisible(pct(n.utilizationA), 7)}` +
          `  ${padStartVisible(pct(n.utilizationB), 7)}` +
          `  ${latency.padStart(13)}`
      )
    }
  }
  if (onlyA.length > 0) {
    lines.push(`${c.dim}  Only in A: ${onlyA.map(([, n]) => n.label).join(', ')}${c.reset}`)
  }
  if (onlyB.length > 0) {
    lines.push(`${c.dim}  Only in B: ${onlyB.map(([, n]) => n.label).join(', ')}${c.reset}`)
  }

  lines.push('')
  lines.push(comparison.summary)
  return lines.join('\n')
}
