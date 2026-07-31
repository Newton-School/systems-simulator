import type { TimeToErrorSummary } from '../../../engine/metrics'
import type { ErrorCause } from '../../../engine/metrics/windowedLatencyAggregator'
import { ERROR_CAUSE_LABELS, dominantTimeToErrorCause } from './errorCausePresentation'

export type FailureRateLevel = 'ok' | 'warn' | 'crit'
export type NodeStatusTone = 'ok' | 'warn' | 'crit'
export type NodeCapacityLevel = 'headroom' | 'tight' | 'saturated'
export type NodeReliabilityLevel = 'idle' | 'healthy' | 'degraded' | 'failing' | 'silent' | 'down'

export const NODE_HEALTH_THRESHOLDS = {
  reliability: {
    failureWarnPercent: 1,
    failureCritPercent: 5,
    noSuccessTerminalCritRatio: 0.5
  },
  capacity: {
    tightUtilizationPercent: 75,
    saturatedUtilizationPercent: 90,
    queueObservedThreshold: 1
  }
} as const

function clampLowerBound(value: number): number {
  return Math.max(0, value)
}

export function roundedFailurePercent(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.round(clampLowerBound(value) * 10) / 10
}

export function failureRateLevelFromPercent(value?: number): FailureRateLevel {
  const rounded = roundedFailurePercent(value)
  if (rounded > NODE_HEALTH_THRESHOLDS.reliability.failureCritPercent) return 'crit'
  if (rounded > NODE_HEALTH_THRESHOLDS.reliability.failureWarnPercent) return 'warn'
  return 'ok'
}

export function failureRateLevelFromRatio(value?: number): FailureRateLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'ok'
  return failureRateLevelFromPercent(value * 100)
}

export function utilizationPercent(value: number, unit: 'ratio' | 'percent'): number {
  if (!Number.isFinite(value)) return 0
  return clampLowerBound(unit === 'ratio' ? value * 100 : value)
}

export function toneRank(tone: NodeStatusTone): number {
  if (tone === 'crit') return 2
  if (tone === 'warn') return 1
  return 0
}

export interface CapacityStatus {
  level: NodeCapacityLevel
  tone: NodeStatusTone
  label: 'Headroom' | 'Tight' | 'Saturated'
  utilizationPercent: number
  detail: string
}

export function deriveCapacityStatus({
  utilization,
  queueDepth = 0,
  workers,
  utilizationUnit
}: {
  utilization: number
  queueDepth?: number
  workers?: number
  utilizationUnit: 'ratio' | 'percent'
}): CapacityStatus {
  const percent = utilizationPercent(utilization, utilizationUnit)
  const normalizedQueueDepth = Number.isFinite(queueDepth) ? Math.max(0, queueDepth) : 0
  const workerText =
    typeof workers === 'number' && Number.isFinite(workers) && workers > 0
      ? `${workers} worker${workers === 1 ? '' : 's'}`
      : null

  if (percent >= NODE_HEALTH_THRESHOLDS.capacity.saturatedUtilizationPercent) {
    return {
      level: 'saturated',
      tone: 'warn',
      label: 'Saturated',
      utilizationPercent: percent,
      detail: workerText
        ? `${workerText} at ${percent.toFixed(1)}% utilization - no headroom for spikes.`
        : `${percent.toFixed(1)}% utilized - no headroom for spikes.`
    }
  }

  if (
    percent >= NODE_HEALTH_THRESHOLDS.capacity.tightUtilizationPercent ||
    normalizedQueueDepth >= NODE_HEALTH_THRESHOLDS.capacity.queueObservedThreshold
  ) {
    return {
      level: 'tight',
      tone: 'warn',
      label: 'Tight',
      utilizationPercent: percent,
      detail:
        percent >= NODE_HEALTH_THRESHOLDS.capacity.tightUtilizationPercent
          ? workerText
            ? `${workerText} at ${percent.toFixed(1)}% utilization - limited headroom for spikes.`
            : `${percent.toFixed(1)}% utilized - limited headroom for spikes.`
          : `Avg queue ${normalizedQueueDepth.toFixed(1)} observed at ${percent.toFixed(1)}% utilization - burstiness is consuming slack.`
    }
  }

  return {
    level: 'headroom',
    tone: 'ok',
    label: 'Headroom',
    utilizationPercent: percent,
    detail: workerText
      ? `${workerText} at ${percent.toFixed(1)}% utilization - comfortable headroom.`
      : `${percent.toFixed(1)}% utilized - comfortable headroom.`
  }
}

export function capacityRank(level: NodeCapacityLevel): number {
  if (level === 'saturated') return 2
  if (level === 'tight') return 1
  return 0
}

export interface ReliabilityStatus {
  level: NodeReliabilityLevel
  tone: NodeStatusTone
  label: 'Idle' | 'Healthy' | 'Degraded' | 'Failing' | 'Silent' | 'Down'
  dominantCause: ErrorCause | null
  detail: string
}

export function deriveReliabilityStatus({
  postWarmupArrived,
  successLatencySamples,
  timeToErrorSamples,
  latencyWindowErrorRate,
  timeToErrorByCause
}: {
  postWarmupArrived: number
  successLatencySamples: number
  timeToErrorSamples: number
  latencyWindowErrorRate: number
  timeToErrorByCause?: Partial<TimeToErrorSummary> | null
}): ReliabilityStatus {
  const hasWindowSamples = successLatencySamples + timeToErrorSamples > 0
  const served = successLatencySamples > 0
  const dominantCause = dominantTimeToErrorCause(timeToErrorByCause)

  if (postWarmupArrived === 0 && !hasWindowSamples) {
    return {
      level: 'idle',
      tone: 'ok',
      label: 'Idle',
      dominantCause,
      detail: 'No post-warmup traffic reached this node.'
    }
  }

  if (
    !served &&
    latencyWindowErrorRate > NODE_HEALTH_THRESHOLDS.reliability.noSuccessTerminalCritRatio
  ) {
    if (dominantCause === 'timeout') {
      return {
        level: 'silent',
        tone: 'crit',
        label: 'Silent',
        dominantCause,
        detail: 'No successful passes; requests are timing out here.'
      }
    }

    return {
      level: 'down',
      tone: 'crit',
      label: 'Down',
      dominantCause,
      detail: 'No successful passes; requests are failing at this node.'
    }
  }

  if (latencyWindowErrorRate > NODE_HEALTH_THRESHOLDS.reliability.failureCritPercent / 100) {
    if (dominantCause === 'node_failed') {
      return {
        level: 'failing',
        tone: 'crit',
        label: 'Failing',
        dominantCause,
        detail: 'Requests are being terminated by node failure at this node.'
      }
    }

    return {
      level: 'degraded',
      tone: 'warn',
      label: 'Degraded',
      dominantCause,
      detail: dominantCause
        ? `Requests are failing here, mostly ${ERROR_CAUSE_LABELS[dominantCause]}.`
        : 'Requests are failing here in this window.'
    }
  }

  return {
    level: 'healthy',
    tone: 'ok',
    label: 'Healthy',
    dominantCause,
    detail: dominantCause
      ? `Requests are succeeding here; no failures terminated at this node in this window.`
      : 'Requests are succeeding at this node in this window.'
  }
}

export function reliabilityRank(level: NodeReliabilityLevel): number {
  switch (level) {
    case 'down':
    case 'silent':
      return 4
    case 'failing':
      return 3
    case 'degraded':
      return 2
    case 'healthy':
      return 1
    case 'idle':
    default:
      return 0
  }
}

export function deriveCombinedRuntimeTone({
  utilization,
  queueDepth = 0,
  errorRatePercent = 0
}: {
  utilization: number
  queueDepth?: number
  errorRatePercent?: number
}): NodeStatusTone {
  const failureTone = failureRateLevelFromPercent(errorRatePercent)
  const capacity = deriveCapacityStatus({
    utilization,
    queueDepth,
    utilizationUnit: 'percent'
  })

  if (failureTone === 'crit') return 'crit'
  if (capacity.level === 'saturated') return 'crit'
  if (failureTone === 'warn' || capacity.level === 'tight') return 'warn'
  return 'ok'
}
