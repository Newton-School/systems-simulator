import { LucideIcon } from 'lucide-react'
import type {
  EdgePresentationRoutingStyle,
  FaultSpec,
  GlobalConfig,
  WorkloadProfile
} from '../../../engine/core/types'
import type { CanvasNodeDataV2, RendererNodeType } from '../../../engine/catalog/nodeSpecTypes'
import type { LatencyPercentiles, TimeToErrorSummary } from '../../../engine/metrics'
import type { LibraryItemInfo } from '@renderer/config/libraryInfo'

export type AnyNodeData = CanvasNodeDataV2
export type ServiceNodeData = CanvasNodeDataV2
export type ComputeNodeData = CanvasNodeDataV2
export type SecurityNodeData = CanvasNodeDataV2
export type VpcNodeData = CanvasNodeDataV2

export type ThemeMode = 'light' | 'dark'
export type PreRunMetricLens = 'instance' | 'concurrency' | 'queueCapacity' | 'timeout' | 'cost'
export type RuntimeMetricLens = 'traffic' | 'saturation' | 'latency' | 'errors' | 'throughput'
export type MetricLens = PreRunMetricLens | RuntimeMetricLens
export type LatencyLensPercentile = 'p50' | 'p95' | 'p99'
export type ResultsTabId = 'overview' | 'bottlenecks' | 'nodes' | 'traffic'
export type ComponentLibraryMode = 'default' | 'all'
export type EdgeRoutingStyle = EdgePresentationRoutingStyle

export interface DisplaySettings {
  theme: ThemeMode
  defaultMetricLens: PreRunMetricLens
  latencyLensPercentile: LatencyLensPercentile
  autoOpenSimulationTray: boolean
  defaultResultsTab: ResultsTabId
  /** Controls the library baseline; per-item hiding is applied on top. */
  componentLibraryMode: ComponentLibraryMode
  /** Palette template ids explicitly hidden by the user. */
  hiddenComponentLibraryTemplateIds: string[]
  /** When false, the SPOF badge and danger ring are hidden on canvas nodes. */
  showSpofBadges: boolean
  /** Geometry used by both normal canvas edges and the causal request tracer. */
  edgeRoutingStyle: EdgeRoutingStyle
  /**
   * When true, request dots on edges are colored by their affinity/partition key
   * so session affinity and sharding are visible (a key's color stays on one edge
   * under sticky/shard routing, and scatters under round-robin).
   */
  colorDotsByKey: boolean
}

export interface NodeSimulationMetrics {
  throughput?: number
  postWarmupArrived?: number
  postWarmupProcessed?: number
  postWarmupRejected?: number
  postWarmupTimedOut?: number
  postWarmupConnectionReset?: number
  postWarmupInFlight?: number
  queueDepth?: number
  utilization?: number
  errorRate?: number
  active?: boolean
  // Real, already-computed values that used to be dropped between
  // PerNodeMetrics and the render store - surfaced so cards/panels can show
  // what a trait actually did instead of only the generic four numbers.
  avgServiceTime?: number
  latencyP50?: number
  latencyP95?: number
  latencyP99?: number
  successLatencySamples?: number
  timeToErrorSamples?: number
  latencyWindowErrorRate?: number
  latencyNodeLocal?: LatencyPercentiles
  timeToErrorByCause?: TimeToErrorSummary
  availability?: number
  cacheHits?: number
  cacheMisses?: number
  cacheHitRatio?: number
  rejectionsByReason?: Record<string, number>
  traitCounters?: Record<string, number>
  totalArrived?: number
  totalRejected?: number
  peakInSystem?: number
  finalInSystem?: number
}

export interface EdgeSimulationData {
  /** Optional visual override. Undefined inherits the canvas-wide display preference. */
  routingStyle?: EdgeRoutingStyle
  /**
   * Presentation-only protocol used by connector-mode diagrams. It deliberately
   * stays separate from `protocol`, which participates in simulation semantics.
   */
  displayProtocol?: 'https' | 'grpc' | 'tcp' | 'udp' | 'websocket' | 'amqp' | 'kafka'
  /**
   * Presentation-only interaction mode used by connector-mode diagrams. It can
   * change the line pattern without changing routing or simulation results.
   */
  displayMode?: 'synchronous' | 'asynchronous' | 'streaming' | 'conditional'
  protocol?: 'https' | 'grpc' | 'tcp' | 'udp' | 'websocket' | 'amqp' | 'kafka'
  mode?: 'synchronous' | 'asynchronous' | 'streaming' | 'conditional'
  latencyDistributionType?: 'log-normal' | 'constant'
  latencyValue?: number
  latencyMu?: number
  latencySigma?: number
  pathType?: 'same-rack' | 'same-dc' | 'cross-zone' | 'cross-region' | 'internet'
  bandwidth?: number
  maxConcurrentRequests?: number
  packetLossRate?: number
  errorRate?: number
  condition?: string
  /**
   * Relative weight for weighted routing at the source. Among a source's edges,
   * each edge's share of traffic is its weight ÷ the sum of sibling weights.
   * Only used when the source's routing strategy is `weighted` (or unset with
   * weights present). Empty/≤0 is treated as weight 1.
   */
  weight?: number
  /**
   * Fan-out amplification: each request over this edge is delivered to this many
   * recipients (e.g. a post → N follower feed writes). ≤1 or empty = no amplification.
   */
  fanoutFactor?: number
}

export type NodeType = RendererNodeType

export interface ColorTheme {
  bg: string
  border: string
  text: string
}

export interface CatalogItem {
  id: string
  templateId: string
  type: NodeType
  label: string
  subLabel: string
  icon: LucideIcon
  color: ColorTheme
  info: LibraryItemInfo
}

export interface CatalogCategory {
  id: string
  title: string
  items: CatalogItem[]
}

export interface ScenarioState {
  global: Pick<
    GlobalConfig,
    'simulationDuration' | 'warmupDuration' | 'seed' | 'defaultTimeout' | 'traceSampleRate'
  >
  selectedSourceNodeId?: string
  workloadOverride?: Partial<Omit<WorkloadProfile, 'sourceNodeId' | 'requestDistribution'>>
  /** Chaos faults injected at run time (scheduled node-failure/recovery events). */
  faults?: FaultSpec[]
  /** Regenerate the seed before each run, while still recording the actual seed used. */
  randomizeSeedEachRun?: boolean
}

export interface SourceNodeOption {
  id: string
  label: string
  workload: NonNullable<CanvasNodeDataV2['source']>['defaultWorkload']
}

/** A node the operator can target with an injected fault. */
export interface FaultTargetOption {
  id: string
  label: string
}

export interface ScenarioRunContext {
  sourceNodeId: string
  sourceLabel: string
  global: ScenarioState['global']
  workload: WorkloadProfile
}

export const DEFAULT_SCENARIO_STATE: ScenarioState = {
  global: {
    simulationDuration: 60_000,
    warmupDuration: 5_000,
    seed: 'default-seed',
    defaultTimeout: 5_000,
    traceSampleRate: 0.01
  },
  selectedSourceNodeId: undefined,
  workloadOverride: {},
  faults: [],
  randomizeSeedEachRun: false
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  theme: 'dark',
  defaultMetricLens: 'concurrency',
  latencyLensPercentile: 'p95',
  autoOpenSimulationTray: true,
  defaultResultsTab: 'overview',
  componentLibraryMode: 'default',
  hiddenComponentLibraryTemplateIds: [],
  showSpofBadges: true,
  edgeRoutingStyle: 'straight',
  colorDotsByKey: false
}

export function normalizeScenarioState(value: unknown): ScenarioState {
  if (!value || typeof value !== 'object') {
    return {
      global: { ...DEFAULT_SCENARIO_STATE.global },
      selectedSourceNodeId: DEFAULT_SCENARIO_STATE.selectedSourceNodeId,
      workloadOverride: {},
      faults: [],
      randomizeSeedEachRun: false
    }
  }

  const scenario = value as Partial<ScenarioState>
  const global =
    scenario.global && typeof scenario.global === 'object' ? scenario.global : undefined
  const workloadOverride =
    scenario.workloadOverride && typeof scenario.workloadOverride === 'object'
      ? scenario.workloadOverride
      : undefined

  return {
    global: {
      ...DEFAULT_SCENARIO_STATE.global,
      ...global
    },
    selectedSourceNodeId:
      typeof scenario.selectedSourceNodeId === 'string' && scenario.selectedSourceNodeId.length > 0
        ? scenario.selectedSourceNodeId
        : undefined,
    workloadOverride: workloadOverride ? { ...workloadOverride } : {},
    faults: Array.isArray(scenario.faults) ? scenario.faults : [],
    randomizeSeedEachRun: scenario.randomizeSeedEachRun === true
  }
}
