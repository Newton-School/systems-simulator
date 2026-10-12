import { buildCostReport, formatCostReport } from '../../../cli/commands/cost'
import { buildLintReport, formatLintReport } from '../../../cli/commands/lint'
import { distributionMean } from '../../../engine/analysis/fluidModel'
import type { SimulationOutput } from '../../../engine/analysis/output'
import type { EdgeDefinition, TopologyJSON } from '../../../engine/core/types'
import { deriveNodeConcurrency } from '../../../engine/nodes/resourceDerivation'
import { enterMode, enterRuntime } from '../context'
import { diffTopologyConfig, flattenConfig } from '../configDump'
import {
  labelOf,
  latestSnapshot,
  nodeName,
  postWarmupSeconds,
  requireTopology,
  resolveNodeId,
  simState
} from '../data'
import {
  errorRate,
  fmtCount,
  fmtMs,
  fmtRps,
  heading,
  keyValues,
  note,
  statusGlyph,
  table,
  warn
} from '../format'
import {
  CommandError,
  type CommandDefinition,
  type CommandResult,
  type CommandScope
} from '../types'
import type { Palette } from '../../ansi'

/** Mean configured one-way latency of an edge, in ms (NaN when not defined by simple parameters). */
export function edgeMeanLatencyMs(edge: EdgeDefinition): number {
  return distributionMean(edge.latency.distribution)
}

function edgeLatencyText(edge: EdgeDefinition): string {
  const mean = edgeMeanLatencyMs(edge)
  return Number.isFinite(mean) ? `~${fmtMs(mean)}` : edge.latency.distribution.type
}

/** Shortest directed path by hop count (BFS), as edges. Null when unreachable. */
export function shortestPath(
  topology: TopologyJSON,
  fromId: string,
  toId: string
): EdgeDefinition[] | null {
  if (fromId === toId) return []
  const outgoing = new Map<string, EdgeDefinition[]>()
  for (const edge of topology.edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.id.localeCompare(b.id))
  const previous = new Map<string, EdgeDefinition>()
  const seen = new Set([fromId])
  const queue = [fromId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of outgoing.get(current) ?? []) {
      if (seen.has(edge.target)) continue
      seen.add(edge.target)
      previous.set(edge.target, edge)
      if (edge.target === toId) {
        const path: EdgeDefinition[] = []
        let cursor = toId
        while (cursor !== fromId) {
          const step = previous.get(cursor)!
          path.unshift(step)
          cursor = step.source
        }
        return path
      }
      queue.push(edge.target)
    }
  }
  return null
}

/** One-paragraph summary of a finished run (also printed when a run completes). */
export function runSummaryLines(results: SimulationOutput, c: Palette): string[] {
  const s = results.summary
  const stopped =
    results.stopReason === 'saturation'
      ? ` ${c.red}(halted: saturation)${c.reset}`
      : results.stopReason === 'request-budget'
        ? ` ${c.dim}(request budget reached)${c.reset}`
        : ''
  return [
    `${heading('Run complete', c, `seed ${results.seed}, ${results.evaluationMode ?? 'discrete'}`)}${stopped}`,
    ...keyValues(
      [
        [
          'requests',
          `${fmtCount(s.totalRequests)} (${fmtCount(s.successfulRequests)} ok, ${fmtCount(s.failedRequests)} failed)`
        ],
        ['throughput', fmtRps(s.throughput)],
        ['error rate', errorRate(s.errorRate, c)],
        [
          'latency',
          `p50 ${fmtMs(s.latency.p50)}  p95 ${fmtMs(s.latency.p95)}  p99 ${fmtMs(s.latency.p99)}`
        ],
        ['events', fmtCount(results.eventsProcessed)]
      ],
      c
    )
  ]
}

function topologySummary(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const topology = requireTopology(scope)
  const sourceIds = new Set(
    topology.nodes.filter((node) => node.role === 'source').map((node) => node.id)
  )
  if (topology.workload?.sourceNodeId) sourceIds.add(topology.workload.sourceNodeId)
  const byCategory = new Map<string, number>()
  for (const node of topology.nodes) {
    byCategory.set(node.category, (byCategory.get(node.category) ?? 0) + 1)
  }
  const workload = topology.workload
  const lines = [
    heading(topology.name || topology.id, c, `(${topology.id})`),
    ...keyValues(
      [
        [
          'nodes',
          `${topology.nodes.length} (${[...byCategory].map(([cat, n]) => `${n} ${cat}`).join(', ')})`
        ],
        ['edges', String(topology.edges.length)],
        ['sources', [...sourceIds].join(', ') || 'none'],
        [
          'workload',
          workload
            ? `${workload.pattern}, ${fmtCount(workload.baseRps)} req/s base`
            : 'none configured'
        ],
        [
          'duration',
          `${topology.global.simulationDuration / 1000}s (warmup ${topology.global.warmupDuration / 1000}s), seed ${topology.global.seed}`
        ]
      ],
      c
    )
  ]
  lines.push('', ...nodeTable(scope, topology))
  return lines
}

function nodeTable(scope: CommandScope, topology: TopologyJSON): string[] {
  const c = scope.deps.palette
  const live = latestSnapshot(scope)
  const rows = topology.nodes.map((node) => {
    const derived = deriveNodeConcurrency(node)
    const state = live?.snapshot.node[node.id]
    return [
      node.id,
      node.label ?? '',
      node.type,
      node.role ?? '',
      `${fmtCount(state?.workers ?? derived.effectiveC)}/${fmtCount(state?.capacity ?? derived.effectiveK)}`,
      state ? statusGlyph(state.status, c) : note('-', c)
    ]
  })
  const lines = table(['ID', 'LABEL', 'TYPE', 'ROLE', 'C/K', 'STATUS'], rows, c)
  if (!live)
    lines.push(
      note(
        'c/K = workers / system capacity (derived from the instance). Status appears once a run starts.',
        c
      )
    )
  return lines
}

function edgeTable(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const topology = requireTopology(scope)
  if (topology.edges.length === 0) return ['No edges.']
  const results = simState(scope)?.results ?? null
  const seconds = results ? postWarmupSeconds(results) : 1
  const rows = topology.edges.map((edge) => {
    const measured = results?.perEdge[edge.id]
    return [
      edge.id,
      `${edge.source} -> ${edge.target}`,
      `${edge.protocol}/${edge.mode}`,
      edge.latency.pathType,
      edgeLatencyText(edge),
      `${fmtCount(edge.bandwidth)} Mbps`,
      fmtCount(edge.maxConcurrentRequests),
      measured ? fmtRps(measured.totalSuccessfulTransits / seconds) : '-',
      measured ? fmtMs(measured.transitLatency.p50) : '-'
    ]
  })
  const lines = table(
    ['EDGE', 'PATH', 'PROTO/MODE', 'PATH TYPE', 'LATENCY', 'BANDWIDTH', 'MAX CONC', 'THRU', 'P50'],
    rows,
    c
  )
  lines.push(
    note(
      results
        ? 'LATENCY is the configured mean; THRU and P50 are measured from the last run.'
        : 'LATENCY is the configured mean. Run a simulation for measured throughput and p50.',
      c
    )
  )
  return lines
}

function runningConfig(scope: CommandScope, nodeToken?: string): string[] {
  const c = scope.deps.palette
  const topology = requireTopology(scope)
  if (nodeToken) {
    const nodeId = resolveNodeId(topology, nodeToken)
    const node = topology.nodes.find((candidate) => candidate.id === nodeId)!
    return [
      heading(`node ${node.id}`, c, node.type),
      ...flattenConfig({ ...node, position: undefined }).map(([path, value]) => ` ${path} ${value}`)
    ]
  }
  const lines = [heading('! running-config', c, topology.name), ' ']
  lines.push(...flattenConfig(topology.global, 'global').map(([path, value]) => `${path} ${value}`))
  for (const node of topology.nodes) {
    lines.push('!', `${c.cyan}node ${node.id}${c.reset} ${c.dim}${node.type}${c.reset}`)
    for (const [path, value] of flattenConfig({ ...node, id: undefined, position: undefined })) {
      lines.push(` ${path} ${value}`)
    }
  }
  for (const edge of topology.edges) {
    lines.push(
      '!',
      `${c.cyan}edge ${edge.id}${c.reset} ${c.dim}${edge.source} -> ${edge.target}${c.reset}`
    )
    for (const [path, value] of flattenConfig({
      ...edge,
      id: undefined,
      source: undefined,
      target: undefined,
      sourceHandle: undefined,
      targetHandle: undefined,
      presentation: undefined
    })) {
      lines.push(` ${path} ${value}`)
    }
  }
  if (topology.workload) {
    lines.push('!', `${c.cyan}workload${c.reset}`)
    for (const [path, value] of flattenConfig(topology.workload)) lines.push(` ${path} ${value}`)
  }
  lines.push('end')
  return lines
}

function configDiff(scope: CommandScope): string[] {
  const c = scope.deps.palette
  if (!scope.deps.savedTopology) {
    throw new CommandError('show config diff needs a saved baseline, which only the app tracks.')
  }
  const saved = scope.deps.savedTopology()
  if (!saved) {
    throw new CommandError('No saved baseline yet: load or save a topology first.')
  }
  const current = requireTopology(scope)
  const diff = diffTopologyConfig(saved, current)
  if (diff.length === 0)
    return [`${c.green}No changes${c.reset} since the topology was last loaded or saved.`]
  const lines = [
    heading(
      'Config diff',
      c,
      `vs last load/save, ${diff.length} change${diff.length === 1 ? '' : 's'}`
    )
  ]
  for (const entry of diff) {
    if (entry.kind === 'added') lines.push(`${c.green}+ ${entry.path} ${entry.after}${c.reset}`)
    else if (entry.kind === 'removed')
      lines.push(`${c.red}- ${entry.path} ${entry.before}${c.reset}`)
    else
      lines.push(
        `${c.yellow}~ ${entry.path}${c.reset} ${entry.before} ${c.dim}->${c.reset} ${entry.after}`
      )
  }
  lines.push(note('Canvas positions are ignored.', c))
  return lines
}

function pathCommand(
  scope: CommandScope,
  fromToken: string | undefined,
  toToken: string | undefined,
  detailed: boolean
): string[] {
  const c = scope.deps.palette
  const topology = requireTopology(scope)
  if (!fromToken || !toToken) {
    throw new CommandError(`Usage: ${detailed ? 'traceroute' : 'ping'} <fromNode> <toNode>`)
  }
  const from = resolveNodeId(topology, fromToken)
  const to = resolveNodeId(topology, toToken)
  const path = shortestPath(topology, from, to)
  if (path === null) {
    return [
      `${c.red}${to} is unreachable from ${from}${c.reset} ${note('(no directed path along the edges)', c)}`
    ]
  }
  if (path.length === 0) return [`${from} is ${to}: 0 hops.`]
  const total = path.reduce((sum, edge) => sum + edgeMeanLatencyMs(edge), 0)
  const route = [from, ...path.map((edge) => edge.target)].join(' -> ')
  const results = simState(scope)?.results ?? null
  if (!detailed) {
    return [
      `${c.green}${to} reachable${c.reset} from ${from}: ${route}`,
      `${path.length} hop${path.length === 1 ? '' : 's'}, configured one-way network latency ${Number.isFinite(total) ? `~${fmtMs(total)}` : 'N/A'}` +
        note(' (edge transit only; queueing and service time at each node are extra)', c)
    ]
  }
  const rows = path.map((edge, index) => {
    const measured = results?.perEdge[edge.id]
    return [
      String(index + 1),
      `${labelOf(topology, edge.source)} -> ${labelOf(topology, edge.target)}`,
      edge.id,
      edge.protocol,
      edge.latency.pathType,
      edgeLatencyText(edge),
      measured ? fmtMs(measured.transitLatency.p50) : '-'
    ]
  })
  return [
    heading(`traceroute ${from} -> ${to}`, c, `${path.length} hop${path.length === 1 ? '' : 's'}`),
    ...table(
      ['HOP', 'FROM -> TO', 'EDGE', 'PROTO', 'PATH TYPE', 'CONFIGURED', 'MEASURED P50'],
      rows,
      c,
      {
        align: ['right', 'left', 'left', 'left', 'left', 'right', 'right']
      }
    ),
    note(
      `Shortest path by hop count. Configured total ~${fmtMs(total)} one way.` +
        (results ? '' : ' Run a simulation for measured per-hop latency.'),
      c
    )
  ]
}

function validateCommand(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const topology = requireTopology(scope)
  const result = scope.deps.validate(topology)
  const lines = [
    result.valid
      ? `${c.green}${c.bold}Valid${c.reset} ${topology.name}`
      : `${c.red}${c.bold}Invalid${c.reset} ${topology.name}`
  ]
  for (const error of result.errors) {
    lines.push(
      `  ${c.red}x${c.reset} ${error.path ? `${c.dim}${error.path}${c.reset}: ` : ''}${error.message}`
    )
  }
  for (const warning of result.warnings) lines.push(`  ${c.yellow}!${c.reset} ${warning}`)
  lines.push(
    `${result.errors.length} error${result.errors.length === 1 ? '' : 's'}, ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`
  )
  return lines
}

function selectNode(scope: CommandScope, token: string | undefined): CommandResult {
  const topology = requireTopology(scope)
  const nodeId = resolveNodeId(topology, token)
  scope.deps.focusNode?.(nodeId)
  return {
    context: enterMode(scope.ctx, { mode: 'node', nodeId }),
    lines: [
      note(
        `${nodeName(topology, nodeId)} (${topology.nodes.find((n) => n.id === nodeId)?.type}). 'show ?' lists what you can inspect; 'configure terminal' edits it.`,
        scope.deps.palette
      )
    ]
  }
}

export function parseSpeed(raw: string | undefined): number | 'max' {
  if (!raw)
    throw new CommandError(
      'Usage: speed <multiplier|max>, e.g. speed 1 (real time), speed 10, speed max'
    )
  if (raw === 'max') return 'max'
  const value = Number(raw.replace(/x$/i, ''))
  if (!Number.isFinite(value) || value <= 0) {
    throw new CommandError(`speed: expected a positive number or 'max', got '${raw}'.`)
  }
  return value
}

export function speedCommand(scope: CommandScope, raw: string | undefined): string[] {
  const sim = scope.deps.sim
  if (!sim?.setSpeed) {
    throw new CommandError(
      'Playback speed applies to runs in the app; sim shell runs complete at full speed.'
    )
  }
  const speed = parseSpeed(raw)
  sim.setSpeed(speed)
  const active = ['running', 'paused'].includes(sim.state().status)
  return [
    `Playback speed ${speed === 'max' ? 'max (as fast as possible)' : `${speed}x simulated time`}` +
      (active ? ' - applied to this run.' : ' - applies to the next run.'),
    note(
      'Speed changes when events are processed, never which events or their outcome.',
      scope.deps.palette
    )
  ]
}

function runCommand(scope: CommandScope): CommandResult {
  const c = scope.deps.palette
  const sim = scope.deps.sim
  if (!sim) throw new CommandError('Running is not available here.')
  const before = sim.state().status
  if (before === 'running' || before === 'paused') {
    throw new CommandError("A run is already in progress. 'runtime' controls it; 'stop' ends it.")
  }
  const error = sim.run()
  if (error) throw new CommandError(error)
  const after = sim.state()
  if (after.status === 'complete' && after.results) {
    return { lines: runSummaryLines(after.results, c) }
  }
  return {
    context: enterRuntime(scope.ctx),
    lines: [
      `${c.green}Simulation started${c.reset} ${note("- runtime mode: pause, resume, step, speed, stop, status. 'exit' leaves it (the run keeps going).", c)}`
    ]
  }
}

const TOPOLOGY_MODES = ['sim'] as const

export const TOPOLOGY_COMMANDS: CommandDefinition[] = [
  {
    name: 'show topology',
    modes: ['sim', 'runtime'],
    summary: 'Topology summary and node table',
    execute: (scope) => ({ lines: topologySummary(scope) })
  },
  {
    name: 'show nodes',
    modes: ['sim', 'runtime'],
    summary: 'All nodes with type, derived c/K and live status',
    execute: (scope) => ({ lines: nodeTable(scope, requireTopology(scope)) })
  },
  {
    name: 'show edges',
    modes: ['sim', 'runtime'],
    summary: 'Edge table: protocol, path type, latency, bandwidth, measured throughput',
    execute: (scope) => ({ lines: edgeTable(scope) })
  },
  {
    name: 'show config running',
    aliases: ['show running-config'],
    modes: TOPOLOGY_MODES,
    summary: 'Full engine config dump (optionally one node)',
    usage: '[nodeId]',
    args: [{ name: 'nodeId', kind: 'node', optional: true }],
    execute: (scope, args) => ({ lines: runningConfig(scope, args.positionals[0]) })
  },
  {
    name: 'show config diff',
    modes: TOPOLOGY_MODES,
    summary: 'What changed since the topology was last loaded or saved',
    execute: (scope) => ({ lines: configDiff(scope) })
  },
  {
    name: 'select',
    modes: ['sim', 'runtime', 'node'],
    summary: 'Enter node context',
    usage: '<nodeId>',
    args: [{ name: 'nodeId', kind: 'node' }],
    execute: (scope, args) => selectNode(scope, args.positionals[0])
  },
  {
    name: 'ping',
    modes: ['sim', 'runtime'],
    summary: 'Is <to> reachable from <from>? Hop count and configured latency',
    usage: '<from> <to>',
    args: [
      { name: 'from', kind: 'node' },
      { name: 'to', kind: 'node' }
    ],
    execute: (scope, args) => ({
      lines: pathCommand(scope, args.positionals[0], args.positionals[1], false)
    })
  },
  {
    name: 'traceroute',
    modes: ['sim', 'runtime'],
    summary: 'Per-hop path with configured (and measured) edge latency',
    usage: '<from> <to>',
    args: [
      { name: 'from', kind: 'node' },
      { name: 'to', kind: 'node' }
    ],
    execute: (scope, args) => ({
      lines: pathCommand(scope, args.positionals[0], args.positionals[1], true)
    })
  },
  {
    name: 'validate',
    modes: TOPOLOGY_MODES,
    summary: 'Validate the topology (same validator as Run and `sim validate`)',
    execute: (scope) => ({ lines: validateCommand(scope) })
  },
  {
    name: 'lint',
    modes: TOPOLOGY_MODES,
    summary: 'Architectural anti-patterns (same report as `sim lint`)',
    execute: (scope) => {
      const topology = requireTopology(scope)
      const report = buildLintReport(topology, scope.deps.validate(topology).warnings)
      return { lines: formatLintReport(report, topology, scope.deps.palette).split('\n') }
    }
  },
  {
    name: 'cost',
    modes: TOPOLOGY_MODES,
    summary: 'Per-component $/hr (same report as `sim cost`; measured after a run)',
    execute: (scope) => {
      const topology = requireTopology(scope)
      const results = simState(scope)?.results ?? undefined
      const report = buildCostReport(topology, results)
      return { lines: formatCostReport(report, scope.deps.palette).split('\n') }
    }
  },
  {
    name: 'run',
    modes: TOPOLOGY_MODES,
    summary: 'Start a simulation of the current topology (enters runtime mode)',
    execute: (scope) => runCommand(scope)
  },
  {
    name: 'runtime',
    modes: TOPOLOGY_MODES,
    summary: 'Enter runtime mode to control the current run',
    execute: (scope) => {
      const status = simState(scope)?.status
      const c = scope.deps.palette
      return {
        context: enterRuntime(scope.ctx),
        lines:
          status === 'running' || status === 'paused'
            ? []
            : [
                warn(
                  "No run in progress. 'run' (or 'exit' then 'run') starts one; show commands still read the last run.",
                  c
                )
              ]
      }
    }
  },
  {
    name: 'speed',
    modes: ['sim', 'runtime'],
    summary: 'Set playback speed: a multiplier of simulated time, or max',
    usage: '<multiplier|max>',
    args: [{ name: 'speed', kind: 'enum', values: ['0.5', '1', '2', '5', '10', '100', 'max'] }],
    execute: (scope, args) => ({ lines: speedCommand(scope, args.positionals[0]) })
  },
  {
    name: 'undo',
    modes: ['sim', 'node', 'node-config', 'port-config'],
    summary: 'Undo the last canvas edit (same history as Ctrl+Z)',
    execute: (scope) => {
      if (!scope.deps.undo) throw new CommandError('Undo is available in the app.')
      return { lines: [scope.deps.undo() ? 'Undone.' : 'Nothing to undo.'] }
    }
  },
  {
    name: 'redo',
    modes: ['sim', 'node', 'node-config', 'port-config'],
    summary: 'Redo the last undone canvas edit',
    execute: (scope) => {
      if (!scope.deps.redo) throw new CommandError('Redo is available in the app.')
      return { lines: [scope.deps.redo() ? 'Redone.' : 'Nothing to redo.'] }
    }
  }
]
