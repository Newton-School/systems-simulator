import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, MoreHorizontal, Save, Workflow } from 'lucide-react'

import { CostChip } from './CostChip'
import { DesignChecksChip } from './DesignChecksChip'
import { FileStatus } from './FileStatus'
import { ModeBadge } from './ModeBadge'

interface HeaderMenuProps {
  onOpen: () => void
  onSave: () => void
  onAutoLayout: () => void
  canOpen: boolean
  canSave: boolean
  fileName: string | null
  isUnsaved: boolean
  showCost: boolean
  /** TopologyJSON import/export/viewer controls. */
  topologyJsonControls?: ReactNode
}

const ITEM_CLASS =
  'flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-nss-text transition-colors hover:bg-nss-surface'

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5 border-t border-nss-border px-1 py-2 first:border-t-0 first:pt-1">
      <p className="px-2.5 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
        {label}
      </p>
      {children}
    </div>
  )
}

/**
 * Simple shell's "..." menu: file actions, canvas actions and the status chips that used to
 * sit in the header, grouped by intent so the bar itself stays quiet.
 */
export function HeaderMenu({
  onOpen,
  onSave,
  onAutoLayout,
  canOpen,
  canSave,
  fileName,
  isUnsaved,
  showCost,
  topologyJsonControls
}: HeaderMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        onClick={() => setOpen((current) => !current)}
        className="nss-touch-target rounded p-2 text-nss-text transition-colors hover:bg-nss-text/10 focus:outline-none focus:ring-2 focus:ring-nss-primary"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="header-menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-nss-border bg-nss-panel p-1 shadow-xl"
        >
          <Group label="File">
            <div className="px-2.5 pb-1">
              <FileStatus fileName={fileName} isUnsaved={isUnsaved} />
            </div>
            {canOpen && (
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(onOpen)}>
                <FolderOpen size={15} /> Open
              </button>
            )}
            {canSave && (
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(onSave)}>
                <Save size={15} /> Save
              </button>
            )}
            {topologyJsonControls && (
              <div className="flex items-center gap-1 px-1">{topologyJsonControls}</div>
            )}
          </Group>
          <Group label="Canvas">
            <button
              type="button"
              role="menuitem"
              className={ITEM_CLASS}
              onClick={run(onAutoLayout)}
            >
              <Workflow size={15} /> Auto layout
            </button>
          </Group>
          <Group label="Status">
            <div className="flex flex-wrap items-center gap-2 px-2.5 py-1">
              {showCost && <CostChip />}
              <DesignChecksChip />
              <ModeBadge />
            </div>
          </Group>
        </div>
      )}
    </div>
  )
}
