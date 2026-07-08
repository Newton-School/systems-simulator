import type {
  ComponentCategory,
  ComponentNode,
  ComponentType,
  DistributionConfig,
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
  routingRules?: ContentRoutingRule[]
  maxTokens?: number
  refillRatePerSecond?: number
  replicationRole?: 'primary' | 'replica'
  readLatency?: DistributionConfig
  writeLatency?: DistributionConfig
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
