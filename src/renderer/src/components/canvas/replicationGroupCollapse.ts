import type { Edge } from 'reactflow'
import type { AnyNodeData } from '@renderer/types/ui'

type NodeLike = { id: string; selected?: boolean; data: unknown }

function isFollower(data: AnyNodeData | undefined): boolean {
  const role = data?.sim?.replicationRole
  return role === 'follower' || role === 'replica'
}

function isLeader(data: AnyNodeData | undefined): boolean {
  const role =
    data?.sim?.replicationRole ?? (data?.sim?.replicationEnabled === true ? 'leader' : undefined)
  return role === 'leader' || role === 'primary'
}

/**
 * Display-only: edges from one caller (e.g. an API server) to every member of a
 * replication group form a mesh. When a caller reaches the leader and at least
 * one follower, its follower edges can be hidden so the canvas reads as
 * "caller → cluster". The stored topology, routing and grading are untouched.
 *
 * Edges stay visible when selected or when either endpoint is selected.
 */
export function collapsibleReplicationEdgeIds(
  nodes: readonly NodeLike[],
  edges: readonly Edge[]
): string[] {
  const dataById = new Map(nodes.map((node) => [node.id, node.data as AnyNodeData | undefined]))
  const callersOfLeader = new Set<string>()
  for (const edge of edges) {
    const target = dataById.get(edge.target)
    const source = dataById.get(edge.source)
    if (isLeader(target) && !isLeader(source) && !isFollower(source)) {
      callersOfLeader.add(edge.source)
    }
  }
  return edges
    .filter(
      (edge) =>
        callersOfLeader.has(edge.source) &&
        isFollower(dataById.get(edge.target)) &&
        !isLeader(dataById.get(edge.source))
    )
    .map((edge) => edge.id)
}

export function applyReplicationGroupCollapse(
  nodes: readonly NodeLike[],
  edges: readonly Edge[],
  collapsed: boolean,
  showReplicationLinks = true
): { edges: Edge[]; hiddenCount: number; collapsibleCount: number } {
  const collapsible = new Set(collapsibleReplicationEdgeIds(nodes, edges))
  const dataById = new Map(nodes.map((node) => [node.id, node.data as AnyNodeData | undefined]))
  const replicationLinks = showReplicationLinks
    ? new Set<string>()
    : new Set(
        edges
          .filter(
            (edge) => isLeader(dataById.get(edge.source)) && isFollower(dataById.get(edge.target))
          )
          .map((edge) => edge.id)
      )
  if ((!collapsed || collapsible.size === 0) && replicationLinks.size === 0) {
    return { edges: edges as Edge[], hiddenCount: 0, collapsibleCount: collapsible.size }
  }
  const selectedNodes = new Set(nodes.filter((node) => node.selected).map((node) => node.id))
  let hiddenCount = 0
  const next = edges.map((edge) => {
    if (replicationLinks.has(edge.id)) {
      hiddenCount += 1
      return { ...edge, hidden: true }
    }
    if (
      !collapsed ||
      !collapsible.has(edge.id) ||
      edge.selected ||
      selectedNodes.has(edge.source) ||
      selectedNodes.has(edge.target)
    ) {
      return edge
    }
    hiddenCount += 1
    return { ...edge, hidden: true }
  })
  return { edges: next, hiddenCount, collapsibleCount: collapsible.size }
}
