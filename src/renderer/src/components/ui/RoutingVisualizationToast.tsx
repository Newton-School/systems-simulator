import { X } from 'lucide-react'
import type { RoutingStrategyVisualizationState } from '@renderer/store/useStore'

const STRATEGY_LABELS: Record<RoutingStrategyVisualizationState['strategy'], string> = {
  passthrough: 'passthrough',
  'round-robin': 'round-robin',
  random: 'random',
  weighted: 'weighted',
  'least-conn': 'least-connections',
  broadcast: 'broadcast',
  conditional: 'conditional'
}

interface RoutingVisualizationToastProps {
  state: RoutingStrategyVisualizationState
  onClose: () => void
}

export function RoutingVisualizationToast({ state, onClose }: RoutingVisualizationToastProps) {
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-nss-primary/30 bg-nss-panel text-xs text-nss-text shadow-2xl"
    >
      <div className="flex items-center justify-between rounded-t-lg border-b border-nss-primary/20 bg-nss-primary/10 px-3 py-2 text-nss-primary">
        <span className="text-[10px] font-semibold uppercase tracking-widest">Routing preview</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Return to normal packet visualization"
          className="rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <X size={13} />
        </button>
      </div>

      <div className="space-y-1.5 px-3 py-2.5 leading-relaxed text-nss-text/80">
        <p>
          Showing how{' '}
          <span className="font-semibold text-nss-text">{STRATEGY_LABELS[state.strategy]}</span>{' '}
          routes traffic from{' '}
          <span className="font-semibold text-nss-text">{state.sourceLabel}</span>.
        </p>
        <p className="text-nss-muted">
          Node id: <span className="text-nss-text">{state.sourceNodeId}</span>. Close this banner to
          return to the normal packet view.
        </p>
      </div>
    </div>
  )
}
