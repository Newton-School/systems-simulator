export type HealthPreset = 'healthy' | 'degraded' | 'critical' | 'down'

export const HEALTH_PRESET_ERROR_RATE: Record<HealthPreset, number> = {
  healthy: 0,
  degraded: 0.4,
  critical: 0.9,
  down: 1
}

export const HEALTH_META: Record<
  HealthPreset,
  { label: string; className: string; dotClassName: string }
> = {
  healthy: {
    label: 'Healthy',
    className: 'border-nss-success/20 bg-nss-success/10 text-nss-success',
    dotClassName: 'bg-nss-success'
  },
  degraded: {
    label: 'Degraded',
    className: 'border-nss-warning/20 bg-nss-warning/10 text-nss-warning',
    dotClassName: 'bg-nss-warning'
  },
  critical: {
    label: 'Critical',
    className: 'border-nss-danger/20 bg-nss-danger/10 text-nss-danger',
    dotClassName: 'bg-nss-danger'
  },
  down: {
    label: 'Down',
    className: 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger',
    dotClassName: 'bg-nss-danger'
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeErrorRate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

export function getHealthPreset(errorRate: number): HealthPreset {
  if (errorRate >= 1) return 'down'
  if (errorRate >= 0.8) return 'critical'
  if (errorRate >= 0.01) return 'degraded'
  return 'healthy'
}

export function formatErrorRatePercent(errorRate: number): number {
  return Math.round(errorRate * 1000) / 10
}
