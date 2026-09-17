import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
import { formatShortcutKey, isApplePlatform } from '@renderer/config/keyboardShortcuts'
import { useCompactWorkspace } from '@renderer/hooks/useResponsiveWorkspace'

function includesLens(lenses: Array<MetricLensOption>, metricLens: MetricLens): boolean {
  return lenses.some((lens) => lens.id === metricLens)
}

/**
 * One control decides the single metric family every node card and edge
 * label shows (C1). Pre-run it shows static config lenses; after a run it
 * switches to runtime result lenses.
 */
export const MetricLensSwitcher = () => {
  const compact = useCompactWorkspace()
  const [compactExpanded, setCompactExpanded] = useState(false)
  const apple = isApplePlatform()
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

  if (compact) {
    const visibleLenses = compactExpanded ? lenses : lenses.filter((lens) => lens.id === activeLens)

    return (
      <div
        aria-label="Canvas metric lens"
        className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto rounded-full border border-nss-border bg-nss-surface/95 p-1 shadow-lg backdrop-blur transition-all duration-200"
      >
        {visibleLenses.map((lens) => (
          <button
            key={lens.id}
            type="button"
            aria-pressed={activeLens === lens.id}
            onClick={() => {
              if (!compactExpanded) {
                setCompactExpanded(true)
                return
              }
              setMetricLens(lens.id)
            }}
            className={clsx(
              'min-h-8 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-nss-primary/50',
              activeLens === lens.id
                ? 'border-nss-primary/50 bg-nss-primary/15 text-nss-primary'
                : 'border-transparent text-nss-muted hover:text-nss-text'
            )}
          >
            {lens.label}
          </button>
        ))}
        <button
          type="button"
          aria-label={compactExpanded ? 'Collapse metric lenses' : 'Expand metric lenses'}
          aria-expanded={compactExpanded}
          onClick={() => setCompactExpanded((expanded) => !expanded)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-nss-muted transition-colors hover:bg-nss-bg hover:text-nss-text focus:outline-none focus:ring-2 focus:ring-nss-primary/50"
        >
          {compactExpanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        </button>
      </div>
    )
  }

  return (
    <div className="absolute top-4 left-4 z-10 flex gap-1.5 p-1 rounded-full bg-nss-surface border border-nss-border shadow-lg">
      {lenses.map((lens, index) => (
        <HoverTooltip key={lens.id} content={METRIC_LENS_TOOLTIPS[lens.id]} width={240}>
          {(triggerProps) => (
            <button
              type="button"
              onClick={() => setMetricLens(lens.id)}
              aria-pressed={activeLens === lens.id}
              className={clsx(
                'group px-3 py-1 text-xs font-semibold rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-nss-primary/50',
                activeLens === lens.id
                  ? 'bg-nss-primary/20 border border-nss-primary/50 text-nss-primary'
                  : 'border border-transparent text-nss-muted hover:text-nss-text'
              )}
              {...triggerProps}
            >
              {lens.label}
              <span className="ml-1 font-mono text-[8px] font-normal opacity-30 transition-opacity group-hover:opacity-60">
                {formatShortcutKey('Alt', apple)}
                {apple ? '' : '+'}
                {index + 1}
              </span>
            </button>
          )}
        </HoverTooltip>
      ))}
    </div>
  )
}
