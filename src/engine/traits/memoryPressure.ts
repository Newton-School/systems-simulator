import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { ComponentNode, ComponentType } from '../core/types'
import { deriveNodeConcurrency } from '../nodes/resourceDerivation'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const MEMORY_PRESSURE_COMPONENT_TYPES = [
  'microservice',
  'batch-worker',
  'in-memory-cache',
  'queue',
  'message-broker',
  'pub-sub',
  'stream',
  'event-bus',
  'search-index',
  'vector-db',
  'memory-fabric'
] as const satisfies readonly ComponentType[]

const DEFAULT_WORKING_SET_PENALTY_MS = 20
const DEFAULT_GC_PRESSURE_START_RATIO = 0.8
const DEFAULT_GC_PAUSE_MS = 40

interface MemoryPressureConfig {
  workingSetActive: boolean
  workingSetRatio: number
  workingSetPenaltyMs: number
  gcPressureActive: boolean
  gcPressureStartRatio: number
  gcPauseMs: number
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asProbability(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function workingSetRatioPlaceholder(data: CanvasNodeDataV2): string {
  const configured = asPositiveNumber(data.sim?.workingSetRatio)
  return configured !== null
    ? `Configured: ${configured.toFixed(2)}x RAM`
    : '1.0 = fits in RAM, >1.0 = hot set spills/evicts'
}

function workingSetPenaltyPlaceholder(data: CanvasNodeDataV2): string {
  const configured = asPositiveNumber(data.sim?.workingSetPenaltyMs)
  return configured !== null
    ? `Configured: ${configured.toFixed(0)}ms`
    : `Default when working-set ratio is set: ${DEFAULT_WORKING_SET_PENALTY_MS}ms`
}

function gcPressureThresholdPlaceholder(data: CanvasNodeDataV2): string {
  const configured = asProbability(data.sim?.gcPressureStartRatio)
  return configured !== null
    ? `Configured: ${(configured * 100).toFixed(0)}% full`
    : `Default when GC pause is set: ${(DEFAULT_GC_PRESSURE_START_RATIO * 100).toFixed(0)}%`
}

function gcPausePlaceholder(data: CanvasNodeDataV2): string {
  const configured = asPositiveNumber(data.sim?.gcPauseMs)
  return configured !== null
    ? `Configured: ${configured.toFixed(0)}ms`
    : `Default when GC pressure threshold is set: ${DEFAULT_GC_PAUSE_MS}ms`
}

export function readMemoryPressureConfig(node: ComponentNode): MemoryPressureConfig {
  const workingSetRatio = asPositiveNumber(node.config?.['workingSetRatio'])
  const workingSetPenaltyMs = asPositiveNumber(node.config?.['workingSetPenaltyMs'])
  const gcPressureStartRatio = asProbability(node.config?.['gcPressureStartRatio'])
  const gcPauseMs = asPositiveNumber(node.config?.['gcPauseMs'])

  return {
    workingSetActive: workingSetRatio !== null,
    workingSetRatio: workingSetRatio ?? 1,
    workingSetPenaltyMs: workingSetPenaltyMs ?? DEFAULT_WORKING_SET_PENALTY_MS,
    gcPressureActive: gcPressureStartRatio !== null || gcPauseMs !== null,
    gcPressureStartRatio: gcPressureStartRatio ?? DEFAULT_GC_PRESSURE_START_RATIO,
    gcPauseMs: gcPauseMs ?? DEFAULT_GC_PAUSE_MS
  }
}

function computeWorkingSetPressure(config: MemoryPressureConfig): number {
  if (!config.workingSetActive || config.workingSetRatio <= 1) {
    return 0
  }

  return clamp01((config.workingSetRatio - 1) / config.workingSetRatio)
}

function computeGcPressure(node: ComponentNode, totalInSystem: number, startRatio: number): number {
  const effectiveK = Math.max(1, deriveNodeConcurrency(node).effectiveK)
  const occupancyRatio = clamp01(totalInSystem / effectiveK)

  if (startRatio >= 1) {
    return occupancyRatio >= 1 ? 1 : 0
  }

  if (occupancyRatio <= startRatio) {
    return 0
  }

  return clamp01((occupancyRatio - startRatio) / (1 - startRatio))
}

export const memoryPressureTrait: NodeBehaviourTrait = {
  name: 'memory.pressure',
  beforeArrival: ({ node, nodeState, request }) => {
    const config = readMemoryPressureConfig(node)
    const workingSetPressure = computeWorkingSetPressure(config)
    const occupancyRatio = config.gcPressureActive
      ? clamp01((nodeState?.totalInSystem ?? 0) / Math.max(1, deriveNodeConcurrency(node).effectiveK))
      : 0
    const gcPressure = config.gcPressureActive
      ? computeGcPressure(node, nodeState?.totalInSystem ?? 0, config.gcPressureStartRatio)
      : 0

    const workingSetPenaltyMs = workingSetPressure * config.workingSetPenaltyMs
    const gcPenaltyMs = gcPressure * config.gcPauseMs
    const totalPenaltyMs = workingSetPenaltyMs + gcPenaltyMs

    if (totalPenaltyMs <= 0) {
      return { action: 'continue' }
    }

    const existingPenalty =
      typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
        ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
        : 0
    request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existingPenalty + totalPenaltyMs

    const metricCounters: Record<string, number> = { memoryPressureEvents: 1 }
    if (workingSetPressure > 0) {
      metricCounters.workingSetPressureEvents = 1
    }
    if (gcPressure > 0) {
      metricCounters.gcPressureEvents = 1
    }

    return {
      action: 'continue',
      payload: {
        memoryPressure: true,
        workingSetRatio: round3(config.workingSetRatio),
        workingSetPressureRatio: round3(workingSetPressure),
        workingSetPenaltyMs: round3(workingSetPenaltyMs),
        memoryOccupancyRatio: round3(occupancyRatio),
        gcPressureRatio: round3(gcPressure),
        gcPressureStartRatio: round3(config.gcPressureStartRatio),
        gcPenaltyMs: round3(gcPenaltyMs),
        memoryPressurePenaltyMs: round3(totalPenaltyMs),
        metricCounters
      }
    }
  }
}

export const memoryPressureCapabilityModule: NodeCapabilityModule = {
  name: 'memory.pressure',
  appliesTo: MEMORY_PRESSURE_COMPONENT_TYPES,
  hooks: memoryPressureTrait,
  config: {
    sections: [
      {
        id: 'memory-pressure',
        title: 'Memory Pressure',
        note: 'This models soft slowdown before hard OOM. The queue model still derives a RAM-capped admission limit and can reject with `oom`; these knobs add extra latency earlier, when the hot working set spills out of RAM or the heap/backlog is close enough to full that GC or memory churn starts to hurt tail latency.',
        fields: [
          {
            path: 'sim.workingSetRatio',
            type: 'input',
            label: 'Working-set ratio',
            unit: 'x RAM',
            step: 0.1,
            altitude: 'advanced',
            placeholder: workingSetRatioPlaceholder,
            why: 'Compares the hot working set to provisioned RAM. 1.0 means it fits; values above 1.0 model spill/eviction pressure.'
          },
          {
            path: 'sim.workingSetPenaltyMs',
            type: 'input',
            label: 'Working-set miss penalty',
            unit: 'ms',
            step: 1,
            altitude: 'advanced',
            placeholder: workingSetPenaltyPlaceholder,
            why: 'Extra latency paid when the hot working set no longer fits in RAM.'
          },
          {
            path: 'sim.gcPressureStartRatio',
            type: 'input',
            label: 'GC pressure threshold',
            unit: 'ratio',
            step: 0.05,
            altitude: 'advanced',
            placeholder: gcPressureThresholdPlaceholder,
            why: 'Fraction of the node’s RAM-bound admission limit at which heap/backlog pressure starts adding latency.'
          },
          {
            path: 'sim.gcPauseMs',
            type: 'input',
            label: 'Max GC pause',
            unit: 'ms',
            step: 1,
            altitude: 'advanced',
            placeholder: gcPausePlaceholder,
            why: 'Maximum extra latency added when the node is effectively full and memory pressure is highest.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['memoryPressureEvents', 'workingSetPressureEvents', 'gcPressureEvents']
  },
  honesty: {
    simulates: [
      'soft latency penalties when the hot working set exceeds RAM',
      'tail-latency growth as the RAM-bound admission limit fills up'
    ],
    notModeled: [
      'byte-accurate allocators and page cache behavior',
      'allocator fragmentation and compaction',
      'cache eviction policy details'
    ]
  }
}
