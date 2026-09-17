import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { EnvironmentsTab } from './EnvironmentsTab'
import { SimulationTab } from './SimulationTab'
import { DisplayTab } from './DisplayTab'
import { ComponentLibraryTab } from './ComponentLibraryTab'
import { LlmGradingTab } from './LlmGradingTab'
import { SETTINGS_TABS, type SettingsTabId } from './settingsTypes'
import { searchSettings, type SettingsSearchEntry } from './settingsSearch'

/**
 * The settings modal. A tabbed overlay opened from the header gear. It surfaces
 * environment policy, simulation defaults, and display preferences; pedagogy
 * controls are intentionally deferred from the shipped UI and documented in the
 * docs repo instead.
 */
export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTabId>('environments')
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null)
  const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery])
  const isSearching = searchQuery.trim().length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (searchQuery) setSearchQuery('')
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, searchQuery])

  useEffect(() => {
    if (!pendingTargetId || isSearching) return

    const animationFrame = window.requestAnimationFrame(() => {
      const target = document.getElementById(pendingTargetId)
      if (!target) {
        setPendingTargetId(null)
        return
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.focus({ preventScroll: true })
      target.classList.add('nss-settings-search-target')
      window.setTimeout(() => target.classList.remove('nss-settings-search-target'), 1600)
      setPendingTargetId(null)
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [isSearching, pendingTargetId, tab])

  const openSearchResult = (result: SettingsSearchEntry): void => {
    setTab(result.tab)
    setPendingTargetId(result.targetId)
    setSearchQuery('')
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="nss-settings-dialog flex overflow-hidden rounded-lg border border-nss-border bg-nss-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Sidebar tabs */}
        <nav className="nss-settings-nav flex w-52 shrink-0 flex-col border-r border-nss-border bg-nss-surface p-2">
          <div className="nss-settings-title px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
            Settings
          </div>
          <label className="relative mb-1.5 block min-w-0">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nss-muted"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search settings"
              aria-label="Search all settings"
              autoComplete="off"
              className="nss-search-input nss-touch-target h-8 w-full rounded-md border border-nss-border/50 bg-nss-surface py-1.5 pl-8 pr-8 text-[11px] text-nss-text placeholder-nss-muted outline-none transition-colors hover:border-nss-border-high hover:bg-nss-panel focus:border-nss-primary/60 focus:bg-nss-panel focus:ring-1 focus:ring-nss-primary/20"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear settings search"
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-nss-muted hover:bg-nss-text/5 hover:text-nss-text"
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
          <div className="nss-settings-tab-list flex min-h-0 flex-col gap-0.5">
            {SETTINGS_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id)
                  setSearchQuery('')
                }}
                className={`nss-touch-target shrink-0 rounded-md px-3 py-2 text-left text-[12px] font-medium transition-colors ${
                  tab === t.id && !isSearching
                    ? 'bg-nss-primary/10 text-nss-primary'
                    : 'text-nss-muted hover:bg-nss-text/5 hover:text-nss-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-nss-border px-5 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold text-nss-text">
                {isSearching
                  ? 'Search results'
                  : SETTINGS_TABS.find((item) => item.id === tab)?.label}
              </h2>
              {isSearching ? (
                <p className="mt-0.5 text-[10px] text-nss-muted" aria-live="polite">
                  {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="nss-touch-target flex items-center justify-center text-nss-muted transition-colors hover:text-nss-text"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3">
            {isSearching ? (
              <div aria-live="polite">
                {searchResults.length > 0 ? (
                  <div className="divide-y divide-nss-border overflow-hidden rounded-md border border-nss-border">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => openSearchResult(result)}
                        className="block w-full bg-nss-panel px-3 py-2.5 text-left transition-colors hover:bg-nss-surface focus-visible:bg-nss-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nss-primary"
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-[12px] font-medium text-nss-text">
                            {result.title}
                          </span>
                          <span className="shrink-0 rounded bg-nss-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-primary">
                            {SETTINGS_TABS.find((item) => item.id === result.tab)?.label}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-nss-muted">
                          {result.description}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed border-nss-border px-4 text-center">
                    <Search size={20} className="mb-2 text-nss-muted" aria-hidden="true" />
                    <p className="text-[12px] font-medium text-nss-text">No settings found</p>
                    <p className="mt-1 text-[11px] text-nss-muted">
                      Try a control name, component, or topic such as latency, cost, or grading.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {tab === 'environments' && <EnvironmentsTab />}
                {tab === 'simulation' && <SimulationTab />}
                {tab === 'library' && <ComponentLibraryTab />}
                {tab === 'llm-grading' && <LlmGradingTab />}
                {tab === 'display' && <DisplayTab />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
