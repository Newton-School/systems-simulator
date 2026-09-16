import { useEffect, useMemo, useRef } from 'react'
import { Keyboard, MousePointer2, X } from 'lucide-react'
import {
  formatShortcutKey,
  isApplePlatform,
  KEYBOARD_SHORTCUT_GROUPS,
  type ShortcutKey
} from '@renderer/config/keyboardShortcuts'

interface ShortcutsModalProps {
  onClose: () => void
}

function ShortcutChord({ keys, apple }: { keys: ShortcutKey[]; apple: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={keys.join(' plus ')}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-[10px] text-nss-muted/70">+</span> : null}
          <kbd className="inline-flex min-h-6 min-w-6 items-center justify-center whitespace-nowrap rounded border border-nss-borderHigh bg-nss-surface px-1.5 font-mono text-[10px] font-semibold leading-none text-nss-text shadow-sm">
            {formatShortcutKey(key, apple)}
          </kbd>
        </span>
      ))}
    </span>
  )
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const apple = useMemo(() => isApplePlatform(), [])

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const toggledByShortcut =
        event.key === '?' || ((event.metaKey || event.ctrlKey) && key === '/')

      if (event.key === 'Escape' || toggledByShortcut) {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        className="flex max-h-[88vh] w-[920px] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-nss-border bg-nss-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-5 border-b border-nss-border px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nss-primary/10 text-nss-primary">
              <Keyboard size={19} />
            </div>
            <div>
              <h2 id="keyboard-shortcuts-title" className="text-base font-semibold text-nss-text">
                Keyboard shortcuts
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-nss-muted">
                Canvas shortcuts pause while you type or while another dialog is open.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nss-muted transition-colors hover:bg-nss-surface hover:text-nss-text focus:outline-none focus:ring-2 focus:ring-nss-primary/60"
          >
            <X size={18} />
          </button>
        </header>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-nss-primary/20 bg-nss-primary/5 px-4 py-3">
            <MousePointer2 size={16} className="mt-0.5 shrink-0 text-nss-primary" />
            <p className="text-xs leading-relaxed text-nss-muted">
              <span className="font-semibold text-nss-text">Canvas rule of thumb:</span> use{' '}
              <kbd className="font-mono text-[11px] text-nss-text">1 / V</kbd> to select,{' '}
              <kbd className="font-mono text-[11px] text-nss-text">2 / H</kbd> to move the canvas,
              and <kbd className="font-mono text-[11px] text-nss-text">3 / T</kbd> to place labels.
              The toolbar shows the number for each tool. Hold Shift or Space for a temporary tool;
              releasing it restores the tool you were using.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-x-7 gap-y-7 lg:grid-cols-2">
            {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
              <section key={group.id} aria-labelledby={`shortcut-group-${group.id}`}>
                <div className="mb-2.5 border-b border-nss-border pb-2">
                  <h3
                    id={`shortcut-group-${group.id}`}
                    className="text-xs font-bold uppercase tracking-[0.12em] text-nss-text"
                  >
                    {group.label}
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-nss-muted">
                    {group.description}
                  </p>
                </div>

                <div className="space-y-0.5">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-2 py-2 hover:bg-nss-surface/70"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-nss-text">{shortcut.label}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-nss-muted">
                          {shortcut.description}
                        </div>
                      </div>
                      <div className="flex max-w-52 flex-wrap items-center justify-end gap-1.5">
                        {shortcut.keys.map((keys, index) => (
                          <span
                            key={`${shortcut.id}-${index}`}
                            className="inline-flex items-center gap-1.5"
                          >
                            {index > 0 ? (
                              <span className="text-[9px] font-medium uppercase text-nss-muted">
                                or
                              </span>
                            ) : null}
                            <ShortcutChord keys={keys} apple={apple} />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-nss-border bg-nss-surface/60 px-5 py-3 text-[11px] text-nss-muted sm:px-6">
          <span>{apple ? '⌘ is the Command key' : 'Mod is the Ctrl key'}</span>
          <span className="inline-flex items-center gap-1.5">
            Press <ShortcutChord keys={['Escape']} apple={apple} /> to close
          </span>
        </footer>
      </section>
    </div>
  )
}
