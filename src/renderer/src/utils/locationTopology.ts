import type { Edge, Node } from 'reactflow'
import type { PerEdgeMetrics, PerNodeMetrics } from '../../../engine/metrics'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import type { EdgeSimulationData } from '@renderer/types/ui'

export type LocationLevel = 'region' | 'az' | 'subnet'
export type EdgePathType = NonNullable<EdgeSimulationData['pathType']>

type ContainerLocation = Partial<Record<LocationLevel, string>>

const CONTAINER_LEVEL_BY_TEMPLATE: Record<string, LocationLevel> = {
  'vpc-region': 'region',
  'availability-zone': 'az',
  subnet: 'subnet'
}

const EDGE_PATH_TYPES = new Set<EdgePathType>([
  'same-rack',
  'same-dc',
  'cross-zone',
  'cross-region',
  'internet'
])

function asCanvasNodeData(data: unknown): Partial<CanvasNodeDataV2> {
  return typeof data === 'object' && data !== null ? (data as Partial<CanvasNodeDataV2>) : {}
}

function cleanLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function asEdgePathType(value: unknown): EdgePathType | undefined {
  return typeof value === 'string' && EDGE_PATH_TYPES.has(value as EdgePathType)
    ? (value as EdgePathType)
    : undefined
}

function parentLevel(node: { data?: unknown }): LocationLevel | undefined {
  const templateId = asCanvasNodeData(node.data).templateId
  return typeof templateId === 'string' ? CONTAINER_LEVEL_BY_TEMPLATE[templateId] : undefined
}

function containerDisplayName(node: { id: string; data?: unknown }): string {
  const data = asCanvasNodeData(node.data)
  return cleanLabel(data.sim?.locationId) ?? cleanLabel(data.label) ?? node.id
}

export interface ContainerPathResolution {
  pathType: EdgePathType
  regionPair?: readonly [string, string]
}

export interface NodeLocationSummary {
  nodeId: string
  regionId?: string
  azId?: string
  subnetId?: string
  regionLabel?: string
  azLabel?: string
  subnetLabel?: string
}

export interface LocationTopology {
  containerLocations: Map<string, ContainerLocation>
  containerLevelById: Map<string, LocationLevel>
  containerLabelById: Map<string, string>
  nodeLocations: Map<string, NodeLocationSummary>
}

export function buildContainerLocations(
  rfNodes: readonly { id: string; parentNode?: string; data?: unknown }[]
): Map<string, ContainerLocation> {
  const byId = new Map(rfNodes.map((node) => [node.id, node]))
  const locations = new Map<string, ContainerLocation>()

  for (const node of rfNodes) {
    const location: ContainerLocation = {}
    const seen = new Set<string>()
    let parentId = node.parentNode

    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      const level = parentLevel(parent)
      if (level && !location[level]) location[level] = parent.id
      parentId = parent.parentNode
    }

    locations.set(node.id, location)
  }

  return locations
}

export function pathTypeFromContainers(
  locations: Map<string, ContainerLocation>,
  source: string,
  target: string
): ContainerPathResolution | null {
  const a = locations.get(source)
  const b = locations.get(target)
  if (!a || !b) return null
  if (a.subnet && a.subnet === b.subnet) return { pathType: 'same-rack' }
  if (a.az && a.az === b.az) return { pathType: 'same-dc' }
  if (a.region && a.region === b.region) return { pathType: 'cross-zone' }
  if (a.region && b.region && a.region !== b.region) {
    return { pathType: 'cross-region', regionPair: [a.region, b.region] }
  }
  return null
}

export function buildLocationTopology(
  rfNodes: readonly Pick<Node, 'id' | 'parentNode' | 'data'>[]
): LocationTopology {
  const containerLevelById = new Map<string, LocationLevel>()
  const containerLabelById = new Map<string, string>()

  for (const node of rfNodes) {
    const level = parentLevel(node)
    if (!level) continue
    containerLevelById.set(node.id, level)
    containerLabelById.set(node.id, containerDisplayName(node))
  }

  const containerLocations = buildContainerLocations(rfNodes)
  const nodeLocations = new Map<string, NodeLocationSummary>()

  for (const node of rfNodes) {
    const location = containerLocations.get(node.id) ?? {}
    nodeLocations.set(node.id, {
      nodeId: node.id,
      regionId: location.region,
      azId: location.az,
      subnetId: location.subnet,
      regionLabel: location.region ? containerLabelById.get(location.region) : undefined,
      azLabel: location.az ? containerLabelById.get(location.az) : undefined,
      subnetLabel: location.subnet ? containerLabelById.get(location.subnet) : undefined
    })
  }

  return {
    containerLocations,
    containerLevelById,
    containerLabelById,
    nodeLocations
  }
}

export function formatNodeLocation(meta?: NodeLocationSummary | null): string | null {
  if (!meta) return null
  const labels = [meta.regionLabel, meta.azLabel, meta.subnetLabel].filter(
    (value): value is string => Boolean(value)
  )
  return labels.length > 0 ? labels.join(' / ') : null
}

export interface EdgeLocalityDescriptor {
  pathType?: EdgePathType
  scopeLabel?: string
  detailLabel?: string
}

export function describeEdgeLocality(
  topology: LocationTopology,
  edge: Pick<Edge, 'source' | 'target' | 'data'>
): EdgeLocalityDescriptor {
  const explicitPathType = asEdgePathType((edge.data as EdgeSimulationData | undefined)?.pathType)
  const derived = explicitPathType
    ? { pathType: explicitPathType }
    : pathTypeFromContainers(topology.containerLocations, edge.source, edge.target) ?? undefined
  if (!derived) return {}

  const sourceMeta = topology.nodeLocations.get(edge.source)
  const targetMeta = topology.nodeLocations.get(edge.target)

  switch (derived.pathType) {
    case 'same-rack': {
      const label = sourceMeta?.subnetLabel ?? targetMeta?.subnetLabel
      return { pathType: derived.pathType, scopeLabel: label, detailLabel: label }
    }
    case 'same-dc': {
      const label = sourceMeta?.azLabel ?? targetMeta?.azLabel
      return { pathType: derived.pathType, scopeLabel: label, detailLabel: label }
    }
    case 'cross-zone': {
      const sourceLabel = sourceMeta?.azLabel
      const targetLabel = targetMeta?.azLabel
      const detailLabel =
        sourceLabel && targetLabel && sourceLabel !== targetLabel
          ? `${sourceLabel} -> ${targetLabel}`
          : sourceMeta?.regionLabel ?? targetMeta?.regionLabel
      return {
        pathType: derived.pathType,
        scopeLabel: sourceMeta?.regionLabel ?? targetMeta?.regionLabel,
        detailLabel
      }
    }
    case 'cross-region': {
      const sourceLabel = sourceMeta?.regionLabel
      const targetLabel = targetMeta?.regionLabel
      const detailLabel =
        sourceLabel && targetLabel ? `${sourceLabel} -> ${targetLabel}` : sourceLabel ?? targetLabel
      return {
        pathType: derived.pathType,
        scopeLabel: detailLabel,
        detailLabel
      }
    }
    case 'internet':
      return { pathType: derived.pathType, scopeLabel: 'internet', detailLabel: 'internet' }
  }
}

export interface NodeRollupInput {
  nodeId: string
  postWarmupArrived: number
  postWarmupProcessed: number
  totalFailures: number
  throughput: number
  utilization?: number | null
  p95?: number | null
  active: boolean
  isSource?: boolean
}

export interface NodeLocationRollup {
  level: LocationLevel
  containerId: string
  label: string
  nodeCount: number
  activeNodeCount: number
  sourceCount: number
  totalArrived: number
  totalProcessed: number
  totalFailures: number
  totalThroughput: number
  errorRate: number | null
  avgUtilization: number | null
  worstP95: number | null
}

export type NodeLocationRollups = Record<LocationLevel, NodeLocationRollup[]>

export function buildNodeLocationRollups(
  topology: LocationTopology,
  inputs: readonly NodeRollupInput[]
): NodeLocationRollups {
  const grouped = new Map<string, NodeLocationRollup & { utilizationSum: number; utilizationCount: number }>()

  for (const input of inputs) {
    const location = topology.nodeLocations.get(input.nodeId)
    if (!location) continue

    for (const level of ['region', 'az', 'subnet'] as const) {
      const containerId = location[`${level}Id`]
      const label = location[`${level}Label`]
      if (!containerId || !label) continue

      const key = `${level}:${containerId}`
      const current =
        grouped.get(key) ??
        {
          level,
          containerId,
          label,
          nodeCount: 0,
          activeNodeCount: 0,
          sourceCount: 0,
          totalArrived: 0,
          totalProcessed: 0,
          totalFailures: 0,
          totalThroughput: 0,
          errorRate: null,
          avgUtilization: null,
          worstP95: null,
          utilizationSum: 0,
          utilizationCount: 0
        }

      current.nodeCount += 1
      if (input.active) current.activeNodeCount += 1
      if (input.isSource) current.sourceCount += 1
      current.totalArrived += input.postWarmupArrived
      current.totalProcessed += input.postWarmupProcessed
      current.totalFailures += input.totalFailures
      current.totalThroughput += input.throughput
      if (typeof input.utilization === 'number' && Number.isFinite(input.utilization)) {
        current.utilizationSum += input.utilization
        current.utilizationCount += 1
      }
      if (typeof input.p95 === 'number' && Number.isFinite(input.p95)) {
        current.worstP95 =
          current.worstP95 === null ? input.p95 : Math.max(current.worstP95, input.p95)
      }

      grouped.set(key, current)
    }
  }

  const toArray = (level: LocationLevel): NodeLocationRollup[] =>
    [...grouped.values()]
      .filter((rollup) => rollup.level === level)
      .map(({ utilizationSum, utilizationCount, ...rollup }) => ({
        ...rollup,
        errorRate: rollup.totalArrived > 0 ? rollup.totalFailures / rollup.totalArrived : null,
        avgUtilization: utilizationCount > 0 ? utilizationSum / utilizationCount : null
      }))
      .sort(
        (a, b) =>
          b.totalArrived - a.totalArrived ||
          b.totalThroughput - a.totalThroughput ||
          a.label.localeCompare(b.label)
      )

  return {
    region: toArray('region'),
    az: toArray('az'),
    subnet: toArray('subnet')
  }
}

export interface EdgeRollupInput {
  edgeId: string
  source: string
  target: string
  data?: unknown
  attempts: number
  failures: number
  p95?: number | null
}

export interface EdgeLocalityRollup {
  key: string
  pathType: EdgePathType
  label: string
  edgeCount: number
  attempts: number
  failures: number
  errorRate: number | null
  worstP95: number | null
}

export function buildEdgeLocalityRollups(
  topology: LocationTopology,
  inputs: readonly EdgeRollupInput[]
): EdgeLocalityRollup[] {
  const grouped = new Map<string, EdgeLocalityRollup>()

  for (const input of inputs) {
    const locality = describeEdgeLocality(topology, input)
    if (!locality.pathType) continue
    const label = locality.detailLabel ?? locality.scopeLabel ?? locality.pathType
    const key = `${locality.pathType}:${label}`
    const current =
      grouped.get(key) ??
      {
        key,
        pathType: locality.pathType,
        label,
        edgeCount: 0,
        attempts: 0,
        failures: 0,
        errorRate: null,
        worstP95: null
      }

    current.edgeCount += 1
    current.attempts += input.attempts
    current.failures += input.failures
    if (typeof input.p95 === 'number' && Number.isFinite(input.p95)) {
      current.worstP95 = current.worstP95 === null ? input.p95 : Math.max(current.worstP95, input.p95)
    }
    grouped.set(key, current)
  }

  return [...grouped.values()]
    .map((rollup) => ({
      ...rollup,
      errorRate: rollup.attempts > 0 ? rollup.failures / rollup.attempts : null
    }))
    .sort(
      (a, b) =>
        b.attempts - a.attempts || b.edgeCount - a.edgeCount || a.pathType.localeCompare(b.pathType)
    )
}

export function buildNodeRollupInputsFromResults(
  perNode: Record<string, PerNodeMetrics>,
  sourceNodeIds: ReadonlySet<string>
): NodeRollupInput[] {
  return Object.entries(perNode).map(([nodeId, metric]) => ({
    nodeId,
    postWarmupArrived: metric.postWarmupArrived,
    postWarmupProcessed: metric.postWarmupProcessed,
    totalFailures:
      metric.postWarmupRejected + metric.postWarmupTimedOut + metric.postWarmupConnectionReset,
    throughput: metric.throughput,
    utilization: metric.utilization,
    p95: metric.latencyNodeLocal.p95 ?? metric.latencyP95,
    active:
      metric.postWarmupArrived > 0 || metric.successLatencySamples > 0 || metric.timeToErrorSamples > 0,
    isSource: sourceNodeIds.has(nodeId)
  }))
}

export function buildEdgeRollupInputsFromResults(
  edges: readonly Pick<Edge, 'id' | 'source' | 'target' | 'data'>[],
  perEdge: Record<string, PerEdgeMetrics>
): EdgeRollupInput[] {
  const inputs: Array<EdgeRollupInput | null> = edges.map((edge) => {
      const metric = perEdge[edge.id]
      if (!metric) return null
      return {
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        data: edge.data,
        attempts: metric.totalSuccessfulTransits + metric.totalFailedTerminals,
        failures: metric.totalFailedTerminals,
        p95: metric.transitLatency.p95
      }
    })
  return inputs.filter((value): value is EdgeRollupInput => value !== null)
}
