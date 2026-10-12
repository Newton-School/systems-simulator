/**
 * Which canvas a set of results belongs to (issue #184). The results tray must
 * only show results for the topology they were run on: when the canvas is
 * emptied or replaced by a different graph the results are discarded, and when
 * nodes or connections change they are flagged as describing the earlier graph.
 */

export interface RunGraphSnapshot {
  nodeIds: string[]
  edgeKeys: string[]
}

export type ResultsTopologyRelation = 'same' | 'edited' | 'replaced' | 'empty'

interface GraphNodeLike {
  id: string
}

interface GraphEdgeLike {
  source: string
  target: string
}

function edgeKey(edge: GraphEdgeLike): string {
  return `${edge.source}->${edge.target}`
}

export function snapshotRunGraph(
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[]
): RunGraphSnapshot {
  return {
    nodeIds: nodes.map((node) => node.id).sort(),
    edgeKeys: edges.map(edgeKey).sort()
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
    current.edgeKeys.every((key, i) => key === run.edgeKeys[i])
  return same ? 'same' : 'edited'
}
