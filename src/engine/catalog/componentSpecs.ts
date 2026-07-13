import type { ComponentNode, ComponentType, SLOConfig } from '../core/types'
import type {
  CanvasNodeDataV2,
  ComponentSpec,
  LegacySeedMetrics,
  NodeSimulationConfig,
  SerializeContext,
  StructuralRole
} from './nodeSpecTypes'
import { CACHE_COMPONENT_TYPES } from '../traits/cache'
import { L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE } from '../traits/contentRouting'
import { HEALTH_AWARE_COMPONENT_TYPES } from '../traits/healthAwareRouting'
import { asDistributionConfig } from '../traits/serviceTimeOverride'

const CATEGORY_MIN_SERVICE_MS = {
  'storage-and-data': 3,
  'external-and-integration': 50,
  'security-and-identity': 0.5,
  'dns-and-certs': 0.2
} as const

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

const HEALTH_AWARE_COMPONENT_TYPE_SET = new Set<ComponentType>(HEALTH_AWARE_COMPONENT_TYPES)
const CACHE_COMPONENT_TYPE_SET = new Set<ComponentType>(CACHE_COMPONENT_TYPES)

function defaultCacheHitRate(componentType: ComponentType): number | null {
  switch (componentType) {
    case 'cdn':
      return 0.9
    case 'in-memory-cache':
      return 0.8
    case 'reverse-proxy':
      return 0
    default:
      return null
  }
}

function defaultCacheHitLatencyMs(componentType: ComponentType): number | null {
  switch (componentType) {
    case 'cdn':
      return 1
    case 'in-memory-cache':
      return 0.1
    case 'reverse-proxy':
      return 1
    default:
      return null
  }
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

function normalizeSLOConfig(slo: SLOConfig | undefined): SLOConfig | undefined {
  if (!slo) {
    return undefined
  }

  const normalized: SLOConfig = {}

  if (typeof slo.latencyP99 === 'number') {
    normalized.latencyP99 = slo.latencyP99
  }

  if (typeof slo.availabilityTarget === 'number') {
    normalized.availabilityTarget = slo.availabilityTarget
  }

  if (typeof slo.errorBudget === 'number') {
    normalized.errorBudget = slo.errorBudget
  }

  if (normalized.availabilityTarget === undefined && typeof normalized.errorBudget === 'number') {
    normalized.availabilityTarget = clamp(1 - normalized.errorBudget, 0, 1)
  }

  if (normalized.errorBudget === undefined && typeof normalized.availabilityTarget === 'number') {
    normalized.errorBudget = clamp(1 - normalized.availabilityTarget, 0, 1)
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
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

  if (HEALTH_AWARE_COMPONENT_TYPE_SET.has(componentType)) {
    sim.healthCheckEnabled = true
  }

  if (CACHE_COMPONENT_TYPE_SET.has(componentType)) {
    const cacheHitRate = defaultCacheHitRate(componentType)
    const cacheHitLatencyMs = defaultCacheHitLatencyMs(componentType)

    if (cacheHitRate !== null) {
      sim.cacheHitRate = cacheHitRate
    }

    if (cacheHitLatencyMs !== null) {
      sim.cacheHitLatencyMs = cacheHitLatencyMs
    }
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
  const resilience: NonNullable<ComponentNode['resilience']> = {}

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

  if (typeof data.sim?.healthCheckEnabled === 'boolean') {
    config.healthCheckEnabled = data.sim.healthCheckEnabled
  }

  if (typeof data.sim?.cacheHitRate === 'number' && Number.isFinite(data.sim.cacheHitRate)) {
    config.cacheHitRate = clamp(data.sim.cacheHitRate, 0, 1)
  }

  if (
    typeof data.sim?.cacheHitLatencyMs === 'number' &&
    Number.isFinite(data.sim.cacheHitLatencyMs) &&
    data.sim.cacheHitLatencyMs > 0
  ) {
    config.cacheHitLatencyMs = data.sim.cacheHitLatencyMs
  }

  if (typeof data.sim?.ttlSeconds === 'number' && Number.isFinite(data.sim.ttlSeconds)) {
    config.ttlSeconds = Math.max(0, data.sim.ttlSeconds)
  }

  if (Array.isArray(data.sim?.routingRules) && data.sim.routingRules.length > 0) {
    config.routingRules = data.sim.routingRules
  }

  if (typeof data.sim?.maxTokens === 'number' && Number.isFinite(data.sim.maxTokens)) {
    config.maxTokens = data.sim.maxTokens
  }

  if (
    typeof data.sim?.refillRatePerSecond === 'number' &&
    Number.isFinite(data.sim.refillRatePerSecond)
  ) {
    config.refillRatePerSecond = data.sim.refillRatePerSecond
  }

  if (data.sim?.coldStartLatency) {
    config.coldStartLatency = data.sim.coldStartLatency
  } else if (typeof data.sim?.coldStartLatencyMs === 'number' && data.sim.coldStartLatencyMs > 0) {
    config.coldStartLatency = { type: 'exponential', lambda: 1 / data.sim.coldStartLatencyMs }
  }

  if (typeof data.sim?.idleTimeoutMs === 'number' && data.sim.idleTimeoutMs > 0) {
    config.idleTimeoutMs = data.sim.idleTimeoutMs
  }

  if (typeof data.sim?.maxConcurrency === 'number' && data.sim.maxConcurrency > 0) {
    config.maxConcurrency = Math.round(data.sim.maxConcurrency)
    resilience.bulkhead = { maxConcurrent: Math.round(data.sim.maxConcurrency) }
  }

  if (typeof data.sim?.routingKeyField === 'string' && data.sim.routingKeyField.trim().length > 0) {
    config.routingKeyField = data.sim.routingKeyField.trim()
  }

  if (typeof data.sim?.dnsRoutingPolicy === 'string') {
    config.dnsRoutingPolicy = data.sim.dnsRoutingPolicy
  }

  if (typeof data.sim?.dnsCacheTtlSeconds === 'number' && data.sim.dnsCacheTtlSeconds >= 0) {
    config.dnsCacheTtlSeconds = data.sim.dnsCacheTtlSeconds
  }

  if (data.sim?.circuitBreaker) {
    resilience.circuitBreaker = {
      failureThreshold: data.sim.circuitBreaker.failureThreshold,
      failureCount: Math.round(data.sim.circuitBreaker.failureCount),
      recoveryTimeout: Math.round(data.sim.circuitBreaker.recoveryTimeout),
      halfOpenRequests: Math.round(data.sim.circuitBreaker.halfOpenRequests)
    }
    config.circuitBreaker = resilience.circuitBreaker
  }

  if (spec.componentType === 'relational-db') {
    // "Primary DB" and "Read Replica" share this component type — the
    // template chosen from the palette is the one truthful signal of role,
    // since it's fixed at creation time (unlike a freely renamable label).
    config.replicationRole =
      data.sim?.replicationRole ?? (data.templateId === 'read-replica' ? 'replica' : 'primary')
  }

  if (data.sim?.readLatency) {
    config.readLatency = data.sim.readLatency
  } else if (typeof data.sim?.readLatencyMs === 'number' && data.sim.readLatencyMs > 0) {
    config.readLatency = { type: 'exponential', lambda: 1 / data.sim.readLatencyMs }
  }

  if (data.sim?.writeLatency) {
    config.writeLatency = data.sim.writeLatency
  } else if (typeof data.sim?.writeLatencyMs === 'number' && data.sim.writeLatencyMs > 0) {
    config.writeLatency = { type: 'exponential', lambda: 1 / data.sim.writeLatencyMs }
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
    resilience: Object.keys(resilience).length > 0 ? resilience : undefined,
    slo: normalizeSLOConfig(data.sim?.slo),
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

  if (
    data.sim?.healthCheckEnabled !== undefined &&
    typeof data.sim.healthCheckEnabled !== 'boolean'
  ) {
    errors.push('healthCheckEnabled must be a boolean.')
  }

  if (
    data.sim?.cacheHitRate !== undefined &&
    (!Number.isFinite(data.sim.cacheHitRate) ||
      data.sim.cacheHitRate < 0 ||
      data.sim.cacheHitRate > 1)
  ) {
    errors.push('cacheHitRate must be between 0 and 1.')
  }

  if (
    data.sim?.cacheHitLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.cacheHitLatencyMs) || data.sim.cacheHitLatencyMs <= 0)
  ) {
    errors.push('cacheHitLatencyMs must be greater than 0.')
  }

  if (
    data.sim?.ttlSeconds !== undefined &&
    (!Number.isFinite(data.sim.ttlSeconds) || data.sim.ttlSeconds < 0)
  ) {
    errors.push('ttlSeconds must be greater than or equal to 0.')
  }

  if (data.sim?.readLatency !== undefined && !asDistributionConfig(data.sim.readLatency)) {
    errors.push('readLatency must be a valid distribution config.')
  }

  if (data.sim?.writeLatency !== undefined && !asDistributionConfig(data.sim.writeLatency)) {
    errors.push('writeLatency must be a valid distribution config.')
  }

  if (
    data.sim?.readLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.readLatencyMs) || data.sim.readLatencyMs <= 0)
  ) {
    errors.push('readLatencyMs must be greater than 0.')
  }

  if (
    data.sim?.writeLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.writeLatencyMs) || data.sim.writeLatencyMs <= 0)
  ) {
    errors.push('writeLatencyMs must be greater than 0.')
  }

  if (
    data.sim?.replicationRole !== undefined &&
    data.sim.replicationRole !== 'primary' &&
    data.sim.replicationRole !== 'replica'
  ) {
    errors.push('replicationRole must be "primary" or "replica".')
  }

  if (
    data.sim?.maxTokens !== undefined &&
    (!Number.isFinite(data.sim.maxTokens) || data.sim.maxTokens <= 0)
  ) {
    errors.push('maxTokens must be greater than 0.')
  }

  if (
    data.sim?.refillRatePerSecond !== undefined &&
    (!Number.isFinite(data.sim.refillRatePerSecond) || data.sim.refillRatePerSecond < 0)
  ) {
    errors.push('refillRatePerSecond must be greater than or equal to 0.')
  }

  if (
    data.sim?.coldStartLatency !== undefined &&
    !asDistributionConfig(data.sim.coldStartLatency)
  ) {
    errors.push('coldStartLatency must be a valid distribution config.')
  }

  if (
    data.sim?.coldStartLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.coldStartLatencyMs) || data.sim.coldStartLatencyMs <= 0)
  ) {
    errors.push('coldStartLatencyMs must be greater than 0.')
  }

  if (
    data.sim?.idleTimeoutMs !== undefined &&
    (!Number.isFinite(data.sim.idleTimeoutMs) || data.sim.idleTimeoutMs <= 0)
  ) {
    errors.push('idleTimeoutMs must be greater than 0.')
  }

  if (
    data.sim?.maxConcurrency !== undefined &&
    (!Number.isFinite(data.sim.maxConcurrency) || data.sim.maxConcurrency <= 0)
  ) {
    errors.push('maxConcurrency must be greater than 0.')
  }

  if (
    data.sim?.routingKeyField !== undefined &&
    (typeof data.sim.routingKeyField !== 'string' || data.sim.routingKeyField.trim().length === 0)
  ) {
    errors.push('routingKeyField must be a non-empty string.')
  }

  if (
    data.sim?.dnsRoutingPolicy !== undefined &&
    !['simple', 'weighted', 'failover', 'latency-based', 'geolocation'].includes(
      data.sim.dnsRoutingPolicy
    )
  ) {
    errors.push(
      'dnsRoutingPolicy must be one of "simple", "weighted", "failover", "latency-based", "geolocation".'
    )
  }

  if (
    data.sim?.dnsCacheTtlSeconds !== undefined &&
    (!Number.isFinite(data.sim.dnsCacheTtlSeconds) || data.sim.dnsCacheTtlSeconds < 0)
  ) {
    errors.push('dnsCacheTtlSeconds must be greater than or equal to 0.')
  }

  if (data.sim?.circuitBreaker) {
    const breaker = data.sim.circuitBreaker
    if (
      !Number.isFinite(breaker.failureThreshold) ||
      breaker.failureThreshold < 0 ||
      breaker.failureThreshold > 1
    ) {
      errors.push('circuitBreaker.failureThreshold must be between 0 and 1.')
    }
    if (!Number.isFinite(breaker.failureCount) || breaker.failureCount <= 0) {
      errors.push('circuitBreaker.failureCount must be greater than 0.')
    }
    if (!Number.isFinite(breaker.recoveryTimeout) || breaker.recoveryTimeout <= 0) {
      errors.push('circuitBreaker.recoveryTimeout must be greater than 0.')
    }
    if (!Number.isFinite(breaker.halfOpenRequests) || breaker.halfOpenRequests <= 0) {
      errors.push('circuitBreaker.halfOpenRequests must be greater than 0.')
    }
  }

  const routingRules = data.sim?.routingRules
  if (routingRules !== undefined) {
    if (data.componentType === 'load-balancer-l4' && routingRules.length > 0) {
      errors.push(L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE)
    } else {
      routingRules.forEach((rule, ruleIndex) => {
        if (!['type', 'path', 'host'].includes(rule.matchField)) {
          errors.push(
            `routingRules[${ruleIndex}].matchField must be one of "type", "path", "host".`
          )
        }
        if (!rule.matchValue) {
          errors.push(`routingRules[${ruleIndex}].matchValue is required.`)
        }
        if (!rule.targetNodeId) {
          errors.push(`routingRules[${ruleIndex}].targetNodeId is required.`)
        }
      })
    }
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
