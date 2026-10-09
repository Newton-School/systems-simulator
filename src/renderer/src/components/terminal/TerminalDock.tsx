import type { ReactNode } from 'react'

export type BottomDockTab = 'results' | 'terminal'

interface TerminalDockProps {
  activeTab: BottomDockTab
  onTabChange: (tab: BottomDockTab) => void
  /** The results tray, or null while it has nothing to show (no run yet / closed). */
  results: ReactNode | null
  /** Whether a run exists to show results for (enables the Results tab). */
  hasRun: boolean
  terminal: ReactNode
  onClose: () => void
}

/**
 * Bottom panel tab strip: the results tray and the terminal side by side. The
 * terminal stays mounted while the Results tab is active so a watch keeps
 * running and the input keeps its draft.
 */
export function TerminalDock({
  activeTab,
  onTabChange,
  results,
  hasRun,
  terminal,
  onClose
}: TerminalDockProps) {
  const tabClass = (tab: BottomDockTab, enabled = true): string =>
    [
      'h-7 px-3 rounded-md border text-xs font-semibold transition-colors',
      activeTab === tab
        ? 'bg-nss-primary text-white border-nss-primary'
        : enabled
          ? 'bg-nss-surface text-nss-muted border-nss-border hover:text-nss-text'
          : 'bg-nss-surface text-nss-muted/50 border-nss-border cursor-not-allowed'
    ].join(' ')

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-nss-border bg-nss-panel">
      <div
        role="tablist"
        aria-label="Bottom panel"
        className="flex shrink-0 items-center gap-2 border-b border-nss-border px-3 py-1.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'results'}
          disabled={!hasRun}
          title={hasRun ? 'Simulation results' : 'Run a simulation to see results'}
          onClick={() => onTabChange('results')}
          className={tabClass('results', hasRun)}
        >
          Results
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'terminal'}
          onClick={() => onTabChange('terminal')}
          className={tabClass('terminal')}
        >
          Terminal
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          title="Close terminal (Ctrl+`)"
          className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded border border-transparent text-nss-muted hover:text-nss-text hover:bg-nss-surface hover:border-nss-border"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'results' && results ? results : null}
        {activeTab === 'results' && !results ? (
          <div className="p-4 text-xs text-nss-muted">
            No results to show. Run a simulation first.
          </div>
        ) : null}
        <div className={activeTab === 'terminal' ? 'h-full' : 'hidden'}>{terminal}</div>
      </div>
    </div>
  )
}
