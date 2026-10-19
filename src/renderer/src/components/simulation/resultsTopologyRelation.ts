/**
 * Which canvas a set of results belongs to (issue #184). The results tray must
 * only show results for the topology they were run on: when the canvas is
 * emptied or replaced by a different graph the results are discarded, and when
 * nodes or connections change they are flagged as describing the earlier graph.
 */

export interface RunGraphSnapshot {
  nodeIds: string[]
  edgeKeys: string[]
  /** `id:rate` for every node with an injected failure, so changing one makes the results stale. */
  failureKeys: string[]
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

function failureKey(node: GraphNodeLike): string | null {
  const rate = (node.data as { sim?: { nodeErrorRate?: unknown } } | undefined)?.sim?.nodeErrorRate
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? `${node.id}:${rate}` : null
}

export function snapshotRunGraph(
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[]
): RunGraphSnapshot {
  return {
    nodeIds: nodes.map((node) => node.id).sort(),
    edgeKeys: edges.map(edgeKey).sort(),
    failureKeys: nodes
      .map(failureKey)
      .filter((key): key is string => key !== null)
      .sort()
  }
}

export function compareRunGraph(
  run: RunGraphSnapshot,
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[]
): ResultsTopologyRelation {
  if (nodes.length === 0) {
    return 'empty'
  }
  const runNodeIds = new Set(run.nodeIds)
  if (run.nodeIds.length > 0 && !nodes.some((node) => runNodeIds.has(node.id))) {
    return 'replaced'
  }
  const current = snapshotRunGraph(nodes, edges)
  const same =
    current.nodeIds.length === run.nodeIds.length &&
    current.edgeKeys.length === run.edgeKeys.length &&
    current.nodeIds.every((id, i) => id === run.nodeIds[i]) &&
    current.edgeKeys.every((key, i) => key === run.edgeKeys[i]) &&
    current.failureKeys.length === run.failureKeys.length &&
    current.failureKeys.every((key, i) => key === run.failureKeys[i])
  return same ? 'same' : 'edited'
}
