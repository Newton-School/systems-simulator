import { useEffect, useRef, useState } from 'react'
import { Braces, Copy, Download, PanelRight, Upload } from 'lucide-react'
import { useTopologyJsonExport, type ExportOutcome } from '@renderer/hooks/useTopologyJsonExport'

interface TopologyJsonMenuProps {
  isViewerOpen: boolean
  onToggleViewer: () => void
  /** Omitted where loading another topology is not allowed. */
  onImport?: () => void
  /** False where exporting the design is not allowed (assignment mode). */
  canExport?: boolean
}

/**
 * Header entry for TopologyJSON (#89): import from a file or pasted text,
 * export as a download or to the clipboard, and open the JSON viewer. These
 * sit next to Open/Save, which keep handling the app's own canvas file.
 */
export function TopologyJsonMenu({
  isViewerOpen,
  onToggleViewer,
  onImport,
  canExport = true
}: TopologyJsonMenuProps) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<ExportOutcome | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { copy, download } = useTopologyJsonExport()

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as globalThis.Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  useEffect(() => {
    if (!notice) return
    const handle = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(handle)
  }, [notice])

  const run = (action: () => void | Promise<ExportOutcome | void>) => async () => {
    setOpen(false)
    const outcome = await action()
    if (outcome) setNotice(outcome)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="TopologyJSON: import, export, viewer"
        className={`nss-touch-target flex items-center gap-1 rounded p-2 text-nss-text transition-colors hover:bg-nss-text/10 focus:outline-none focus:ring-2 focus:ring-nss-primary ${
          isViewerOpen ? 'text-nss-primary' : ''
        }`}
      >
        <Braces size={18} />
        <span className="nss-desktop-only text-xs font-semibold">JSON</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-50 mt-1 w-60 -translate-x-1/2 overflow-hidden rounded-lg border border-nss-border bg-nss-panel py-1 text-xs text-nss-text shadow-xl"
        >
          <MenuItem
            icon={<PanelRight size={14} />}
            label={isViewerOpen ? 'Hide JSON viewer' : 'Show JSON viewer'}
            onSelect={run(onToggleViewer)}
          />
          {onImport ? (
            <MenuItem
              icon={<Upload size={14} />}
              label="Import JSON (file or paste)..."
              onSelect={run(onImport)}
            />
          ) : null}
          {canExport ? (
            <>
              <MenuItem
                icon={<Download size={14} />}
                label="Download TopologyJSON"
                onSelect={run(download)}
              />
              <MenuItem icon={<Copy size={14} />} label="Copy TopologyJSON" onSelect={run(copy)} />
            </>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p
          role="status"
          className={`absolute left-1/2 top-full z-50 mt-1 w-max max-w-xs -translate-x-1/2 rounded-md border border-nss-border bg-nss-panel px-2 py-1 text-[11px] shadow-lg ${
            notice.ok ? 'text-nss-success' : 'text-nss-warning'
          }`}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onSelect
}: {
  icon: React.ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-nss-surface hover:text-nss-primary"
    >
      <span className="text-nss-muted">{icon}</span>
      {label}
    </button>
  )
}
