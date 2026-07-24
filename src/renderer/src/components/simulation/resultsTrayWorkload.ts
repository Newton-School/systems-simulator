import type { ScenarioRunContext } from '../../types/ui'

function hash01(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

export function workloadRateMultiplierAtMs(
  workload: ScenarioRunContext['workload'],
  currentSimMs: number
): number {
  const baseRps = Math.max(1, workload.baseRps)

  switch (workload.pattern) {
    case 'constant':
    case 'replay':
      return 1

    case 'poisson': {
      const bucket = Math.floor(currentSimMs / 900)
      return 0.55 + hash01(`poisson:${bucket}`) * 0.9
    }

    case 'bursty': {
      if (!workload.bursty) return 1
      const burstDuration = Math.max(1, workload.bursty.burstDuration)
      const normalDuration = Math.max(1, workload.bursty.normalDuration)
      const cycle = burstDuration + normalDuration
      const inBurst = currentSimMs % cycle < burstDuration
      return inBurst ? Math.max(1.5, Math.min(4, workload.bursty.burstRps / baseRps)) : 1
    }

    case 'spike': {
      if (!workload.spike) return 1
      const inSpike =
        currentSimMs >= workload.spike.spikeTime &&
        currentSimMs < workload.spike.spikeTime + workload.spike.spikeDuration
      return inSpike ? Math.max(1.75, Math.min(5, workload.spike.spikeRps / baseRps)) : 1
    }

    case 'sawtooth': {
      if (!workload.sawtooth) return 1
      const rampDuration = Math.max(1, workload.sawtooth.rampDuration)
      const progress = (currentSimMs % rampDuration) / rampDuration
      const currentRps = baseRps + (workload.sawtooth.peakRps - baseRps) * progress
      return Math.max(0.45, Math.min(5, currentRps / baseRps))
    }

    case 'diurnal': {
      const multipliers = workload.diurnal?.hourlyMultipliers
      if (!multipliers) return 1
      const hourPosition = (((currentSimMs / 1000 / 60 / 60) % 24) + 24) % 24
      const hour = Math.floor(hourPosition)
      const nextHour = (hour + 1) % 24
      const localT = hourPosition - Math.floor(hourPosition)
      const current = multipliers[hour] ?? 1
      const next = multipliers[nextHour] ?? current
      return Math.max(0.35, Math.min(2.5, current + (next - current) * localT))
    }

    default:
      return 1
  }
}

export function simulatedArrivalBins(
  workload: ScenarioRunContext['workload'],
  currentSimMs: number,
  windowMs: number,
  binCount: number
): number[] {
  const binWidthMs = Math.max(1, windowMs / Math.max(1, binCount))

  return Array.from({ length: binCount }, (_, index) => {
    const binCenterMs = currentSimMs - windowMs + binWidthMs * index + binWidthMs / 2
    const base = workloadRateMultiplierAtMs(workload, Math.max(0, binCenterMs))

    if (workload.pattern === 'poisson') {
      return base * (0.7 + hash01(`arrival:${Math.round(binCenterMs / 80)}:${index}`) * 0.9)
    }

    return base
  })
}
