import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { filterPaletteCommands, type PaletteCommand } from './commandPaletteModel'

/**
 * Cmd/Ctrl+K: every action by its plain name. It is what makes the simple shell safe to
 * simplify, since nothing a menu or panel hides is more than a few keystrokes away.
 */
export function CommandPalette({
  commands,
  onClose
}: {
  commands: readonly PaletteCommand[]
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const results = useMemo(() => filterPaletteCommands(commands, query), [commands, query])
  const active = Math.min(activeIndex, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active, results])

  const runCommand = (command: PaletteCommand | undefined): void => {
    if (!command) return
    onClose()
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(Math.min(active + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(Math.max(active - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runCommand(results[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 px-4 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        onKeyDown={onKeyDown}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-nss-border bg-nss-panel shadow-2xl"
      >
        <div className="relative border-b border-nss-border">
          <Search
            size={15}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-nss-muted"
          />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            placeholder="Type a command or component…"
            aria-label="Command"
            aria-controls="command-palette-list"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            className="h-12 w-full bg-transparent pl-10 pr-4 text-sm text-nss-text outline-none placeholder:text-nss-muted"
          />
        </div>
        <ul
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-80 overflow-y-auto p-1"
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-nss-muted">
              No command matches &quot;{query.trim()}&quot;
            </li>
          )}
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`palette-${command.id}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runCommand(command)}
              className={`flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-xs text-nss-text ${
                index === active ? 'bg-nss-surface' : ''
              }`}
            >
              <span className="truncate">{command.title}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-nss-muted">
                {command.group}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
