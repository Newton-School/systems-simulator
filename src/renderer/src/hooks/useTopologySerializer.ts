import { useCallback } from 'react'
import type { Edge } from 'reactflow'
import type {
  BaseDistributionConfig,
  DistributionConfig,
  EdgeDefinition,
  GlobalConfig,
  TopologyJSON,
  WorkloadProfile
} from '../../../engine/core/types'
import { getComponentSpec } from '../../../engine/catalog/componentSpecs'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import { hasWorkloadSourceConfig } from '../../../engine/catalog/sourceNodeSemantics'
import { getPathTypeLatencyProfile, inferEdgeDefaults } from '../../../engine/defaults/edgeDefaults'
import { inferCanvasEdgeMode } from '@renderer/config/edgeSemantics'
import useStore from '../store/useStore'
import type { ScenarioRunContext, ScenarioState } from '@renderer/types/ui'
import { normalizeScenarioState } from '@renderer/types/ui'
import { mergeWorkloadDefaults } from '@renderer/utils/workloadDefaults'
import { isCanvasAnnotationNodeType } from '../../../engine/catalog/canvasAnnotations'

type EdgeRuntimeData = {
  protocol?: EdgeDefinition['protocol']
  mode?: EdgeDefinition['mode']
  latencyDistributionType?: 'log-normal' | 'constant'
  latencyValue?: number
  latencyMu?: number
  latencySigma?: number
  pathType?: EdgeDefinition['latency']['pathType']
  bandwidth?: number
  maxConcurrentRequests?: number
  packetLossRate?: number
  errorRate?: number
  condition?: string
  weight?: number
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function asPositiveInt(value: unknown): number | null {
  const normalized = asPositiveNumber(value)
  return normalized !== null ? Math.round(normalized) : null
}

function asProbabilityFromPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    return null
  }

  return value / 100
}

function normalizePercentToRatio(value: unknown, defaultPercent: number): number {
  return clamp(asProbabilityFromPercent(value) ?? defaultPercent / 100, 0, 1)
}

function asPathType(value: unknown): EdgeDefinition['latency']['pathType'] | null {
  if (
    value === 'same-rack' ||
    value === 'same-dc' ||
    value === 'cross-zone' ||
    value === 'cross-region' ||
    value === 'internet'
  ) {
    return value
  }
  return null
}

function asProtocol(value: unknown): EdgeDefinition['protocol'] | null {
  if (
    value === 'https' ||
    value === 'grpc' ||
    value === 'tcp' ||
    value === 'udp' ||
    value === 'websocket' ||
    value === 'amqp' ||
    value === 'kafka'
  ) {
    return value
  }
  return null
}

function asEdgeMode(value: unknown): EdgeDefinition['mode'] | null {
  if (
    value === 'synchronous' ||
    value === 'asynchronous' ||
    value === 'streaming' ||
    value === 'conditional'
  ) {
    return value
  }
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

type EdgeLatencyDistribution = Extract<BaseDistributionConfig, { type: 'constant' | 'log-normal' }>

export function resolveEdgeLatencyDistribution(
  edgeData: Pick<
    EdgeRuntimeData,
    'latencyDistributionType' | 'latencyValue' | 'latencyMu' | 'latencySigma'
  >,
  pathLatencyProfile: Extract<DistributionConfig, { type: 'log-normal' }>
): {
  distribution: EdgeLatencyDistribution
  derivedFromPathType: boolean
} {
  const explicitLatencyValue = asNonNegativeNumber(edgeData.latencyValue)
  const explicitLatencyMu = asFiniteNumber(edgeData.latencyMu)
  const explicitLatencySigma = asPositiveNumber(edgeData.latencySigma)
  const distributionType =
    edgeData.latencyDistributionType === 'constant'
      ? 'constant'
      : edgeData.latencyDistributionType === 'log-normal'
        ? 'log-normal'
        : explicitLatencyValue !== null &&
            explicitLatencyMu === null &&
            explicitLatencySigma === null
          ? 'constant'
          : 'log-normal'

  if (distributionType === 'constant') {
    return {
      distribution: {
        type: 'constant',
        value: explicitLatencyValue ?? Math.exp(pathLatencyProfile.mu)
      },
      derivedFromPathType: false
    }
  }

  const hasExplicitLogNormal = explicitLatencyMu !== null || explicitLatencySigma !== null
  return {
    distribution: {
      type: 'log-normal',
      mu: explicitLatencyMu ?? pathLatencyProfile.mu,
      sigma: explicitLatencySigma ?? pathLatencyProfile.sigma
    },
    derivedFromPathType: !hasExplicitLogNormal
  }
}

function buildScenarioGlobal(global: ScenarioState['global']): GlobalConfig {
  return {
    simulationDuration: global.simulationDuration,
    warmupDuration: global.warmupDuration,
    seed: global.seed,
    defaultTimeout: global.defaultTimeout,
    traceSampleRate: global.traceSampleRate,
    timeResolution: 'millisecond'
  }
}

type EdgePathType = EdgeDefinition['latency']['pathType']
type ContainerLocation = { region?: string; az?: string; subnet?: string }

const CONTAINER_LEVEL_BY_TEMPLATE: Record<string, keyof ContainerLocation> = {
  'vpc-region': 'region',
  'availability-zone': 'az',
  subnet: 'subnet'
}

/**
 * Maps each node to the Region/AZ/Subnet container ids it is nested inside, by
 * walking the React Flow parent chain. Composite containers are not simulated
 * themselves; this membership is what lets an edge's pathType be derived from
 * where its endpoints physically sit.
 */
export function buildContainerLocations(
  rfNodes: readonly { id: string; parentNode?: string; data?: unknown }[]
): Map<string, ContainerLocation> {
  const byId = new Map(rfNodes.map((node) => [node.id, node]))
  const levelOf = (node: { data?: unknown }): keyof ContainerLocation | undefined => {
    const templateId = (node.data as { templateId?: unknown } | undefined)?.templateId
    return typeof templateId === 'string' ? CONTAINER_LEVEL_BY_TEMPLATE[templateId] : undefined
  }

  const locations = new Map<string, ContainerLocation>()
  for (const node of rfNodes) {
    const location: ContainerLocation = {}
    let parentId = node.parentNode
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      const level = levelOf(parent)
      if (level && !location[level]) location[level] = parent.id
      parentId = parent.parentNode
    }
    locations.set(node.id, location)
  }
  return locations
}

export interface ContainerPathResolution {
  pathType: EdgePathType
  /**
   * For cross-region hops, the ordered [sourceRegion, targetRegion] container
   * ids. Populated so a future distance-aware model can look up a per-pair RTT
   * (e.g. us-east↔ap-south costs more than us-east↔us-west) without re-threading
   * the serializer. v1 ignores it — cross-region uses the flat profile.
   */
  regionPair?: readonly [string, string]
}

/**
 * Derives an edge's pathType from where its endpoints sit in the container
 * hierarchy: same subnet → same-rack, same AZ → same-dc, same region →
 * cross-zone, different region → cross-region. Returns null when membership
 * doesn't determine it (e.g. an endpoint outside all containers), leaving the
 * edge's existing/inferred pathType untouched.
 */
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

function serializeEdge(
  rfEdge: Edge,
  serializedNodeIds: Set<string>,
  dataByNodeId: Map<string, CanvasNodeDataV2>,
  containerPath: ContainerPathResolution | null
): EdgeDefinition | null {
  const { id, source, target } = rfEdge
  if (!serializedNodeIds.has(source) || !serializedNodeIds.has(target)) {
    return null
  }

  const targetData = dataByNodeId.get(target)
  const sourceData = dataByNodeId.get(source)
  const edgeData = (rfEdge.data ?? {}) as EdgeRuntimeData
  const inferredDefaults = inferEdgeDefaults(sourceData, targetData)
  // Priority: an explicit pathType the user set on the edge wins; otherwise the
  // location-derived pathType (Region/AZ/Subnet membership); otherwise the
  // generic inferred default. Explicit latency (mu/sigma/value) still overrides
  // inside resolveEdgeLatencyDistribution, so manual tuning is never lost.
  const pathType =
    asPathType(edgeData.pathType) ?? containerPath?.pathType ?? inferredDefaults.pathType
  const pathLatencyProfile = getPathTypeLatencyProfile(pathType)
  const { distribution, derivedFromPathType } = resolveEdgeLatencyDistribution(
    edgeData,
    pathLatencyProfile
  )

  const mode = inferCanvasEdgeMode(
    {
      mode: asEdgeMode(edgeData.mode) ?? undefined,
      protocol: asProtocol(edgeData.protocol) ?? undefined
    },
    targetData
  )

  return {
    id: id || `${source}->${target}`,
    source,
    target,
    label: typeof rfEdge.label === 'string' ? rfEdge.label : undefined,
    mode,
    protocol: asProtocol(edgeData.protocol) ?? inferredDefaults.protocol,
    latency: {
      distribution,
      pathType,
      derivedFromPathType
    },
    bandwidth: asPositiveNumber(edgeData.bandwidth) ?? inferredDefaults.bandwidth,
    maxConcurrentRequests:
      asPositiveInt(edgeData.maxConcurrentRequests) ?? inferredDefaults.maxConcurrentRequests,
    packetLossRate: normalizePercentToRatio(
      edgeData.packetLossRate,
      inferredDefaults.packetLossRatePercent
    ),
    errorRate: normalizePercentToRatio(edgeData.errorRate, inferredDefaults.errorRatePercent),
    condition:
      typeof edgeData.condition === 'string' && edgeData.condition.trim().length > 0
        ? edgeData.condition.trim()
        : undefined,
    weight: asPositiveNumber(edgeData.weight) ?? undefined
  }
}

export interface SerializerResult {
  topology: TopologyJSON | null
  errors: string[]
  runContext: ScenarioRunContext | null
}

export function useTopologySerializer() {
  const nodes = useStore((state) => state.nodes)
  const edges = useStore((state) => state.edges)
  const scenario = useStore((state) => state.scenario)

  const serialize = useCallback(
    (overrideScenario?: ScenarioState): SerializerResult => {
      const resolvedScenario = normalizeScenarioState(overrideScenario ?? scenario)

      const errors: string[] = []
      const engineNodes: TopologyJSON['nodes'] = []
      const dataByNodeId = new Map<string, CanvasNodeDataV2>()

      for (const rfNode of nodes) {
        if (isCanvasAnnotationNodeType(rfNode.type)) {
          continue
        }

        const data = rfNode.data as CanvasNodeDataV2
        dataByNodeId.set(rfNode.id, data)

        if (data.structuralRole === 'composite') {
          continue
        }

        const spec = getComponentSpec(data.componentType)
        if (!spec) {
          errors.push(`Node '${data.label || rfNode.id}' is missing a registered component spec.`)
          continue
        }

        const validationErrors = spec.validateCanvas(data)
        for (const error of validationErrors) {
          errors.push(`${data.label || rfNode.id}: ${error}`)
        }

        const serialized = spec.serializeCanvas(data, {
          nodeId: rfNode.id,
          position: rfNode.positionAbsolute ?? rfNode.position
        })

        if (serialized) {
          engineNodes.push(serialized)
        }
      }

      if (errors.length > 0) {
        return { topology: null, errors, runContext: null }
      }

      if (engineNodes.length === 0) {
        return {
          topology: null,
          errors: ['Canvas has no serializable nodes. Add components to run a simulation.'],
          runContext: null
        }
      }

      const sourceRfNodes = nodes.filter(
        (node) =>
          !isCanvasAnnotationNodeType(node.type) &&
          hasWorkloadSourceConfig(node.data as Partial<CanvasNodeDataV2>)
      )
      const selectedSourceRfNode =
        sourceRfNodes.find((node) => node.id === resolvedScenario.selectedSourceNodeId) ??
        sourceRfNodes[0]

      if (!selectedSourceRfNode) {
        return {
          topology: null,
          errors: [
            'Add at least one workload-configured entrypoint before running the simulation.'
          ],
          runContext: null
        }
      }

      const selectedSourceData = selectedSourceRfNode.data as CanvasNodeDataV2
      if (!selectedSourceData.source) {
        return {
          topology: null,
          errors: [`Source node '${selectedSourceData.label}' is missing workload configuration.`],
          runContext: null
        }
      }

      const workload: WorkloadProfile = {
        sourceNodeId: selectedSourceRfNode.id,
        requestDistribution: selectedSourceData.source.requestDistribution,
        ...mergeWorkloadDefaults(
          selectedSourceData.source.defaultWorkload,
          resolvedScenario.workloadOverride
        )
      }

      const serializedNodeIds = new Set(engineNodes.map((node) => node.id))
      const containerLocations = buildContainerLocations(nodes)
      const engineEdges = edges
        .map((edge) =>
          serializeEdge(
            edge,
            serializedNodeIds,
            dataByNodeId,
            pathTypeFromContainers(containerLocations, edge.source, edge.target)
          )
        )
        .filter((edge): edge is EdgeDefinition => edge !== null)

      // Only forward faults that target a serializable node in this topology.
      const faults = (resolvedScenario.faults ?? []).filter((fault) =>
        serializedNodeIds.has(fault.targetId)
      )

      const topology: TopologyJSON = {
        id: 'canvas-topology',
        name: 'Canvas Topology',
        version: '2.0.0',
        global: buildScenarioGlobal(resolvedScenario.global),
        nodes: engineNodes,
        edges: engineEdges,
        workload,
        ...(faults.length > 0 ? { faults } : {})
      }

      return {
        topology,
        errors,
        runContext: {
          sourceNodeId: selectedSourceRfNode.id,
          sourceLabel: selectedSourceData.label || selectedSourceRfNode.id,
          global: resolvedScenario.global,
          workload
        }
      }
    },
    [edges, nodes, scenario]
  )

  return { serialize }
}
