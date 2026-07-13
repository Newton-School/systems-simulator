import { msToMicro } from '../core/time'
import type { Request } from '../core/events'
import type { ComponentNode, ComponentType } from '../core/types'
import type { BeforeRoutingDecision, NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const CIRCUIT_BREAKER_COMPONENT_TYPES = [
  'service-mesh',
  'sidecar'
] as const satisfies readonly ComponentType[]

const CIRCUIT_BREAKER_STATE_KEY = 'circuit-breaker:state'
const CIRCUIT_BREAKER_TRACKING_KEY = 'circuitBreakerTracking'

export interface CircuitBreakerConfig {
  failureThreshold: number
  failureCount: number
  recoveryTimeoutMs: number
  halfOpenRequests: number
}

interface CircuitBreakerState {
  phase: 'closed' | 'open' | 'half-open'
  recentOutcomes: boolean[]
  openUntilUs?: bigint
  halfOpenInFlight: number
  halfOpenSuccesses: number
}

interface CircuitBreakerTracking {
  trackerNodeId: string
  targetNodeId: string
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function asRatio(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 0.5,
  failureCount: 10,
  recoveryTimeoutMs: 15_000,
  halfOpenRequests: 1
}

export function readCircuitBreakerConfig(node: ComponentNode): CircuitBreakerConfig | null {
  const configured =
    node.resilience?.circuitBreaker &&
    asRatio(node.resilience.circuitBreaker.failureThreshold) !== null &&
    asPositiveInt(node.resilience.circuitBreaker.failureCount) !== null &&
    asPositiveInt(node.resilience.circuitBreaker.recoveryTimeout) !== null
      ? {
          failureThreshold: node.resilience.circuitBreaker.failureThreshold,
          failureCount: node.resilience.circuitBreaker.failureCount,
          recoveryTimeoutMs: node.resilience.circuitBreaker.recoveryTimeout,
          halfOpenRequests: node.resilience.circuitBreaker.halfOpenRequests
        }
      : null

  const rawConfig = node.config?.['circuitBreaker']
  if (rawConfig && typeof rawConfig === 'object') {
    const candidate = rawConfig as Record<string, unknown>
    const failureThreshold = asRatio(candidate.failureThreshold)
    const failureCount = asPositiveInt(candidate.failureCount)
    const recoveryTimeoutMs = asPositiveInt(candidate.recoveryTimeout)
    const halfOpenRequests = asPositiveInt(candidate.halfOpenRequests)

    if (
      failureThreshold !== null &&
      failureCount !== null &&
      recoveryTimeoutMs !== null &&
      halfOpenRequests !== null
    ) {
      return {
        failureThreshold,
        failureCount,
        recoveryTimeoutMs,
        halfOpenRequests
      }
    }
  }

  return configured
}

function getState(store: TraitStateStore | undefined): CircuitBreakerState {
  return (
    store?.get<CircuitBreakerState>(CIRCUIT_BREAKER_STATE_KEY) ?? {
      phase: 'closed',
      recentOutcomes: [],
      halfOpenInFlight: 0,
      halfOpenSuccesses: 0
    }
  )
}

function setState(store: TraitStateStore | undefined, value: CircuitBreakerState): void {
  store?.set(CIRCUIT_BREAKER_STATE_KEY, value)
}

function reject(reason: string, phase: CircuitBreakerState['phase']): BeforeRoutingDecision {
  return {
    action: 'rejected',
    reason,
    payload: {
      circuitBreakerPhase: phase,
      metricCounters: { circuitBreakerFastRejects: 1 }
    }
  }
}

export function beginCircuitBreakerRouting(
  store: TraitStateStore | undefined,
  node: ComponentNode,
  clock: bigint
): BeforeRoutingDecision {
  const config = readCircuitBreakerConfig(node)
  if (!config) {
    return { action: 'route' }
  }

  let current = getState(store)
  if (current.phase === 'open' && current.openUntilUs !== undefined && clock >= current.openUntilUs) {
    current = {
      phase: 'half-open',
      recentOutcomes: [],
      halfOpenInFlight: 0,
      halfOpenSuccesses: 0
    }
    setState(store, current)
  }

  if (current.phase === 'open') {
    return reject('circuit_breaker_open', current.phase)
  }

  if (current.phase === 'half-open') {
    if (current.halfOpenInFlight >= config.halfOpenRequests) {
      return reject('circuit_breaker_open', current.phase)
    }

    current = {
      ...current,
      halfOpenInFlight: current.halfOpenInFlight + 1
    }
    setState(store, current)
  }

  return {
    action: 'route',
    payload: { circuitBreakerPhase: current.phase }
  }
}

export function attachCircuitBreakerTracking(
  request: Request,
  trackerNodeId: string,
  targetNodeId: string
): void {
  request.metadata[CIRCUIT_BREAKER_TRACKING_KEY] = {
    trackerNodeId,
    targetNodeId
  } satisfies CircuitBreakerTracking
}

export function readCircuitBreakerTracking(request: Request): CircuitBreakerTracking | null {
  const raw = request.metadata[CIRCUIT_BREAKER_TRACKING_KEY]
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const tracking = raw as Partial<CircuitBreakerTracking>
  return typeof tracking.trackerNodeId === 'string' &&
    typeof tracking.targetNodeId === 'string'
    ? { trackerNodeId: tracking.trackerNodeId, targetNodeId: tracking.targetNodeId }
    : null
}

export function clearCircuitBreakerTracking(request: Request): void {
  delete request.metadata[CIRCUIT_BREAKER_TRACKING_KEY]
}

export function recordCircuitBreakerOutcome(
  store: TraitStateStore | undefined,
  node: ComponentNode,
  success: boolean,
  clock: bigint
): { transition?: 'open' | 'close'; phase: CircuitBreakerState['phase'] } {
  const config = readCircuitBreakerConfig(node) ?? DEFAULT_BREAKER_CONFIG
  let current = getState(store)

  if (current.phase === 'half-open') {
    current = {
      ...current,
      halfOpenInFlight: Math.max(0, current.halfOpenInFlight - 1)
    }

    if (!success) {
      current = {
        phase: 'open',
        recentOutcomes: [],
        openUntilUs: clock + msToMicro(config.recoveryTimeoutMs),
        halfOpenInFlight: 0,
        halfOpenSuccesses: 0
      }
      setState(store, current)
      return { transition: 'open', phase: current.phase }
    }

    current = {
      ...current,
      halfOpenSuccesses: current.halfOpenSuccesses + 1
    }

    if (current.halfOpenSuccesses >= config.halfOpenRequests) {
      current = {
        phase: 'closed',
        recentOutcomes: [],
        halfOpenInFlight: 0,
        halfOpenSuccesses: 0
      }
      setState(store, current)
      return { transition: 'close', phase: current.phase }
    }

    setState(store, current)
    return { phase: current.phase }
  }

  const recentOutcomes = [...current.recentOutcomes, success].slice(-config.failureCount)
  const failureRate =
    recentOutcomes.length > 0
      ? recentOutcomes.filter((outcome) => !outcome).length / recentOutcomes.length
      : 0

  if (recentOutcomes.length >= config.failureCount && failureRate >= config.failureThreshold) {
    current = {
      phase: 'open',
      recentOutcomes: [],
      openUntilUs: clock + msToMicro(config.recoveryTimeoutMs),
      halfOpenInFlight: 0,
      halfOpenSuccesses: 0
    }
    setState(store, current)
    return { transition: 'open', phase: current.phase }
  }

  current = {
    ...current,
    phase: 'closed',
    recentOutcomes
  }
  setState(store, current)
  return { phase: current.phase }
}

export const circuitBreakerTrait: NodeBehaviourTrait = {
  name: 'resilience.circuit-breaker',
  beforeRouting: ({ node, clock, state }) => beginCircuitBreakerRouting(state, node, clock)
}

export const circuitBreakerCapabilityModule: NodeCapabilityModule = {
  name: 'resilience.circuit-breaker',
  appliesTo: CIRCUIT_BREAKER_COMPONENT_TYPES,
  hooks: circuitBreakerTrait,
  config: {
    sections: [
      {
        id: 'circuit-breaker',
        title: 'Circuit Breaker',
        fields: [
          {
            path: 'sim.circuitBreaker.failureThreshold',
            type: 'input',
            label: 'Failure threshold',
            unit: 'ratio',
            step: 0.05,
            why: 'Trips open when failures exceed this ratio over the rolling window.'
          },
          {
            path: 'sim.circuitBreaker.failureCount',
            type: 'input',
            label: 'Window size',
            unit: 'req',
            step: 1,
            why: 'Sets how many recent downstream outcomes the breaker evaluates.'
          },
          {
            path: 'sim.circuitBreaker.recoveryTimeout',
            type: 'input',
            label: 'Recovery timeout',
            unit: 'ms',
            step: 100,
            why: 'Keeps the breaker open for this long before half-open probes are allowed.'
          },
          {
            path: 'sim.circuitBreaker.halfOpenRequests',
            type: 'input',
            label: 'Half-open probes',
            unit: 'req',
            step: 1,
            why: 'Limits how many probe requests can test the downstream before the breaker closes again.'
          }
        ]
      }
    ]
  },
  defaults: [
    {
      path: 'sim.circuitBreaker.failureThreshold',
      value: DEFAULT_BREAKER_CONFIG.failureThreshold,
      rationale: 'A breaker should trip only after failures are sustained, not on a single blip.'
    },
    {
      path: 'sim.circuitBreaker.failureCount',
      value: DEFAULT_BREAKER_CONFIG.failureCount,
      rationale: 'Rolling windows avoid opening the breaker on low-sample noise.'
    },
    {
      path: 'sim.circuitBreaker.recoveryTimeout',
      value: DEFAULT_BREAKER_CONFIG.recoveryTimeoutMs,
      rationale: 'Open breakers need a cooldown before probe traffic resumes.'
    },
    {
      path: 'sim.circuitBreaker.halfOpenRequests',
      value: DEFAULT_BREAKER_CONFIG.halfOpenRequests,
      rationale: 'Probe traffic stays intentionally small until the downstream proves healthy again.'
    }
  ],
  metrics: {
    counters: ['circuitBreakerFastRejects'],
    rejectionReasons: ['circuit_breaker_open']
  },
  honesty: {
    simulates: ['closed/open/half-open breaker states and fail-fast rejections'],
    notModeled: ['sliding-time windows', 'per-exception-class trip rules']
  }
}
