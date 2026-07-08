import { LucideIcon } from 'lucide-react'
import type { GlobalConfig, WorkloadProfile } from '../../../engine/core/types'
import type { CanvasNodeDataV2, RendererNodeType } from '../../../engine/catalog/nodeSpecTypes'
import type { LibraryItemInfo } from '@renderer/config/libraryInfo'

export type AnyNodeData = CanvasNodeDataV2
export type ServiceNodeData = CanvasNodeDataV2
export type ComputeNodeData = CanvasNodeDataV2
export type SecurityNodeData = CanvasNodeDataV2
export type VpcNodeData = CanvasNodeDataV2

export interface NodeSimulationMetrics {
  throughput?: number
  queueDepth?: number
  utilization?: number
  errorRate?: number
  active?: boolean
}

export interface EdgeSimulationData {
  protocol?: 'https' | 'grpc' | 'tcp' | 'udp' | 'websocket' | 'amqp' | 'kafka'
  mode?: 'synchronous' | 'asynchronous' | 'streaming' | 'conditional'
  latencyMu?: number
  latencySigma?: number
  pathType?: 'same-rack' | 'same-dc' | 'cross-zone' | 'cross-region' | 'internet'
  bandwidth?: number
  maxConcurrentRequests?: number
  packetLossRate?: number
  errorRate?: number
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
}

export interface SourceNodeOption {
  id: string
  label: string
  workload: NonNullable<CanvasNodeDataV2['source']>['defaultWorkload']
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
  workloadOverride: {}
}

export function normalizeScenarioState(value: unknown): ScenarioState {
  if (!value || typeof value !== 'object') {
    return {
      global: { ...DEFAULT_SCENARIO_STATE.global },
      selectedSourceNodeId: DEFAULT_SCENARIO_STATE.selectedSourceNodeId,
      workloadOverride: {}
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
    workloadOverride: workloadOverride ? { ...workloadOverride } : {}
  }
}
