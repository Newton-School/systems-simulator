import type { SimulationOutput, TimeSeriesSnapshot } from '../../engine/analysis/output'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../../engine/core/types'
import {
  CommandError,
  type CommandScope,
  type SimulationStateView,
  type TerminalContext
} from './types'

/** The current topology, or a CommandError explaining why there is none. */
export function requireTopology(scope: CommandScope): TopologyJSON {
  const { topology, errors } = scope.deps.topology()
  if (!topology) {
    throw new CommandError(
      errors.length > 0
        ? `The topology cannot be read: ${errors.join('; ')}`
        : 'There is no topology loaded.'
    )
  }
  return topology
}

export function labelOf(topology: TopologyJSON, nodeId: string): string {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  return node?.label?.trim() ? node.label : nodeId
}

/** `Label [id]`, or just the id when they match. */
export function nodeName(topology: TopologyJSON, nodeId: string): string {
  const label = labelOf(topology, nodeId)
  return label === nodeId ? nodeId : `${label} [${nodeId}]`
}

/** Resolve a user token to a node id: exact id, then case-insensitive id or label, then unique prefix. */
export function resolveNodeId(topology: TopologyJSON, token: string | undefined): string {
  if (!token) throw new CommandError('Missing node. Type a node id (Tab completes).')
  const exact = topology.nodes.find((node) => node.id === token)
  if (exact) return exact.id
  const lower = token.toLowerCase()
  const loose = topology.nodes.filter(
    (node) => node.id.toLowerCase() === lower || node.label?.toLowerCase() === lower
  )
  if (loose.length === 1) return loose[0].id
  const prefixed = topology.nodes.filter((node) => node.id.toLowerCase().startsWith(lower))
  if (prefixed.length === 1) return prefixed[0].id
  if (prefixed.length > 1) {
    throw new CommandError(
      `'${token}' matches several nodes: ${prefixed.map((node) => node.id).join(', ')}.`
    )
  }
  throw new CommandError(`No node '${token}'. 'show nodes' lists them.`)
}

export function requireNode(topology: TopologyJSON, nodeId: string): ComponentNode {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new CommandError(`Node '${nodeId}' is no longer in the topology.`)
  return node
}

/** The node the context is scoped to. */
export function contextNode(scope: CommandScope): { topology: TopologyJSON; node: ComponentNode } {
  const topology = requireTopology(scope)
  if (!scope.ctx.nodeId) throw new CommandError('No node selected. Use select <nodeId>.')
  return { topology, node: requireNode(topology, scope.ctx.nodeId) }
}

export interface NodeInterface {
  /** 1-based, stable for a given topology: outbound edges first, then inbound, each by edge id. */
  index: number
  direction: 'out' | 'in'
  edge: EdgeDefinition
  peerId: string
}

/** A node's connections as an interface table (the engine's only notion of a "port"). */
export function nodeInterfaces(topology: TopologyJSON, nodeId: string): NodeInterface[] {
  const byId = (a: EdgeDefinition, b: EdgeDefinition): number => a.id.localeCompare(b.id)
  const outbound = topology.edges.filter((edge) => edge.source === nodeId).sort(byId)
  const inbound = topology.edges
    .filter((edge) => edge.target === nodeId && edge.source !== nodeId)
    .sort(byId)
  return [
    ...outbound.map((edge) => ({ direction: 'out' as const, edge, peerId: edge.target })),
    ...inbound.map((edge) => ({ direction: 'in' as const, edge, peerId: edge.source }))
  ].map((entry, index) => ({ ...entry, index: index + 1 }))
}

export function simState(scope: CommandScope): SimulationStateView | null {
  return scope.deps.sim?.state() ?? null
}

/** Final output of the last completed run, or a CommandError saying how to get one. */
export function requireResults(scope: CommandScope, what = 'This command'): SimulationOutput {
  const state = simState(scope)
  if (state?.results) return state.results
  if (state?.status === 'running' || state?.status === 'paused') {
    throw new CommandError(
      `${what} reads the final run output, which exists once the run completes. ` +
        `While it runs, use 'show status', 'status' or 'show node <id>'.`
    )
  }
  throw new CommandError(`${what} needs a completed run. Type 'run' first.`)
}

export type NodeLive = TimeSeriesSnapshot['node'][string]

/**
 * Latest per-node state: the live snapshot while a run is in progress, the last
 * snapshot of the finished run otherwise. Null when nothing has run.
 */
export function latestSnapshot(
  scope: CommandScope
): { snapshot: TimeSeriesSnapshot; source: 'live' | 'final' } | null {
  const state = simState(scope)
  if (!state) return null
  if ((state.status === 'running' || state.status === 'paused') && state.snapshot) {
    return { snapshot: state.snapshot, source: 'live' }
  }
  const series = state.results?.timeSeries
  if (series && series.length > 0) return { snapshot: series[series.length - 1], source: 'final' }
  if (state.snapshot) return { snapshot: state.snapshot, source: 'live' }
  return null
}

export function isRunActive(scope: CommandScope): boolean {
  const status = simState(scope)?.status
  return status === 'running' || status === 'paused'
}

/** The run results only when they describe the current topology's node. */
export function resultsFor(scope: CommandScope): SimulationOutput | null {
  return simState(scope)?.results ?? null
}

export function microsToMs(value: string | number): number {
  return Number(value) / 1000
}

export function withContext(
  ctx: TerminalContext,
  patch: Partial<TerminalContext>
): TerminalContext {
  return { ...ctx, ...patch }
}

/** Run seconds after warmup (rate basis), never zero. */
export function postWarmupSeconds(results: SimulationOutput): number {
  return Math.max(results.summary.postWarmupDurationSec, 1e-9)
}
