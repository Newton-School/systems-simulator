/**
 * Single-point-of-failure (SPOF) detection.
 *
 * A **single point of failure** is a component whose loss disconnects the
 * traffic source(s) from part of the system — nothing else can carry that
 * traffic. This is pure topology analysis (no simulation run needed): for each
 * node we remove it from the graph and check whether anything that *was*
 * reachable from a source becomes unreachable.
 *
 * A structurally-critical node is only a *true* SPOF when it is not internally
 * redundant — i.e. it runs fewer than 2 instances. A node running ≥2 instances
 * survives the loss of any single instance, and a critical node that has a
 * redundant sibling on an alternate path is never flagged, because the
 * reachability re-check still reaches the orphaned set through the sibling.
 *
 * This correctly flags the classic cases: a lone load balancer (the cut vertex
 * in front of N healthy servers), a single database with no replica, a
 * single-instance service tier.
 */

import { inferStructuralRole } from '../catalog/componentSpecs'
import {
  getInstanceCount,
  type ComponentNode,
  type ComponentType,
  type TopologyJSON
} from '../core/types'

export interface SpofFinding {
  /** The id of the single-point-of-failure node. */
  nodeId: string
  /** Human-readable label for the node (falls back to id). */
  nodeLabel: string
  /** The node's component type. */
  nodeType: ComponentType
  /** How many instances it runs (a SPOF always has < 2). */
  instanceCount: number
  /** Labels of the nodes that become unreachable from every source if this node is lost. */
  orphansIfLost: string[]
  /** Plain-English explanation of why this is a SPOF and how to fix it. */
  reason: string
}

function resolvedRole(node: ComponentNode): ComponentNode['role'] | undefined {
  if (node.role) {
    return node.role
  }
  const inferred = inferStructuralRole(node.type)
  return inferred === 'composite' ? undefined : inferred
}

function sourceNodeIds(topology: TopologyJSON): string[] {
  const ids = new Set<string>()
  for (const node of topology.nodes) {
    if (resolvedRole(node) === 'source') {
      ids.add(node.id)
    }
  }
  const workloadSource = topology.workload?.sourceNodeId
  if (typeof workloadSource === 'string' && workloadSource.length > 0) {
    ids.add(workloadSource)
  }
  return [...ids]
}

/** Directed adjacency, optionally excluding one node (both as a vertex and from any edge). */
function directedAdjacency(topology: TopologyJSON, exclude?: string): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const node of topology.nodes) {
    if (node.id !== exclude) {
      adjacency.set(node.id, [])
    }
  }
  for (const edge of topology.edges) {
    if (edge.source === exclude || edge.target === exclude) {
      continue
    }
    adjacency.get(edge.source)?.push(edge.target)
  }
  return adjacency
}

function collectReachable(
  starts: readonly string[],
  adjacency: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>()
  const queue = [...starts]
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]
    if (visited.has(current) || !adjacency.has(current)) {
      continue
    }
    visited.add(current)
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor)
      }
    }
  }
  return visited
}

/**
 * Returns every true single point of failure in the topology, in a stable order
 * (most downstream impact first, then by node id). Empty when the design is
 * adequately redundant, or when there is no traffic source to reason from.
 */
export function detectSinglePointsOfFailure(topology: TopologyJSON): SpofFinding[] {
  const sources = sourceNodeIds(topology)
  if (sources.length === 0 || topology.nodes.length <= 1) {
    return []
  }

  const labelById = new Map(topology.nodes.map((n) => [n.id, n.label ?? n.id]))
  const baseReachable = collectReachable(sources, directedAdjacency(topology))
  const findings: SpofFinding[] = []

  for (const node of topology.nodes) {
    // A source is the entry point, not a design SPOF; skip it.
    if (sources.includes(node.id)) {
      continue
    }
    // Only nodes that actually carry traffic can orphan anything.
    if (!baseReachable.has(node.id)) {
      continue
    }

    const instanceCount = getInstanceCount(node.resources)
    if (instanceCount >= 2) {
      continue // internally redundant — surviving instances carry the traffic
    }

    const withoutNode = collectReachable(sources, directedAdjacency(topology, node.id))
    const orphaned = [...baseReachable].filter((id) => id !== node.id && !withoutNode.has(id))

    if (orphaned.length > 0) {
      // Cut-node SPOF: removing it disconnects other components from the source.
      const orphanLabels = orphaned.map((id) => labelById.get(id) ?? id).sort()
      findings.push({
        nodeId: node.id,
        nodeLabel: labelById.get(node.id) ?? node.id,
        nodeType: node.type,
        instanceCount,
        orphansIfLost: orphanLabels,
        reason:
          `Runs a single instance and is the only path to ${orphanLabels.length} downstream ` +
          `component${orphanLabels.length === 1 ? '' : 's'}. If it fails, ` +
          `${orphanLabels.join(', ')} become unreachable. Add a redundant instance or a peer on an alternate path.`
      })
      continue
    }

    // Critical-singleton-dependency SPOF: a terminal dependency (e.g. the only
    // database) that carries traffic, runs one instance, and has no peer of the
    // same type to fall back on. Losing it removes that capability entirely.
    const hasSameTypePeer = topology.nodes.some(
      (other) => other.id !== node.id && other.type === node.type
    )
    if (!hasSameTypePeer) {
      findings.push({
        nodeId: node.id,
        nodeLabel: labelById.get(node.id) ?? node.id,
        nodeType: node.type,
        instanceCount,
        orphansIfLost: [],
        reason:
          `The only ${node.type} in the design and it runs a single instance. If it fails, ` +
          `this capability is lost with no fallback. Add a replica/instance or a redundant peer.`
      })
    }
  }

  return findings.sort(
    (a, b) => b.orphansIfLost.length - a.orphansIfLost.length || a.nodeId.localeCompare(b.nodeId)
  )
}
