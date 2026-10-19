/**
 * Which canvas a set of results belongs to (issue #184). The results tray must
 * only show results for the design they were run on: when the canvas is
 * emptied or replaced by a different graph the results are discarded, and when
 * nodes, connections or any node's settings change they are flagged as
 * describing the earlier design.
 */

export interface RunGraphSnapshot {
  nodeIds: string[]
  edgeKeys: string[]
  /** `id:settings` for every node, so editing any node's configuration makes the results stale. */
  configKeys: string[]
  /** The workload, failure injection and timing the run used, serialized. */
  scenarioKey: string
}

export type ResultsTopologyRelation = 'same' | 'edited' | 'replaced' | 'empty'

interface GraphNodeLike {
  id: string
  data?: unknown
}

interface GraphEdgeLike {
  source: string
  target: string
}

function edgeKey(edge: GraphEdgeLike): string {
  return `${edge.source}->${edge.target}`
}

// A node's data object keeps its identity until it is edited, so its serialized settings can be
// cached: dragging nodes around recomputes this on every move.
const settingsCache = new WeakMap<object, string>()

function nodeSettings(node: GraphNodeLike): string {
  const data = node.data
  if (typeof data !== 'object' || data === null) return ''
  const cached = settingsCache.get(data)
  if (cached !== undefined) return cached
  const sim = (data as { sim?: unknown }).sim
  let serialized = ''
  try {
    serialized = sim === undefined ? '' : JSON.stringify(sim)
  } catch {
    serialized = ''
  }
  settingsCache.set(data, serialized)
  return serialized
}

function scenarioKeyOf(scenario: unknown): string {
  if (scenario === undefined) return ''
  try {
    return JSON.stringify(scenario) ?? ''
  } catch {
    return ''
  }
}

export function snapshotRunGraph(
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[],
  scenario?: unknown
): RunGraphSnapshot {
  return {
    nodeIds: nodes.map((node) => node.id).sort(),
    edgeKeys: edges.map(edgeKey).sort(),
    configKeys: nodes.map((node) => `${node.id}:${nodeSettings(node)}`).sort(),
    scenarioKey: scenarioKeyOf(scenario)
  }
}

export function compareRunGraph(
  run: RunGraphSnapshot,
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[],
  scenario?: unknown
): ResultsTopologyRelation {
  if (nodes.length === 0) {
    return 'empty'
  }
  const runNodeIds = new Set(run.nodeIds)
  if (run.nodeIds.length > 0 && !nodes.some((node) => runNodeIds.has(node.id))) {
    return 'replaced'
  }
  const current = snapshotRunGraph(nodes, edges, scenario)
  const same =
    current.nodeIds.length === run.nodeIds.length &&
    current.edgeKeys.length === run.edgeKeys.length &&
    current.nodeIds.every((id, i) => id === run.nodeIds[i]) &&
    current.edgeKeys.every((key, i) => key === run.edgeKeys[i]) &&
    current.configKeys.length === run.configKeys.length &&
    current.configKeys.every((key, i) => key === run.configKeys[i]) &&
    current.scenarioKey === run.scenarioKey
  return same ? 'same' : 'edited'
}
