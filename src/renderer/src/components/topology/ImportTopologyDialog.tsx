import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileJson, Upload, X } from 'lucide-react'
import type { ValidationError } from '../../../../engine/validation/validator'
import { isTopologyJsonLike } from '@renderer/utils/topologyCanvasAdapter'
import {
  deserializeTopology,
  isImportFailure,
  parseJsonText,
  type TopologyImportSuccess
} from '@renderer/utils/topologyDeserializer'

interface ImportTopologyDialogProps {
  onClose: () => void
  /**
   * Replaces the canvas with imported canvas data (the regular load path, which
   * asks before discarding unsaved changes). Resolves false when the user
   * cancels or loading fails.
   */
  onImport: (canvasData: object, fileName: string) => Promise<boolean>
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'error'; title: string; errors: ValidationError[] }
  | { kind: 'imported'; result: TopologyImportSuccess }

function isCanvasFile(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { nodes?: unknown }).nodes) &&
    !('global' in value)
  )
}

/**
 * Import JSON (#89): bring in a TopologyJSON document from a file or pasted
 * text. Validation runs before anything changes, so a bad document leaves the
 * canvas untouched and lists what is wrong in plain words. A design file saved
 * with Save is accepted too.
 */
export function ImportTopologyDialog({ onClose, onImport }: ImportTopologyDialogProps) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textAreaRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const runImport = async (source: string, name: string) => {
    const parsed = parseJsonText(source)
    if ('error' in parsed) {
      setOutcome({
        kind: 'error',
        title: 'Nothing was imported',
        errors: [{ path: '', message: parsed.error }]
      })
      return
    }

    if (!isTopologyJsonLike(parsed.value) && isCanvasFile(parsed.value)) {
      setBusy(true)
      const loaded = await onImport(parsed.value as object, name)
      setBusy(false)
      if (loaded) onClose()
      return
    }

    const result = deserializeTopology(parsed.value)
    if (isImportFailure(result)) {
      setOutcome({ kind: 'error', title: 'Nothing was imported', errors: result.errors })
      return
    }

    setBusy(true)
    const loaded = await onImport(result.canvas, name)
    setBusy(false)
    if (!loaded) return
    if (result.problems.length === 0 && result.warnings.length === 0 && !result.autoLaidOut) {
      onClose()
      return
    }
    setOutcome({ kind: 'imported', result })
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const content = await file.text()
    setFileName(file.name)
    setText(content)
    await runImport(content, file.name)
  }

  const suggestedName = (() => {
    const parsed = parseJsonText(text)
    const name =
      'value' in parsed && typeof (parsed.value as { name?: unknown })?.name === 'string'
        ? ((parsed.value as { name: string }).name as string)
        : ''
    return fileName ?? (name.trim() ? `${name.trim()}.json` : 'imported-topology.json')
  })()

  return (
    <div
      className="fixed inset-0 z-[45] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-topology-title"
        className="flex max-h-[88vh] w-[640px] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-nss-border bg-nss-panel text-nss-text shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-nss-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nss-primary/10 text-nss-primary">
              <FileJson size={19} />
            </div>
            <div>
              <h2 id="import-topology-title" className="text-base font-semibold">
                Import TopologyJSON
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-nss-muted">
                Choose a file or paste a document. It is checked before the canvas changes; nodes
                without positions are laid out automatically.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nss-muted transition-colors hover:bg-nss-surface hover:text-nss-text focus:outline-none focus:ring-2 focus:ring-nss-primary/60"
          >
            <X size={18} />
          </button>
        </header>

        {outcome.kind === 'imported' ? (
          <ImportSummary result={outcome.result} onClose={onClose} />
        ) : (
          <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-nss-border bg-nss-surface px-3 text-xs font-semibold transition-colors hover:border-nss-primary hover:text-nss-primary"
              >
                <Upload size={14} />
                Choose file...
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="TopologyJSON file"
                onChange={handleFile}
              />
              <span className="truncate text-xs text-nss-muted">
                {fileName ?? 'or paste the JSON below'}
              </span>
            </div>
            <label className="sr-only" htmlFor="import-topology-text">
              TopologyJSON text
            </label>
            <textarea
              id="import-topology-text"
              ref={textAreaRef}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setFileName(null)
                if (outcome.kind === 'error') setOutcome({ kind: 'idle' })
              }}
              onKeyDown={(event) => event.stopPropagation()}
              spellCheck={false}
              placeholder='{ "id": "...", "name": "...", "global": { ... }, "nodes": [ ... ], "edges": [ ... ] }'
              className="custom-scrollbar min-h-[220px] flex-1 resize-y rounded-md border border-nss-border bg-nss-input-bg p-3 font-mono text-[11px] leading-5 text-nss-text placeholder:text-nss-muted/60 focus:border-nss-primary focus:outline-none"
            />
            {outcome.kind === 'error' ? (
              <IssueList
                tone="error"
                title={outcome.title}
                messages={outcome.errors.map((error) => error.message)}
              />
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-9 rounded-md px-3 text-xs font-semibold text-nss-muted transition-colors hover:bg-nss-surface hover:text-nss-text"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || text.trim().length === 0}
                onClick={() => void runImport(text, suggestedName)}
                className="min-h-9 rounded-md bg-nss-primary px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Import
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function ImportSummary({
  result,
  onClose
}: {
  result: TopologyImportSuccess
  onClose: () => void
}) {
  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
      <div className="flex items-start gap-2 rounded-md border border-nss-success/30 bg-nss-success/10 px-3 py-2 text-xs">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-nss-success" />
        <span>
          Imported {result.nodesImported} component{result.nodesImported === 1 ? '' : 's'} and{' '}
          {result.edgesImported} connection{result.edgesImported === 1 ? '' : 's'}
          {result.autoLaidOut ? '. The document had no positions, so it was laid out.' : '.'}
        </span>
      </div>
      {result.problems.length > 0 ? (
        <IssueList
          tone="error"
          title="Fix these before running"
          messages={result.problems.map((problem) => problem.message)}
        />
      ) : null}
      {result.warnings.length > 0 ? (
        <IssueList tone="warning" title="Warnings" messages={result.warnings} />
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="min-h-9 rounded-md bg-nss-primary px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          Done
        </button>
      </div>
    </div>
  )
}

export function IssueList({
  tone,
  title,
  messages
}: {
  tone: 'error' | 'warning'
  title: string
  messages: string[]
}) {
  const isError = tone === 'error'
  return (
    <div
      role={isError ? 'alert' : undefined}
      className={`rounded-md border px-3 py-2 text-xs ${
        isError ? 'border-nss-danger/30 bg-nss-danger/5' : 'border-nss-warning/30 bg-nss-warning/5'
      }`}
    >
      <p
        className={`mb-1 flex items-center gap-1.5 font-semibold ${
          isError ? 'text-nss-danger' : 'text-nss-warning'
        }`}
      >
        <AlertTriangle size={13} />
        {title}
      </p>
      <ul className="space-y-1 leading-5 text-nss-text/90">
        {messages.map((message, index) => (
          <li key={`${index}-${message}`}>- {message}</li>
        ))}
      </ul>
    </div>
  )
}
