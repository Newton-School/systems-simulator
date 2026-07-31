import type { Edge, Node } from 'reactflow'
import type { RoutingStrategyVisualizationState, EdgeFlowState } from '@renderer/store/useStore'
import type { NodeSimulationMetrics } from '@renderer/types/ui'
import { buildRoutingVisualizationTargets } from './routingStrategyGraph'
import { createRoutingVisualizationFrames } from './routingStrategyVisualization'

export interface RoutingPreviewSnapshot {
  sourceNodeId: string
  countsByEdgeId: Record<string, number>
  targetEdgeIds: Set<string>
  requestCount: number
  totalCount: number
  maxCount: number
}

interface RoutingPreviewSnapshotInput {
  routingVisualization: RoutingStrategyVisualizationState
  nodes: Node[]
  edges: Edge[]
  metricsByNode: Record<string, NodeSimulationMetrics>
  edgeFlowById: Record<string, EdgeFlowState>
  decisionSampleLimit: number
}

interface RoutingPreviewCache {
  input: RoutingPreviewSnapshotInput
  snapshot: RoutingPreviewSnapshot
}

let lastPreviewCache: RoutingPreviewCache | null = null

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

function getRoutingPreviewRequestCount({
  sourceNodeId,
  targetEdgeIds,
  metricsByNode,
  edgeFlowById
}: {
  sourceNodeId: string
  targetEdgeIds: string[]
  metricsByNode: Record<string, NodeSimulationMetrics>
  edgeFlowById: Record<string, EdgeFlowState>
}): number {
  const sourceMetrics = metricsByNode[sourceNodeId]
  const processed = finiteCount(sourceMetrics?.postWarmupProcessed)
  if (processed && processed > 0) return processed

  const outgoingAttempted = targetEdgeIds.reduce(
    (sum, edgeId) => sum + (edgeFlowById[edgeId]?.totalAttempted ?? 0),
    0
  )
  if (outgoingAttempted > 0) return Math.round(outgoingAttempted)

  const arrived = finiteCount(sourceMetrics?.postWarmupArrived)
  if (arrived && arrived > 0) return arrived

  return processed ?? arrived ?? 0
}

function isSamePreviewInput(
  previous: RoutingPreviewSnapshotInput,
  next: RoutingPreviewSnapshotInput
): boolean {
  return (
    previous.routingVisualization.sourceNodeId === next.routingVisualization.sourceNodeId &&
    previous.routingVisualization.strategy === next.routingVisualization.strategy &&
    previous.nodes === next.nodes &&
    previous.edges === next.edges &&
    previous.metricsByNode === next.metricsByNode &&
    previous.edgeFlowById === next.edgeFlowById &&
    previous.decisionSampleLimit === next.decisionSampleLimit
  )
}

export function getRoutingPreviewSnapshot(
  input: RoutingPreviewSnapshotInput
): RoutingPreviewSnapshot {
  if (lastPreviewCache && isSamePreviewInput(lastPreviewCache.input, input)) {
    return lastPreviewCache.snapshot
  }

  const { routingVisualization, nodes, edges, metricsByNode, edgeFlowById, decisionSampleLimit } =
    input
  const targets = buildRoutingVisualizationTargets({
    sourceNodeId: routingVisualization.sourceNodeId,
    edges,
    nodes,
    metricsByNode
  })
  const targetEdgeIds = targets.map((target) => target.id)
  const requestCount = getRoutingPreviewRequestCount({
    sourceNodeId: routingVisualization.sourceNodeId,
    targetEdgeIds,
    metricsByNode,
    edgeFlowById
  })
  const preview = createRoutingVisualizationFrames({
    strategy: routingVisualization.strategy,
    targets,
    requestCount,
    decisionSampleLimit
  })
  const totalCount = Object.values(preview.finalCounts).reduce((sum, count) => sum + count, 0)

  const snapshot = {
    sourceNodeId: routingVisualization.sourceNodeId,
    countsByEdgeId: preview.finalCounts,
    targetEdgeIds: new Set(targetEdgeIds),
    requestCount,
    totalCount,
    maxCount: Math.max(1, ...Object.values(preview.finalCounts))
  }

  lastPreviewCache = { input, snapshot }
  return snapshot
}
