import type { TopologyJSON } from '../../engine/core/types'
import { topologyCost, formatCostPerHour, type TopologyCost } from '../../engine/analysis/cost'
import { costRunContextFromOutput } from '../../engine/analysis/designComparator'
import type { SimulationOutput } from '../../engine/analysis/output'
import { padStartVisible, truncate, type Palette } from '../../shared/ansi'

/** Hours in an average month (365 * 24 / 12), for the convenience monthly figure. */
export const HOURS_PER_MONTH = 730

export interface CostReport {
  topologyId: string
  topologyName: string
  /**
   * `pre-run`: traffic-dependent lines are estimates from the configured workload.
   * `post-run`: consumption and egress lines use the measured run.
   */
  basis: 'pre-run' | 'post-run'
  /** Present for post-run reports: how the run was evaluated, and its seed. */
  run?: { evaluationMode: 'discrete' | 'analytic'; seed: string; postWarmupDurationSec: number }
  totalPerHour: number
  totalPerMonth: number
  cost: TopologyCost
}

export function buildCostReport(topology: TopologyJSON, output?: SimulationOutput): CostReport {
  const cost = output
    ? topologyCost(topology, costRunContextFromOutput(output))
    : topologyCost(topology)
  return {
    topologyId: topology.id,
    topologyName: topology.name,
    basis: output ? 'post-run' : 'pre-run',
    ...(output
      ? {
          run: {
            evaluationMode: output.evaluationMode ?? 'discrete',
            seed: output.seed,
            postWarmupDurationSec: output.summary.postWarmupDurationSec
          }
        }
      : {}),
    totalPerHour: cost.totalPerHour,
    totalPerMonth: cost.totalPerHour * HOURS_PER_MONTH,
    cost
  }
}

export function formatCostReport(report: CostReport, c: Palette): string {
  const lines: string[] = []
  const basisNote =
    report.basis === 'post-run'
      ? `post-run, ${report.run?.evaluationMode} run, seed ${report.run?.seed}`
      : 'pre-run, traffic-dependent lines estimated from the configured workload'
  lines.push(
    `${c.bold}Cost${c.reset} ${c.dim}${report.topologyName} (${report.topologyId}) - ${basisNote}${c.reset}`
  )
  lines.push('')

  const items = report.cost.items
  const labelW = Math.min(32, Math.max(9, ...items.map((item) => item.label.length)))
  const kindW = Math.min(28, Math.max(4, ...items.map((item) => item.kind.length)))
  const header =
    `  ${'Component'.padEnd(labelW)}  ${'Kind'.padEnd(kindW)}  ${'Basis'.padEnd(11)}` +
    `  ${'$/hr'.padStart(10)}  Derivation`
  lines.push(`${c.bold}${header}${c.reset}`)
  lines.push(`  ${'-'.repeat(header.length - 2 + 12)}`)
  for (const item of items) {
    const amount = item.priced
      ? `${item.isEstimate ? '~' : ''}${item.costPerHour.toFixed(4)}`
      : `${c.dim}-${c.reset}`
    lines.push(
      `  ${truncate(item.label, labelW).padEnd(labelW)}` +
        `  ${truncate(item.kind, kindW).padEnd(kindW)}` +
        `  ${item.basis.padEnd(11)}` +
        `  ${padStartVisible(amount, 10)}` +
        `  ${item.priced ? item.formula : `${c.dim}${item.formula}${c.reset}`}`
    )
  }
  lines.push('')
  const approx = report.cost.hasEstimates ? '~' : ''
  lines.push(
    `${c.bold}Total${c.reset}  ${approx}${formatCostPerHour(report.totalPerHour)}` +
      `  ${c.dim}(${approx}$${report.totalPerMonth.toFixed(2)}/month at ${HOURS_PER_MONTH} h)${c.reset}`
  )
  if (report.cost.hasEstimates) {
    lines.push(
      `${c.dim}~ marks estimates at the configured load; pass --run for measured figures.${c.reset}`
    )
  }
  if (report.cost.hasUnpricedNodes) {
    lines.push(
      `${c.yellow}Some components have no instance type and are counted as $0 (unpriced).${c.reset}`
    )
  }
  return lines.join('\n')
}
