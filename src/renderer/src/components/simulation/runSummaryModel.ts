import type { SimulationOutput } from '../../../../engine/analysis/output'
import type { FaultSpec } from '../../../../engine/core/types'
import { readFault, type FailureMode } from './simulationControlModel'
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
  /** The unrounded number behind `value`, for comparing runs. Null when there is none. */
  raw: number | null
  /** Which direction is an improvement. */
  better: 'higher' | 'lower'
}

export interface RunSummary {
  verdict: RunVerdict
  stats: RunSummaryStat[]
  /** One sentence naming the component that limits the run, when there is one. */
  bottleneck: string | null
  /** The canvas node behind `bottleneck`, so the strip can select it. */
  bottleneckNodeId: string | null
  /** What each node with an injected failure did in this run, one sentence per node. */
  injectedFailureNotes: string[]
}

/** A node the run was given an injected failure on (Chaos > Inject failure). */
export interface InjectedFailure {
  nodeId: string
  label: string
  /** 0..1 */
  rate: number
}

/** What the run was given besides per-node settings: scheduled failures from the Workload panel. */
export interface RunFailureInputs {
  injected?: readonly InjectedFailure[]
  faults?: readonly FaultSpec[]
  /** Labels for fault targets (nodes or containers), by id. */
  labelFor?: (id: string) => string
  /** The chaos experiment's verdict, when the run was one. */
  experiment?: { name: string; passed: boolean; summary: string } | null
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

const MAX_INJECTED_NOTES = 3

const FAULT_VERB: Record<FailureMode, string> = {
  blackhole: 'stops responding',
  hang: 'freezes',
  reject: 'rejects requests',
  degraded: 'slows down'
}

/** One sentence per scheduled failure: when it hit, and how many requests it cost there. */
function describeScheduledFaults(
  output: SimulationOutput,
  faults: readonly FaultSpec[],
  labelFor?: (id: string) => string
): string[] {
  return faults.map((fault) => {
    const { targetId, atS, durationS, mode } = readFault(fault)
    const label = labelFor?.(targetId) ?? output.perNode[targetId]?.nodeLabel ?? targetId
    const node = output.perNode[targetId]
    const failed = node
      ? node.postWarmupRejected + node.postWarmupTimedOut + node.postWarmupConnectionReset
      : 0
    const span = durationS > 0 ? `from ${atS}s for ${durationS}s` : `from ${atS}s onward`
    const cost =
      failed > 0
        ? ` ${failed.toLocaleString()} requests failed there.`
        : ' No requests failed there.'
    return `Scheduled failure: ${label} ${FAULT_VERB[mode] ?? 'fails'} ${span}.${cost}`
  })
}

/**
 * Say what an injected failure did, because "Passed, 0% errors" is otherwise indistinguishable
 * from "the setting did nothing": a down node behind health-aware routing gets no traffic, so
 * the failure shows up as a node going idle, not as errors.
 */
function describeInjectedFailures(
  output: SimulationOutput,
  injected: readonly InjectedFailure[]
): string[] {
  const notes: string[] = []
  for (const failure of injected) {
    if (failure.rate <= 0) continue
    const node = output.perNode[failure.nodeId]
    if (!node) continue
    const arrived = node.postWarmupArrived
    const failed =
      node.postWarmupRejected + node.postWarmupTimedOut + node.postWarmupConnectionReset
    const percent = Math.round(failure.rate * 100)
    const state = failure.rate >= 1 ? 'down' : `failing ${percent}% of requests`
    if (arrived === 0) {
      notes.push(
        failure.rate >= 1
          ? `${failure.label} is down and got no traffic: its requests were routed elsewhere.`
          : `${failure.label} is ${state} but got no traffic in this run.`
      )
    } else if (failed > 0) {
      notes.push(
        `${failure.label} is ${state}: ${failed.toLocaleString()} of ${arrived.toLocaleString()} requests it received failed.`
      )
    } else {
      notes.push(
        `${failure.label} is ${state}, but none of the ${arrived.toLocaleString()} requests it received failed.`
      )
    }
  }
  if (notes.length <= MAX_INJECTED_NOTES) return notes
  return [...notes.slice(0, MAX_INJECTED_NOTES), `and ${notes.length - MAX_INJECTED_NOTES} more`]
}

/**
 * Collapse a finished run to a verdict, four numbers and one bottleneck sentence: what the
 * collapsed results strip shows before the learner opts into the full tray.
 */
export function summarizeRun(
  output: SimulationOutput,
  classroom: ClassroomRunSummary | null,
  failures: RunFailureInputs = {}
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
    { id: 'served', label: 'Served', value: formatRps(served), raw: served, better: 'higher' },
    {
      id: 'dropped',
      label: classroom ? 'Dropped' : 'Errors',
      value: formatPercent(droppedShare),
      bad: droppedShare > 0,
      raw: droppedShare,
      better: 'lower'
    },
    {
      id: 'p95',
      label: 'p95',
      value: formatLatency(summary.latency.p95),
      raw: summary.latency.p95,
      better: 'lower'
    }
  ]
  if (classroom?.costPerHour !== undefined) {
    stats.push({
      id: 'cost',
      label: 'Cost',
      value: formatCostPerHour(classroom.costPerHour),
      raw: classroom.costPerHour,
      better: 'lower'
    })
  }

  const bottleneck = classroom ? classroomBottleneck(classroom) : engineBottleneck(output)
  // A failed experiment is not a pass, even when the steady-state numbers look fine.
  const experimentFailed = failures.experiment ? !failures.experiment.passed : false
  return {
    verdict: experimentFailed && verdict === 'passed' ? 'needs-work' : verdict,
    stats,
    bottleneck: bottleneck?.text ?? null,
    bottleneckNodeId: bottleneck?.nodeId ?? null,
    injectedFailureNotes: [
      ...(failures.experiment
        ? [
            `Experiment "${failures.experiment.name}" ${failures.experiment.passed ? 'passed' : 'failed'}: ${failures.experiment.summary}`
          ]
        : []),
      ...describeInjectedFailures(output, failures.injected ?? []),
      ...describeScheduledFaults(output, failures.faults ?? [], failures.labelFor)
    ]
  }
}

export interface StatDelta {
  text: string
  tone: 'better' | 'worse'
}

/** Changes smaller than this share of the earlier value read as noise, not a result. */
const NOISE_SHARE = 0.01

function signed(value: number, format: (magnitude: number) => string): string {
  return `${value > 0 ? '+' : '-'}${format(Math.abs(value))}`
}

function formatDelta(id: RunSummaryStat['id'], diff: number): string {
  switch (id) {
    case 'served':
      return signed(diff, (n) => formatRps(n))
    case 'dropped':
      return signed(diff, (n) => `${Math.round(n * 1000) / 10} pts`)
    case 'p95':
      return signed(diff, (n) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`))
    case 'cost':
      return signed(diff, (n) => formatCostPerHour(n))
  }
}

/**
 * How a stat moved since the previous run, or null when it did not move enough to mean
 * anything (or either run has no number for it).
 */
export function statDelta(
  previous: RunSummaryStat | undefined,
  current: RunSummaryStat
): StatDelta | null {
  if (!previous || previous.raw === null || current.raw === null) return null
  const diff = current.raw - previous.raw
  const scale = Math.max(Math.abs(previous.raw), Math.abs(current.raw))
  if (diff === 0 || (scale > 0 && Math.abs(diff) / scale < NOISE_SHARE)) return null
  const improved = current.better === 'higher' ? diff > 0 : diff < 0
  return { text: formatDelta(current.id, diff), tone: improved ? 'better' : 'worse' }
}
