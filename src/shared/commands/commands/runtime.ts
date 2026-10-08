import { deriveNodeConcurrency } from '../../../engine/nodes/resourceDerivation'
import {
  latestSnapshot,
  nodeName,
  postWarmupSeconds,
  requireNode,
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
  statusGlyph,
  table,
  utilization,
  warn
} from '../format'
import { nodeQueueLines, nodeStatusLines } from './node'
import {
  CommandError,
  type CommandDefinition,
  type CommandScope,
  type SimulationAccess
} from '../types'

export const BOTTLENECK_THRESHOLD = 0.85

function requireSim(scope: CommandScope): SimulationAccess {
  if (!scope.deps.sim) throw new CommandError('No simulation is attached here.')
  return scope.deps.sim
}

function requireLiveControl<K extends 'pause' | 'resume' | 'step' | 'stop'>(
  scope: CommandScope,
  name: K
): NonNullable<SimulationAccess[K]> {
  const sim = requireSim(scope)
  const control = sim[name]
  if (!control) {
    throw new CommandError(
      `${name} controls a run in progress, which only the app has; sim shell runs to completion. Use 'sim run --live' for a live view.`
    )
  }
  return control as NonNullable<SimulationAccess[K]>
}

function statusLines(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const state = requireSim(scope).state()
  const live = latestSnapshot(scope)
  const speed = state.playbackSpeed === 'max' ? 'max' : `${state.playbackSpeed}x`
  const runTopology = state.runTopology
  const simMs = live?.snapshot.timestamp
  const pairs: Array<[string, string]> = [
    [
      'state',
      state.status === 'paused' && state.stopped
        ? `${c.yellow}stopping${c.reset}`
        : state.status === 'running'
          ? `${c.green}running${c.reset}`
          : state.status === 'paused'
            ? `${c.yellow}paused${c.reset}`
            : state.status === 'error'
              ? `${c.red}error${c.reset}`
              : state.status
    ],
    ['progress', `${state.progress.toFixed(1)}%`],
    ['events', fmtCount(state.results?.eventsProcessed ?? state.eventsProcessed)],
    ['speed', speed]
  ]
  if (simMs !== undefined) {
    const total = runTopology?.global.simulationDuration
    pairs.push(['sim time', `${(simMs / 1000).toFixed(1)}s${total ? ` of ${total / 1000}s` : ''}`])
  }
  if (state.error) pairs.push(['error', `${c.red}${state.error}${c.reset}`])
  if (state.results) {
    pairs.push([
      'result',
      `${state.stopped ? 'stopped early, ' : ''}${fmtCount(state.results.summary.totalRequests)} requests, p99 ${fmtMs(state.results.summary.latency.p99)}`
    ])
  }
  return [heading('Simulation', c), ...keyValues(pairs, c)]
}

/** All nodes from the latest snapshot (live during a run, final after it). */
function allNodeStatus(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const topology = simState(scope)?.runTopology ?? requireTopology(scope)
  const live = latestSnapshot(scope)
  if (!live) {
    return [
      warn("No run data yet. 'run' starts one (sim>), and status fills in as snapshots arrive.", c)
    ]
  }
  const results = simState(scope)?.results ?? null
  const rows = topology.nodes.map((node) => {
    const state = live.snapshot.node[node.id]
    const metrics = results?.perNode[node.id]
    return [
      node.id,
      state ? statusGlyph(state.status, c) : note('-', c),
      state ? utilization(state.utilization, c) : '-',
      state ? fmtCount(state.queueLength) : '-',
      metrics ? fmtRps(metrics.throughput) : '-',
      metrics ? errorRate(metrics.errorRate, c) : '-'
    ]
  })
  return [
    heading(
      'Node status',
      c,
      live.source === 'live'
        ? `live, t=${(live.snapshot.timestamp / 1000).toFixed(1)}s`
        : 'end of last run'
    ),
    ...table(['NODE', 'STATUS', 'OCCUPANCY', 'WAITING', 'RPS', 'ERRORS'], rows, c, {
      align: ['left', 'left', 'right', 'right', 'right', 'right']
    }),
    note(
      results
        ? 'OCCUPANCY and WAITING are the last snapshot; RPS and ERRORS are over the whole run (post-warmup).'
        : 'OCCUPANCY is an instantaneous sample. RPS and ERRORS are computed when the run completes.',
      c
    )
  ]
}

function bottleneckLines(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const topology = simState(scope)?.runTopology ?? requireTopology(scope)
  const results = simState(scope)?.results ?? null
  const live = latestSnapshot(scope)
  if (!results && !live) return [warn("No run data yet. 'run' first.", c)]
  const ranked = topology.nodes
    .filter((node) => node.role !== 'source')
    .map((node) => ({
      node,
      value: results
        ? (results.perNode[node.id]?.utilization ?? 0)
        : (live?.snapshot.node[node.id]?.utilization ?? 0)
    }))
    .sort((a, b) => b.value - a.value)
  const top = ranked[0]
  if (!top) return ['No processing nodes.']
  const basis = results
    ? 'time-weighted utilization over the run'
    : 'instantaneous occupancy (the run is still going)'
  const lines = [heading('Bottleneck', c, basis)]
  if (top.value >= BOTTLENECK_THRESHOLD) {
    lines.push(
      `${c.red}${c.bold}${nodeName(topology, top.node.id)}${c.reset} at ${utilization(top.value, c)} - above ${fmtPct(BOTTLENECK_THRESHOLD, 0)}, queueing grows sharply from here.`
    )
  } else {
    lines.push(
      `Busiest: ${nodeName(topology, top.node.id)} at ${utilization(top.value, c)} - below ${fmtPct(BOTTLENECK_THRESHOLD, 0)}, no node is saturated.`
    )
  }
  lines.push(
    ...table(
      ['NODE', 'UTILIZATION', 'C/K'],
      ranked.slice(0, 5).map(({ node, value }) => {
        const derived = deriveNodeConcurrency(node)
        return [
          node.id,
          utilization(value, c),
          `${fmtCount(derived.effectiveC)}/${fmtCount(derived.effectiveK)}`
        ]
      }),
      c,
      { align: ['left', 'right', 'right'] }
    )
  )
  if (results && results.summary.failuresByLocus.length > 0) {
    const locus = results.summary.failuresByLocus[0]
    lines.push(note(`Most failures end at ${locus.locus} (${fmtCount(locus.total)}).`, c))
  }
  return lines
}

function throughputLines(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const state = simState(scope)
  const results = state?.results
  const topology = state?.runTopology ?? requireTopology(scope)
  if (!results) {
    const live = latestSnapshot(scope)
    if (!live) return [warn("No run data yet. 'run' first.", c)]
    const seconds = Math.max(live.snapshot.timestamp / 1000, 1e-9)
    const rows = topology.nodes.map((node) => {
      const done = live.snapshot.node[node.id]?.completedTotal
      return [node.id, fmtCount(done), done === undefined ? '-' : fmtRps(done / seconds)]
    })
    return [
      heading('Throughput', c, `live, completed so far / ${seconds.toFixed(1)}s (includes warmup)`),
      ...table(['NODE', 'COMPLETED', 'AVG RATE'], rows, c, { align: ['left', 'right', 'right'] })
    ]
  }
  const seconds = postWarmupSeconds(results)
  const rows = topology.nodes.map((node) => {
    const metrics = results.perNode[node.id]
    return [
      node.id,
      metrics ? fmtRps(metrics.throughput) : '-',
      metrics ? fmtCount(metrics.postWarmupArrived) : '-',
      metrics ? fmtRps(metrics.postWarmupArrived / seconds) : '-',
      metrics ? errorRate(metrics.errorRate, c) : '-'
    ]
  })
  return [
    heading('Throughput', c, `post-warmup ${seconds.toFixed(1)}s`),
    `  system ${c.bold}${fmtRps(results.summary.throughput)}${c.reset} successful, error rate ${errorRate(results.summary.errorRate, c)}`,
    ...table(['NODE', 'THROUGHPUT', 'ARRIVED', 'OFFERED', 'ERRORS'], rows, c, {
      align: ['left', 'right', 'right', 'right', 'right']
    })
  ]
}

const RUNTIME = ['runtime'] as const

export const RUNTIME_COMMANDS: CommandDefinition[] = [
  {
    name: 'pause',
    modes: RUNTIME,
    summary: 'Pause the run (same as the Pause button)',
    execute: (scope) => {
      const status = requireSim(scope).state().status
      if (status !== 'running')
        throw new CommandError(status === 'paused' ? 'Already paused.' : 'No run in progress.')
      requireLiveControl(scope, 'pause')()
      return { lines: ["Paused. 'step [N]' advances N events, 'resume' continues."] }
    }
  },
  {
    name: 'resume',
    aliases: ['continue'],
    modes: RUNTIME,
    summary: 'Resume a paused run',
    execute: (scope) => {
      const state = requireSim(scope).state()
      if (state.status !== 'paused' || state.stopped)
        throw new CommandError(
          state.status === 'running' ? 'Already running.' : 'Nothing to resume.'
        )
      requireLiveControl(scope, 'resume')()
      return { lines: ['Resumed.'] }
    }
  },
  {
    name: 'step',
    modes: RUNTIME,
    summary: 'Process N more events while paused (default 1)',
    usage: '[N]',
    execute: (scope, args) => {
      const state = requireSim(scope).state()
      if (state.status !== 'paused' || state.stopped) {
        throw new CommandError(
          state.status === 'running'
            ? "Step works while paused - 'pause' first."
            : 'No paused run to step.'
        )
      }
      const raw = args.positionals[0]
      const count = raw === undefined ? 1 : Number(raw)
      if (!Number.isInteger(count) || count < 1 || count > 1_000_000) {
        throw new CommandError(`step: expected a whole number of events (1-1000000), got '${raw}'.`)
      }
      requireLiveControl(scope, 'step')(count)
      return {
        lines: [
          `Stepped ${fmtCount(count)} event${count === 1 ? '' : 's'}. ${note("'status' shows the new event count once the worker reports it.", scope.deps.palette)}`
        ]
      }
    }
  },
  {
    name: 'stop',
    modes: RUNTIME,
    summary: 'Stop the run early and keep the partial results',
    execute: (scope) => {
      const status = requireSim(scope).state().status
      if (status !== 'running' && status !== 'paused') throw new CommandError('No run in progress.')
      requireLiveControl(scope, 'stop')()
      return {
        lines: ['Stopping: the worker finishes its current chunk and reports partial results.']
      }
    }
  },
  {
    name: 'status',
    modes: ['runtime', 'sim'],
    summary: 'Simulation state: progress, events, sim time, speed',
    execute: (scope) => ({ lines: statusLines(scope) })
  },
  {
    name: 'show status',
    modes: ['runtime', 'sim'],
    summary: 'Every node: status, occupancy, queue, RPS, error rate',
    execute: (scope) => ({ lines: allNodeStatus(scope) })
  },
  {
    name: 'show node',
    modes: ['runtime', 'sim'],
    summary: 'One node in detail from the latest snapshot',
    usage: '<nodeId>',
    args: [{ name: 'nodeId', kind: 'node' }],
    execute: (scope, args) => {
      const topology = simState(scope)?.runTopology ?? requireTopology(scope)
      const node = requireNode(topology, resolveNodeId(topology, args.positionals[0]))
      return { lines: nodeStatusLines(scope, topology, node) }
    }
  },
  {
    name: 'show bottleneck',
    modes: ['runtime', 'sim'],
    summary: 'Highest-utilization node, flagged above 85%',
    execute: (scope) => ({ lines: bottleneckLines(scope) })
  },
  {
    name: 'show queue',
    modes: ['runtime', 'sim'],
    summary: 'Queue depth, c/K, discipline and wait for one node',
    usage: '<nodeId>',
    args: [{ name: 'nodeId', kind: 'node' }],
    execute: (scope, args) => {
      const topology = simState(scope)?.runTopology ?? requireTopology(scope)
      const node = requireNode(topology, resolveNodeId(topology, args.positionals[0]))
      return { lines: nodeQueueLines(scope, topology, node) }
    }
  },
  {
    name: 'show throughput',
    modes: ['runtime', 'sim'],
    summary: 'System and per-node throughput',
    execute: (scope) => ({ lines: throughputLines(scope) })
  }
]
