import { distributionMean } from '../../../engine/analysis/fluidModel'
import type { SimulationOutput } from '../../../engine/analysis/output'
import { projectToDebugEvent, type RequestOutcomeRecord } from '../../../engine/core/event-stream'
import { getInstanceCount, type ComponentNode, type TopologyJSON } from '../../../engine/core/types'
import { INSTANCE_CATALOG } from '../../../engine/catalog/instanceCatalog'
import { getResourceDefaults } from '../../../engine/catalog/resourceDefaults'
import {
  deriveNodeConcurrency,
  hasInstanceModel,
  serviceTimeMultiplier,
  workersPerVcpu
} from '../../../engine/nodes/resourceDerivation'
import {
  buildCascadeTrees,
  cascadeEffectLabel
} from '../../../renderer/src/components/simulation/failureCascade'
import {
  nodeName,
  postWarmupSeconds,
  requireNode,
  requireResults,
  requireTopology,
  resolveNodeId,
  simState
} from '../data'
import {
  errorRate,
  fmtCount,
  fmtMs,
  fmtPct,
  fmtRps,
  heading,
  keyValues,
  note,
  table,
  utilization
} from '../format'
import { BOTTLENECK_THRESHOLD } from './runtime'
import { CommandError, type CommandDefinition, type CommandScope } from '../types'

const MODES = ['runtime', 'sim'] as const

function scopeTopology(scope: CommandScope): TopologyJSON {
  return simState(scope)?.runTopology ?? requireTopology(scope)
}

/** Mean service time (ms) including the instance performance factor; NaN if undefined. */
function meanServiceMs(node: ComponentNode): number {
  return distributionMean(node.processing?.distribution) * serviceTimeMultiplier(node)
}

/** c / mean service time, in req/s: the most this node can complete. */
function serviceCapacityRps(node: ComponentNode): number {
  const mean = meanServiceMs(node)
  if (!Number.isFinite(mean) || mean <= 0) return NaN
  return (deriveNodeConcurrency(node).effectiveC * 1000) / mean
}

function diagnoseNode(scope: CommandScope, token: string | undefined): string[] {
  const c = scope.deps.palette
  const results = requireResults(scope, 'diagnose')
  const topology = scopeTopology(scope)
  const node = requireNode(topology, resolveNodeId(topology, token))
  const metrics = results.perNode[node.id]
  if (!metrics) throw new CommandError(`${node.id} has no metrics in the last run.`)
  const seconds = postWarmupSeconds(results)
  const derived = deriveNodeConcurrency(node)
  const offered = metrics.postWarmupArrived / seconds
  const capacity = serviceCapacityRps(node)
  const findings: string[] = []
  const causes: string[] = []

  // 1. Saturation
  if (metrics.utilization >= BOTTLENECK_THRESHOLD) {
    findings.push(
      `${c.red}saturated${c.reset}: utilization ${utilization(metrics.utilization, c)} (>= ${fmtPct(BOTTLENECK_THRESHOLD, 0)})`
    )
    causes.push(
      `not enough capacity: add instances or a larger instance type (c is ${fmtCount(derived.effectiveC)})`
    )
  } else {
    findings.push(`utilization ${utilization(metrics.utilization, c)} - not saturated`)
  }

  // 2. Offered load vs service capacity
  if (Number.isFinite(capacity)) {
    const rho = offered / capacity
    findings.push(
      `offered ${fmtRps(offered)} vs service capacity ~${fmtRps(capacity)} (c ${fmtCount(derived.effectiveC)} / mean service ${fmtMs(meanServiceMs(node))}) - load ${fmtPct(rho)}`
    )
    if (rho >= 1) causes.push('arrivals exceed what the workers can serve: the queue only grows')
  }

  // 3. Queue
  const waitingRoom = Math.max(0, derived.effectiveK - derived.effectiveC)
  findings.push(
    `queue avg ${metrics.avgQueueLength.toFixed(1)}, peak ${fmtCount(metrics.peakQueueLength)} of ${fmtCount(waitingRoom)} waiting slots, avg wait ${fmtMs(metrics.avgQueueWait)}`
  )
  if (waitingRoom > 0 && metrics.peakQueueLength >= waitingRoom) {
    causes.push('the queue filled to K at least once, so arrivals were turned away')
  }

  // 4. Failures by reason
  findings.push(
    `error rate ${errorRate(metrics.errorRate, c)}: ${fmtCount(metrics.totalRejected)} rejected, ${fmtCount(metrics.totalTimedOut)} timed out`
  )
  const reasons = Object.entries(metrics.rejectionsByReason).sort((a, b) => b[1] - a[1])
  if (reasons.length > 0) {
    findings.push(
      `rejections by reason: ${reasons.map(([reason, count]) => `${reason} ${fmtCount(count)}`).join(', ')}`
    )
    const [topReason] = reasons[0]
    if (topReason === 'node_failed') causes.push('the node was down (injected fault)')
    else if (topReason.includes('rate'))
      causes.push('a rate limiter on this node rejected the excess')
    else if (topReason.includes('circuit')) causes.push('a circuit breaker opened')
    else if (topReason.includes('bulkhead')) causes.push('a bulkhead compartment hit its cap')
  }
  if (metrics.totalTimedOut > 0 && node.processing?.timeout !== undefined) {
    causes.push(
      `requests waited past the ${fmtMs(node.processing.timeout)} timeout (queue wait + service)`
    )
  }

  // 5. Upstream pressure and downstream blame
  const upstream = topology.edges.filter((edge) => edge.target === node.id)
  if (upstream.length > 0) {
    findings.push(
      `upstream: ${upstream
        .map((edge) => {
          const transits = results.perEdge[edge.id]?.totalSuccessfulTransits ?? 0
          return `${edge.source} ${fmtRps(transits / seconds)}${edge.fanoutFactor ? ` (fan-out x${edge.fanoutFactor})` : ''}`
        })
        .join(', ')}`
    )
  }
  const downstream = topology.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => edge.target)
  const downstreamFailures = results.summary.failuresByLocus.filter((entry) =>
    downstream.includes(entry.locus)
  )
  if (downstreamFailures.length > 0) {
    findings.push(
      `downstream failures: ${downstreamFailures.map((entry) => `${entry.locus} ${fmtCount(entry.total)}`).join(', ')}`
    )
  }
  const affected = results.causalGraph?.nodes?.find((entry) => entry.nodeId === node.id)
  if (affected) {
    findings.push(
      `failure cascade: ${affected.severity} from ${fmtMs(affected.firstAffectedMs)}${affected.faultMode ? ` (${affected.faultMode})` : ''}`
    )
    if (affected.severity === 'degraded' && !affected.faultMode)
      causes.push("it was hit by a cascade from a failing dependency ('show cascade')")
  }
  const breaches = results.sloBreaches.filter((breach) => breach.nodeId === node.id)
  for (const breach of breaches) {
    findings.push(
      `${c.red}SLO breach${c.reset}: ${breach.metric} ${breach.actual} vs target ${breach.target}`
    )
  }

  const lines = [
    heading(`Diagnosis ${nodeName(topology, node.id)}`, c, `last run, seed ${results.seed}`)
  ]
  lines.push(...findings.map((line) => `  - ${line}`))
  lines.push(
    causes.length > 0
      ? `${c.bold}Likely cause${causes.length > 1 ? 's' : ''}:${c.reset} ${causes.join('; ')}.`
      : `${c.green}Healthy:${c.reset} no saturation, queue overflow or failures here.`
  )
  return lines
}

const CAPACITY_REASONS = new Set(['capacity_exceeded', 'queue_full', 'oom'])

/**
 * The exact admission event was not retained (the event stream keeps a prefix
 * of the run), so show the node state from the nearest per-second snapshot
 * instead, labelled as approximate.
 */
/**
 * The exact admission record the tracer kept for a sampled request, used when the
 * event stream was cut off before the rejection. Null when the request wasn't
 * traced or has no rejecting admission (e.g. it timed out).
 */
function tracedAdmission(
  scope: CommandScope,
  topology: TopologyJSON,
  results: SimulationOutput,
  requestId: string
): string[] | null {
  const c = scope.deps.palette
  const trace = results.traces?.find((candidate) => candidate.requestId === requestId)
  const record = trace?.admissions?.find((candidate) => candidate.outcome === 'rejected')
  if (!record) return null
  const state = record.state
  const reason = record.reasonCode ?? trace?.terminalReason ?? 'unknown'
  const decidedBy =
    record.stage === 'security'
      ? 'the security policy'
      : record.stage === 'trait'
        ? `the ${record.traitName ?? 'admission'} trait`
        : 'the G/G/c/K admission check'
  const lines = [
    heading(
      `Why ${requestId} was rejected`,
      c,
      `at ${nodeName(topology, record.nodeId)}, t=${(Number(record.atUs) / 1000).toFixed(3)}ms (traced)`
    ),
    `  reason ${c.red}${reason}${c.reset}, decided by ${decidedBy}`
  ]
  if (state) {
    lines.push(
      `  ${c.bold}Admission check${c.reset} (node state when the request arrived)`,
      ...keyValues(
        [
          ['status', state.status],
          ['active workers', `${fmtCount(state.activeWorkers)} / ${fmtCount(state.workers)} (c)`],
          ['waiting', fmtCount(state.queueLength)],
          ['held', fmtCount(state.heldCount)],
          ['in system', `${fmtCount(state.totalInSystem)} / ${fmtCount(state.capacity)} (K)`]
        ],
        c,
        '    '
      )
    )
    if (record.stage === 'node' && CAPACITY_REASONS.has(reason)) {
      const full = state.totalInSystem >= state.capacity
      lines.push(
        `  rule: admit while in system < K  ->  ${fmtCount(state.totalInSystem)} ${full ? '>=' : '<'} ${fmtCount(state.capacity)}  ->  ${full ? `${c.red}reject${c.reset}` : 'admit'}`
      )
    }
  } else {
    lines.push(note('  This node has no queue, so no occupancy was recorded.', c))
  }
  if (record.concurrencyProvenance) {
    lines.push(note(`  ${record.concurrencyProvenance}`, c))
  }
  return lines
}

function approximateAdmission(
  scope: CommandScope,
  topology: TopologyJSON,
  results: SimulationOutput,
  outcome: RequestOutcomeRecord
): string[] {
  const c = scope.deps.palette
  const nodeId = outcome.nodeId ?? 'unknown'
  const atMs = outcome.terminalAtMs ?? outcome.createdAtMs
  const before = results.timeSeries.filter((snapshot) => snapshot.timestamp <= atMs)
  const snapshot = before[before.length - 1] ?? results.timeSeries[0]
  const state = snapshot?.node[nodeId]
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  const derived = node ? deriveNodeConcurrency(node) : null
  const lines = [
    heading(
      `Why ${outcome.requestId} was rejected`,
      c,
      `at ${nodeName(topology, nodeId)}, t=${atMs.toFixed(1)}ms`
    ),
    `  reason ${c.red}${outcome.reasonCode ?? 'unknown'}${c.reset}`
  ]
  if (state && snapshot) {
    const capacityK = state.capacity ?? derived?.effectiveK
    lines.push(
      `  ${c.bold}Node state${c.reset} ${note(`from the nearest snapshot (t=${(snapshot.timestamp / 1000).toFixed(1)}s, ${fmtMs(atMs - snapshot.timestamp)} earlier) - approximate; the exact admission event was not retained`, c)}`,
      ...keyValues(
        [
          ['status', state.status],
          [
            'active workers',
            `${fmtCount(state.activeWorkers)} / ${fmtCount(state.workers ?? derived?.effectiveC)} (c)`
          ],
          ['waiting', fmtCount(state.queueLength)],
          ['in system', `${fmtCount(state.totalInSystem)} / ${fmtCount(capacityK)} (K)`]
        ],
        c,
        '    '
      )
    )
    if (CAPACITY_REASONS.has(outcome.reasonCode ?? '')) {
      lines.push(
        `  rule: admit while in system < K (${fmtCount(capacityK)}); this arrival found the node full.`
      )
    }
  }
  lines.push(note(`  attempts ${outcome.attempts}, request type ${outcome.requestType ?? '-'}`, c))
  return lines
}

function whyRejected(scope: CommandScope, requestId: string | undefined): string[] {
  const c = scope.deps.palette
  const results = requireResults(scope, 'why-rejected')
  const topology = scopeTopology(scope)
  const rejectedEvents = results.eventStream.filter((record) => record.type === 'request-rejected')
  const record = requestId
    ? rejectedEvents.find((candidate) => candidate.requestId === requestId)
    : rejectedEvents[rejectedEvents.length - 1]
  const outcome = requestId
    ? results.requestOutcomes.find((candidate) => candidate.requestId === requestId)
    : [...results.requestOutcomes].reverse().find((candidate) => candidate.status === 'rejected')
  if (!record) {
    if (outcome && outcome.status !== 'rejected') {
      return [
        `${requestId} was not rejected: it ended as ${outcome.status}${outcome.reasonCode ? ` (${outcome.reasonCode})` : ''}.`
      ]
    }
    if (outcome) {
      return (
        tracedAdmission(scope, topology, results, outcome.requestId) ??
        approximateAdmission(scope, topology, results, outcome)
      )
    }
    throw new CommandError(
      requestId
        ? `No rejection recorded for ${requestId}. 'show rejected' lists rejected requests.`
        : `${c.green}No rejections${c.reset} in the last run.`
    )
  }
  const event = projectToDebugEvent(record)
  const nodeId = record.nodeId ?? 'unknown'
  const reason = record.reasonCode ?? 'unknown'
  const snapshot = record.nodeSnapshot
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  const derived = node ? deriveNodeConcurrency(node) : null
  const workers = snapshot?.workers ?? derived?.effectiveC
  const capacityK = snapshot?.capacity ?? derived?.effectiveK
  const lines = [
    heading(
      `Why ${record.requestId} was rejected`,
      c,
      `at ${nodeName(topology, nodeId)}, t=${event.timestampMs.toFixed(3)}ms`
    ),
    `  reason ${c.red}${reason}${c.reset}`
  ]
  if (snapshot) {
    lines.push(
      `  ${c.bold}Admission check${c.reset} (node state when the request arrived)`,
      ...keyValues(
        [
          ['status', snapshot.status],
          ['active workers', `${fmtCount(snapshot.activeWorkers)} / ${fmtCount(workers)} (c)`],
          ['waiting', fmtCount(snapshot.queueLength)],
          ['in system', `${fmtCount(snapshot.totalInSystem)} / ${fmtCount(capacityK)} (K)`]
        ],
        c,
        '    '
      )
    )
    const inSystem = snapshot.totalInSystem ?? snapshot.activeWorkers + snapshot.queueLength
    if (CAPACITY_REASONS.has(reason) && capacityK !== undefined) {
      const full = inSystem >= capacityK
      lines.push(
        `  rule: admit while in system < K  ->  ${fmtCount(inSystem)} ${full ? '>=' : '<'} ${fmtCount(capacityK)}  ->  ${full ? `${c.red}reject${c.reset}` : 'admit'}`
      )
      if (!full) {
        lines.push(
          note(
            '  The K check passed; the capacity limit that fired is memory or a trait-level cap.',
            c
          )
        )
      }
    } else if (reason === 'node_failed') {
      lines.push('  rule: a failed node admits nothing (injected fault active).')
    } else {
      lines.push(
        `  The queue had room (${fmtCount(inSystem)} of ${fmtCount(capacityK)}); '${reason}' comes from a trait or policy on this node, not the G/G/c/K admission check.`
      )
    }
  } else {
    lines.push(note('  No node snapshot was recorded with this rejection.', c))
  }
  if (outcome)
    lines.push(
      note(`  attempts ${outcome.attempts}, request type ${outcome.requestType ?? '-'}`, c)
    )
  return lines
}

function compareNodes(scope: CommandScope, a: string | undefined, b: string | undefined): string[] {
  const c = scope.deps.palette
  const results = requireResults(scope, 'compare')
  const topology = scopeTopology(scope)
  if (!a || !b) throw new CommandError('Usage: compare <nodeA> <nodeB>')
  const left = resolveNodeId(topology, a)
  const right = resolveNodeId(topology, b)
  const ma = results.perNode[left]
  const mb = results.perNode[right]
  if (!ma || !mb) throw new CommandError('Both nodes need metrics from the last run.')
  const na = requireNode(topology, left)
  const nb = requireNode(topology, right)
  const da = deriveNodeConcurrency(na)
  const db = deriveNodeConcurrency(nb)
  const rows: string[][] = [
    ['type', na.type, nb.type],
    [
      'c / K',
      `${fmtCount(da.effectiveC)} / ${fmtCount(da.effectiveK)}`,
      `${fmtCount(db.effectiveC)} / ${fmtCount(db.effectiveK)}`
    ],
    ['throughput', fmtRps(ma.throughput), fmtRps(mb.throughput)],
    ['utilization', utilization(ma.utilization, c), utilization(mb.utilization, c)],
    ['error rate', errorRate(ma.errorRate, c), errorRate(mb.errorRate, c)],
    ['p50 (node)', fmtMs(ma.latencyNodeLocal.p50), fmtMs(mb.latencyNodeLocal.p50)],
    ['p99 (node)', fmtMs(ma.latencyNodeLocal.p99), fmtMs(mb.latencyNodeLocal.p99)],
    ['avg queue wait', fmtMs(ma.avgQueueWait), fmtMs(mb.avgQueueWait)],
    ['peak waiting', fmtCount(ma.peakQueueLength), fmtCount(mb.peakQueueLength)],
    ['rejected', fmtCount(ma.totalRejected), fmtCount(mb.totalRejected)],
    ['timed out', fmtCount(ma.totalTimedOut), fmtCount(mb.totalTimedOut)]
  ]
  return [
    heading(`Compare ${left} vs ${right}`, c, 'last run'),
    ...table(['METRIC', left, right], rows, c, { align: ['left', 'right', 'right'] })
  ]
}

function explainCapacity(scope: CommandScope, token: string | undefined): string[] {
  const c = scope.deps.palette
  const topology = scopeTopology(scope)
  const node = requireNode(topology, resolveNodeId(topology, token))
  const derived = deriveNodeConcurrency(node)
  const lines = [heading(`Capacity of ${nodeName(topology, node.id)}`, c, 'G/G/c/K')]
  if (hasInstanceModel(node.resources)) {
    const defaults = getResourceDefaults(node.type)
    const instanceType = node.resources?.instanceType ?? defaults.instanceType
    const spec = INSTANCE_CATALOG[instanceType]
    const kind = node.resources?.workloadKind ?? defaults.workloadKind
    const count = getInstanceCount(node.resources)
    const perRequestMb = node.resources?.perRequestMemMb ?? defaults.perRequestMemMb
    lines.push(
      `  c (workers): ${count} x ${instanceType} = ${spec.vcpu * count} vCPU; ${kind} work runs ${workersPerVcpu(kind)} worker${workersPerVcpu(kind) === 1 ? '' : 's'} per vCPU -> c = ${fmtCount(derived.effectiveC)}`,
      `  K (capacity): ${spec.ramGb * count} GB RAM / ${perRequestMb.toFixed(1)} MB per request = ${fmtCount(Math.floor((spec.ramGb * 1024 * count) / perRequestMb))}, never below c -> K = ${fmtCount(derived.effectiveK)}`
    )
  } else {
    lines.push(
      `  c (workers) = ${fmtCount(derived.effectiveC)}, K (capacity) = ${fmtCount(derived.effectiveK)}: set directly (no instance model on this node).`
    )
  }
  lines.push(
    `  ${Math.max(0, derived.effectiveK - derived.effectiveC)} requests can wait (${node.queue?.discipline ?? 'fifo'}); arrivals beyond K are rejected (capacity_exceeded).`
  )
  const mean = meanServiceMs(node)
  const capacity = serviceCapacityRps(node)
  if (Number.isFinite(capacity)) {
    lines.push(
      `  service time ~${fmtMs(mean)} mean, so at most c / service = ~${fmtRps(capacity)} complete per second.`
    )
  }
  const results = simState(scope)?.results
  const metrics = results?.perNode[node.id]
  if (results && metrics) {
    const offered = metrics.postWarmupArrived / postWarmupSeconds(results)
    lines.push(
      `  last run: ${fmtRps(offered)} offered, utilization ${utilization(metrics.utilization, c)}` +
        (Number.isFinite(capacity) ? ` (offered / capacity = ${fmtPct(offered / capacity)})` : '') +
        '.'
    )
    if (metrics.utilization >= BOTTLENECK_THRESHOLD) {
      lines.push(
        `  ${c.yellow}Above ${fmtPct(BOTTLENECK_THRESHOLD, 0)} the queue, and so latency, grows quickly with any more load.${c.reset}`
      )
    }
  }
  return lines
}

function showCascade(scope: CommandScope, fromToken: string | undefined): string[] {
  const c = scope.deps.palette
  const results = requireResults(scope, 'show cascade')
  const topology = scopeTopology(scope)
  const graph = results.causalGraph
  if (!graph || graph.rootCauses.length === 0) {
    return [
      `${c.green}No failure cascade${c.reset} in the last run (no injected fault spread to other nodes).`
    ]
  }
  let trees = buildCascadeTrees(graph)
  if (fromToken) {
    const from = resolveNodeId(topology, fromToken)
    trees = trees.filter((tree) => tree.rows.some((row) => row.nodeId === from))
    if (trees.length === 0) throw new CommandError(`${from} is not part of a failure cascade.`)
  }
  const lines = [
    heading(
      'Failure cascade',
      c,
      `${graph.impactSummary.totalNodesAffected} nodes affected, depth ${graph.impactSummary.cascadeDepth}`
    )
  ]
  for (const tree of trees) {
    for (const row of tree.rows) {
      const indent = '  '.repeat(row.depth + 1)
      const branch = row.depth === 0 ? '' : '└─ '
      const color = row.severity === 'failed' ? c.red : c.yellow
      const detail = row.detail
        ? note(
            ` (${fmtCount(row.detail.rejected)} rejected, ${fmtCount(row.detail.timedOut)} timed out)`,
            c
          )
        : ''
      lines.push(
        `${indent}${branch}${color}${row.nodeId}${c.reset} ${fmtMs(row.timeMs)} ${cascadeEffectLabel(row.effect)}${detail}`
      )
    }
  }
  return lines
}

export const DIAGNOSE_COMMANDS: CommandDefinition[] = [
  {
    name: 'diagnose',
    modes: MODES,
    summary: 'Analyse one node: saturation, queue, failures, upstream pressure, likely cause',
    usage: '<nodeId>',
    args: [{ name: 'nodeId', kind: 'node' }],
    execute: (scope, args) => ({ lines: diagnoseNode(scope, args.positionals[0]) })
  },
  {
    name: 'why-rejected',
    modes: MODES,
    summary: 'The admission check (c, queue, K) that rejected a request (default: the latest)',
    usage: '[requestId]',
    args: [{ name: 'requestId', kind: 'request', optional: true }],
    execute: (scope, args) => ({ lines: whyRejected(scope, args.positionals[0]) })
  },
  {
    name: 'compare',
    modes: MODES,
    summary: 'Two nodes side by side from the last run',
    usage: '<nodeA> <nodeB>',
    args: [
      { name: 'nodeA', kind: 'node' },
      { name: 'nodeB', kind: 'node' }
    ],
    execute: (scope, args) => ({
      lines: compareNodes(scope, args.positionals[0], args.positionals[1])
    })
  },
  {
    name: 'explain capacity',
    modes: MODES,
    summary: 'How c and K are derived and what they mean for this node',
    usage: '<nodeId>',
    args: [{ name: 'nodeId', kind: 'node' }],
    execute: (scope, args) => ({ lines: explainCapacity(scope, args.positionals[0]) })
  },
  {
    name: 'show cascade',
    modes: MODES,
    summary: 'Causal failure graph as an indented tree',
    usage: '[--from <nodeId>]',
    execute: (scope, args) => {
      const from = args.flags.from
      return { lines: showCascade(scope, typeof from === 'string' ? from : args.positionals[0]) }
    }
  }
]
