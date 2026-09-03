import type { ComponentNode, ComponentType, SLOConfig } from '../core/types'
import type {
  CanvasNodeDataV2,
  ComponentSpec,
  LegacySeedMetrics,
  NodeSimulationConfig,
  SerializeContext,
  StructuralRole
} from './nodeSpecTypes'
import { buildDefaultResources, buildReproducingResources } from './resourceDefaults'
import { CACHE_COMPONENT_TYPES } from '../traits/cache'
import {
  CONTENT_ROUTING_MATCH_FIELDS,
  L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE
} from '../traits/contentRouting'
import { DEFAULT_BREAKER_CONFIG } from '../traits/circuitBreaker'
import { HEALTH_AWARE_COMPONENT_TYPES } from '../traits/healthAwareRouting'
import {
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  DEFAULT_RETRY_MULTIPLIER
} from '../traits/retryBackoff'
import { asDistributionConfig } from '../traits/serviceTimeOverride'
import {
  nonNegativeNumber,
  oneOf,
  positiveNumber,
  probability,
  queueCapacityAtLeastWorkers,
  queueFieldLabels,
  routingRuleMissingMatchValue,
  routingRuleMissingTarget,
  routingRuleUnsupportedMatchField,
  validationMessage,
  validDistribution,
  wholeNumberAtLeastOne
} from '../validation/validationCopy'

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
  'alerting-hook': 5,
  'rate-limiter': 0.2,
  'circuit-breaker-controller': 0.2,
  'distributed-lock': 2
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
    // Fresh palette nodes start from the curated per-type instance profile so a
    // generic API server, worker, cache, etc. lands with the intended execution
    // model. Legacy/migrated nodes still use buildReproducingResources(...) to
    // preserve older queue-authored behavior exactly.
    resources: buildDefaultResources(componentType),
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

  if (componentType === 'rate-limiter') {
    sim.maxTokens = 100
    sim.refillRatePerSecond = 50
  }

  if (componentType === 'circuit-breaker-controller') {
    sim.circuitBreaker = {
      failureThreshold: DEFAULT_BREAKER_CONFIG.failureThreshold,
      failureCount: DEFAULT_BREAKER_CONFIG.failureCount,
      recoveryTimeout: DEFAULT_BREAKER_CONFIG.recoveryTimeoutMs,
      halfOpenRequests: DEFAULT_BREAKER_CONFIG.halfOpenRequests
    }
  }

  if (componentType === 'distributed-lock') {
    sim.lockKeyField = 'seatId'
    sim.acquireMs = 2
    sim.leaseMs = 5_000
    sim.fencing = true
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

  if (data.sim?.cacheEngine === 'redis' || data.sim?.cacheEngine === 'memcached') {
    config.cacheEngine = data.sim.cacheEngine
  }

  if (
    data.sim?.cacheStrategy === 'cache-aside' ||
    data.sim?.cacheStrategy === 'read-through' ||
    data.sim?.cacheStrategy === 'write-through' ||
    data.sim?.cacheStrategy === 'write-behind'
  ) {
    config.cacheStrategy = data.sim.cacheStrategy
  }

  if (
    data.sim?.dataModel === 'document' ||
    data.sim?.dataModel === 'key-value' ||
    data.sim?.dataModel === 'wide-column'
  ) {
    config.dataModel = data.sim.dataModel
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

  if (data.sim?.retry) {
    const maxAttempts =
      typeof data.sim.retry.maxAttempts === 'number' && data.sim.retry.maxAttempts > 0
        ? Math.round(data.sim.retry.maxAttempts)
        : null
    if (maxAttempts !== null) {
      resilience.retry = {
        maxAttempts,
        baseDelay:
          typeof data.sim.retry.baseDelay === 'number' && data.sim.retry.baseDelay > 0
            ? data.sim.retry.baseDelay
            : DEFAULT_RETRY_BASE_DELAY_MS,
        maxDelay:
          typeof data.sim.retry.maxDelay === 'number' && data.sim.retry.maxDelay > 0
            ? data.sim.retry.maxDelay
            : DEFAULT_RETRY_MAX_DELAY_MS,
        multiplier:
          typeof data.sim.retry.multiplier === 'number' && data.sim.retry.multiplier > 0
            ? data.sim.retry.multiplier
            : DEFAULT_RETRY_MULTIPLIER,
        jitter: data.sim.retry.jitter === true
      }
    }
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

  if (
    (spec.componentType === 'relational-db' || spec.componentType === 'nosql-db') &&
    data.sim?.replicationEnabled === true
  ) {
    config.replicationEnabled = true
    config.replicationMode = data.sim.replicationMode ?? 'primary-replica'
    config.replicationRole =
      data.sim?.replicationRole ?? (data.templateId === 'read-replica' ? 'replica' : 'primary')
    for (const field of ['replicationLagMs', 'failoverUntilMs'] as const) {
      const value = data.sim?.[field]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) config[field] = value
    }
    if (data.sim?.writeAckPolicy) config.writeAckPolicy = data.sim.writeAckPolicy
    if (data.sim?.replicaMembers?.trim()) config.replicaMembers = data.sim.replicaMembers.trim()
    if (data.sim?.consensusProtocol) config.consensusProtocol = data.sim.consensusProtocol
    if (data.sim?.conflictResolution) config.conflictResolution = data.sim.conflictResolution
  }

  if (
    typeof data.sim?.shardCount === 'number' &&
    Number.isInteger(data.sim.shardCount) &&
    data.sim.shardCount > 1
  ) {
    config.shardCount = data.sim.shardCount
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

  for (const field of [
    'storageReadMs',
    'storageWriteMs',
    'storageQueryMs',
    'storageScanMs',
    'storageIngestMs'
  ] as const) {
    const value = data.sim?.[field]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      config[field] = value
    }
  }

  for (const field of ['dedupWindowMs', 'storeLookupMs'] as const) {
    const value = data.sim?.[field]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      config[field] = value
    }
  }

  for (const field of ['acquireMs', 'leaseMs'] as const) {
    const value = data.sim?.[field]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      config[field] = value
    }
  }

  for (const field of [
    'workingSetRatio',
    'workingSetPenaltyMs',
    'gcPressureStartRatio',
    'gcPauseMs'
  ] as const) {
    const value = data.sim?.[field]
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (field === 'gcPressureStartRatio' ? value >= 0 && value <= 1 : value > 0)
    ) {
      config[field] = value
    }
  }

  if (typeof data.sim?.dedupKeyField === 'string' && data.sim.dedupKeyField.trim().length > 0) {
    config.dedupKeyField = data.sim.dedupKeyField.trim()
  }

  if (typeof data.sim?.lockKeyField === 'string' && data.sim.lockKeyField.trim().length > 0) {
    config.lockKeyField = data.sim.lockKeyField.trim()
  }

  if (typeof data.sim?.fencing === 'boolean') {
    config.fencing = data.sim.fencing
  }

  const queue = data.sim?.queue
  // Prefer authored resources (edited via the RESOURCES section); else reproduce
  // the raw queue so the node stays cost-computable and byte-identical.
  const resources =
    data.sim?.resources ??
    (queue
      ? buildReproducingResources(spec.componentType, queue.workers, queue.capacity)
      : undefined)

  return {
    id: ctx.nodeId,
    type: spec.componentType,
    category: spec.category,
    role: spec.structuralRole,
    label: data.label,
    position: ctx.position,
    queue,
    resources,
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
  const queueLabels = queueFieldLabels(data.componentType)

  if (!queue) {
    errors.push(validationMessage('missingQueue'))
  } else {
    if (!Number.isInteger(queue.workers) || queue.workers < 1) {
      errors.push(wholeNumberAtLeastOne(queueLabels.workers))
    }
    if (!Number.isInteger(queue.capacity) || queue.capacity < 1) {
      errors.push(wholeNumberAtLeastOne(queueLabels.capacity))
    }
    if (queue.capacity < queue.workers) {
      errors.push(queueCapacityAtLeastWorkers(queueLabels.capacity, queueLabels.workers))
    }
  }

  if (!processing) {
    errors.push(validationMessage('missingProcessing'))
  } else {
    if (!processing.distribution) {
      errors.push('Please choose a distribution model.')
    }
    if (!Number.isFinite(processing.timeout) || processing.timeout <= 0) {
      errors.push(positiveNumber('Timeout', 'ms'))
    }
  }

  if (
    data.sim?.nodeErrorRate !== undefined &&
    (!Number.isFinite(data.sim.nodeErrorRate) ||
      data.sim.nodeErrorRate < 0 ||
      data.sim.nodeErrorRate > 1)
  ) {
    errors.push(probability('Inject failure'))
  }

  if (
    data.sim?.healthCheckEnabled !== undefined &&
    typeof data.sim.healthCheckEnabled !== 'boolean'
  ) {
    errors.push('Health checks must be either on or off.')
  }

  if (
    data.sim?.cacheHitRate !== undefined &&
    (!Number.isFinite(data.sim.cacheHitRate) ||
      data.sim.cacheHitRate < 0 ||
      data.sim.cacheHitRate > 1)
  ) {
    errors.push(probability('Cache hit rate'))
  }

  if (
    data.sim?.cacheHitLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.cacheHitLatencyMs) || data.sim.cacheHitLatencyMs <= 0)
  ) {
    errors.push(positiveNumber('Cache hit latency', 'ms'))
  }

  if (
    data.sim?.ttlSeconds !== undefined &&
    (!Number.isFinite(data.sim.ttlSeconds) || data.sim.ttlSeconds < 0)
  ) {
    errors.push(nonNegativeNumber('TTL', 'seconds'))
  }

  if (data.sim?.readLatency !== undefined && !asDistributionConfig(data.sim.readLatency)) {
    errors.push(validDistribution('Read latency'))
  }

  if (data.sim?.writeLatency !== undefined && !asDistributionConfig(data.sim.writeLatency)) {
    errors.push(validDistribution('Write latency'))
  }

  if (
    data.sim?.readLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.readLatencyMs) || data.sim.readLatencyMs <= 0)
  ) {
    errors.push(positiveNumber('Read latency', 'ms'))
  }

  if (
    data.sim?.writeLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.writeLatencyMs) || data.sim.writeLatencyMs <= 0)
  ) {
    errors.push(positiveNumber('Write latency', 'ms'))
  }

  for (const [field, label] of [
    ['storageReadMs', 'Read latency'],
    ['storageWriteMs', 'Write latency'],
    ['storageQueryMs', 'Query latency'],
    ['storageScanMs', 'Scan latency'],
    ['storageIngestMs', 'Ingest latency']
  ] as const) {
    const value = data.sim?.[field]
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      errors.push(positiveNumber(label, 'ms'))
    }
  }

  for (const [field, label] of [
    ['dedupWindowMs', 'Dedup window'],
    ['storeLookupMs', 'Lookup latency']
  ] as const) {
    const value = data.sim?.[field]
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      errors.push(positiveNumber(label, 'ms'))
    }
  }

  for (const [field, label] of [
    ['workingSetRatio', 'Working-set ratio'],
    ['workingSetPenaltyMs', 'Working-set miss penalty'],
    ['gcPauseMs', 'Max GC pause']
  ] as const) {
    const value = data.sim?.[field]
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      errors.push(positiveNumber(label, field === 'workingSetRatio' ? undefined : 'ms'))
    }
  }

  if (
    data.sim?.gcPressureStartRatio !== undefined &&
    (!Number.isFinite(data.sim.gcPressureStartRatio) ||
      data.sim.gcPressureStartRatio < 0 ||
      data.sim.gcPressureStartRatio > 1)
  ) {
    errors.push(probability('GC pressure threshold'))
  }

  if (
    data.sim?.dedupKeyField !== undefined &&
    (typeof data.sim.dedupKeyField !== 'string' || data.sim.dedupKeyField.trim().length === 0)
  ) {
    errors.push('Metadata key must be a non-empty string.')
  }

  if (
    data.sim?.lockKeyField !== undefined &&
    (typeof data.sim.lockKeyField !== 'string' || data.sim.lockKeyField.trim().length === 0)
  ) {
    errors.push('Lock key field must be a non-empty string.')
  }

  if (
    data.sim?.acquireMs !== undefined &&
    (!Number.isFinite(data.sim.acquireMs) || data.sim.acquireMs <= 0)
  ) {
    errors.push(positiveNumber('Acquire latency', 'ms'))
  }

  if (
    data.sim?.leaseMs !== undefined &&
    (!Number.isFinite(data.sim.leaseMs) || data.sim.leaseMs <= 0)
  ) {
    errors.push(positiveNumber('Lease TTL', 'ms'))
  }

  if (
    data.sim?.replicationRole !== undefined &&
    data.sim.replicationRole !== 'primary' &&
    data.sim.replicationRole !== 'replica' &&
    data.sim.replicationRole !== 'leader' &&
    data.sim.replicationRole !== 'follower'
  ) {
    errors.push('Replication role must be Primary, Replica, Leader, or Follower.')
  }

  if (
    data.sim?.maxTokens !== undefined &&
    (!Number.isFinite(data.sim.maxTokens) || data.sim.maxTokens <= 0)
  ) {
    errors.push(positiveNumber('Bucket size'))
  }

  if (
    data.sim?.refillRatePerSecond !== undefined &&
    (!Number.isFinite(data.sim.refillRatePerSecond) || data.sim.refillRatePerSecond < 0)
  ) {
    errors.push(nonNegativeNumber('Refill rate', 'tokens/s'))
  }

  const retry = data.sim?.retry
  if (retry) {
    const retryFieldsProvided = [
      retry.maxAttempts,
      retry.baseDelay,
      retry.maxDelay,
      retry.multiplier,
      retry.jitter
    ].some((value) => value !== undefined)

    if (
      retryFieldsProvided &&
      (!Number.isFinite(retry.maxAttempts) || (retry.maxAttempts ?? 0) <= 0)
    ) {
      errors.push(positiveNumber('Max attempts'))
    }
    if (
      retry.baseDelay !== undefined &&
      (!Number.isFinite(retry.baseDelay) || retry.baseDelay <= 0)
    ) {
      errors.push(positiveNumber('Base delay', 'ms'))
    }
    if (retry.maxDelay !== undefined && (!Number.isFinite(retry.maxDelay) || retry.maxDelay <= 0)) {
      errors.push(positiveNumber('Max delay', 'ms'))
    }
    if (
      retry.multiplier !== undefined &&
      (!Number.isFinite(retry.multiplier) || retry.multiplier <= 0)
    ) {
      errors.push(positiveNumber('Multiplier'))
    }
    if (
      retry.baseDelay !== undefined &&
      retry.maxDelay !== undefined &&
      Number.isFinite(retry.baseDelay) &&
      Number.isFinite(retry.maxDelay) &&
      retry.maxDelay < retry.baseDelay
    ) {
      errors.push('Max delay must be at least as large as Base delay.')
    }
  }

  if (
    data.sim?.coldStartLatency !== undefined &&
    !asDistributionConfig(data.sim.coldStartLatency)
  ) {
    errors.push(validDistribution('Cold start latency'))
  }

  if (
    data.sim?.coldStartLatencyMs !== undefined &&
    (!Number.isFinite(data.sim.coldStartLatencyMs) || data.sim.coldStartLatencyMs <= 0)
  ) {
    errors.push(positiveNumber('Cold start latency', 'ms'))
  }

  if (
    data.sim?.idleTimeoutMs !== undefined &&
    (!Number.isFinite(data.sim.idleTimeoutMs) || data.sim.idleTimeoutMs <= 0)
  ) {
    errors.push(positiveNumber('Idle timeout', 'ms'))
  }

  if (
    data.sim?.maxConcurrency !== undefined &&
    (!Number.isFinite(data.sim.maxConcurrency) || data.sim.maxConcurrency <= 0)
  ) {
    errors.push(positiveNumber('Max concurrency'))
  }

  if (
    data.sim?.routingKeyField !== undefined &&
    (typeof data.sim.routingKeyField !== 'string' || data.sim.routingKeyField.trim().length === 0)
  ) {
    errors.push('Routing key field cannot be empty.')
  }

  if (
    data.sim?.dnsRoutingPolicy !== undefined &&
    !['simple', 'weighted', 'failover', 'latency-based', 'geolocation'].includes(
      data.sim.dnsRoutingPolicy
    )
  ) {
    errors.push(
      oneOf('DNS routing policy', [
        'Simple',
        'Weighted',
        'Failover',
        'Latency-based',
        'Geolocation'
      ])
    )
  }

  if (
    data.sim?.dnsCacheTtlSeconds !== undefined &&
    (!Number.isFinite(data.sim.dnsCacheTtlSeconds) || data.sim.dnsCacheTtlSeconds < 0)
  ) {
    errors.push(nonNegativeNumber('Cache TTL', 'seconds'))
  }

  if (data.sim?.circuitBreaker) {
    const breaker = data.sim.circuitBreaker
    if (
      !Number.isFinite(breaker.failureThreshold) ||
      breaker.failureThreshold < 0 ||
      breaker.failureThreshold > 1
    ) {
      errors.push(probability('Failure threshold'))
    }
    if (!Number.isFinite(breaker.failureCount) || breaker.failureCount <= 0) {
      errors.push(positiveNumber('Window size'))
    }
    if (!Number.isFinite(breaker.recoveryTimeout) || breaker.recoveryTimeout <= 0) {
      errors.push(positiveNumber('Recovery timeout', 'ms'))
    }
    if (!Number.isFinite(breaker.halfOpenRequests) || breaker.halfOpenRequests <= 0) {
      errors.push(positiveNumber('Half-open probes'))
    }
  }

  const routingRules = data.sim?.routingRules
  if (routingRules !== undefined) {
    if (data.componentType === 'load-balancer-l4' && routingRules.length > 0) {
      errors.push(L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE)
    } else {
      routingRules.forEach((rule, ruleIndex) => {
        if (!(CONTENT_ROUTING_MATCH_FIELDS as readonly string[]).includes(rule.matchField)) {
          errors.push(
            routingRuleUnsupportedMatchField(ruleIndex, ['Type', 'Method', 'Path', 'Host'])
          )
        }
        if (!rule.matchValue) {
          errors.push(routingRuleMissingMatchValue(ruleIndex))
        }
        if (!rule.targetNodeId) {
          errors.push(routingRuleMissingTarget(ruleIndex))
        }
      })
    }
  }

  return errors
}

function validateSourceNode(data: CanvasNodeDataV2): string[] {
  const errors: string[] = []
  if (!data.source) {
    errors.push(validationMessage('missingSourceWorkload'))
    return errors
  }

  if (!data.source.requestDistribution || data.source.requestDistribution.length === 0) {
    errors.push(validationMessage('requestDistributionEmpty'))
  } else {
    const totalWeight = data.source.requestDistribution.reduce(
      (acc, entry) => acc + entry.weight,
      0
    )
    if (Math.abs(totalWeight - 1) > 0.0001) {
      errors.push(validationMessage('requestDistributionWeights'))
    }
  }

  if (!data.source.defaultWorkload.pattern) {
    errors.push(validationMessage('workloadPatternRequired'))
  }

  if (
    !Number.isFinite(data.source.defaultWorkload.baseRps) ||
    data.source.defaultWorkload.baseRps <= 0
  ) {
    errors.push(positiveNumber('Base RPS'))
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
        errors.push(validationMessage('missingSecurityPolicy'))
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

register('rate-limiter', {
  category: 'auxiliary',
  structuralRole: 'processor',
  profile: 'control-plane',
  defaultRenderer: 'serviceNode'
})

register('circuit-breaker-controller', {
  category: 'auxiliary',
  structuralRole: 'processor',
  profile: 'control-plane',
  defaultRenderer: 'serviceNode'
})

register('idempotency-manager', {
  category: 'auxiliary',
  structuralRole: 'processor',
  profile: 'control-plane',
  defaultRenderer: 'serviceNode'
})

register('reservation-store', {
  category: 'auxiliary',
  structuralRole: 'processor',
  profile: 'control-plane',
  defaultRenderer: 'serviceNode'
})

register('distributed-lock', {
  category: 'consensus-and-coordination',
  structuralRole: 'processor',
  profile: 'control-plane',
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
