import type { Edge, Node } from 'reactflow'
import type {
  ComponentNode,
  DistributionConfig,
  EdgeDefinition,
  TopologyJSON,
  WorkloadProfile
} from '../../../engine/core/types'
import { instantiateTemplate, PALETTE_TEMPLATES } from '../../../engine/catalog/paletteTemplates'
import type {
  CanvasNodeDataV2,
  NodeSimulationConfig,
  PaletteTemplate,
  RoutingStrategy
} from '../../../engine/catalog/nodeSpecTypes'
import type { EdgeSimulationData, ScenarioState } from '@renderer/types/ui'
import { DEFAULT_SCENARIO_STATE } from '@renderer/types/ui'
import type { NestedFileData, NestedNode } from './nodeTransformers'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDistributionConfig(value: unknown): value is DistributionConfig {
  return isRecord(value) && typeof value.type === 'string'
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function asRoutingStrategy(value: unknown): RoutingStrategy | undefined {
  return value === 'round-robin' ||
    value === 'weighted' ||
    value === 'random' ||
    value === 'least-conn' ||
    value === 'broadcast' ||
    value === 'conditional' ||
    value === 'passthrough'
    ? value
    : undefined
}

function asDistribution(value: unknown): DistributionConfig | undefined {
  return isDistributionConfig(value) ? value : undefined
}

function pickTemplateForNode(node: ComponentNode): PaletteTemplate | null {
  if (node.type === 'relational-db') {
    const replicationRole = asString(node.config?.['replicationRole'])
    if (replicationRole === 'replica') {
      return PALETTE_TEMPLATES['read-replica']
    }
    return PALETTE_TEMPLATES['primary-db']
  }

  if (node.type === 'api-endpoint') {
    return PALETTE_TEMPLATES['client-user']
  }

  const candidates = Object.values(PALETTE_TEMPLATES).filter(
    (template) => template.serializable && template.componentType === node.type
  )

  if (candidates.length === 0) {
    return null
  }

  return [...candidates].sort((left, right) => {
    const leftScore =
      (left.structuralRole === node.role ? 10 : 0) +
      (node.role === 'source' && left.profile === 'source' ? 5 : 0)
    const rightScore =
      (right.structuralRole === node.role ? 10 : 0) +
      (node.role === 'source' && right.profile === 'source' ? 5 : 0)
    return rightScore - leftScore
  })[0]
}

function buildSourceDefaults(workload: WorkloadProfile) {
  return {
    pattern: workload.pattern,
    baseRps: workload.baseRps,
    ...(workload.bursty ? { bursty: workload.bursty } : {}),
    ...(workload.spike ? { spike: workload.spike } : {}),
    ...(workload.sawtooth ? { sawtooth: workload.sawtooth } : {}),
    ...(workload.diurnal ? { diurnal: workload.diurnal } : {})
  }
}

function overlaySimulationConfig(
  node: ComponentNode,
  initial: NodeSimulationConfig | undefined
): NodeSimulationConfig | undefined {
  const sim: NodeSimulationConfig = initial ? structuredClone(initial) : {}

  if (node.queue) {
    sim.queue = structuredClone(node.queue)
  }

  if (node.processing) {
    sim.processing = structuredClone(node.processing)
  }

  if (node.slo) {
    sim.slo = structuredClone(node.slo)
  }

  const config = node.config ?? {}
  const resilience = node.resilience
  const scaling = node.scaling

  if (asNumber(config['nodeErrorRate']) !== undefined) {
    sim.nodeErrorRate = asNumber(config['nodeErrorRate'])
  }

  if (asBoolean(config['healthCheckEnabled']) !== undefined) {
    sim.healthCheckEnabled = asBoolean(config['healthCheckEnabled'])
  }

  if (asNumber(config['cacheHitRate']) !== undefined) {
    sim.cacheHitRate = asNumber(config['cacheHitRate'])
  }

  if (asNumber(config['cacheHitLatencyMs']) !== undefined) {
    sim.cacheHitLatencyMs = asNumber(config['cacheHitLatencyMs'])
  }

  if (asNumber(config['ttlSeconds']) !== undefined) {
    sim.ttlSeconds = asNumber(config['ttlSeconds'])
  }

  if (Array.isArray(config['routingRules'])) {
    sim.routingRules = structuredClone(config['routingRules']) as NonNullable<
      NodeSimulationConfig['routingRules']
    >
  }

  if (asNumber(config['maxTokens']) !== undefined) {
    sim.maxTokens = asNumber(config['maxTokens'])
  } else if (asNumber(resilience?.rateLimiter?.maxTokens) !== undefined) {
    sim.maxTokens = resilience?.rateLimiter?.maxTokens
  }

  if (asNumber(config['refillRatePerSecond']) !== undefined) {
    sim.refillRatePerSecond = asNumber(config['refillRatePerSecond'])
  } else if (asNumber(resilience?.rateLimiter?.refillRate) !== undefined) {
    sim.refillRatePerSecond = resilience?.rateLimiter?.refillRate
  }

  const coldStartLatency =
    asDistribution(config['coldStartLatency']) ?? scaling?.coldStartPenalty?.distribution
  if (coldStartLatency) {
    sim.coldStartLatency = structuredClone(coldStartLatency)
  }

  if (asNumber(config['idleTimeoutMs']) !== undefined) {
    sim.idleTimeoutMs = asNumber(config['idleTimeoutMs'])
  }

  if (asNumber(config['maxConcurrency']) !== undefined) {
    sim.maxConcurrency = asNumber(config['maxConcurrency'])
  } else if (asNumber(resilience?.bulkhead?.maxConcurrent) !== undefined) {
    sim.maxConcurrency = resilience?.bulkhead?.maxConcurrent
  }

  if (asString(config['routingKeyField'])) {
    sim.routingKeyField = asString(config['routingKeyField'])
  }

  if (
    config['dnsRoutingPolicy'] === 'simple' ||
    config['dnsRoutingPolicy'] === 'weighted' ||
    config['dnsRoutingPolicy'] === 'failover' ||
    config['dnsRoutingPolicy'] === 'latency-based' ||
    config['dnsRoutingPolicy'] === 'geolocation'
  ) {
    sim.dnsRoutingPolicy = config['dnsRoutingPolicy']
  }

  if (asNumber(config['dnsCacheTtlSeconds']) !== undefined) {
    sim.dnsCacheTtlSeconds = asNumber(config['dnsCacheTtlSeconds'])
  }

  if (resilience?.circuitBreaker) {
    sim.circuitBreaker = structuredClone(resilience.circuitBreaker)
  } else if (isRecord(config['circuitBreaker'])) {
    const circuitBreaker = config['circuitBreaker']
    const failureThreshold = asNumber(circuitBreaker['failureThreshold'])
    const failureCount = asNumber(circuitBreaker['failureCount'])
    const recoveryTimeout = asNumber(circuitBreaker['recoveryTimeout'])
    const halfOpenRequests = asNumber(circuitBreaker['halfOpenRequests'])

    if (
      failureThreshold !== undefined &&
      failureCount !== undefined &&
      recoveryTimeout !== undefined &&
      halfOpenRequests !== undefined
    ) {
      sim.circuitBreaker = {
        failureThreshold,
        failureCount,
        recoveryTimeout,
        halfOpenRequests
      }
    }
  }

  if (config['replicationRole'] === 'primary' || config['replicationRole'] === 'replica') {
    sim.replicationRole = config['replicationRole']
  }

  const readLatency = asDistribution(config['readLatency'])
  if (readLatency) {
    sim.readLatency = structuredClone(readLatency)
  }

  const writeLatency = asDistribution(config['writeLatency'])
  if (writeLatency) {
    sim.writeLatency = structuredClone(writeLatency)
  }

  return Object.keys(sim).length > 0 ? sim : undefined
}

function convertNode(node: ComponentNode, workload?: WorkloadProfile): Node<CanvasNodeDataV2> | null {
  const template = pickTemplateForNode(node)
  if (!template) {
    return null
  }

  const data = instantiateTemplate(template.id)
  data.label = node.label

  const routingStrategy = asRoutingStrategy(node.config?.['routingStrategy'])
  if (routingStrategy) {
    data.routingStrategy = routingStrategy
  }

  data.sim = overlaySimulationConfig(node, data.sim)

  if (data.profile === 'source' && workload && workload.sourceNodeId === node.id) {
    data.source = {
      requestDistribution: structuredClone(workload.requestDistribution),
      defaultWorkload: buildSourceDefaults(workload)
    }
  }

  return {
    id: node.id,
    type: data.rendererType,
    position: structuredClone(node.position),
    data
  }
}

function edgeDataFromTopology(edge: EdgeDefinition): EdgeSimulationData {
  const distribution = edge.latency.distribution
  return {
    protocol: edge.protocol,
    mode: edge.mode,
    latencyMu: distribution.type === 'log-normal' ? distribution.mu : undefined,
    latencySigma: distribution.type === 'log-normal' ? distribution.sigma : undefined,
    pathType: edge.latency.pathType,
    bandwidth: edge.bandwidth,
    maxConcurrentRequests: edge.maxConcurrentRequests,
    packetLossRate: edge.packetLossRate * 100,
    errorRate: edge.errorRate * 100,
    condition: edge.condition
  }
}

function convertEdge(edge: EdgeDefinition): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: edgeDataFromTopology(edge),
    animated: edge.animated,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle
  }
}

function buildScenarioState(topology: TopologyJSON): ScenarioState {
  return {
    global: {
      simulationDuration: topology.global.simulationDuration,
      warmupDuration: topology.global.warmupDuration,
      seed: topology.global.seed,
      defaultTimeout: topology.global.defaultTimeout,
      traceSampleRate:
        topology.global.traceSampleRate ?? DEFAULT_SCENARIO_STATE.global.traceSampleRate
    },
    selectedSourceNodeId: topology.workload?.sourceNodeId,
    workloadOverride: {}
  }
}

export function isTopologyJsonLike(value: unknown): value is TopologyJSON {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    isRecord(value.global) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string'
  )
}

export function topologyToCanvasFileData(topology: TopologyJSON): NestedFileData {
  const nodes = topology.nodes
    .map((node) => convertNode(node, topology.workload))
    .filter((node): node is Node<CanvasNodeDataV2> => node !== null)
    .map((node) => ({ ...node }) as NestedNode)

  return {
    nodes,
    edges: topology.edges.map(convertEdge),
    scenario: buildScenarioState(topology)
  }
}
