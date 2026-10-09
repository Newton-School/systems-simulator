import type { Edge, Node } from 'reactflow'
import type {
  ComponentNode,
  DistributionConfig,
  EdgeDefinition,
  TopologyLocation,
  TopologyJSON,
  WorkloadProfile
} from '../../../engine/core/types'
import { instantiateTemplate, PALETTE_TEMPLATES } from '../../../engine/catalog/paletteTemplates'
import type {
  CanvasNodeDataV2,
  NodeSimulationConfig,
  PaletteTemplate,
  RoutingStrategy,
  TopologyNodeCarry
} from '../../../engine/catalog/nodeSpecTypes'
import { isCustomNodeDefinition } from '../../../engine/catalog/customDefinitions'
import { getComponentSpec } from '../../../engine/catalog/componentSpecs'
import type { EdgeSimulationData, ScenarioState, TopologyMeta } from '@renderer/types/ui'
import { DEFAULT_SCENARIO_STATE } from '@renderer/types/ui'
import type { NestedFileData, NestedNode } from './nodeTransformers'
import { convertFlatToNested } from './nodeTransformers'
import { computeNodeExtra } from './topologyCarry'
import { getPathTypeLatencyProfile } from '../../../engine/defaults/edgeDefaults'

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
    value === 'least-response-time' ||
    value === 'p2c' ||
    value === 'sticky' ||
    value === 'ip-hash' ||
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
    if (replicationRole === 'replica' || replicationRole === 'follower') {
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
    return pickStandInTemplate(node)
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

/**
 * An engine type with no palette template of its own (e.g. `kv-store`, or
 * `payment-gateway`, which has no canvas component at all) is rendered with the
 * closest template: same component profile, else same category. The real type
 * is restored on export through the node's topology carry.
 */
function pickStandInTemplate(node: ComponentNode): PaletteTemplate | null {
  const spec = getComponentSpec(node.type)
  const serializable = Object.values(PALETTE_TEMPLATES).filter(
    (template) =>
      template.serializable &&
      template.profile !== 'source' &&
      template.profile !== 'composite' &&
      getComponentSpec(template.componentType) !== undefined
  )
  const sameProfile = spec
    ? serializable.find(
        (template) =>
          getComponentSpec(template.componentType)?.profile === spec.profile &&
          template.category === node.category
      )
    : undefined
  const sameCategory = serializable.find((template) => template.category === node.category)
  return sameProfile ?? sameCategory ?? PALETTE_TEMPLATES['backend-server'] ?? null
}

/** Every workload field except the two the source node holds separately. */
function buildSourceDefaults(workload: WorkloadProfile) {
  const defaults: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(workload)) {
    if (key === 'sourceNodeId' || key === 'requestDistribution' || value === undefined) continue
    defaults[key] = structuredClone(value)
  }
  return defaults as Omit<WorkloadProfile, 'sourceNodeId' | 'requestDistribution'>
}

type HandleSide = 'left' | 'right' | 'top' | 'bottom'

function buildHandleId(side: HandleSide, kind: 'source' | 'target'): string {
  return `${side}-1-${kind}`
}

function inferHandleSides(
  sourcePosition: { x: number; y: number },
  targetPosition: { x: number; y: number }
): { sourceSide: HandleSide; targetSide: HandleSide } {
  const dx = targetPosition.x - sourcePosition.x
  const dy = targetPosition.y - sourcePosition.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceSide: 'right', targetSide: 'left' }
      : { sourceSide: 'left', targetSide: 'right' }
  }

  return dy >= 0
    ? { sourceSide: 'bottom', targetSide: 'top' }
    : { sourceSide: 'top', targetSide: 'bottom' }
}

function synthesizeEdgeHandles(
  edge: EdgeDefinition,
  nodePositions: ReadonlyMap<string, { x: number; y: number }>
): Pick<Edge, 'sourceHandle' | 'targetHandle'> {
  const sourcePosition = nodePositions.get(edge.source)
  const targetPosition = nodePositions.get(edge.target)
  const inferred =
    sourcePosition && targetPosition
      ? inferHandleSides(sourcePosition, targetPosition)
      : { sourceSide: 'right' as const, targetSide: 'left' as const }

  return {
    sourceHandle: edge.sourceHandle ?? buildHandleId(inferred.sourceSide, 'source'),
    targetHandle: edge.targetHandle ?? buildHandleId(inferred.targetSide, 'target')
  }
}

function overlaySimulationConfig(
  node: ComponentNode,
  initial: NodeSimulationConfig | undefined
): NodeSimulationConfig | undefined {
  const sim: NodeSimulationConfig = initial ? structuredClone(initial) : {}

  if (node.provider) {
    sim.provider = node.provider
  }

  if (node.queue) {
    sim.queue = structuredClone(node.queue)
  }

  // Preserve an authored instance allocation so the RESOURCES selector reflects
  // the loaded topology's real instance, not a fallback default.
  if (node.resources) {
    sim.resources = structuredClone(node.resources)
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

  if (isRecord(config['securityPolicy'])) {
    sim.securityPolicy = {
      blockRate: asNumber(config['securityPolicy']['blockRate']) ?? 0,
      droppedPackets: asNumber(config['securityPolicy']['droppedPackets']) ?? 0
    }
  }

  if (resilience?.retry) {
    sim.retry = structuredClone(resilience.retry)
  }

  if (asNumber(config['nodeErrorRate']) !== undefined) {
    sim.nodeErrorRate = asNumber(config['nodeErrorRate'])
  }

  if (asBoolean(config['healthCheckEnabled']) !== undefined) {
    sim.healthCheckEnabled = asBoolean(config['healthCheckEnabled'])
  }

  if (asNumber(config['cacheHitRate']) !== undefined) {
    sim.cacheHitRate = asNumber(config['cacheHitRate'])
  }

  if (config['cacheModel'] === 'declared-rate' || config['cacheModel'] === 'derived-lru') {
    sim.cacheModel = config['cacheModel']
  }

  if (asBoolean(config['requestCollapsing']) !== undefined) {
    sim.requestCollapsing = asBoolean(config['requestCollapsing'])
  }

  if (asNumber(config['cacheRamMb']) !== undefined) {
    sim.cacheRamMb = asNumber(config['cacheRamMb'])
  }

  if (asNumber(config['valueSizeBytes']) !== undefined) {
    sim.valueSizeBytes = asNumber(config['valueSizeBytes'])
  }

  if (asNumber(config['cacheHitLatencyMs']) !== undefined) {
    sim.cacheHitLatencyMs = asNumber(config['cacheHitLatencyMs'])
  }

  if (asNumber(config['ttlSeconds']) !== undefined) {
    sim.ttlSeconds = asNumber(config['ttlSeconds'])
  }

  if (config['cacheEngine'] === 'redis' || config['cacheEngine'] === 'memcached') {
    sim.cacheEngine = config['cacheEngine']
  }
  if (
    config['cacheStrategy'] === 'cache-aside' ||
    config['cacheStrategy'] === 'read-through' ||
    config['cacheStrategy'] === 'write-through' ||
    config['cacheStrategy'] === 'write-behind'
  ) {
    sim.cacheStrategy = config['cacheStrategy']
  }
  if (
    config['dataModel'] === 'document' ||
    config['dataModel'] === 'key-value' ||
    config['dataModel'] === 'wide-column'
  ) {
    sim.dataModel = config['dataModel']
  }
  if (asBoolean(config['replicationEnabled']) !== undefined) {
    sim.replicationEnabled = asBoolean(config['replicationEnabled'])
  }
  if (
    config['replicationRole'] === 'primary' ||
    config['replicationRole'] === 'replica' ||
    config['replicationRole'] === 'leader' ||
    config['replicationRole'] === 'follower'
  ) {
    sim.replicationRole = config['replicationRole']
  }
  for (const field of ['replicationLagMs', 'failoverUntilMs', 'shardCount'] as const) {
    const value = asNumber(config[field])
    if (value !== undefined) sim[field] = value
  }
  if (config['writeAckPolicy'] === 'primary' || config['writeAckPolicy'] === 'quorum') {
    sim.writeAckPolicy = config['writeAckPolicy']
  }
  if (asString(config['replicaMembers'])) sim.replicaMembers = asString(config['replicaMembers'])
  if (config['consensusProtocol'] === 'raft' || config['consensusProtocol'] === 'none') {
    sim.consensusProtocol = config['consensusProtocol']
  }
  if (
    config['conflictResolution'] === 'leader-wins' ||
    config['conflictResolution'] === 'highest-index-wins'
  ) {
    sim.conflictResolution = config['conflictResolution']
  }
  if (
    config['consistencyModel'] === 'eventual' ||
    config['consistencyModel'] === 'monotonic-reads' ||
    config['consistencyModel'] === 'read-your-writes' ||
    config['consistencyModel'] === 'strong'
  ) {
    sim.consistencyModel = config['consistencyModel']
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

  const bulkheadPartitions = resilience?.bulkhead?.partitions
  if (bulkheadPartitions && Object.keys(bulkheadPartitions).length > 0) {
    sim.bulkheadPartitions = { ...bulkheadPartitions }
  }
  if (asNumber(resilience?.bulkhead?.defaultMaxConcurrent) !== undefined) {
    sim.bulkheadDefaultMaxConcurrent = resilience?.bulkhead?.defaultMaxConcurrent
  }
  if (asString(resilience?.bulkhead?.keyField)) {
    sim.bulkheadKeyField = asString(resilience?.bulkhead?.keyField)
  }

  for (const field of ['loadShedQueueDepth', 'loadShedMaxQueueDelayMs'] as const) {
    if (asNumber(config[field]) !== undefined) {
      sim[field] = asNumber(config[field])
    }
  }
  if (config['loadShedProtectHighPriority'] === true) {
    sim.loadShedProtectHighPriority = true
  }

  if (asString(config['routingKeyField'])) {
    sim.routingKeyField = asString(config['routingKeyField'])
  }

  if (asString(config['stickyKeyField'])) {
    sim.stickyKeyField = asString(config['stickyKeyField'])
  }

  if (typeof config['consumerGroupMode'] === 'boolean') {
    sim.consumerGroupMode = config['consumerGroupMode']
  }

  if (asString(config['consumerGroup'])) {
    sim.consumerGroup = asString(config['consumerGroup'])
  }

  if (typeof config['streamBrokerEnabled'] === 'boolean') {
    sim.streamBrokerEnabled = config['streamBrokerEnabled']
  }

  if (asNumber(config['partitionCount']) !== undefined) {
    sim.partitionCount = asNumber(config['partitionCount'])
  }

  if (asString(config['partitionKeyField'])) {
    sim.partitionKeyField = asString(config['partitionKeyField'])
  }

  for (const field of [
    'retentionMs',
    'streamReplayIntervalMs',
    'brokerFailureAtMs',
    'brokerRecoveryAtMs'
  ] as const) {
    if (asNumber(config[field]) !== undefined) {
      sim[field] = asNumber(config[field])
    }
  }

  // Scheduler, telemetry sink, change stream and held-connection traits.
  for (const field of [
    'podStartupMs',
    'rescheduleDelayMs',
    'machineProvisionMs',
    'machineFailureAtMs',
    'machineRecoveryAtMs',
    'telemetryIngestRps',
    'telemetrySampleRate',
    'memPerConnectionKb',
    'heartbeatCostMs',
    'pushSendMs',
    'clusterMaxMachines',
    'machineFailureCount',
    'pushRecipients'
  ] as const) {
    if (asNumber(config[field]) !== undefined) {
      sim[field] = asNumber(config[field])
    }
  }
  for (const field of ['telemetryAsyncIngest', 'changeStreamOrdering'] as const) {
    if (typeof config[field] === 'boolean') {
      sim[field] = config[field]
    }
  }
  for (const field of ['scheduledOn', 'changeKeyField'] as const) {
    if (asString(config[field])) {
      sim[field] = asString(config[field])
    }
  }
  if (config['placementStrategy'] === 'spread' || config['placementStrategy'] === 'bin-pack') {
    sim.placementStrategy = config['placementStrategy']
  }
  if (
    config['consumerOrdering'] === 'parallel' ||
    config['consumerOrdering'] === 'per-partition' ||
    config['consumerOrdering'] === 'per-key'
  ) {
    sim.consumerOrdering = config['consumerOrdering']
  }
  const heldConnections = asNumber(config['heldConnections'])
  if (heldConnections !== undefined && heldConnections > 0) {
    const heartbeatIntervalMs = asNumber(config['heartbeatIntervalMs'])
    sim.connection = {
      ...(sim.connection ?? { maxConnectionsPerInstance: 65000, sessionProtocol: 'websocket' }),
      offeredConnections: heldConnections,
      ...(asNumber(config['maxConnectionsPerInstance']) !== undefined
        ? { maxConnectionsPerInstance: asNumber(config['maxConnectionsPerInstance'])! }
        : {}),
      // Absent means no keepalives were declared; don't let the template's
      // default add heartbeat load on a plain import -> export.
      heartbeatIntervalMs: heartbeatIntervalMs ?? 0
    }
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

  for (const field of [
    'storageReadMs',
    'storageWriteMs',
    'storageQueryMs',
    'storageScanMs',
    'storageIngestMs',
    'dedupWindowMs',
    'storeLookupMs',
    'workingSetRatio',
    'workingSetPenaltyMs',
    'gcPressureStartRatio',
    'gcPauseMs'
  ] as const) {
    const value = asNumber(config[field])
    if (value !== undefined) {
      sim[field] = value
    }
  }

  if (typeof config['dedupKeyField'] === 'string' && config['dedupKeyField'].trim().length > 0) {
    sim.dedupKeyField = config['dedupKeyField'].trim()
  }

  return Object.keys(sim).length > 0 ? sim : undefined
}

/**
 * Sim keys that serialize to a differently named engine field. Used to drop
 * template defaults the imported node never authored (see pruneUnauthoredDefaults).
 */
const SIM_KEYS_BY_ENGINE_FIELD: Record<string, readonly (keyof NodeSimulationConfig)[]> = {
  coldStartLatency: ['coldStartLatency', 'coldStartLatencyMs'],
  readLatency: ['readLatency', 'readLatencyMs'],
  writeLatency: ['writeLatency', 'writeLatencyMs']
}

/**
 * Template defaults fill every editor field, but an imported node that never
 * set, say, `healthCheckEnabled` must not export one: that would change the
 * engine input on a plain import -> export. Drop each default the source node
 * did not author, unless the canvas needs it to stay valid.
 */
function pruneUnauthoredDefaults(node: ComponentNode, data: CanvasNodeDataV2): void {
  const spec = getComponentSpec(data.componentType)
  const sim = data.sim
  if (!spec || !sim || spec.structuralRole === 'source') return
  const produced = spec.serializeCanvas(data, { nodeId: node.id, position: node.position })
  if (!produced) return

  const originalConfig = node.config ?? {}
  const candidates = new Set<keyof NodeSimulationConfig>()
  for (const field of Object.keys(produced.config ?? {})) {
    if (field in originalConfig) continue
    for (const key of SIM_KEYS_BY_ENGINE_FIELD[field] ?? [field as keyof NodeSimulationConfig]) {
      if (sim[key] !== undefined) candidates.add(key)
    }
  }
  if (produced.resilience?.circuitBreaker && !node.resilience?.circuitBreaker) {
    if (!('circuitBreaker' in originalConfig)) candidates.add('circuitBreaker')
  }
  if (produced.resilience?.retry && !node.resilience?.retry) candidates.add('retry')
  if (produced.slo && !node.slo) candidates.add('slo')

  const baselineErrors = spec.validateCanvas(data).length
  const mutableSim = sim as Record<string, unknown>
  for (const key of candidates) {
    const saved = mutableSim[key]
    delete mutableSim[key]
    if (spec.validateCanvas(data).length > baselineErrors) {
      mutableSim[key] = saved
    }
  }
}

function convertNode(
  node: ComponentNode,
  workload?: WorkloadProfile
): Node<CanvasNodeDataV2> | null {
  const template = pickTemplateForNode(node)
  if (!template) {
    return null
  }

  const data = instantiateTemplate(template.id)
  data.label = node.label

  // A stand-in template (no template for this engine type): keep the real type
  // when the canvas has a component spec for it, otherwise carry it to export.
  const carry: TopologyNodeCarry = {}
  if (template.componentType !== node.type) {
    const ownSpec = getComponentSpec(node.type)
    if (ownSpec) {
      data.componentType = node.type
      data.structuralRole = ownSpec.structuralRole
      data.profile = ownSpec.profile
    } else {
      carry.type = node.type
      carry.category = node.category
    }
  }

  if (isCustomNodeDefinition(node.config?.['customDefinition'])) {
    data.customDefinition = structuredClone(node.config?.['customDefinition'])
  }

  // An unset strategy means the engine's default for the type; do not let the
  // template's default become an authored value on export.
  data.routingStrategy = asRoutingStrategy(node.config?.['routingStrategy'])

  data.sim = overlaySimulationConfig(node, data.sim)
  pruneUnauthoredDefaults(node, data)

  if (workload && workload.sourceNodeId === node.id) {
    data.source = {
      requestDistribution: structuredClone(workload.requestDistribution),
      defaultWorkload: buildSourceDefaults(workload)
    }
  }

  // Whatever the canvas cannot reproduce is carried so export stays lossless.
  const spec = getComponentSpec(data.componentType)
  const produced = spec
    ? spec.serializeCanvas(data, { nodeId: node.id, position: node.position })
    : null
  if (node.role && produced && produced.role !== node.role) {
    carry.role = node.role
  }
  const extra = computeNodeExtra(node, produced)
  if (extra) carry.extra = extra
  if (Object.keys(carry).length > 0) data.topologyCarry = carry

  return {
    id: node.id,
    type: data.rendererType,
    position: structuredClone(node.position),
    data
  }
}

function locationTemplateId(location: TopologyLocation): string | null {
  switch (location.kind) {
    case 'region':
      return 'vpc-region'
    case 'availability-zone':
      return 'availability-zone'
    case 'subnet':
      return 'subnet'
    case 'edge-pop':
      return null
  }
}

function convertLocation(location: TopologyLocation): Node<CanvasNodeDataV2> | null {
  const templateId = locationTemplateId(location)
  if (!templateId) return null
  const data = instantiateTemplate(templateId)
  data.label = location.label
  data.sim = {
    locationId: location.providerCode,
    locationProvider: location.provider,
    locationLatitude: location.coordinates?.latitude,
    locationLongitude: location.coordinates?.longitude
  }

  return {
    id: location.id,
    type: data.rendererType,
    position: structuredClone(location.position ?? { x: 0, y: 0 }),
    parentNode: location.parentId,
    extent: location.parentId ? 'parent' : undefined,
    style: location.size ? { width: location.size.width, height: location.size.height } : undefined,
    data
  }
}

function mostSpecificPlacementParent(
  node: ComponentNode,
  locationIds: ReadonlySet<string>
): string | undefined {
  const candidates = [
    node.placement?.subnetId,
    node.placement?.availabilityZoneId,
    node.placement?.regionId
  ]
  return candidates.find((id): id is string => Boolean(id && locationIds.has(id)))
}

function absoluteLocationPosition(
  locationId: string,
  byId: ReadonlyMap<string, TopologyLocation>,
  memo: Map<string, { x: number; y: number }>,
  visiting = new Set<string>()
): { x: number; y: number } {
  const cached = memo.get(locationId)
  if (cached) return cached
  const location = byId.get(locationId)
  if (!location || visiting.has(locationId)) return { x: 0, y: 0 }
  visiting.add(locationId)
  const local = location.position ?? { x: 0, y: 0 }
  const parent = location.parentId
    ? absoluteLocationPosition(location.parentId, byId, memo, visiting)
    : { x: 0, y: 0 }
  const result = { x: local.x + parent.x, y: local.y + parent.y }
  memo.set(locationId, result)
  visiting.delete(locationId)
  return result
}

/** Ratio -> percent without float noise (0.07 * 100 is 7.000000000000001). */
function ratioToPercent(value: number): number {
  return Number((value * 100).toPrecision(12))
}

function edgeDataFromTopology(edge: EdgeDefinition): EdgeSimulationData {
  const distribution = edge.latency.distribution
  const isConstant = distribution.type === 'constant' || distribution.type === 'deterministic'
  // An edge whose latency was derived from its path type keeps that link: leave
  // the explicit values unset so export derives (and flags) them again, and the
  // geo-aware resolver can still replace them.
  const derived =
    edge.latency.derivedFromPathType === true && latencyMatchesPathProfile(edge, distribution)
  return {
    routingStyle: edge.presentation?.routingStyle,
    protocol: edge.protocol,
    mode: edge.mode,
    latencyDistributionType: isConstant ? 'constant' : 'log-normal',
    latencyValue: !derived && isConstant ? distribution.value : undefined,
    latencyMu: !derived && distribution.type === 'log-normal' ? distribution.mu : undefined,
    latencySigma: !derived && distribution.type === 'log-normal' ? distribution.sigma : undefined,
    pathType: edge.latency.pathType,
    bandwidth: edge.bandwidth,
    maxConcurrentRequests: edge.maxConcurrentRequests,
    packetLossRate: ratioToPercent(edge.packetLossRate),
    errorRate: ratioToPercent(edge.errorRate),
    condition: edge.condition,
    weight: edge.weight,
    fanoutFactor: edge.fanoutFactor,
    connectionReuse: edge.connection?.reuse,
    tlsVersion: edge.connection?.tls,
    tlsSessionResumption: edge.connection?.tlsSessionResumption,
    connectionIdleTimeoutMs: edge.connection?.idleTimeoutMs,
    maxConnections: edge.connection?.maxConnections,
    maxStreamsPerConnection: edge.connection?.maxStreamsPerConnection,
    batchLingerMs: edge.batching?.lingerMs,
    batchMaxBytes: edge.batching?.maxBatchBytes
  }
}

function latencyMatchesPathProfile(
  edge: EdgeDefinition,
  distribution: DistributionConfig
): boolean {
  const profile = getPathTypeLatencyProfile(edge.latency.pathType)
  if (distribution.type === 'constant' || distribution.type === 'deterministic') {
    return distribution.value === Math.exp(profile.mu)
  }
  return (
    distribution.type === 'log-normal' &&
    distribution.mu === profile.mu &&
    distribution.sigma === profile.sigma
  )
}

function convertEdge(
  edge: EdgeDefinition,
  nodePositions: ReadonlyMap<string, { x: number; y: number }>
): Edge {
  const handles = synthesizeEdgeHandles(edge, nodePositions)

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: edgeDataFromTopology(edge),
    animated: edge.animated,
    sourceHandle: handles.sourceHandle,
    targetHandle: handles.targetHandle
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
    workloadOverride: {},
    faults: topology.faults ?? [],
    randomizeSeedEachRun: false,
    topologyMeta: buildTopologyMeta(topology)
  }
}

function buildTopologyMeta(topology: TopologyJSON): TopologyMeta {
  return {
    id: topology.id,
    name: topology.name,
    version: topology.version,
    timeResolution: topology.global.timeResolution,
    ...(topology.networkModel ? { networkModel: structuredClone(topology.networkModel) } : {}),
    ...(topology.invariants?.length ? { invariants: structuredClone(topology.invariants) } : {}),
    ...(topology.scenarios?.length ? { scenarios: structuredClone(topology.scenarios) } : {})
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
  const runtimeNodes = topology.nodes
    .map((node) => convertNode(node, topology.workload))
    .filter((node): node is Node<CanvasNodeDataV2> => node !== null)
  const locations = topology.locations ?? []
  const locationIds = new Set(locations.map((location) => location.id))
  const locationsById = new Map(locations.map((location) => [location.id, location]))
  const absoluteLocationPositions = new Map<string, { x: number; y: number }>()
  const locationNodes = locations
    .map(convertLocation)
    .filter((node): node is Node<CanvasNodeDataV2> => node !== null)

  for (let index = 0; index < runtimeNodes.length; index++) {
    const runtimeNode = runtimeNodes[index]!
    const sourceNode = topology.nodes.find((node) => node.id === runtimeNode.id)
    if (!sourceNode) continue
    const parentNode = mostSpecificPlacementParent(sourceNode, locationIds)
    if (!parentNode) continue
    const parentPosition = absoluteLocationPosition(
      parentNode,
      locationsById,
      absoluteLocationPositions
    )
    runtimeNodes[index] = {
      ...runtimeNode,
      parentNode,
      extent: 'parent',
      position: {
        x: runtimeNode.position.x - parentPosition.x,
        y: runtimeNode.position.y - parentPosition.y
      }
    }
  }

  const flatNodes = [...locationNodes, ...runtimeNodes]
  const nodes = convertFlatToNested(flatNodes) as NestedNode[]
  const nodePositions = new Map(topology.nodes.map((node) => [node.id, node.position]))

  return {
    nodes,
    edges: topology.edges.map((edge) => convertEdge(edge, nodePositions)),
    scenario: buildScenarioState(topology)
  }
}

/**
 * The canvas data one TopologyJSON node maps to (the same conversion a full
 * import uses). The JSON viewer diffs two of these to turn a field edit into a
 * canvas patch.
 */
export function topologyNodeToCanvasData(
  node: ComponentNode,
  workload?: WorkloadProfile
): CanvasNodeDataV2 | null {
  return convertNode(node, workload)?.data ?? null
}

/** The canvas label and data one TopologyJSON edge maps to. */
export function topologyEdgeToCanvasData(edge: EdgeDefinition): {
  label?: string
  data: EdgeSimulationData
} {
  return { label: edge.label, data: edgeDataFromTopology(edge) }
}
