import type {
  ComponentCategory,
  ComponentNode,
  ComponentType,
  DistributionConfig,
  ResourceConfig,
  SLOConfig,
  WorkloadProfile
} from '../core/types'
import type { ContentRoutingRule } from '../traits/contentRouting'

export type StructuralRole = 'source' | 'processor' | 'storage' | 'router' | 'sink' | 'composite'

export type NodeProfile =
  | 'source'
  | 'router'
  | 'compute-service'
  | 'worker'
  | 'datastore'
  | 'broker'
  | 'security-filter'
  | 'control-plane'
  | 'observability'
  | 'integration'
  | 'composite'

export type RendererNodeType = 'serviceNode' | 'computeNode' | 'securityNode' | 'vpcNode'

export type RoutingStrategy =
  | 'round-robin'
  | 'weighted'
  | 'random'
  | 'least-conn'
  | 'broadcast'
  | 'conditional'
  | 'passthrough'

export interface NodeSimulationConfig {
  /**
   * Authored physical resource allocation (AWS instance model). When present, it
   * drives serialized `resources` and thus effective concurrency/K and cost; when
   * absent, serialization falls back to reproducing the raw queue. Edited via the
   * RESOURCES config section.
   */
  resources?: ResourceConfig
  queue?: {
    workers: number
    capacity: number
    discipline: 'fifo' | 'lifo' | 'priority' | 'wfq'
  }
  processing?: {
    distribution: DistributionConfig
    timeout: number
  }
  nodeErrorRate?: number
  securityPolicy?: {
    blockRate?: number
    droppedPackets?: number
  }
  healthCheckEnabled?: boolean
  cacheHitRate?: number
  cacheHitLatencyMs?: number
  ttlSeconds?: number
  cacheEngine?: 'redis' | 'memcached'
  cacheStrategy?: 'cache-aside' | 'read-through' | 'write-through' | 'write-behind'
  dataModel?: 'document' | 'key-value' | 'wide-column'
  routingRules?: ContentRoutingRule[]
  maxTokens?: number
  refillRatePerSecond?: number
  retry?: {
    maxAttempts?: number
    baseDelay?: number
    maxDelay?: number
    multiplier?: number
    jitter?: boolean
  }
  coldStartLatency?: DistributionConfig
  coldStartLatencyMs?: number
  idleTimeoutMs?: number
  maxConcurrency?: number
  locationId?: string
  routingKeyField?: string
  dnsRoutingPolicy?: 'simple' | 'weighted' | 'failover' | 'latency-based' | 'geolocation'
  dnsCacheTtlSeconds?: number
  circuitBreaker?: {
    failureThreshold: number
    failureCount: number
    recoveryTimeout: number
    halfOpenRequests: number
  }
  replicationEnabled?: boolean
  replicationMode?: 'primary-replica' | 'leader-follower'
  replicationRole?: 'primary' | 'replica' | 'leader' | 'follower'
  replicationLagMs?: number
  writeAckPolicy?: 'primary' | 'quorum'
  failoverUntilMs?: number
  replicaMembers?: string
  consensusProtocol?: 'raft' | 'none'
  conflictResolution?: 'leader-wins' | 'highest-index-wins'
  shardCount?: number
  readLatency?: DistributionConfig
  writeLatency?: DistributionConfig
  /**
   * Canvas-simple mean-latency inputs for ReadWriteSplitTrait - serialized
   * into readLatency/writeLatency as exponential distributions. JSON-authored
   * topologies can still set the full DistributionConfig directly.
   */
  readLatencyMs?: number
  writeLatencyMs?: number
  storageReadMs?: number
  storageWriteMs?: number
  storageQueryMs?: number
  storageScanMs?: number
  storageIngestMs?: number
  dedupWindowMs?: number
  storeLookupMs?: number
  dedupKeyField?: string
  lockKeyField?: string
  acquireMs?: number
  leaseMs?: number
  fencing?: boolean
  deliverySemantics?: 'at-most-once' | 'at-least-once' | 'exactly-once'
  visibilityTimeoutMs?: number
  maxReceiveCount?: number
  dlqNodeId?: string
  workingSetRatio?: number
  workingSetPenaltyMs?: number
  gcPressureStartRatio?: number
  gcPauseMs?: number
  slo?: SLOConfig
}

export interface SourceConfig {
  requestDistribution: WorkloadProfile['requestDistribution']
  defaultWorkload: Omit<WorkloadProfile, 'sourceNodeId' | 'requestDistribution'>
}

export interface CanvasNodeUiState {
  overloadPreview?: boolean
}

export interface CanvasNodeDataV2 {
  schemaVersion: 2
  templateId: string
  componentType?: ComponentType
  structuralRole: StructuralRole
  profile: NodeProfile
  rendererType: RendererNodeType
  label: string
  subLabel?: string
  iconKey: string
  routingStrategy?: RoutingStrategy
  sim?: NodeSimulationConfig
  source?: SourceConfig
  ui?: CanvasNodeUiState
}

export interface LegacySeedMetrics {
  throughput?: number
  load?: number
  queueDepth?: number
  workers?: number
  capacity?: number
  queueDiscipline?: 'fifo' | 'lifo' | 'priority' | 'wfq'
  meanServiceMs?: number
  timeoutMs?: number
  vCPU?: number
  ram?: number
  nodeErrorRate?: number
  blockRate?: number
  droppedPackets?: number
  overloadPreview?: boolean
  requestType?: string
  requestSizeBytes?: number
  baseRps?: number
  pattern?: WorkloadProfile['pattern']
}

export interface PaletteTemplate {
  id: string
  componentType?: ComponentType
  category?: ComponentCategory
  structuralRole: StructuralRole
  profile: NodeProfile
  rendererType: RendererNodeType
  iconKey: string
  label: string
  subLabel: string
  serializable: boolean
  seed?: LegacySeedMetrics
  routingStrategy?: RoutingStrategy
  asyncBoundary?: boolean
  /** Template-level configuration layered on top of type defaults at creation. */
  simDefaults?: Partial<NodeSimulationConfig>
}

export interface SerializeContext {
  nodeId: string
  position: { x: number; y: number }
}

export interface ComponentSpec {
  componentType: ComponentType
  category: ComponentCategory
  structuralRole: Exclude<StructuralRole, 'composite'>
  profile: Exclude<NodeProfile, 'composite'>
  defaultRenderer: Exclude<RendererNodeType, 'vpcNode'>
  routingStrategy?: RoutingStrategy
  asyncBoundary?: boolean
  createDefaultSimulationConfig: (seed?: LegacySeedMetrics) => NodeSimulationConfig
  validateCanvas: (data: CanvasNodeDataV2) => string[]
  serializeCanvas: (data: CanvasNodeDataV2, ctx: SerializeContext) => ComponentNode | null
}
