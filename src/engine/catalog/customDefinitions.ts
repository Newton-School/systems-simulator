import type { ComponentType } from '../core/types'
import type { CanvasNodeDataV2 } from './nodeSpecTypes'

export type CustomDefinitionKind = 'service' | 'custom-node'

export type RuntimeTemplateId =
  | 'long-running-service'
  | 'serverless-function'
  | 'background-worker'
  | 'external-dependency'
  | 'relational-datastore'
  | 'object-store'
  | 'distributed-cache'
  | 'message-queue'
  | 'event-stream'
  | 'request-source'

export type CustomNodeClass =
  | 'compute'
  | 'storage'
  | 'network'
  | 'messaging'
  | 'external'
  | 'security'
  | 'observability'
  | 'coordination'
  | 'auxiliary'

export type CapabilityId =
  | 'accept-requests'
  | 'process-requests'
  | 'route-requests'
  | 'read-data'
  | 'write-data'
  | 'cache-data'
  | 'enqueue-messages'
  | 'publish-events'
  | 'subscribe-events'
  | 'invoke-external-api'
  | 'rate-limit'
  | 'authenticate'
  | 'observe'
  | 'coordinate'

/**
 * Trait packs that map to `sim.*` and change simulation output. A pack lives here
 * only if it has both a builder field editor and a mapping in `applyDefinitionTraits`
 * (honesty contract §0.2). `circuit-breaker`, `idempotency`, and `async-emission`
 * were removed in V1 because they had no runtime mapping — re-add only alongside a
 * mapping. (The `circuit-breaker-controller` / `idempotency-manager` engine
 * component types are unrelated and still fully implemented.)
 */
export type TraitPackId =
  | 'capacity'
  | 'workload-profile'
  | 'serverless-lifecycle'
  | 'retry-timeout'
  | 'rate-limiting'
  | 'external-dependency'
  | 'cache'
  | 'arrival'

export type FieldClass = 'info' | 'contract' | 'runtime'

export type DependencyAction =
  | 'read'
  | 'write'
  | 'publish'
  | 'invoke'
  | 'enqueue'
  | 'subscribe'
  | 'route'
  | 'observe'

export type DependencyTargetRole =
  | 'service'
  | 'cache'
  | 'database'
  | 'queue'
  | 'stream'
  | 'object-store'
  | 'search-index'
  | 'external-api'
  | 'auth-provider'
  | 'observability'
  | 'any'

/** Canonical dependency-action list. Both dependency editors (builder modal and
 * properties panel) must render exactly these, so a stored action never lands on an
 * editor that cannot display it (honesty contract §0.2). */
export const DEPENDENCY_ACTIONS: ReadonlyArray<{ id: DependencyAction; label: string }> = [
  { id: 'read', label: 'Read' },
  { id: 'write', label: 'Write' },
  { id: 'invoke', label: 'Invoke' },
  { id: 'publish', label: 'Publish' },
  { id: 'enqueue', label: 'Enqueue' },
  { id: 'subscribe', label: 'Subscribe' },
  { id: 'route', label: 'Route' },
  { id: 'observe', label: 'Observe' }
]

export const DEPENDENCY_TARGET_ROLES: ReadonlyArray<{ id: DependencyTargetRole; label: string }> = [
  { id: 'service', label: 'Service' },
  { id: 'cache', label: 'Cache' },
  { id: 'database', label: 'Database' },
  { id: 'queue', label: 'Queue' },
  { id: 'stream', label: 'Stream' },
  { id: 'object-store', label: 'Object store' },
  { id: 'search-index', label: 'Search index' },
  { id: 'external-api', label: 'External API' },
  { id: 'auth-provider', label: 'Auth provider' },
  { id: 'observability', label: 'Observability' },
  { id: 'any', label: 'Any' }
]

export const DEPENDENCY_CONDITIONS: ReadonlyArray<{
  id: NonNullable<CustomDependencyIntent['condition']>
  label: string
}> = [
  { id: 'always', label: 'Always' },
  { id: 'success', label: 'On success' },
  { id: 'failure', label: 'On failure' },
  { id: 'cache-hit', label: 'On cache hit' },
  { id: 'cache-miss', label: 'On cache miss' }
]

export interface ContractField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
}

export interface CustomDependencyIntent {
  target: string
  targetRole?: DependencyTargetRole
  action: DependencyAction
  required?: boolean
  callMode?: 'sync' | 'async'
  condition?: 'always' | 'success' | 'failure' | 'cache-hit' | 'cache-miss'
}

export interface CustomOperationDefinition {
  id: string
  label?: string
  requestType: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path?: string
  responseType: string
  intent?: 'read' | 'write' | 'read-write' | 'compute' | 'side-effect'
  /** Relative share of emitted traffic for this operation. Only consumed when the
   * node is a traffic source (runtime template whose component type is a source, e.g.
   * `request-source`); projected into `sim.source.requestDistribution`. Defaults to an
   * equal split when omitted. Documentation-only for non-source nodes. */
  weight?: number
  inputFields?: ContractField[]
  outputFields?: ContractField[]
  dependencies: CustomDependencyIntent[]
}

export interface CustomTraitSelection {
  traitId: TraitPackId
  enabled: boolean
  required?: boolean
  values?: Record<string, unknown>
  fieldClasses?: Record<string, FieldClass>
}

export interface CustomNodeDefinition {
  kind: CustomDefinitionKind
  runtimeTemplate: RuntimeTemplateId
  name?: string
  description?: string
  nodeClass?: CustomNodeClass
  capabilities?: CapabilityId[]
  tags?: string[]
  traits?: CustomTraitSelection[]
  operations: CustomOperationDefinition[]
}

export interface RuntimeTemplateDefinition {
  id: RuntimeTemplateId
  label: string
  nodeClass: CustomNodeClass
  componentType: ComponentType
  paletteTemplateId: string
  allowedDefinitionKinds: readonly CustomDefinitionKind[]
  capabilities: readonly CapabilityId[]
  traitPacks: readonly TraitPackId[]
  simulates: readonly string[]
  notModeled: readonly string[]
}

export const RUNTIME_TEMPLATES: Record<RuntimeTemplateId, RuntimeTemplateDefinition> = {
  'long-running-service': {
    id: 'long-running-service',
    label: 'Long-running service',
    nodeClass: 'compute',
    componentType: 'microservice',
    paletteTemplateId: 'backend-server',
    allowedDefinitionKinds: ['service'],
    capabilities: ['accept-requests', 'process-requests', 'invoke-external-api'],
    traitPacks: ['capacity', 'workload-profile', 'retry-timeout', 'rate-limiting'],
    simulates: ['queueing', 'resource-derived concurrency', 'timeouts and retries'],
    notModeled: ['user-written application code']
  },
  'serverless-function': {
    id: 'serverless-function',
    label: 'Serverless function',
    nodeClass: 'compute',
    componentType: 'serverless-function',
    paletteTemplateId: 'lambda-function',
    allowedDefinitionKinds: ['service', 'custom-node'],
    capabilities: ['accept-requests', 'process-requests', 'invoke-external-api'],
    traitPacks: ['workload-profile', 'serverless-lifecycle', 'retry-timeout'],
    simulates: ['cold starts', 'idle windows', 'concurrency throttling'],
    notModeled: ['provider-exact quotas and billing']
  },
  'background-worker': {
    id: 'background-worker',
    label: 'Background worker',
    nodeClass: 'compute',
    componentType: 'batch-worker',
    paletteTemplateId: 'async-worker',
    allowedDefinitionKinds: ['service', 'custom-node'],
    capabilities: ['process-requests', 'enqueue-messages', 'subscribe-events'],
    traitPacks: ['capacity', 'workload-profile', 'retry-timeout'],
    simulates: ['queueing', 'asynchronous processing', 'worker capacity'],
    notModeled: ['arbitrary job code']
  },
  'external-dependency': {
    id: 'external-dependency',
    label: 'External dependency',
    nodeClass: 'external',
    componentType: 'third-party-api-connector',
    paletteTemplateId: 'external-service',
    allowedDefinitionKinds: ['custom-node'],
    capabilities: ['invoke-external-api', 'rate-limit'],
    traitPacks: ['external-dependency', 'retry-timeout'],
    simulates: ['external latency', 'error rate', 'timeouts'],
    notModeled: ['the provider implementation']
  },
  'relational-datastore': {
    id: 'relational-datastore',
    label: 'Relational datastore',
    nodeClass: 'storage',
    componentType: 'relational-db',
    paletteTemplateId: 'primary-db',
    allowedDefinitionKinds: ['custom-node'],
    capabilities: ['read-data', 'write-data'],
    traitPacks: ['capacity', 'workload-profile', 'retry-timeout'],
    simulates: ['read/write service time', 'connection concurrency', 'queueing'],
    notModeled: ['SQL query planning', 'index internals']
  },
  'object-store': {
    id: 'object-store',
    label: 'Object store',
    nodeClass: 'storage',
    componentType: 'object-storage',
    paletteTemplateId: 'object-storage',
    allowedDefinitionKinds: ['custom-node'],
    capabilities: ['read-data', 'write-data'],
    traitPacks: ['capacity', 'workload-profile'],
    simulates: ['object get/put latency', 'throughput ceiling'],
    notModeled: ['storage-class tiering', 'consistency edge cases']
  },
  'distributed-cache': {
    id: 'distributed-cache',
    label: 'Distributed cache',
    nodeClass: 'storage',
    componentType: 'in-memory-cache',
    paletteTemplateId: 'redis-cache',
    allowedDefinitionKinds: ['custom-node'],
    capabilities: ['read-data', 'write-data', 'cache-data'],
    traitPacks: ['cache', 'capacity', 'workload-profile'],
    simulates: ['cache hit/miss split (serve locally vs forward)', 'hit latency'],
    notModeled: ['TTL expiry', 'eviction policy']
  },
  'message-queue': {
    id: 'message-queue',
    label: 'Message queue',
    nodeClass: 'messaging',
    componentType: 'queue',
    paletteTemplateId: 'message-queue',
    allowedDefinitionKinds: ['custom-node'],
    capabilities: ['enqueue-messages', 'subscribe-events'],
    traitPacks: ['capacity', 'workload-profile'],
    simulates: ['enqueue/dequeue capacity', 'backlog growth', 'async delivery'],
    notModeled: ['broker-exact ordering and delivery guarantees']
  },
  'event-stream': {
    id: 'event-stream',
    label: 'Event stream',
    nodeClass: 'messaging',
    componentType: 'stream',
    paletteTemplateId: 'stream',
    allowedDefinitionKinds: ['custom-node'],
    capabilities: ['publish-events', 'subscribe-events'],
    traitPacks: ['capacity', 'workload-profile'],
    simulates: ['append throughput', 'consumer lag', 'ordered log capacity'],
    notModeled: ['partition rebalancing', 'exactly-once semantics']
  },
  'request-source': {
    id: 'request-source',
    label: 'Request source',
    nodeClass: 'network',
    componentType: 'api-endpoint',
    paletteTemplateId: 'input-source',
    allowedDefinitionKinds: ['custom-node'],
    capabilities: ['accept-requests', 'route-requests'],
    traitPacks: ['arrival'],
    // Unlike every other template, this one's operations are NOT documentation-only:
    // their request types + weights become the emitted request mix consumed by the
    // engine (sim.source.requestDistribution). The `arrival` pack sets the rate/pattern.
    simulates: ['request arrival rate & pattern', 'per-operation traffic share'],
    notModeled: ['downstream application logic']
  }
}

export function templateForDefinition(definition: CustomNodeDefinition): RuntimeTemplateDefinition {
  return RUNTIME_TEMPLATES[definition.runtimeTemplate]
}

export function isCustomNodeDefinition(value: unknown): value is CustomNodeDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CustomNodeDefinition>
  return (
    (candidate.kind === 'service' || candidate.kind === 'custom-node') &&
    typeof candidate.runtimeTemplate === 'string' &&
    candidate.runtimeTemplate in RUNTIME_TEMPLATES &&
    RUNTIME_TEMPLATES[candidate.runtimeTemplate].allowedDefinitionKinds.includes(candidate.kind) &&
    Array.isArray(candidate.operations)
  )
}

export function defaultServiceOperations(): CustomOperationDefinition[] {
  return [
    {
      id: 'handle-request',
      label: 'Handle request',
      requestType: 'request',
      responseType: 'response',
      intent: 'compute',
      inputFields: [{ name: 'requestId', type: 'string', required: true }],
      outputFields: [{ name: 'status', type: 'string', required: true }],
      dependencies: []
    }
  ]
}

export function defaultCustomNodeOperations(): CustomOperationDefinition[] {
  return [
    {
      id: 'handle-event',
      label: 'Handle event',
      requestType: 'event',
      responseType: 'completed',
      intent: 'compute',
      dependencies: []
    }
  ]
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function valuesForTrait(
  traits: CustomTraitSelection[],
  traitId: TraitPackId
): Record<string, unknown> {
  const trait = traits.find((candidate) => candidate.traitId === traitId)
  return trait?.enabled ? (trait.values ?? {}) : {}
}

/**
 * Projects a definition's runtime trait values onto `data.sim.*`. This is the single
 * source of truth for how a custom definition changes simulation behavior — every
 * field mapped here must be editable in the builder, and vice versa (honesty
 * contract §0.2). Only enabled traits contribute. Idempotent: safe to re-run
 * whenever the definition is edited (properties panel) as well as at creation.
 */
export function applyDefinitionTraits(
  data: CanvasNodeDataV2,
  definition: CustomNodeDefinition
): void {
  // Source-role nodes (e.g. request-source) may have no `sim` block, but their
  // operations still project into the request mix, and the arrival pack sets the
  // rate/pattern — run both regardless.
  projectOperationsToRequestMix(data, definition)
  projectArrivalToSource(data, definition)
  if (!data.sim) return
  const traits = definition.traits ?? []
  const capacity = valuesForTrait(traits, 'capacity')
  const workload = valuesForTrait(traits, 'workload-profile')
  const serverless = valuesForTrait(traits, 'serverless-lifecycle')
  const retry = valuesForTrait(traits, 'retry-timeout')
  const rateLimit = valuesForTrait(traits, 'rate-limiting')
  const external = valuesForTrait(traits, 'external-dependency')
  const cache = valuesForTrait(traits, 'cache')

  const resources = { ...(data.sim.resources ?? {}) }
  if (capacity.workloadKind === 'cpu-bound' || capacity.workloadKind === 'io-bound') {
    resources.workloadKind = capacity.workloadKind
  }
  const instanceCount = safeNumber(capacity.instanceCount)
  if (instanceCount !== undefined) resources.instanceCount = Math.max(1, Math.round(instanceCount))
  const workersPerInstance = safeNumber(capacity.workersPerInstance)
  if (workersPerInstance !== undefined) {
    resources.workersPerInstance = Math.max(1, Math.round(workersPerInstance))
  }
  const queueSlots = safeNumber(capacity.queueSlots)
  if (queueSlots !== undefined) resources.queueSlots = Math.max(1, Math.round(queueSlots))
  if (Object.keys(resources).length > 0) {
    data.sim.resources = resources
  }

  const serviceTimeMs = safeNumber(workload.serviceTimeMs)
  if (serviceTimeMs !== undefined && serviceTimeMs > 0) {
    data.sim.processing = {
      distribution: { type: 'constant', value: serviceTimeMs },
      timeout: data.sim.processing?.timeout ?? Math.max(100, serviceTimeMs * 40)
    }
  }

  // External-dependency latency: the defining knob of a third-party call. Maps to the
  // node's own service time (how long the external call takes to return). Set before
  // the retry block so a configured timeout still wins on top.
  const externalLatencyMs = safeNumber(external.latencyMs)
  if (externalLatencyMs !== undefined && externalLatencyMs > 0) {
    data.sim.processing = {
      distribution: { type: 'constant', value: externalLatencyMs },
      timeout: data.sim.processing?.timeout ?? Math.max(100, externalLatencyMs * 40)
    }
  }

  const coldStartLatencyMs = safeNumber(serverless.coldStartLatencyMs)
  if (coldStartLatencyMs !== undefined) {
    data.sim.coldStartLatencyMs = Math.max(0, coldStartLatencyMs)
  }
  const idleTimeoutMs = safeNumber(serverless.idleTimeoutMs)
  if (idleTimeoutMs !== undefined) data.sim.idleTimeoutMs = Math.max(0, idleTimeoutMs)
  const maxConcurrency = safeNumber(serverless.maxConcurrency)
  if (maxConcurrency !== undefined) {
    data.sim.maxConcurrency = Math.max(1, Math.round(maxConcurrency))
  }

  const timeoutMs = safeNumber(retry.timeoutMs)
  if (timeoutMs !== undefined && data.sim.processing) {
    data.sim.processing = { ...data.sim.processing, timeout: Math.max(1, timeoutMs) }
  }
  const maxRetries = safeNumber(retry.maxRetries)
  if (maxRetries !== undefined) {
    data.sim.retry = {
      ...(data.sim.retry ?? {}),
      maxAttempts: Math.max(1, Math.round(maxRetries) + 1)
    }
  }

  const limitPerSecond = safeNumber(rateLimit.limitPerSecond)
  if (limitPerSecond !== undefined) {
    data.sim.maxTokens = Math.max(1, Math.round(limitPerSecond))
    data.sim.refillRatePerSecond = Math.max(1, Math.round(limitPerSecond))
  }

  const errorRate = safeNumber(external.errorRate)
  if (errorRate !== undefined) {
    data.sim.nodeErrorRate = Math.min(1, Math.max(0, errorRate / 100))
  }

  const cacheHitRate = safeNumber(cache.cacheHitRate)
  if (cacheHitRate !== undefined) {
    data.sim.cacheHitRate = Math.min(1, Math.max(0, cacheHitRate))
  }
  const cacheHitLatencyMs = safeNumber(cache.cacheHitLatencyMs)
  if (cacheHitLatencyMs !== undefined) {
    data.sim.cacheHitLatencyMs = Math.max(0, cacheHitLatencyMs)
  }
}

/**
 * For source-role nodes only (those `instantiateTemplate` gave a `data.source`), the
 * declared operations are NOT documentation — their request types and weights become
 * the emitted request mix the engine consumes (`sim.source.requestDistribution`).
 * Weights are normalized to sum to 1.0; an omitted weight counts as an equal share.
 * No-op for every non-source node, where operations stay documentation-only.
 */
/** Arrival patterns whose sub-config is pre-seeded on a source, so selecting them from
 * the builder is safe (fine-tuning the sub-config stays post-placement). */
const ARRIVAL_PATTERNS = ['constant', 'poisson', 'bursty', 'diurnal', 'spike', 'sawtooth'] as const

/**
 * For source-role nodes only, the `arrival` pack sets the emission rate and pattern —
 * the defining knobs of a source — onto `sim.source.defaultWorkload` (which the engine
 * consumes). No-op for every non-source node.
 */
function projectArrivalToSource(data: CanvasNodeDataV2, definition: CustomNodeDefinition): void {
  if (!data.source) return
  const arrival = valuesForTrait(definition.traits ?? [], 'arrival')
  const next = { ...data.source.defaultWorkload }
  let changed = false

  const baseRps = safeNumber(arrival.baseRps)
  if (baseRps !== undefined && baseRps > 0) {
    next.baseRps = baseRps
    changed = true
  }
  const pattern = arrival.pattern
  if (typeof pattern === 'string' && (ARRIVAL_PATTERNS as readonly string[]).includes(pattern)) {
    next.pattern = pattern as (typeof ARRIVAL_PATTERNS)[number]
    changed = true
  }

  if (changed) data.source = { ...data.source, defaultWorkload: next }
}

function projectOperationsToRequestMix(
  data: CanvasNodeDataV2,
  definition: CustomNodeDefinition
): void {
  if (!data.source) return
  const operations = definition.operations.filter((operation) => operation.requestType.trim())
  if (operations.length === 0) return

  const rawWeights = operations.map((operation) => {
    const weight = safeNumber(operation.weight)
    return weight !== undefined && weight > 0 ? weight : 1
  })
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0) || operations.length
  const existing = data.source.requestDistribution ?? []
  const defaultSize = existing[0]?.sizeBytes ?? 1024

  data.source = {
    ...data.source,
    requestDistribution: operations.map((operation, index) => ({
      type: operation.requestType.trim(),
      weight: rawWeights[index] / total,
      sizeBytes: defaultSize
    }))
  }
}

export function createDefaultTraits(runtimeTemplate: RuntimeTemplateId): CustomTraitSelection[] {
  return RUNTIME_TEMPLATES[runtimeTemplate].traitPacks.map((traitId) => ({
    traitId,
    enabled:
      traitId === 'capacity' ||
      traitId === 'workload-profile' ||
      (runtimeTemplate === 'serverless-function' && traitId === 'serverless-lifecycle') ||
      (runtimeTemplate === 'external-dependency' && traitId === 'external-dependency') ||
      (runtimeTemplate === 'distributed-cache' && traitId === 'cache') ||
      (runtimeTemplate === 'request-source' && traitId === 'arrival'),
    values: {},
    fieldClasses: {}
  }))
}
