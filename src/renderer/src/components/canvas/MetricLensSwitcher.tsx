import { clsx } from 'clsx'
import { useShallow } from 'zustand/react/shallow'
import type { MetricLens } from '@renderer/types/ui'
import useStore from '@renderer/store/useStore'

const LENSES: Array<{ id: MetricLens; label: string }> = [
  { id: 'results', label: 'Results' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'latency', label: 'Latency' },
  { id: 'errors', label: 'Errors' },
  { id: 'throughput', label: 'Throughput' }
]

/**
 * One control decides the single metric family every node card and edge
 * label shows (C1). Default is Results — the post-run completion view.
 */
export const MetricLensSwitcher = () => {
  const { metricLens, setMetricLens } = useStore(
    useShallow((state) => ({ metricLens: state.metricLens, setMetricLens: state.setMetricLens }))
  )

  return (
    <div className="absolute top-4 left-4 z-10 flex gap-1.5 p-1 rounded-full bg-nss-surface border border-nss-border shadow-lg">
      {LENSES.map((lens) => (
        <button
          key={lens.id}
          type="button"
          onClick={() => setMetricLens(lens.id)}
          className={clsx(
            'px-3 py-1 text-xs font-semibold rounded-full transition-colors',
            metricLens === lens.id
              ? 'bg-nss-primary/20 border border-nss-primary/50 text-nss-primary'
              : 'border border-transparent text-nss-muted hover:text-nss-text'
          )}
        >
          {lens.label}
        </button>
      ))}
    </div>
  )
}
