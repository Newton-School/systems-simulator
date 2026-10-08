/**
 * Human-readable field labels for validation messages (#223).
 *
 * Validation runs on engine topology JSON, whose paths (`nodes[2].config.cacheHitRate`,
 * `edges.0.maxConcurrentRequests`, `workload.baseRps`) are not what a user sees. This
 * module maps those paths onto the labels the editor already shows:
 *
 * - node fields resolve through `NODE_CONFIG_MODULES`, the same field definitions the
 *   properties panel renders, so a renamed UI label renames the message too;
 * - edge fields resolve through `EDGE_FIELD_LABELS`, which the edge panel renders;
 * - global run settings resolve through `GLOBAL_FIELD_LABELS`, which the settings tab renders.
 *
 * Only fields the editor never shows (legacy or JSON-only keys) fall back to the small
 * `ENGINE_ONLY_FIELD_LABELS` table, and anything still unknown is humanized from its key,
 * so a raw camelCase key never reaches a message.
 */
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import { EDGE_FIELD_LABELS, type EdgeFieldKey } from '../defaults/edgeFieldLabels'
import { NODE_CONFIG_MODULES, moduleAppliesToNode } from '../traits/capabilityModules'
import type { ConfigField } from '../traits/types'
import { GLOBAL_FIELD_LABELS, queueFieldLabels } from './validationCopy'

export { GLOBAL_FIELD_LABELS }

/**
 * Keys the editor does not render as a field (legacy resource keys, JSON-only engine
 * settings, nested distribution parameters). Kept short on purpose: anything the UI
 * shows must resolve through the UI definitions instead.
 */
const ENGINE_ONLY_FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  label: 'Name',
  type: 'Component type',
  category: 'Category',
  role: 'Role',
  provider: 'Provider',
  position: 'Canvas position',
  workers: 'Workers',
  capacity: 'Queue capacity',
  workersPerInstance: 'Workers per instance',
  queueSlots: 'Queue slots',
  perRequestMemMb: 'Memory per request',
  maxInstances: 'Max instances',
  cpu: 'CPU',
  memory: 'Memory',
  replicas: 'Replicas',
  maxReplicas: 'Max replicas',
  distribution: 'Distribution',
  timeout: 'Timeout',
  value: 'Value',
  lambda: 'Lambda',
  mu: 'Mu',
  sigma: 'Sigma',
  mean: 'Mean',
  stdDev: 'Std dev',
  min: 'Min',
  max: 'Max',
  shape: 'Shape',
  scale: 'Scale',
  alpha: 'Alpha',
  beta: 'Beta',
  samples: 'Samples',
  components: 'Mixture components',
  storageReadMs: 'Read latency',
  storageWriteMs: 'Write latency',
  storageQueryMs: 'Query latency',
  storageScanMs: 'Scan latency',
  storageIngestMs: 'Ingest latency',
  checkIntervalMs: 'Check interval',
  unhealthyThreshold: 'Unhealthy threshold',
  healthyThreshold: 'Healthy threshold',
  monitoredNodes: 'Monitored nodes',
  coldStartLatency: 'Cold start latency',
  readLatency: 'Read latency',
  writeLatency: 'Write latency',
  geoTargets: 'Geolocation targets',
  // Workload keys that the source panel nests under its own sections.
  sourceNodeId: 'Workload source',
  sizeBytes: 'Payload size',
  weight: 'Weight',
  field: 'Key field',
  size: 'Number of keys',
  skew: 'Skew',
  metadata: 'Metadata',
  keyspace: 'Keyspace',
  peakMultiplier: 'Peak multiplier',
  hourlyMultipliers: 'Hourly multipliers',
  stopCondition: 'Stop condition',
  mode: 'Mode',
  maxRequests: 'Request budget',
  haltOnSaturation: 'Halt on saturation',
  utilization: 'Utilization',
  errorRate: 'Error rate',
  latitude: 'Latitude',
  longitude: 'Longitude',
  regionId: 'Region',
  availabilityZoneId: 'Availability zone',
  subnetId: 'Subnet',
  parentId: 'Parent location',
  providerCode: 'Region code',
  coordinates: 'Coordinates',
  targetId: 'Fault target',
  faultType: 'Fault type'
}

/** Turns a camelCase or kebab key into a sentence-case label: `maxReceiveCount` -> `Max receive count`. */
export function humanizeFieldKey(key: string): string {
  const spaced = key
    .replace(/Ms$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  if (spaced.length === 0) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function isIndexSegment(segment: string): boolean {
  return /^\d+$/.test(segment)
}

/** Splits `a[0].b.1.c` into `['a', '0', 'b', '1', 'c']`. */
export function splitFieldPath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0)
}

function fallbackLabel(segments: readonly string[]): string {
  const named = segments.filter((segment) => !isIndexSegment(segment))
  const last = named[named.length - 1] ?? 'value'
  return ENGINE_ONLY_FIELD_LABELS[last] ?? humanizeFieldKey(last)
}

function resolveConfigFieldLabel(field: ConfigField, data: CanvasNodeDataV2): string | undefined {
  if (typeof field.label === 'string') return field.label
  try {
    return field.label(data)
  } catch {
    return undefined
  }
}

/**
 * Finds the properties-panel label for a canvas field path such as `sim.cacheHitRate`.
 * Modules that apply to this node win (two traits can share a path with different
 * labels); any module that defines the path is the fallback.
 */
export function uiNodeFieldLabel(
  canvasPath: string,
  data: Partial<CanvasNodeDataV2> = {}
): string | undefined {
  const nodeData = data as CanvasNodeDataV2
  let fallback: string | undefined
  for (const module of NODE_CONFIG_MODULES) {
    const fields = module.config?.sections.flatMap((section) => section.fields) ?? []
    const field = fields.find((candidate) => candidate.path === canvasPath)
    if (!field) continue
    let applies = false
    try {
      applies = moduleAppliesToNode(module, nodeData)
    } catch {
      applies = false
    }
    const label = resolveConfigFieldLabel(field, nodeData)
    if (!label) continue
    if (applies) return label
    fallback ??= label
  }
  return fallback
}

/**
 * Maps an engine node path (relative to the node: `config.cacheHitRate`,
 * `resilience.retry.maxAttempts`, `processing.distribution.sigma`) onto the canvas
 * path the properties panel uses (`sim.cacheHitRate`, `sim.retry.maxAttempts`, ...).
 */
function canvasPathForEngineNodePath(segments: readonly string[]): string {
  const named = segments.filter((segment) => !isIndexSegment(segment))
  const [head, ...rest] = named
  if (head === 'config' || head === 'resilience') {
    return ['sim', ...rest].join('.')
  }
  return ['sim', ...named].join('.')
}

export interface NodeFieldContext {
  componentType?: string
  templateId?: string
  data?: Partial<CanvasNodeDataV2>
}

/**
 * Label for a field on a node, given its engine path relative to the node
 * (for example `queue.workers` or `config.circuitBreaker.failureThreshold`).
 */
export function nodeFieldLabel(relativePath: string, context: NodeFieldContext = {}): string {
  const segments = splitFieldPath(relativePath)
  const data: Partial<CanvasNodeDataV2> = {
    ...(context.data ?? {}),
    ...(context.componentType
      ? { componentType: context.componentType as CanvasNodeDataV2['componentType'] }
      : {}),
    ...(context.templateId ? { templateId: context.templateId } : {})
  }

  if (segments[0] === 'queue' && (segments[1] === 'workers' || segments[1] === 'capacity')) {
    return queueFieldLabels(data.componentType)[segments[1]]
  }

  return uiNodeFieldLabel(canvasPathForEngineNodePath(segments), data) ?? fallbackLabel(segments)
}

/** Label for a workload field, given its path relative to `workload`. */
export function workloadFieldLabel(relativePath: string): string {
  const segments = splitFieldPath(relativePath)
  const named = segments.filter((segment) => !isIndexSegment(segment))
  const head = named[0]
  if (head === 'requestDistribution' && named.length === 1) {
    return uiNodeFieldLabel('source.requestDistribution') ?? 'Requests'
  }
  if (head === 'requestDistribution' || head === 'origins') {
    return fallbackLabel(segments.slice(2))
  }
  return (
    uiNodeFieldLabel(['source', 'defaultWorkload', ...named].join('.')) ?? fallbackLabel(segments)
  )
}

/** Engine `edge.connection.*` / `edge.batching.*` paths -> the panel's flat field keys. */
const NESTED_EDGE_FIELD_KEYS: Record<string, EdgeFieldKey> = {
  'connection.reuse': 'connectionReuse',
  'connection.tls': 'tlsVersion',
  'connection.tlsSessionResumption': 'tlsSessionResumption',
  'connection.idleTimeoutMs': 'connectionIdleTimeoutMs',
  'connection.maxConnections': 'maxConnections',
  'connection.maxStreamsPerConnection': 'maxStreamsPerConnection',
  'batching.lingerMs': 'batchLingerMs',
  'batching.maxBatchBytes': 'batchMaxBytes'
}

/** Label for an edge field, given its path relative to the edge. */
export function edgeFieldLabel(relativePath: string): string {
  const named = splitFieldPath(relativePath).filter((segment) => !isIndexSegment(segment))
  const [head, second, third] = named
  let key: EdgeFieldKey | undefined
  if (head === 'latency') {
    if (second === 'pathType') key = 'pathType'
    else if (third === 'mu') key = 'latencyMu'
    else if (third === 'sigma') key = 'latencySigma'
    else if (third === 'value') key = 'latencyValue'
    else key = 'latency'
  } else if (head === 'connection' || head === 'batching') {
    key = second ? NESTED_EDGE_FIELD_KEYS[`${head}.${second}`] : undefined
  } else if (head && head in EDGE_FIELD_LABELS) {
    key = head as EdgeFieldKey
  }
  if (key) return EDGE_FIELD_LABELS[key].label
  if (head === 'source') return 'Source node'
  if (head === 'target') return 'Target node'
  return fallbackLabel(named)
}

/** Label for a global run setting, given its path relative to `global`. */
export function globalFieldLabel(relativePath: string): string {
  const head = splitFieldPath(relativePath)[0] ?? ''
  return GLOBAL_FIELD_LABELS[head as keyof typeof GLOBAL_FIELD_LABELS] ?? fallbackLabel([head])
}
