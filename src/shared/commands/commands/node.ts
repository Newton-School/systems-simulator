import type { ComponentNode, TopologyJSON } from '../../../engine/core/types'
import { deriveNodeConcurrency } from '../../../engine/nodes/resourceDerivation'
import {
  describeFaultDomain,
  enclosingLocationIds,
  findFaultDomain
} from '../../../engine/core/faultDomains'
import { enterMode } from '../context'
import { flattenConfig } from '../configDump'
import {
  contextNode,
  latestSnapshot,
  nodeInterfaces,
  nodeName,
  postWarmupSeconds,
  simState
} from '../data'
import {
  errorRate,
  fmtCount,
  fmtMs,
  fmtPct,
  fmtRps,
  fmtValue,
  heading,
  keyValues,
  note,
  statusGlyph,
  table,
  utilization
} from '../format'
import { edgeMeanLatencyMs } from './topology'
import type { CommandDefinition, CommandScope, TerminalMode } from '../types'
import type { Palette } from '../../ansi'

/** Node show commands work in node mode and, IOS `do`-style, in its config sub-modes. */
export const NODE_SHOW_MODES: readonly TerminalMode[] = ['node', 'node-config', 'port-config']

export function nodeStatusLines(
  scope: CommandScope,
  topology: TopologyJSON,
  node: ComponentNode
): string[] {
  const c = scope.deps.palette
  const live = latestSnapshot(scope)
  const state = live?.snapshot.node[node.id]
  const results = simState(scope)?.results ?? null
  const metrics = results?.perNode[node.id]
  const derived = deriveNodeConcurrency(node)
  const lines = [
    heading(
      nodeName(topology, node.id),
      c,
      `${node.type} (${node.category}${node.role ? `, ${node.role}` : ''})`
    )
  ]
  const pairs: Array<[string, string]> = []
  if (state && live) {
    pairs.push(
      [
        'status',
        `${statusGlyph(state.status, c)} ${note(live.source === 'live' ? `(live, t=${(live.snapshot.timestamp / 1000).toFixed(1)}s)` : '(end of last run)', c)}`
      ],
      [
        'in service',
        `${fmtCount(state.activeWorkers)} / ${fmtCount(state.workers ?? derived.effectiveC)} workers`
      ],
      ['waiting', `${fmtCount(state.queueLength)}`],
      [
        'in system',
        `${fmtCount(state.totalInSystem)} / ${fmtCount(state.capacity ?? derived.effectiveK)} capacity (K)`
      ],
      ['occupancy now', `${utilization(state.utilization, c)} ${note('(instantaneous sample)', c)}`]
    )
  } else {
    pairs.push(['status', note('no run yet', c)], ['capacity', derived.provenance])
  }
  if (metrics) {
    pairs.push(
      ['availability', fmtPct(metrics.availability, 2)],
      [
        'utilization',
        `${utilization(metrics.utilization, c)} ${note('(time-weighted, post-warmup)', c)}`
      ]
    )
  }
  // Faults on this node, plus Region / AZ / Subnet faults on a container it sits in.
  const enclosing = enclosingLocationIds(topology, node)
  const faults = (topology.faults ?? []).filter(
    (fault) => fault.targetId === node.id || enclosing.has(fault.targetId)
  )
  if (faults.length > 0) {
    pairs.push([
      'faults',
      faults
        .map((fault) => {
          const domain =
            fault.targetId === node.id ? undefined : findFaultDomain(topology, fault.targetId)
          return `${fault.faultType} (${fault.timing}, ${fault.duration})${domain ? ` via ${describeFaultDomain(domain)}` : ''}`
        })
        .join('; ')
    ])
  }
  const windows = results?.statusTimeline.filter((window) => window.componentId === node.id) ?? []
  if (windows.length > 0) {
    pairs.push([
      'down windows',
      windows
        .map(
          (w) =>
            `${w.mode} ${(w.startMs / 1000).toFixed(1)}-${(w.endMs / 1000).toFixed(1)}s${w.faultDomain ? ` (${describeFaultDomain(w.faultDomain)} down)` : ''}`
        )
        .join(', ')
    ])
  }
  lines.push(...keyValues(pairs, c))
  return lines
}

export function nodeQueueLines(
  scope: CommandScope,
  topology: TopologyJSON,
  node: ComponentNode
): string[] {
  const c = scope.deps.palette
  const derived = deriveNodeConcurrency(node)
  const live = latestSnapshot(scope)
  const state = live?.snapshot.node[node.id]
  const metrics = simState(scope)?.results?.perNode[node.id]
  const pairs: Array<[string, string]> = [
    ['discipline', node.queue?.discipline ?? 'fifo'],
    ['workers (c)', fmtCount(state?.workers ?? derived.effectiveC)],
    [
      'capacity (K)',
      `${fmtCount(state?.capacity ?? derived.effectiveK)} ${note('in service + waiting', c)}`
    ],
    [
      'waiting room',
      fmtCount(
        Math.max(
          0,
          (state?.capacity ?? derived.effectiveK) - (state?.workers ?? derived.effectiveC)
        )
      )
    ],
    ['derived from', derived.provenance]
  ]
  if (node.queue?.discipline === 'wfq' && node.queue.weights) {
    pairs.push([
      'wfq weights',
      Object.entries(node.queue.weights)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
    ])
  }
  if (state) {
    pairs.push(
      [
        'waiting now',
        `${fmtCount(state.queueLength)} ${note(live?.source === 'live' ? '(live)' : '(end of run)', c)}`
      ],
      ['in service now', fmtCount(state.activeWorkers)]
    )
  }
  if (metrics) {
    pairs.push(
      ['avg waiting', metrics.avgQueueLength.toFixed(2)],
      ['peak waiting', fmtCount(metrics.peakQueueLength)],
      ['avg queue wait', fmtMs(metrics.avgQueueWait)],
      ['avg service', fmtMs(metrics.avgServiceTime)],
      ['rejected', fmtCount(metrics.totalRejected)]
    )
    const reasons = Object.entries(metrics.rejectionsByReason)
    if (reasons.length > 0) {
      pairs.push([
        'rejected by',
        reasons.map(([reason, count]) => `${reason} ${fmtCount(count)}`).join(', ')
      ])
    }
  }
  return [
    heading(`Queue ${node.id}`, c, `G/G/c/K, ${node.queue?.discipline ?? 'fifo'}`),
    ...keyValues(pairs, c)
  ]
}

function connectionLines(
  scope: CommandScope,
  topology: TopologyJSON,
  node: ComponentNode
): string[] {
  const c = scope.deps.palette
  const interfaces = nodeInterfaces(topology, node.id)
  if (interfaces.length === 0) return [`${node.id} has no connections.`]
  const results = simState(scope)?.results ?? null
  const seconds = results ? postWarmupSeconds(results) : 1
  const rows = interfaces.map((entry) => {
    const measured = results?.perEdge[entry.edge.id]
    return [
      String(entry.index),
      entry.direction,
      entry.peerId,
      entry.edge.id,
      `${entry.edge.protocol}/${entry.edge.mode}`,
      fmtCount(entry.edge.maxConcurrentRequests),
      measured ? fmtCount(measured.totalSuccessfulTransits) : '-',
      measured ? fmtRps(measured.totalSuccessfulTransits / seconds) : '-',
      measured ? fmtCount(measured.totalFailedTerminals) : '-'
    ]
  })
  const lines = [
    heading(`Connections ${node.id}`, c),
    ...table(
      ['#', 'DIR', 'PEER', 'EDGE', 'PROTO/MODE', 'MAX CONC', 'TRANSITS', 'THRU', 'FAILED'],
      rows,
      c,
      {
        align: ['right', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right']
      }
    )
  ]
  lines.push(
    note(
      results
        ? 'Measured over the last run. Live per-connection counts are not part of the snapshot stream.'
        : 'Run a simulation for per-connection traffic.',
      c
    )
  )
  return lines
}

function configLines(scope: CommandScope, topology: TopologyJSON, node: ComponentNode): string[] {
  const c = scope.deps.palette
  const fields = scope.deps.config?.fields(node.id)
  if (!fields) {
    return [
      heading(`Config ${node.id}`, c, 'engine view'),
      ...flattenConfig({ ...node, position: undefined, id: undefined }).map(
        ([path, value]) => `  ${path} ${value}`
      )
    ]
  }
  const lines = [heading(`Config ${node.id}`, c, 'fields the properties panel exposes')]
  let section = ''
  const rows: string[][] = []
  const flush = (): void => {
    if (rows.length === 0) return
    lines.push(
      `${c.cyan}${section}${c.reset}`,
      ...table(['KEY', 'VALUE', 'UNIT', 'LABEL'], rows, c, { indent: '  ' }).slice(2)
    )
    rows.length = 0
  }
  for (const field of fields) {
    if (field.section !== section) {
      flush()
      section = field.section
    }
    const value = fmtValue(field.displayValue)
    rows.push([
      field.editable ? field.key : `${c.dim}${field.key}${c.reset}`,
      field.editable ? value : `${c.dim}${value}${c.reset}`,
      field.unit ?? '',
      field.editable ? field.label : `${c.dim}${field.label} (panel editor only)${c.reset}`
    ])
  }
  flush()
  lines.push(
    note(
      "'configure terminal' then 'set <key> <value>'. Engine view: show running-config " +
        node.id +
        ' (from sim>).',
      c
    )
  )
  return lines
}

export function interfaceLines(
  scope: CommandScope,
  topology: TopologyJSON,
  node: ComponentNode
): string[] {
  const c = scope.deps.palette
  const interfaces = nodeInterfaces(topology, node.id)
  if (interfaces.length === 0) return [`${node.id} has no interfaces (no connections).`]
  const results = simState(scope)?.results ?? null
  const seconds = results ? postWarmupSeconds(results) : 1
  const lines: string[] = []
  for (const entry of interfaces) {
    const edge = entry.edge
    const arrow = entry.direction === 'out' ? '->' : '<-'
    lines.push(
      `${c.bold}Interface ${entry.index}${c.reset} (${entry.direction}) ${arrow} ${nodeName(topology, entry.peerId)} ${c.dim}[${edge.id}]${c.reset}`,
      `  protocol ${edge.protocol}, mode ${edge.mode}, path ${edge.latency.pathType}, latency ~${fmtMs(edgeMeanLatencyMs(edge))}`,
      `  bandwidth ${fmtCount(edge.bandwidth)} Mbps, max concurrent ${fmtCount(edge.maxConcurrentRequests)}, packet loss ${fmtPct(edge.packetLossRate, 2)}, error rate ${fmtPct(edge.errorRate, 2)}` +
        (edge.weight !== undefined ? `, weight ${edge.weight}` : '') +
        (edge.fanoutFactor !== undefined ? `, fan-out x${edge.fanoutFactor}` : '')
    )
    const measured = results?.perEdge[edge.id]
    if (measured) {
      lines.push(
        `  ${fmtCount(measured.totalSuccessfulTransits)} transits (${fmtRps(measured.totalSuccessfulTransits / seconds)}), p50 ${fmtMs(measured.transitLatency.p50)}, p99 ${fmtMs(measured.transitLatency.p99)}, ${fmtCount(measured.totalFailedTerminals)} failed` +
          (measured.linkUtilization !== undefined
            ? `, link ${fmtPct(measured.linkUtilization)}`
            : '')
      )
    }
  }
  return lines
}

function portLines(
  scope: CommandScope,
  topology: TopologyJSON,
  node: ComponentNode,
  c: Palette
): string[] {
  const interfaces = nodeInterfaces(topology, node.id)
  if (interfaces.length === 0) return [`${node.id} has no ports (no connections).`]
  const rows = interfaces.map((entry) => [
    String(entry.index),
    entry.direction,
    entry.peerId,
    entry.edge.protocol,
    fmtCount(entry.edge.maxConcurrentRequests),
    `${fmtCount(entry.edge.bandwidth)} Mbps`
  ])
  return [
    heading(`Ports ${node.id}`, c, 'one per connection'),
    ...table(['PORT', 'DIR', 'PEER', 'PROTOCOL', 'MAX CONN', 'BANDWIDTH'], rows, c, {
      align: ['right', 'left', 'left', 'left', 'right', 'right']
    }),
    note(
      'The engine models connections, not numbered ports: a port here is one edge, and its protocol, ' +
        'concurrency cap and bandwidth are the edge settings. Per-port connection counts, port rate limits, ' +
        'health checks and shutdown are not simulated.',
      c
    )
  ]
}

function metricLines(scope: CommandScope, topology: TopologyJSON, node: ComponentNode): string[] {
  const c = scope.deps.palette
  const results = simState(scope)?.results ?? null
  const metrics = results?.perNode[node.id]
  if (!results || !metrics) {
    const live = latestSnapshot(scope)
    const state = live?.snapshot.node[node.id]
    const lines = [heading(`Metrics ${node.id}`, c)]
    if (state) {
      lines.push(
        ...keyValues(
          [
            ['completed', fmtCount(state.completedTotal)],
            ['occupancy now', utilization(state.utilization, c)]
          ],
          c
        ),
        note('Latency percentiles and error rates are computed when the run completes.', c)
      )
    } else {
      lines.push(note("No run yet. 'run' from sim> (or the Run button) first.", c))
    }
    return lines
  }
  const local = metrics.latencyNodeLocal
  const pairs: Array<[string, string]> = [
    ['throughput', fmtRps(metrics.throughput)],
    ['arrived', fmtCount(metrics.totalArrived)],
    ['processed', fmtCount(metrics.totalProcessed)],
    ['rejected', fmtCount(metrics.totalRejected)],
    ['timed out', fmtCount(metrics.totalTimedOut)],
    ['error rate', errorRate(metrics.errorRate, c)],
    [
      'utilization',
      `${utilization(metrics.utilization, c)} ${note(`(workers ${fmtPct(metrics.workerUtilization)})`, c)}`
    ],
    [
      'node latency',
      `p50 ${fmtMs(local.p50)}  p95 ${fmtMs(local.p95)}  p99 ${fmtMs(local.p99)} ${note('(queue + service here)', c)}`
    ],
    ['avg queue wait', fmtMs(metrics.avgQueueWait)],
    ['avg service', fmtMs(metrics.avgServiceTime)]
  ]
  if (metrics.cacheHits + metrics.cacheMisses > 0) {
    pairs.push([
      'cache',
      `${fmtCount(metrics.cacheHits)} hits, ${fmtCount(metrics.cacheMisses)} misses (${fmtPct(metrics.cacheHitRatio)})`
    ])
  }
  const reasons = Object.entries(metrics.rejectionsByReason)
  if (reasons.length > 0) {
    pairs.push([
      'rejected by',
      reasons.map(([reason, count]) => `${reason} ${fmtCount(count)}`).join(', ')
    ])
  }
  return [
    heading(`Metrics ${node.id}`, c, `post-warmup, seed ${results.seed}`),
    ...keyValues(pairs, c)
  ]
}

function nodeCommand(
  name: string,
  summary: string,
  render: (scope: CommandScope, topology: TopologyJSON, node: ComponentNode) => string[],
  aliases?: string[]
): CommandDefinition {
  return {
    name,
    aliases,
    modes: NODE_SHOW_MODES,
    summary,
    execute: (scope) => {
      const { topology, node } = contextNode(scope)
      return { lines: render(scope, topology, node) }
    }
  }
}

export const NODE_COMMANDS: CommandDefinition[] = [
  nodeCommand('show status', 'Node status, occupancy and fault windows', nodeStatusLines),
  nodeCommand(
    'show queue',
    'Queue discipline, c and K (and where they come from), waiters',
    nodeQueueLines
  ),
  nodeCommand('show connections', 'Connections with measured per-edge traffic', connectionLines),
  nodeCommand(
    'show config',
    'Every config field the properties panel exposes, with its terminal key',
    configLines
  ),
  nodeCommand(
    'show ports',
    'Port table (a projection of the node connections)',
    (scope, topology, node) => portLines(scope, topology, node, scope.deps.palette)
  ),
  nodeCommand(
    'show interfaces',
    'IOS-style interface summary (one per connection)',
    interfaceLines
  ),
  nodeCommand(
    'show metrics',
    'Throughput, latency percentiles, error rate, utilization',
    metricLines
  ),
  {
    name: 'configure terminal',
    aliases: ['conf t', 'configure', 'config'],
    modes: ['node'],
    summary: 'Enter config mode for this node',
    execute: (scope) => {
      const { node } = contextNode(scope)
      const c = scope.deps.palette
      if (!scope.deps.config) {
        return {
          lines: [
            `${c.yellow}Config mode is available in the app terminal.${c.reset} ${note('sim shell reads a topology file and never rewrites it.', c)}`
          ]
        }
      }
      return {
        context: enterMode(scope.ctx, { mode: 'node-config', nodeId: node.id }),
        lines: [
          note(
            "'show config' lists keys; 'set <key> <value>', 'no <key>', 'interface port <N>'. 'end' to finish.",
            c
          )
        ]
      }
    }
  }
]
