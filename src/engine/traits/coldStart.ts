import { msToMicro } from '../core/time'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type {
  ComponentNode,
  ComponentType,
  DistributionConfig,
  RandomGenerator
} from '../core/types'
import { Distributions } from '../stochastic/distribution'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY, asDistributionConfig } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const COLD_START_COMPONENT_TYPES = [
  'serverless-function'
] as const satisfies readonly ComponentType[]

const DEFAULT_COLD_START_LATENCY_MS = 200
const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_MAX_CONCURRENCY = 8

interface ColdStartConfig {
  coldStartLatency: DistributionConfig
  idleTimeoutMs: number
  maxConcurrency: number
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asPositiveInt(value: unknown): number | null {
  const num = asPositiveNumber(value)
  return num !== null ? Math.round(num) : null
}

function coldStartLatencyPlaceholder(data: CanvasNodeDataV2): string {
  // The engine also accepts a full distribution via `sim.coldStartLatency`; when that
  // is set (as some sample scenarios do) this scalar field is intentionally left empty,
  // so surface the effective value instead of showing a blank, broken-looking input.
  const distribution = data.sim?.coldStartLatency
  if (distribution && distribution.type === 'exponential' && distribution.lambda > 0) {
    return `Using distribution ≈ ${Math.round(1 / distribution.lambda)}ms mean`
  }
  return `Default: ${DEFAULT_COLD_START_LATENCY_MS}ms after idle`
}

function createTraitRng(random?: () => number): RandomGenerator {
  const next = () => random?.() ?? Math.random()
  return {
    next,
    between: (min, max) => min + next() * (max - min),
    integer: (min, max) => Math.floor(min + next() * (max - min + 1)),
    boolean: (probability = 0.5) => next() < probability
  }
}

function sampleDistribution(config: DistributionConfig, random?: () => number): number {
  return new Distributions(createTraitRng(random)).fromConfig(config)
}

export function readColdStartConfig(node: ComponentNode): ColdStartConfig {
  const configuredDistribution =
    asDistributionConfig(node.config?.['coldStartLatency']) ??
    node.scaling?.coldStartPenalty?.distribution

  return {
    coldStartLatency: configuredDistribution ?? {
      type: 'exponential',
      lambda: 1 / DEFAULT_COLD_START_LATENCY_MS
    },
    idleTimeoutMs: asPositiveNumber(node.config?.['idleTimeoutMs']) ?? DEFAULT_IDLE_TIMEOUT_MS,
    maxConcurrency:
      asPositiveInt(node.config?.['maxConcurrency']) ??
      node.resilience?.bulkhead?.maxConcurrent ??
      node.queue?.workers ??
      DEFAULT_MAX_CONCURRENCY
  }
}

export const coldStartTrait: NodeBehaviourTrait = {
  name: 'compute.cold-start',
  beforeArrival: ({ node, request, clock, random, state, nodeState }) => {
    const config = readColdStartConfig(node)

    if ((nodeState?.activeWorkers ?? 0) >= config.maxConcurrency) {
      return {
        action: 'rejected',
        reason: 'max_concurrency_exceeded',
        payload: {
          maxConcurrency: config.maxConcurrency,
          metricCounters: { coldStartThrottles: 1 }
        }
      }
    }

    const key = 'cold-start:last-request-at-us'
    const lastRequestAt = state?.get<bigint>(key)
    state?.set(key, clock)

    if (lastRequestAt !== undefined && clock - lastRequestAt <= msToMicro(config.idleTimeoutMs)) {
      return {
        action: 'continue',
        payload: { coldStart: false, idleTimeoutMs: config.idleTimeoutMs }
      }
    }

    const coldStartMs = Math.max(0, sampleDistribution(config.coldStartLatency, random))
    const existingPenalty =
      typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
        ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
        : 0
    request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existingPenalty + coldStartMs

    return {
      action: 'continue',
      payload: {
        coldStart: true,
        coldStartMs,
        idleTimeoutMs: config.idleTimeoutMs,
        metricCounters: { coldStarts: 1 }
      }
    }
  }
}

export const coldStartCapabilityModule: NodeCapabilityModule = {
  name: 'compute.cold-start',
  appliesTo: COLD_START_COMPONENT_TYPES,
  hooks: coldStartTrait,
  config: {
    sections: [
      {
        id: 'cold-start',
        title: 'Cold Start',
        fields: [
          {
            path: 'sim.coldStartLatencyMs',
            type: 'input',
            label: 'Cold start latency',
            unit: 'ms',
            step: 1,
            placeholder: coldStartLatencyPlaceholder,
            why: 'Adds one-off startup latency after the function has been idle.'
          },
          {
            path: 'sim.idleTimeoutMs',
            type: 'input',
            label: 'Idle timeout',
            unit: 'ms',
            step: 100,
            why: 'Requests after this idle window are treated as cold.'
          },
          {
            path: 'sim.maxConcurrency',
            type: 'input',
            label: 'Max concurrency',
            unit: 'req',
            step: 1,
            why: 'Caps how many concurrent invocations the function can run before throttling.'
          }
        ]
      }
    ]
  },
  defaults: [
    {
      path: 'sim.coldStartLatencyMs',
      value: DEFAULT_COLD_START_LATENCY_MS,
      rationale: 'Cold serverless starts usually cost hundreds of milliseconds, not single digits.'
    },
    {
      path: 'sim.idleTimeoutMs',
      value: DEFAULT_IDLE_TIMEOUT_MS,
      rationale: 'Idle functions cool down after tens of seconds, not immediately.'
    },
    {
      path: 'sim.maxConcurrency',
      value: DEFAULT_MAX_CONCURRENCY,
      rationale: 'Concurrency caps are part of the teaching model for serverless throttling.'
    }
  ],
  metrics: {
    counters: ['coldStarts', 'coldStartThrottles'],
    rejectionReasons: ['max_concurrency_exceeded']
  },
  honesty: {
    simulates: ['cold-start latency after idle windows', 'hard concurrency throttling'],
    notModeled: ['provisioned concurrency pools', 'container image pull time']
  }
}
