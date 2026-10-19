import type { SimulationOutput } from '../../../../engine/analysis/output'
import type { ClassroomRunSummary } from '../../../../engine/classroom/runSummary'
import {
  formatCostPerHour,
  formatPercent,
  formatRps
} from '../../../../engine/classroom/givensTable'

export type RunVerdict = 'passed' | 'needs-work' | 'failed'

export interface RunSummaryStat {
  id: 'served' | 'dropped' | 'p95' | 'cost'
  label: string
  value: string
  /** Draw the value in the danger colour. */
  bad?: boolean
}

export interface RunSummary {
  verdict: RunVerdict
  stats: RunSummaryStat[]
  /** One sentence naming the component that limits the run, when there is one. */
  bottleneck: string | null
  /** The canvas node behind `bottleneck`, so the strip can select it. */
  bottleneckNodeId: string | null
}

/** Error rate at or above this reads as a failed run, not just one that needs work. */
const FAILED_ERROR_RATE = 0.05

function formatLatency(ms: number | null): string {
  if (ms === null) return 'N/A'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function verdictFor(errorRate: number, breaches: number, overTarget: boolean): RunVerdict {
  if (errorRate >= FAILED_ERROR_RATE) return 'failed'
  if (errorRate > 0 || breaches > 0 || overTarget) return 'needs-work'
  return 'passed'
}

interface Bottleneck {
  text: string
  nodeId: string | null
}

function classroomBottleneck(summary: ClassroomRunSummary): Bottleneck | null {
  const target = summary.targetUtilization
  const worst = [...summary.components].sort((a, b) => b.utilization - a.utilization)[0]
  if (!worst) return null
  const pct = formatPercent(worst.utilization)
  if (target !== undefined && worst.overTarget) {
    return {
      text: `Bottleneck: ${worst.label} at ${pct} (target ${formatPercent(target)} or less)`,
      nodeId: worst.nodeId
    }
  }
  return target === undefined
    ? null
    : { text: `Busiest: ${worst.label} at ${pct}`, nodeId: worst.nodeId }
}

function engineBottleneck(output: SimulationOutput): Bottleneck | null {
  const { failuresByLocus, latencyDecomposition } = output.summary
  const failure = failuresByLocus[0]
  if (failure) {
    const isNode = failure.locusKind === 'node'
    const label = isNode
      ? (output.perNode[failure.locus]?.nodeLabel ?? failure.locus)
      : (output.perEdge[failure.locus]?.edgeLabel ?? failure.locus)
    return { text: `Most failures end at ${label}`, nodeId: isNode ? failure.locus : null }
  }
  const latency = latencyDecomposition[0]
  if (latency && latency.kind !== 'unattributed') {
    const isEdge = latency.kind === 'edge'
    const label = isEdge
      ? (output.perEdge[latency.component]?.edgeLabel ?? latency.label)
      : (output.perNode[latency.component]?.nodeLabel ?? latency.label)
    return {
      text: `Slowest part of the path: ${label}`,
      nodeId: isEdge ? null : latency.component
    }
  }
  return null
}

/**
 * Collapse a finished run to a verdict, four numbers and one bottleneck sentence: what the
 * collapsed results strip shows before the learner opts into the full tray.
 */
export function summarizeRun(
  output: SimulationOutput,
  classroom: ClassroomRunSummary | null
): RunSummary {
  const { summary } = output
  const overTarget = classroom?.components.some((component) => component.overTarget) ?? false
  const droppedShare = classroom ? classroom.droppedShare : summary.errorRate
  const verdict = verdictFor(
    classroom ? classroom.droppedShare : summary.errorRate,
    output.sloBreaches.length,
    overTarget
  )

  const served = classroom ? classroom.servedRps : summary.throughput
  const stats: RunSummaryStat[] = [
    { id: 'served', label: 'Served', value: formatRps(served) },
    {
      id: 'dropped',
      label: classroom ? 'Dropped' : 'Errors',
      value: formatPercent(droppedShare),
      bad: droppedShare > 0
    },
    { id: 'p95', label: 'p95', value: formatLatency(summary.latency.p95) }
  ]
  if (classroom?.costPerHour !== undefined) {
    stats.push({ id: 'cost', label: 'Cost', value: formatCostPerHour(classroom.costPerHour) })
  }

  const bottleneck = classroom ? classroomBottleneck(classroom) : engineBottleneck(output)
  return {
    verdict,
    stats,
    bottleneck: bottleneck?.text ?? null,
    bottleneckNodeId: bottleneck?.nodeId ?? null
  }
}
