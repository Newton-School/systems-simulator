import type { WorkloadProfile } from '../../../engine/core/types'

export type WorkloadWithoutRuntimeFields = Omit<
  WorkloadProfile,
  'sourceNodeId' | 'requestDistribution'
>

const DEFAULT_DIURNAL_HOURLY_MULTIPLIERS: NonNullable<
  WorkloadProfile['diurnal']
>['hourlyMultipliers'] = [
  0.6, 0.5, 0.45, 0.4, 0.4, 0.5, 0.7, 0.9, 1.1, 1.2, 1.15, 1.05, 1, 1.05, 1.1, 1.2, 1.25, 1.3, 1.2,
  1.05, 0.95, 0.85, 0.75, 0.65
]

export const DEFAULT_WORKLOAD_PATTERN_CONFIG = {
  bursty: { burstRps: 500, burstDuration: 2000, normalDuration: 8000 },
  spike: { spikeTime: 30_000, spikeRps: 1000, spikeDuration: 5000 },
  sawtooth: { peakRps: 300, rampDuration: 10_000 },
  diurnal: {
    peakMultiplier: 1,
    hourlyMultipliers: DEFAULT_DIURNAL_HOURLY_MULTIPLIERS
  }
} satisfies Pick<WorkloadWithoutRuntimeFields, 'bursty' | 'spike' | 'sawtooth' | 'diurnal'>

export function mergeWorkloadDefaults(
  base: WorkloadWithoutRuntimeFields,
  override: Partial<WorkloadWithoutRuntimeFields> | undefined
): WorkloadWithoutRuntimeFields {
  const merged = { ...base, ...override }

  return {
    ...merged,
    ...(base.bursty || override?.bursty || merged.pattern === 'bursty'
      ? {
          bursty: {
            ...DEFAULT_WORKLOAD_PATTERN_CONFIG.bursty,
            ...base.bursty,
            ...override?.bursty
          }
        }
      : {}),
    ...(base.spike || override?.spike || merged.pattern === 'spike'
      ? {
          spike: {
            ...DEFAULT_WORKLOAD_PATTERN_CONFIG.spike,
            ...base.spike,
            ...override?.spike
          }
        }
      : {}),
    ...(base.sawtooth || override?.sawtooth || merged.pattern === 'sawtooth'
      ? {
          sawtooth: {
            ...DEFAULT_WORKLOAD_PATTERN_CONFIG.sawtooth,
            ...base.sawtooth,
            ...override?.sawtooth
          }
        }
      : {}),
    ...(base.diurnal || override?.diurnal || merged.pattern === 'diurnal'
      ? {
          diurnal: {
            ...DEFAULT_WORKLOAD_PATTERN_CONFIG.diurnal,
            ...base.diurnal,
            ...override?.diurnal
          }
        }
      : {})
  }
}
