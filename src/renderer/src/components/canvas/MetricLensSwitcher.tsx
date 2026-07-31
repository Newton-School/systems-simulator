import { useEffect } from 'react'
import { clsx } from 'clsx'
import { useShallow } from 'zustand/react/shallow'
import type { MetricLens } from '@renderer/types/ui'
import {
  PRE_RUN_LENSES,
  RUNTIME_LENSES,
  type MetricLensOption
} from '@renderer/config/metricLensConfig'
import { METRIC_LENS_TOOLTIPS } from '@renderer/config/tooltipCatalog'
import { HoverTooltip } from '@renderer/components/ui/Tooltip'
import useStore from '@renderer/store/useStore'

function includesLens(lenses: Array<MetricLensOption>, metricLens: MetricLens): boolean {
  return lenses.some((lens) => lens.id === metricLens)
}

/**
 * One control decides the single metric family every node card and edge
 * label shows (C1). Pre-run it shows static config lenses; after a run it
 * switches to runtime result lenses.
 */
export const MetricLensSwitcher = () => {
  const { metricLens, setMetricLens, hasRuntimeMetrics } = useStore(
    useShallow((state) => ({
      metricLens: state.metricLens,
      setMetricLens: state.setMetricLens,
      hasRuntimeMetrics: Object.keys(state.simulationMetricsByNode).length > 0
    }))
  )
  const lenses = hasRuntimeMetrics ? RUNTIME_LENSES : PRE_RUN_LENSES
  const activeLens = includesLens(lenses, metricLens) ? metricLens : lenses[0].id

  useEffect(() => {
    if (activeLens !== metricLens) {
      setMetricLens(activeLens)
    }
  }, [activeLens, metricLens, setMetricLens])

  return (
    <div className="absolute top-4 left-4 z-10 flex gap-1.5 p-1 rounded-full bg-nss-surface border border-nss-border shadow-lg">
      {lenses.map((lens) => (
        <HoverTooltip key={lens.id} content={METRIC_LENS_TOOLTIPS[lens.id]} width={240}>
          {(triggerProps) => (
            <button
              type="button"
              onClick={() => setMetricLens(lens.id)}
              className={clsx(
                'px-3 py-1 text-xs font-semibold rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-nss-primary/50',
                activeLens === lens.id
                  ? 'bg-nss-primary/20 border border-nss-primary/50 text-nss-primary'
                  : 'border border-transparent text-nss-muted hover:text-nss-text'
              )}
              {...triggerProps}
            >
              {lens.label}
            </button>
          )}
        </HoverTooltip>
      ))}
    </div>
  )
}
