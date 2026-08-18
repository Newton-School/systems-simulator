import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { EnvironmentsTab } from './EnvironmentsTab'
import { SETTINGS_TABS, type SettingsTabId } from './settingsTypes'

/**
 * The settings modal. A tabbed overlay opened from the header gear. The
 * Environments tab is live; the remaining tabs are signposted roadmap so the
 * intended structure is visible without shipping non-functional controls.
 */
export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTabId>('environments')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[560px] max-h-[85vh] w-[720px] max-w-[92vw] overflow-hidden rounded-lg border border-nss-border bg-nss-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Sidebar tabs */}
        <nav className="flex w-44 shrink-0 flex-col border-r border-nss-border bg-nss-surface p-2">
          <div className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
            Settings
          </div>
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-2 text-left text-[12px] font-medium transition-colors ${
                tab === t.id
                  ? 'bg-nss-primary/10 text-nss-primary'
                  : 'text-nss-muted hover:bg-nss-text/5 hover:text-nss-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-nss-border px-5 py-3">
            <h2 className="text-[13px] font-semibold text-nss-text">
              {SETTINGS_TABS.find((t) => t.id === tab)?.label}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="text-nss-muted transition-colors hover:text-nss-text"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3">
            {tab === 'environments' && <EnvironmentsTab />}
            {tab === 'simulation' && (
              <RoadmapTab
                title="Simulation defaults"
                items={[
                  'Run length & warmup duration',
                  'Random seed (deterministic, reproducible runs)',
                  'Default edge-latency jitter'
                ]}
              />
            )}
            {tab === 'display' && (
              <RoadmapTab
                title="Display & appearance"
                items={[
                  'Theme (currently in the header)',
                  'Default metric lens',
                  'Latency percentile (p50 / p95 / p99)',
                  'Chrome density'
                ]}
              />
            )}
            {tab === 'pedagogy' && (
              <RoadmapTab
                title="Teaching"
                items={['Hint verbosity', 'Show number provenance (why each metric has its value)']}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RoadmapTab({ title, items }: { title: string; items: string[] }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-nss-text">{title}</p>
      <p className="text-[11px] leading-relaxed text-nss-muted">
        Planned for this tab — not yet wired up:
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[11px] text-nss-muted">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-nss-muted" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
