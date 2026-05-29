import type { ComponentCategory, ComponentNode, ComponentType } from '../core/types'
import type {
  CanvasNodeDataV2,
  ComponentSpec,
  LegacySeedMetrics,
  NodeSimulationConfig,
  SerializeContext,
  StructuralRole
} from './nodeSpecTypes'

const CATEGORY_MIN_SERVICE_MS: Partial<Record<ComponentCategory, number>> = {
  'storage-and-data': 3,
  'external-and-integration': 50,
  'security-and-identity': 0.5,
  'dns-and-certs': 0.2
}

const TYPE_MEAN_SERVICE_MS: Partial<Record<ComponentType, number>> = {
  'in-memory-cache': 0.1,
  'relational-db': 8,
  'nosql-db': 3,
  'object-storage': 20,
  'search-index': 10,
  cdn: 2,
  'load-balancer': 0.2,
  'load-balancer-l4': 0.15,
  'load-balancer-l7': 0.4,
  'edge-router': 0.8,
  'ingress-controller': 0.3,
  'reverse-proxy': 0.5,
  'service-mesh': 0.6,
  'api-gateway': 1,
  'routing-rule': 0.1,
  'routing-policy': 0.1,
  'nat-gateway': 0.5,
  'vpn-gateway': 2,
  waf: 0.3,
  firewall: 0.1,
  'third-party-api-connector': 150,
  'internal-dns': 0.5,
  'time-series-db': 6,
  'graph-db': 7,
  'vector-db': 8,
  'data-warehouse': 12,
  'data-lake': 18,
  'kv-store': 0.3,
  'llm-gateway': 6,
  'tool-registry': 1,
  'memory-fabric': 3,
  'agent-orchestrator': 10,
  'safety-observability-mesh': 2,
  sharding: 0.4,
  hashing: 0.2,
  'shard-node': 4,
  'partition-node': 3,
  'centralized-logging': 1,
  'metrics-store': 0.5,
  'distributed-tracing': 1,
  'alerting-hook': 5
}

const DEFAULT_UTILIZATION_HINT = 65
const MAX_DERIVED_WORKERS = 512
const MAX_DERIVED_CAPACITY = 2_000_000

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asPositiveNumber(value: unknown): number | null {
  const num = asFiniteNumber(value)
  return num !== null && num > 0 ? num : null
}

function asNonNegativeInt(value: unknown): number | null {
  const num = asFiniteNumber(value)
  if (num === null) return null
  const rounded = Math.round(num)
  return rounded >= 0 ? rounded : null
}

function asPositiveInt(value: unknown): number | null {
  const num = asNonNegativeInt(value)
  return num !== null && num > 0 ? num : null
}

function asProbability(value: unknown): number | null {
  const num = asFiniteNumber(value)
  if (num === null || num < 0 || num > 100) return null
  return num / 100
}

export function buildSeededSimulationConfig(
  componentType: ComponentType,
  category: ComponentNode['category'],
  seed: LegacySeedMetrics = {}
): NodeSimulationConfig {
  const vCpuCores = asPositiveNumber(seed.vCPU) ?? 4
  const memoryGb = asPositiveNumber(seed.ram) ?? 8

  const desiredThroughput = asPositiveNumber(seed.throughput)
  const utilizationPct = asFiniteNumber(seed.load) ?? DEFAULT_UTILIZATION_HINT
  const utilizationHint = clamp(utilizationPct / 100, 0.05, 0.98)
  const queueDepthHint = asNonNegativeInt(seed.queueDepth) ?? 0

  const workersFromThroughput = desiredThroughput ? Math.ceil(desiredThroughput / 10_000) : 1
  const workersFromQueueDepth = Math.max(1, Math.round(Math.sqrt(queueDepthHint + 1)))
  const workersFromUtilization = Math.max(1, Math.round(utilizationHint * 8))
  const workersFromCpu = Math.max(1, Math.round(vCpuCores * 2))

  let workers = Math.min(
    MAX_DERIVED_WORKERS,
    asPositiveInt(seed.workers) ??
      Math.max(workersFromThroughput, workersFromQueueDepth, workersFromUtilization, workersFromCpu)
  )

  const memoryCapacityBoost = clamp(memoryGb / 8, 0.5, 8)
  const derivedCapacity = Math.max(
    workers,
    Math.round((workers + queueDepthHint) * memoryCapacityBoost)
  )
  const capacity = Math.max(
    workers,
    Math.min(MAX_DERIVED_CAPACITY, asPositiveInt(seed.capacity) ?? derivedCapacity)
  )

  let meanServiceMs = asPositiveNumber(seed.meanServiceMs)

  if (meanServiceMs === null) {
    meanServiceMs = TYPE_MEAN_SERVICE_MS[componentType] ?? null
  }

  if (meanServiceMs === null && desiredThroughput) {
    meanServiceMs = (workers * utilizationHint * 1000) / desiredThroughput
  }

  if (meanServiceMs === null) {
    meanServiceMs = 10 + utilizationHint * 90
  }

  const cpuServiceFactor = clamp(4 / vCpuCores, 0.2, 4)
  meanServiceMs *= cpuServiceFactor

  if (seed.overloadPreview) {
    workers = Math.max(1, Math.floor(workers * 0.75))
    meanServiceMs *= 2
  }

  const categoryFloor = CATEGORY_MIN_SERVICE_MS[category] ?? 0
  meanServiceMs = Math.max(0.05, categoryFloor, meanServiceMs)

  const timeoutMs = asPositiveInt(seed.timeoutMs) ?? Math.max(100, Math.round(meanServiceMs * 40))
  const queueDiscipline = seed.queueDiscipline ?? 'fifo'
  const nodeErrorRate = clamp(asProbability(seed.nodeErrorRate) ?? 0, 0, 1)
  const blockRate = clamp(asProbability(seed.blockRate) ?? 0, 0, 1)
  const droppedPackets = clamp(asProbability(seed.droppedPackets) ?? 0, 0, 1)

  const sim: NodeSimulationConfig = {
    queue: { workers, capacity, discipline: queueDiscipline },
    processing: {
      distribution: { type: 'exponential', lambda: 1 / meanServiceMs },
      timeout: timeoutMs
    }
  }

  if (nodeErrorRate > 0) {
    sim.nodeErrorRate = nodeErrorRate
  }

  if (blockRate > 0 || droppedPackets > 0) {
    sim.securityPolicy = { blockRate, droppedPackets }
  }

  return sim
}

function buildSourceNode(
  data: CanvasNodeDataV2,
  spec: ComponentSpec,
  ctx: SerializeContext
): ComponentNode {
  return {
    id: ctx.nodeId,
    type: spec.componentType,
    category: spec.category,
    role: spec.structuralRole,
    label: data.label,
    position: ctx.position,
    config: { sourceOnly: true }
  }
}

function buildRuntimeNode(
  data: CanvasNodeDataV2,
  spec: ComponentSpec,
  ctx: SerializeContext
): ComponentNode {
  const config: Record<string, unknown> = {}

  if (typeof data.sim?.nodeErrorRate === 'number' && Number.isFinite(data.sim.nodeErrorRate)) {
    config.nodeErrorRate = clamp(data.sim.nodeErrorRate, 0, 1)
  }

  if (data.routingStrategy) {
    config.routingStrategy = data.routingStrategy
  }

  if (data.sim?.securityPolicy) {
    const blockRate = clamp(data.sim.securityPolicy.blockRate ?? 0, 0, 1)
    const droppedPackets = clamp(data.sim.securityPolicy.droppedPackets ?? 0, 0, 1)
    if (blockRate > 0 || droppedPackets > 0) {
      config.securityPolicy = { blockRate, droppedPackets }
    }
  }

  return {
    id: ctx.nodeId,
    type: spec.componentType,
    category: spec.category,
    role: spec.structuralRole,
    label: data.label,
    position: ctx.position,
    queue: data.sim?.queue,
    processing: data.sim?.processing,
    slo: data.sim?.slo,
    config: Object.keys(config).length > 0 ? config : undefined
  }
}

function validateSimulationNode(data: CanvasNodeDataV2): string[] {
  const errors: string[] = []
  const queue = data.sim?.queue
  const processing = data.sim?.processing

  if (!queue) {
    errors.push('Missing queue configuration.')
  } else {
    if (!Number.isInteger(queue.workers) || queue.workers < 1) {
      errors.push('queue.workers must be a positive integer.')
    }
    if (!Number.isInteger(queue.capacity) || queue.capacity < 1) {
      errors.push('queue.capacity must be a positive integer.')
    }
    if (queue.capacity < queue.workers) {
      errors.push('queue.capacity must be greater than or equal to queue.workers.')
    }
  }

  if (!processing) {
    errors.push('Missing processing configuration.')
  } else {
    if (!processing.distribution) {
      errors.push('processing.distribution is required.')
    }
    if (!Number.isFinite(processing.timeout) || processing.timeout <= 0) {
      errors.push('processing.timeout must be greater than 0.')
    }
  }

  if (
    data.sim?.nodeErrorRate !== undefined &&
    (!Number.isFinite(data.sim.nodeErrorRate) ||
      data.sim.nodeErrorRate < 0 ||
      data.sim.nodeErrorRate > 1)
  ) {
    errors.push('nodeErrorRate must be between 0 and 1.')
  }

  return errors
}

function validateSourceNode(data: CanvasNodeDataV2): string[] {
  const errors: string[] = []
  if (!data.source) {
    errors.push('Missing source workload configuration.')
    return errors
  }

  if (!data.source.requestDistribution || data.source.requestDistribution.length === 0) {
    errors.push('Source requestDistribution must contain at least one request type.')
  } else {
    const totalWeight = data.source.requestDistribution.reduce(
      (acc, entry) => acc + entry.weight,
      0
    )
    if (Math.abs(totalWeight - 1) > 0.0001) {
      errors.push('Source requestDistribution weights must sum to 1.')
    }
  }

  if (!data.source.defaultWorkload.pattern) {
    errors.push('Source workload pattern is required.')
  }

  if (
    !Number.isFinite(data.source.defaultWorkload.baseRps) ||
    data.source.defaultWorkload.baseRps <= 0
  ) {
    errors.push('Source baseRps must be greater than 0.')
  }

  return errors
}

function createSpec(
  meta: Omit<ComponentSpec, 'createDefaultSimulationConfig' | 'validateCanvas' | 'serializeCanvas'>
): ComponentSpec {
  return {
    ...meta,
    createDefaultSimulationConfig: (seed) =>
      buildSeededSimulationConfig(meta.componentType, meta.category, seed),
    validateCanvas: (data) => {
      if (meta.structuralRole === 'source') {
        return validateSourceNode(data)
      }

      const errors = validateSimulationNode(data)
      if (
        meta.profile === 'security-filter' &&
        (!data.sim?.securityPolicy ||
          ((data.sim.securityPolicy.blockRate ?? 0) <= 0 &&
            (data.sim.securityPolicy.droppedPackets ?? 0) <= 0))
      ) {
        errors.push('Security filter nodes require blockRate or droppedPackets.')
      }
      return errors
    },
    serializeCanvas: (data, ctx) =>
      meta.structuralRole === 'source'
        ? buildSourceNode(data, specMap[meta.componentType]!, ctx)
        : buildRuntimeNode(data, specMap[meta.componentType]!, ctx)
  }
}

const specMap: Partial<Record<ComponentType, ComponentSpec>> = {}

function register(
  componentType: ComponentType,
  meta: Omit<
    ComponentSpec,
    'componentType' | 'createDefaultSimulationConfig' | 'validateCanvas' | 'serializeCanvas'
  >
): void {
  specMap[componentType] = createSpec({ componentType, ...meta })
}

register('api-endpoint', {
  category: 'compute',
  structuralRole: 'source',
  profile: 'source',
  defaultRenderer: 'serviceNode'
})

for (const componentType of [
  'load-balancer',
  'load-balancer-l4',
  'load-balancer-l7',
  'ingress-controller',
  'reverse-proxy',
  'service-mesh',
  'api-gateway',
  'cdn',
  'nat-gateway',
  'vpn-gateway',
  'routing-rule',
  'routing-policy',
  'edge-router',
  'high-perf-nic'
] as const) {
  register(componentType, {
    category: 'network-and-edge',
    structuralRole: 'router',
    profile: 'router',
    defaultRenderer: 'serviceNode',
    routingStrategy:
      componentType === 'load-balancer' ||
      componentType === 'load-balancer-l4' ||
      componentType === 'load-balancer-l7' ||
      componentType === 'ingress-controller' ||
      componentType === 'reverse-proxy'
        ? 'round-robin'
        : 'passthrough'
  })
}

register('internal-dns', {
  category: 'dns-and-certs',
  structuralRole: 'router',
  profile: 'router',
  defaultRenderer: 'serviceNode',
  routingStrategy: 'passthrough'
})

for (const componentType of ['sharding', 'hashing'] as const) {
  register(componentType, {
    category: 'auxiliary',
    structuralRole: 'router',
    profile: 'router',
    defaultRenderer: 'serviceNode',
    routingStrategy: 'passthrough'
  })
}

for (const componentType of [
  'microservice',
  'serverless-function',
  'auth-service',
  'search-service',
  'sidecar'
] as const) {
  register(componentType, {
    category: 'compute',
    structuralRole: 'processor',
    profile: 'compute-service',
    defaultRenderer: 'computeNode'
  })
}

register('llm-gateway', {
  category: 'external-and-integration',
  structuralRole: 'processor',
  profile: 'compute-service',
  defaultRenderer: 'serviceNode'
})

register('streaming-analytics', {
  category: 'data-infra-and-analytics',
  structuralRole: 'processor',
  profile: 'compute-service',
  defaultRenderer: 'serviceNode'
})

for (const componentType of ['batch-worker'] as const) {
  register(componentType, {
    category: 'compute',
    structuralRole: 'processor',
    profile: 'worker',
    defaultRenderer: 'computeNode',
    asyncBoundary: true
  })
}

register('push-notification-service', {
  category: 'real-time-and-media',
  structuralRole: 'processor',
  profile: 'worker',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

for (const componentType of [
  'relational-db',
  'in-memory-cache',
  'nosql-db',
  'object-storage',
  'search-index',
  'time-series-db',
  'graph-db',
  'vector-db',
  'data-warehouse',
  'data-lake',
  'kv-store'
] as const) {
  register(componentType, {
    category: 'storage-and-data',
    structuralRole: 'storage',
    profile: 'datastore',
    defaultRenderer: 'serviceNode'
  })
}

register('memory-fabric', {
  category: 'data-infra-and-analytics',
  structuralRole: 'storage',
  profile: 'datastore',
  defaultRenderer: 'serviceNode'
})

for (const componentType of ['shard-node', 'partition-node'] as const) {
  register(componentType, {
    category: 'auxiliary',
    structuralRole: 'storage',
    profile: 'datastore',
    defaultRenderer: 'serviceNode'
  })
}

register('queue', {
  category: 'messaging-and-streaming',
  structuralRole: 'storage',
  profile: 'broker',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

register('stream', {
  category: 'messaging-and-streaming',
  structuralRole: 'storage',
  profile: 'broker',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

for (const componentType of ['message-broker', 'pub-sub'] as const) {
  register(componentType, {
    category: 'messaging-and-streaming',
    structuralRole: 'router',
    profile: 'broker',
    defaultRenderer: 'serviceNode',
    asyncBoundary: true,
    routingStrategy: 'broadcast'
  })
}

register('waf', {
  category: 'security-and-identity',
  structuralRole: 'router',
  profile: 'security-filter',
  defaultRenderer: 'securityNode',
  routingStrategy: 'passthrough'
})

register('firewall', {
  category: 'security-and-identity',
  structuralRole: 'processor',
  profile: 'security-filter',
  defaultRenderer: 'securityNode'
})

for (const componentType of [
  'service-registry',
  'tool-registry',
  'config-store',
  'secrets-manager'
] as const) {
  register(componentType, {
    category: 'orchestration-and-infra',
    structuralRole: 'processor',
    profile: 'control-plane',
    defaultRenderer: 'serviceNode'
  })
}

register('agent-orchestrator', {
  category: 'orchestration-and-infra',
  structuralRole: 'processor',
  profile: 'control-plane',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

register('feature-flag-service', {
  category: 'devops-and-delivery',
  structuralRole: 'processor',
  profile: 'control-plane',
  defaultRenderer: 'serviceNode'
})

register('metrics-store', {
  category: 'observability',
  structuralRole: 'processor',
  profile: 'observability',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

register('centralized-logging', {
  category: 'observability',
  structuralRole: 'processor',
  profile: 'observability',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

register('distributed-tracing', {
  category: 'observability',
  structuralRole: 'processor',
  profile: 'observability',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

register('alerting-hook', {
  category: 'observability',
  structuralRole: 'sink',
  profile: 'observability',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

register('health-check-manager', {
  category: 'observability',
  structuralRole: 'processor',
  profile: 'control-plane',
  defaultRenderer: 'serviceNode'
})

register('safety-observability-mesh', {
  category: 'observability',
  structuralRole: 'processor',
  profile: 'observability',
  defaultRenderer: 'serviceNode',
  asyncBoundary: true
})

register('third-party-api-connector', {
  category: 'external-and-integration',
  structuralRole: 'sink',
  profile: 'integration',
  defaultRenderer: 'serviceNode'
})

export const COMPONENT_SPECS = specMap as Readonly<Partial<Record<ComponentType, ComponentSpec>>>

export function getComponentSpec(
  componentType: ComponentType | undefined
): ComponentSpec | undefined {
  if (!componentType) return undefined
  return COMPONENT_SPECS[componentType]
}

export function inferStructuralRole(
  componentType: ComponentType | undefined
): StructuralRole | undefined {
  return getComponentSpec(componentType)?.structuralRole
}
