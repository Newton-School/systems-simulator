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
import { getPaletteTemplate } from '../../../engine/catalog/paletteTemplates'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import { getPathTypeLatencyProfile, inferEdgeDefaults } from '../../../engine/defaults/edgeDefaults'
import useStore from '../store/useStore'
import type { ScenarioRunContext, ScenarioState } from '@renderer/types/ui'
import { normalizeScenarioState } from '@renderer/types/ui'
import { mergeWorkloadDefaults } from '@renderer/utils/workloadDefaults'

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

function serializeEdge(
  rfEdge: Edge,
  serializedNodeIds: Set<string>,
  dataByNodeId: Map<string, CanvasNodeDataV2>
): EdgeDefinition | null {
  const { id, source, target } = rfEdge
  if (!serializedNodeIds.has(source) || !serializedNodeIds.has(target)) {
    return null
  }

  const targetData = dataByNodeId.get(target)
  const sourceData = dataByNodeId.get(source)
  const targetTemplate = getPaletteTemplate(targetData?.templateId)
  const targetSpec = getComponentSpec(targetData?.componentType)
  const edgeData = (rfEdge.data ?? {}) as EdgeRuntimeData
  const inferredDefaults = inferEdgeDefaults(sourceData, targetData)
  const pathType = asPathType(edgeData.pathType) ?? inferredDefaults.pathType
  const pathLatencyProfile = getPathTypeLatencyProfile(pathType)
  const { distribution, derivedFromPathType } = resolveEdgeLatencyDistribution(
    edgeData,
    pathLatencyProfile
  )

  const mode =
    asEdgeMode(edgeData.mode) ??
    (targetTemplate?.asyncBoundary || targetSpec?.asyncBoundary ? 'asynchronous' : 'synchronous')

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
        : undefined
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
        (node) => (node.data as CanvasNodeDataV2).profile === 'source'
      )
      const selectedSourceRfNode =
        sourceRfNodes.find((node) => node.id === resolvedScenario.selectedSourceNodeId) ??
        sourceRfNodes[0]

      if (!selectedSourceRfNode) {
        return {
          topology: null,
          errors: ['Add at least one source node before running the simulation.'],
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
      const engineEdges = edges
        .map((edge) => serializeEdge(edge, serializedNodeIds, dataByNodeId))
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
