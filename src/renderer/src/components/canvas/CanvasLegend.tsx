import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Info } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  CANVAS_PRE_RUN_LEGEND_NOTE,
  CANVAS_RUNTIME_LEGEND_SECTIONS,
  type CanvasLegendItem
} from '@renderer/config/canvasLegendConfig'
import { getMetricLensLabel } from '@renderer/config/metricLensConfig'
import { METRIC_LENS_TOOLTIPS } from '@renderer/config/tooltipCatalog'
import useStore from '@renderer/store/useStore'

function LegendSwatch({ item }: { item: CanvasLegendItem }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-nss-border bg-nss-panel px-2 py-1 text-[11px] text-nss-text">
      <span
        className={clsx(
          'shrink-0',
          item.shape === 'dot' ? 'h-2 w-2 rounded-full' : 'h-2.5 w-2.5 rounded-[4px]',
          item.swatchClassName
        )}
      />
      <span>{item.label}</span>
    </span>
  )
}

export function CanvasLegend() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { metricLens, hasRuntimeMetrics } = useStore(
    useShallow((state) => ({
      metricLens: state.metricLens,
      hasRuntimeMetrics: Object.keys(state.simulationMetricsByNode).length > 0
    }))
  )
  const lensLabel = getMetricLensLabel(metricLens)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
      <button
        type="button"
        aria-label={open ? 'Close legend' : 'Open legend'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'inline-flex h-8 w-8 items-center justify-center rounded-full border bg-nss-surface/95 shadow-lg backdrop-blur transition-colors focus:outline-none focus:ring-2 focus:ring-nss-primary/50',
          open
            ? 'border-nss-primary/50 text-nss-primary'
            : 'border-nss-border text-nss-muted hover:text-nss-text'
        )}
      >
        <Info size={14} />
      </button>

      {open ? (
        <aside className="w-[280px] max-w-[calc(100vw-2rem)] rounded-2xl border border-nss-border bg-nss-surface/95 shadow-lg backdrop-blur">
          <div className="border-b border-nss-border px-3 py-2.5">
            <div className="mt-1 text-xs font-semibold text-nss-text">{lensLabel} lens</div>
            <div className="mt-1 text-[11px] leading-snug text-nss-muted">
              {METRIC_LENS_TOOLTIPS[metricLens]}
            </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            {hasRuntimeMetrics ? (
              CANVAS_RUNTIME_LEGEND_SECTIONS.map((section) => (
                <section key={section.title} className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-nss-muted">
                    {section.title}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {section.items.map((item) => (
                      <LegendSwatch key={`${section.title}-${item.label}`} item={item} />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <p className="text-[11px] leading-snug text-nss-muted">
                {CANVAS_PRE_RUN_LEGEND_NOTE}
              </p>
            )}
          </div>
        </aside>
      ) : null}
    </div>
  )
}
