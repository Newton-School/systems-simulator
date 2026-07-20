import type { EdgeFlowRunConfig } from '@renderer/store/useStore'

export function patternElapsedMs(
  runConfig: EdgeFlowRunConfig | null,
  playback: { wallStartMs: number; simStartMs: number } | null,
  now: number
): number {
  if (!runConfig || !playback) return 0

  const duration = Math.max(1, runConfig.simulationDurationMs)
  const elapsed = playback.simStartMs + (now - playback.wallStartMs) * 4
  return ((elapsed % duration) + duration) % duration
}

export function patternMultiplier(
  runConfig: EdgeFlowRunConfig | null,
  playback: { wallStartMs: number; simStartMs: number } | null,
  now: number,
  edgeId: string,
  hash01: (input: string) => number
): number {
  if (!runConfig) return 1

  const workload = runConfig.workload
  const elapsed = patternElapsedMs(runConfig, playback, now)
  const baseRps = Math.max(1, workload.baseRps)

  switch (workload.pattern) {
    case 'constant':
    case 'replay':
      return 1

    case 'poisson': {
      const bucket = Math.floor(elapsed / 900)
      return 0.45 + hash01(`${edgeId}:poisson:${bucket}`) * 1.25
    }

    case 'bursty': {
      const burst = workload.bursty
      if (!burst) return 1
      const burstDuration = Math.max(1, burst.burstDuration)
      const normalDuration = Math.max(1, burst.normalDuration)
      const cycle = burstDuration + normalDuration
      const inBurst = elapsed % cycle < burstDuration
      return inBurst ? Math.max(1.5, Math.min(4, burst.burstRps / baseRps)) : 1
    }

    case 'spike': {
      const spike = workload.spike
      if (!spike) return 1
      const inSpike = elapsed >= spike.spikeTime && elapsed < spike.spikeTime + spike.spikeDuration
      return inSpike ? Math.max(1.75, Math.min(5, spike.spikeRps / baseRps)) : 1
    }

    case 'sawtooth': {
      const sawtooth = workload.sawtooth
      if (!sawtooth) return 1
      const rampDuration = Math.max(1, sawtooth.rampDuration)
      const t = (elapsed % rampDuration) / rampDuration
      const currentRps = baseRps + (sawtooth.peakRps - baseRps) * t
      return Math.max(0.45, Math.min(5, currentRps / baseRps))
    }

    case 'diurnal': {
      const multipliers = workload.diurnal?.hourlyMultipliers
      if (!multipliers) return 1
      const progress = elapsed / Math.max(1, runConfig.simulationDurationMs)
      const hourPosition = progress * 24
      const hour = Math.floor(hourPosition) % 24
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

export function patternPhaseLabel(
  runConfig: EdgeFlowRunConfig | null,
  playback: { wallStartMs: number; simStartMs: number } | null,
  now: number,
  multiplier: (
    runConfig: EdgeFlowRunConfig | null,
    playback: { wallStartMs: number; simStartMs: number } | null,
    now: number,
    edgeId: string
  ) => number
): string | null {
  if (!runConfig) return null

  const workload = runConfig.workload
  const elapsed = patternElapsedMs(runConfig, playback, now)

  switch (workload.pattern) {
    case 'bursty': {
      const burst = workload.bursty
      if (!burst) return null
      const burstDuration = Math.max(1, burst.burstDuration)
      const normalDuration = Math.max(1, burst.normalDuration)
      const cycle = burstDuration + normalDuration
      return elapsed % cycle < burstDuration ? 'burst' : 'base'
    }

    case 'spike': {
      const spike = workload.spike
      if (!spike) return null
      return elapsed >= spike.spikeTime && elapsed < spike.spikeTime + spike.spikeDuration
        ? 'spike'
        : 'base'
    }

    case 'sawtooth': {
      const sawtooth = workload.sawtooth
      if (!sawtooth) return null
      const rampDuration = Math.max(1, sawtooth.rampDuration)
      const progress = (elapsed % rampDuration) / rampDuration
      if (progress > 0.66) return 'ramp high'
      if (progress > 0.33) return 'ramp mid'
      return 'ramp low'
    }

    case 'diurnal': {
      const diurnalMultiplier = multiplier(runConfig, playback, now, 'diurnal-label')
      if (diurnalMultiplier > 1.1) return 'peak'
      if (diurnalMultiplier < 0.8) return 'low'
      return 'normal'
    }

    case 'poisson':
      return 'poisson arrivals'

    default:
      return null
  }
}
