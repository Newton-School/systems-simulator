import type { FaultSpec, WorkloadProfile } from '../../../../engine/core/types'

export type WorkloadPattern = WorkloadProfile['pattern']
export type FailureMode = 'blackhole' | 'hang' | 'reject' | 'degraded'

export const FAILURE_MODE_OPTIONS: Array<{ value: FailureMode; label: string }> = [
  { value: 'blackhole', label: 'Blackhole (silent, walls at timeout)' },
  { value: 'hang', label: 'Hang (accept then freeze)' },
  { value: 'reject', label: 'Reject (instant node_failed)' },
  { value: 'degraded', label: 'Degraded (slower service)' }
]

export const PATTERN_OPTIONS: Array<{ value: WorkloadPattern; label: string }> = [
  { value: 'constant', label: 'Constant' },
  { value: 'poisson', label: 'Poisson' },
  { value: 'bursty', label: 'Bursty' },
  { value: 'spike', label: 'Spike' },
  { value: 'diurnal', label: 'Diurnal' },
  { value: 'sawtooth', label: 'Sawtooth' }
]

/** Defaults for the degraded-mode parameters when a fault first switches to it. */
export const DEFAULT_DEGRADED_FRACTION = 0.3
export const DEFAULT_DEGRADED_SERVICE_MULTIPLIER = 10

export interface SimpleFault {
  targetId: string
  atS: number
  durationS: number
  mode: FailureMode
  /** degraded only: share of requests hit by the slowdown [0, 1]. */
  degradedFraction: number
  /** degraded only: service-time multiplier applied to the affected share. */
  degradedServiceMultiplier: number
}

export function readFault(fault: FaultSpec): SimpleFault {
  const params = (fault.params ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && v >= 0 ? v : 0)
  const mode = typeof params.mode === 'string' ? (params.mode as FailureMode) : 'blackhole'
  const degradation = (params.degradation ?? {}) as Record<string, unknown>
  return {
    targetId: fault.targetId,
    atS: Math.round(num(params.atMs) / 1000),
    durationS: Math.round(num(params.durationMs) / 1000),
    mode,
    degradedFraction:
      typeof degradation.fraction === 'number' && degradation.fraction >= 0
        ? degradation.fraction
        : DEFAULT_DEGRADED_FRACTION,
    degradedServiceMultiplier:
      typeof degradation.serviceTimeMultiplier === 'number' &&
      degradation.serviceTimeMultiplier >= 0
        ? degradation.serviceTimeMultiplier
        : DEFAULT_DEGRADED_SERVICE_MULTIPLIER
  }
}

export function buildFault(simple: SimpleFault): FaultSpec {
  return {
    targetId: simple.targetId,
    faultType: 'chaos',
    timing: 'deterministic',
    duration: simple.durationS > 0 ? 'fixed' : 'permanent',
    params: {
      atMs: Math.max(0, simple.atS) * 1000,
      durationMs: Math.max(0, simple.durationS) * 1000,
      mode: simple.mode,
      inFlightPolicy: 'hang',
      recoveryPolicy: 'reset',
      ...(simple.mode === 'degraded'
        ? {
            degradation: {
              fraction: Math.max(0, Math.min(1, simple.degradedFraction)),
              serviceTimeMultiplier: Math.max(0, simple.degradedServiceMultiplier)
            }
          }
        : {})
    }
  }
}

export function generateRunSeed(): string {
  if (typeof globalThis !== 'undefined' && 'crypto' in globalThis) {
    const id = globalThis.crypto?.randomUUID?.()
    if (typeof id === 'string' && id.length > 0) {
      return `seed-${id.slice(0, 8)}`
    }
  }

  return `seed-${Math.random().toString(36).slice(2, 10)}`
}
