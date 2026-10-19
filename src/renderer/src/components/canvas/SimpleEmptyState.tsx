import { Plus } from 'lucide-react'

/**
 * Simple shell's empty canvas: one sentence and the next move as buttons, instead of a
 * "drag from the library" hint that points at a sidebar that is no longer there.
 */
export function SimpleEmptyState({
  onAddComponent,
  onLoadStarter
}: {
  onAddComponent: () => void
  /** Offered only when no question is loaded, so a starter can't break a question's rules. */
  onLoadStarter?: () => void
}): React.JSX.Element {
  return (
    <div
      data-testid="simple-empty-state"
      className="pointer-events-auto flex max-w-xs flex-col items-center gap-3 text-center"
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-nss-text">Start with your first component</p>
        <p className="text-xs text-nss-muted">
          Add a client, then connect it to a server and press Run.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onAddComponent}
          className="flex min-h-9 items-center gap-1.5 rounded-md border border-nss-primary/50 bg-nss-primary/10 px-3 text-xs font-semibold text-nss-primary transition-colors hover:bg-nss-primary/20"
        >
          <Plus size={14} />
          Add component
        </button>
        {onLoadStarter && (
          <button
            type="button"
            onClick={onLoadStarter}
            className="min-h-9 rounded-md border border-nss-border px-3 text-xs font-semibold text-nss-text transition-colors hover:border-nss-primary/50 hover:text-nss-primary"
          >
            Load starter diagram
          </button>
        )}
      </div>
    </div>
  )
}
