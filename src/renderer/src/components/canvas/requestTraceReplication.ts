import type { Edge } from 'reactflow'
import type { RequestOutcomeRecord } from '../../../../engine/core/event-stream'
import type { AnyNodeData } from '@renderer/types/ui'
import { getReplicationEdgePresentation } from './replicationEdgePresentation'

export function replicationEffectEdgeIds({
  record,
  visitedNodeIds,
  edges,
  nodes
}: {
  record: RequestOutcomeRecord
  visitedNodeIds: readonly string[]
  edges: readonly Edge[]
  nodes: readonly { id: string; data: unknown }[]
}): string[] {
  if (record.status !== 'success' || record.requestType?.toLowerCase() !== 'write') return []

  const nodeDataById = new Map(nodes.map((node) => [node.id, node.data as AnyNodeData | undefined]))
  const visited = new Set(visitedNodeIds)
  return edges.flatMap((edge) => {
    if (!visited.has(edge.source)) return []
    const presentation = getReplicationEdgePresentation(
      nodeDataById.get(edge.source),
      nodeDataById.get(edge.target)
    )
    return presentation ? [edge.id] : []
  })
}
