import type { Edge, Node } from 'reactflow'
import type { EdgeDefinition } from '../../../engine/core/types'
import { getComponentSpec } from '../../../engine/catalog/componentSpecs'
import { getPaletteTemplate } from '../../../engine/catalog/paletteTemplates'
import type { AnyNodeData, NodeSimulationMetrics } from '@renderer/types/ui'
import type { RoutingVisualizationTarget } from './routingStrategyVisualization'

type EdgeDataRecord = Record<string, unknown>

function asRecord(value: unknown): EdgeDataRecord {
  return value && typeof value === 'object' ? (value as EdgeDataRecord) : {}
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }

  return undefined
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }

  return undefined
}

function asEdgeMode(value: unknown): EdgeDefinition['mode'] | undefined {
  if (
    value === 'synchronous' ||
    value === 'asynchronous' ||
    value === 'streaming' ||
    value === 'conditional'
  ) {
    return value
  }

  return undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function nodeLabel(node: Node | undefined, fallback: string): string {
  const data = node?.data as Partial<AnyNodeData> | undefined
  return data?.label || fallback
}

function edgeLabel(edge: Edge, fallback: string): string {
  return typeof edge.label === 'string' && edge.label.trim().length > 0
    ? edge.label.trim()
    : fallback
}

function inferEdgeMode(edgeData: EdgeDataRecord, targetData: AnyNodeData | undefined) {
  const explicitMode = asEdgeMode(edgeData.mode)
  if (explicitMode) return explicitMode

  const targetTemplate = getPaletteTemplate(targetData?.templateId)
  const targetSpec = getComponentSpec(targetData?.componentType)
  return targetTemplate?.asyncBoundary || targetSpec?.asyncBoundary ? 'asynchronous' : 'synchronous'
}

function edgeSuccessRatio(edgeData: EdgeDataRecord): number {
  const loss = clamp((readNumber(edgeData.packetLossRate) ?? 0) / 100, 0, 1)
  const error = clamp((readNumber(edgeData.errorRate) ?? 0) / 100, 0, 1)
  return (1 - loss) * (1 - error)
}

function isTargetHealthy(
  targetData: AnyNodeData | undefined,
  targetMetrics: NodeSimulationMetrics | undefined,
  edgeData: EdgeDataRecord
): boolean {
  const configuredNodeError = targetData?.sim?.nodeErrorRate ?? 0
  if (configuredNodeError >= 1) return false
  if (targetData?.ui?.overloadPreview) return false
  if (targetMetrics?.active === false) return false
  return edgeSuccessRatio(edgeData) > 0
}

function metricInFlight(metrics: NodeSimulationMetrics | undefined): number {
  if (!metrics) return 0
  if (
    typeof metrics.postWarmupInFlight === 'number' &&
    Number.isFinite(metrics.postWarmupInFlight)
  ) {
    return Math.max(0, Math.round(metrics.postWarmupInFlight))
  }

  if (typeof metrics.queueDepth === 'number' && Number.isFinite(metrics.queueDepth)) {
    return Math.max(0, Math.round(metrics.queueDepth))
  }

  if (typeof metrics.utilization === 'number' && Number.isFinite(metrics.utilization)) {
    return Math.max(0, Math.round(metrics.utilization / 10))
  }

  return 0
}

export function compactText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value
}

export function readableRouteName(target: RoutingVisualizationTarget): string {
  const nodeName = target.nodeLabel ?? target.label
  const nodeId = target.nodeId ? ` (${target.nodeId})` : ''
  const edgeName = target.edgeLabel ?? target.edgeId ?? target.id
  const edgeId =
    target.edgeId && target.edgeId !== target.edgeLabel && target.edgeId !== edgeName
      ? ` (${target.edgeId})`
      : ''

  return `${edgeName}${edgeId} -> ${nodeName}${nodeId}`
}

export function compactRouteName(target: RoutingVisualizationTarget): string {
  const nodeName = target.nodeLabel ?? target.label
  const edgeName = target.edgeLabel ?? target.edgeId ?? target.id
  return `${compactText(edgeName, 18)} -> ${compactText(nodeName, 18)}`
}

export function buildRoutingVisualizationTargets({
  sourceNodeId,
  edges,
  nodes,
  metricsByNode
}: {
  sourceNodeId: string
  edges: Edge[]
  nodes: Node[]
  metricsByNode: Record<string, NodeSimulationMetrics>
}): RoutingVisualizationTarget[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  return edges
    .filter((edge) => edge.source === sourceNodeId)
    .map((edge, index) => {
      const targetNode = nodeById.get(edge.target)
      const targetData = targetNode?.data as AnyNodeData | undefined
      const edgeData = asRecord(edge.data)
      const targetMetrics = metricsByNode[edge.target]
      const routeId = edge.id || `${sourceNodeId}->${edge.target}:${index}`
      const targetLabel = nodeLabel(targetNode, edge.target)
      const routeEdgeLabel = edgeLabel(edge, routeId)
      const weight = readNumber(
        edgeData.weight,
        edgeData.routingWeight,
        edgeData.trafficWeight,
        (edge as unknown as { weight?: unknown }).weight,
        1
      )

      return {
        id: routeId,
        label: targetLabel,
        nodeId: edge.target,
        nodeLabel: targetLabel,
        edgeId: routeId,
        edgeLabel: routeEdgeLabel,
        weight: weight && weight > 0 ? weight : 1,
        inFlight: metricInFlight(targetMetrics),
        healthy: isTargetHealthy(targetData, targetMetrics, edgeData),
        condition: readString(edgeData.condition),
        mode: inferEdgeMode(edgeData, targetData),
        successRatio: edgeSuccessRatio(edgeData)
      }
    })
}
