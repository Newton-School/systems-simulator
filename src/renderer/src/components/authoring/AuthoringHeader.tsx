import {
  ArrowLeft,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Save,
  Settings,
  Sparkles
} from 'lucide-react'

export type AuthoringFileStatus = 'new' | 'unsaved' | 'saving' | 'opening' | 'saved' | 'error'

interface AuthoringHeaderProps {
  simulatorHref: string
  questionTitle: string
  fileStatus: AuthoringFileStatus
  onOpen: () => void
  onNew: () => void
  onPreviewLearner: () => void
  onSave: () => void
  canExport: boolean
  isExporting: boolean
  onExport: () => void
  onOpenSettings: () => void
}

export function AuthoringHeader({
  simulatorHref,
  questionTitle,
  fileStatus,
  onOpen,
  onNew,
  onPreviewLearner,
  onSave,
  canExport,
  isExporting,
  onExport,
  onOpenSettings
}: AuthoringHeaderProps): React.JSX.Element {
  const displayTitle = questionTitle.trim() || 'Untitled question'
  const busy = fileStatus === 'saving' || fileStatus === 'opening'
  const statusText = {
    new: 'New draft',
    unsaved: 'Unsaved draft',
    saving: 'Saving…',
    opening: 'Opening…',
    saved: 'Saved',
    error: 'File error'
  }[fileStatus]

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-nss-border bg-nss-panel px-4">
      <div className="flex min-w-0 items-center gap-3">
        <a
          href={simulatorHref}
          aria-label="Back to simulator"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-nss-border text-nss-muted hover:bg-nss-surface hover:text-nss-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/70"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </a>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nss-primary text-white shadow-sm">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-nss-text">Question Studio</h1>
            <span className="rounded-full border border-nss-primary/20 bg-nss-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-nss-primary">
              Authoring
            </span>
          </div>
          <p className="truncate text-[11px] text-nss-muted" title={displayTitle}>
            {displayTitle} · {statusText}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="flex items-center gap-2 rounded-md border border-nss-border px-3 py-1.5 text-xs font-medium text-nss-text hover:bg-nss-surface disabled:opacity-50"
        >
          <FilePlus2 size={14} />
          <span className="hidden sm:inline">New</span>
        </button>
        <button
          type="button"
          onClick={onOpen}
          disabled={busy}
          className="flex items-center gap-2 rounded-md border border-nss-border px-3 py-1.5 text-xs font-medium text-nss-text hover:bg-nss-surface disabled:cursor-wait disabled:opacity-50"
        >
          {fileStatus === 'opening' ? (
            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <FolderOpen size={14} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Open</span>
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="flex items-center gap-2 rounded-md border border-nss-border px-3 py-1.5 text-xs font-medium text-nss-text hover:bg-nss-surface disabled:cursor-wait disabled:opacity-50"
        >
          {fileStatus === 'saving' ? (
            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size={14} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Save draft</span>
        </button>
        <button
          type="button"
          onClick={onPreviewLearner}
          className="hidden items-center gap-2 rounded-md border border-nss-border px-3 py-1.5 text-xs font-medium text-nss-text hover:bg-nss-surface xl:flex"
        >
          <Eye size={14} aria-hidden="true" />
          Preview learner
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Environments, simulation, and display settings"
          className="flex items-center justify-center rounded-md border border-nss-border p-1.5 text-nss-text hover:bg-nss-surface"
        >
          <Settings size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={busy || isExporting || !canExport}
          onClick={onExport}
          title={
            canExport
              ? 'Download the complete Django handoff bundle'
              : 'Complete the generated-output checklist before downloading'
          }
          className="flex items-center gap-2 rounded-md bg-nss-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-nss-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isExporting ? (
            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={14} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Django bundle</span>
          <span className="sm:hidden">Export</span>
        </button>
      </div>
    </header>
  )
}
