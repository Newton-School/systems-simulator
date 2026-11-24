import type { Node } from 'reactflow'
import { findReplicationGroups, type GroupNodeLike } from './replicationClusterGroups'

/**
 * Display-only: hides every follower of each replication group so the group
 * reads as one cluster at its leader. The stored topology is untouched, and
 * edges to a hidden node are hidden by the caller.
 */
export function collapseReplicationClusters(
  nodes: readonly Node[],
  collapsed: boolean
): { nodes: Node[]; hiddenIds: ReadonlySet<string> } {
  if (!collapsed) return { nodes: nodes as Node[], hiddenIds: new Set() }
  const hidden = new Set<string>()
  for (const group of findReplicationGroups(nodes as readonly GroupNodeLike[])) {
    for (const id of group.memberIds) if (id !== group.leaderId) hidden.add(id)
  }
  if (hidden.size === 0) return { nodes: nodes as Node[], hiddenIds: hidden }
  return {
    nodes: nodes.map((node) => (hidden.has(node.id) ? { ...node, hidden: true } : node)),
    hiddenIds: hidden
  }
}
