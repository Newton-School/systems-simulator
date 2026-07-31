import type { FailureRateLevel } from '@renderer/utils/nodeHealthThresholds'

export type { FailureRateLevel } from '@renderer/utils/nodeHealthThresholds'
export {
  failureRateLevelFromPercent,
  failureRateLevelFromRatio
} from '@renderer/utils/nodeHealthThresholds'

export function roundedFailurePercent(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.round(Math.max(0, value) * 10) / 10
}

export function formatFailurePercentLabel(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '0.0%'
  }

  if (value < 0.1) {
    return '<0.1%'
  }

  return `${value.toFixed(1)}%`
}

export function failureRateTextClass(level: FailureRateLevel): string {
  if (level === 'crit') return 'text-nss-danger'
  if (level === 'warn') return 'text-nss-warning'
  return 'text-nss-success'
}
