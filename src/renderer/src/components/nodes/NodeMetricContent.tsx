import type { MetricLens } from '@renderer/types/ui'
import { RuntimeNodeMetrics } from '@renderer/components/nodes/RuntimeNodeMetrics'
import { LensMetricCard } from './LensMetricCard'
import { NodeMetricCell } from './NodeMetricCell'
import type { IdentityChip, LensCardData, SummaryMetric } from './nodePresentation'

type NodeMetricContentProps = {
  isInactive: boolean
  hasRuntime: boolean
  lens: MetricLens
  arrived?: number
  completed?: number
  rejected?: number
  timedOut?: number
  lensCard: LensCardData | null
  identityChip: IdentityChip | null
  preRunMetric: SummaryMetric | null
  inactiveClassName?: string
  identityClassName?: string
  runtimeClassName?: string
  preRunClassName?: string
}

export function NodeMetricContent({
  isInactive,
  hasRuntime,
  lens,
  arrived,
  completed,
  rejected,
  timedOut,
  lensCard,
  identityChip,
  preRunMetric,
  inactiveClassName = 'text-[10px] text-nss-muted italic text-center py-2',
  identityClassName = 'min-w-0',
  runtimeClassName,
  preRunClassName = 'grid grid-cols-1 gap-4'
}: NodeMetricContentProps) {
  if (isInactive) {
    return <p className={inactiveClassName}>No post-warmup traffic</p>
  }

  if (lens === 'traffic' && hasRuntime) {
    return (
      <RuntimeNodeMetrics
        arrived={arrived}
        completed={completed}
        rejected={rejected}
        timedOut={timedOut}
        className={runtimeClassName}
      />
    )
  }

  if (lensCard) {
    return <LensMetricCard card={lensCard} />
  }

  if (hasRuntime) {
    return null
  }

  if (!identityChip && !preRunMetric) {
    return null
  }

  return (
    <div className={preRunClassName}>
      {identityChip ? (
        <div className={identityClassName}>
          <NodeMetricCell label={identityChip.label} value={identityChip.value} />
        </div>
      ) : null}
      {preRunMetric ? (
        <NodeMetricCell
          label={preRunMetric.label}
          value={`${preRunMetric.value}${preRunMetric.unit ? ` ${preRunMetric.unit}` : ''}`}
          tone={preRunMetric.textColor}
        />
      ) : null}
    </div>
  )
}
