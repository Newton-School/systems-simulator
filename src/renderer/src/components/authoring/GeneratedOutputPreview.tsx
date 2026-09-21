import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  LoaderCircle,
  Rows3
} from 'lucide-react'
import { useState } from 'react'
import type {
  QuestionAuthoringPreview,
  QuestionAuthoringPreviewDiagnostic
} from '../../../../engine/analysis/questionAuthoringCompiler'
import type { AuthoringStageId } from '../../../../engine/analysis/questionAuthoringProject'
import { getQuestionStudioStage } from './questionStudioStages'

interface GeneratedOutputPreviewProps {
  preview: QuestionAuthoringPreview
  onNavigate: (stage: AuthoringStageId) => void
  onDownload: () => Promise<void>
  copyText?: (text: string) => Promise<void>
}

async function writeClipboardText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is not available in this environment.')
  }
  await navigator.clipboard.writeText(text)
}

function DiagnosticList({
  diagnostics,
  onNavigate
}: {
  diagnostics: readonly QuestionAuthoringPreviewDiagnostic[]
  onNavigate: (stage: AuthoringStageId) => void
}): React.JSX.Element {
  return (
    <ul className="space-y-2">
      {diagnostics.map((diagnostic, index) => {
        const stage = getQuestionStudioStage(diagnostic.stage)
        return (
          <li
            key={`${diagnostic.code}-${diagnostic.path ?? index}`}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
              diagnostic.level === 'error'
                ? 'border-nss-danger/25 bg-nss-danger/10'
                : 'border-nss-warning/25 bg-nss-warning/10'
            }`}
          >
            <AlertTriangle
              size={14}
              className={`mt-0.5 shrink-0 ${
                diagnostic.level === 'error' ? 'text-nss-danger' : 'text-nss-warning'
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-5 text-nss-text">{diagnostic.message}</p>
              {diagnostic.path && (
                <code className="mt-0.5 block truncate text-[10px] text-nss-muted">
                  {diagnostic.path}
                </code>
              )}
            </div>
            {diagnostic.stage !== 'export' && (
              <button
                type="button"
                onClick={() => onNavigate(diagnostic.stage)}
                className="shrink-0 rounded border border-nss-border bg-nss-panel px-2 py-1 text-[10px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary"
              >
                Open {stage.label}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function GeneratedOutputPreview({
  preview,
  onNavigate,
  onDownload,
  copyText = writeClipboardText
}: GeneratedOutputPreviewProps): React.JSX.Element {
  const [activeOutput, setActiveOutput] = useState<'package' | 'rows' | 'django'>('package')
  const [isDownloading, setIsDownloading] = useState(false)
  const [actionNotice, setActionNotice] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)

  const handleCopy = async (text: string, label: string): Promise<void> => {
    try {
      await copyText(text)
      setActionNotice({ tone: 'success', message: `${label} copied.` })
    } catch {
      setActionNotice({ tone: 'error', message: `Could not copy ${label.toLowerCase()}.` })
    }
  }

  const handleDownload = async (): Promise<void> => {
    setIsDownloading(true)
    setActionNotice(null)
    try {
      await onDownload()
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <section
      className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
      aria-labelledby="generated-output-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Production-shaped output
          </p>
          <h3 id="generated-output-title" className="mt-1 text-base font-semibold text-nss-text">
            Generated package and Newton rows
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
            Read-only output from the strict runtime schema and shared Newton row codec. Edit the
            visual stages to change it.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide ${
            preview.status === 'ready'
              ? 'border-nss-success/25 bg-nss-success/10 text-nss-success'
              : 'border-nss-danger/25 bg-nss-danger/10 text-nss-danger'
          }`}
        >
          {preview.status === 'ready' ? 'Generated' : 'Blocked'}
        </span>
      </div>

      {preview.status === 'blocked' ? (
        <div className="mt-5">
          <div className="rounded-lg border border-nss-danger/25 bg-nss-danger/10 px-4 py-3">
            <div className="flex items-center gap-2 text-nss-danger">
              <AlertTriangle size={15} aria-hidden="true" />
              <p className="text-xs font-semibold">Generated output is not available yet</p>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-nss-muted">
              Complete the items below. The Studio does not display plausible partial JSON.
            </p>
          </div>
          <div className="mt-3">
            <DiagnosticList diagnostics={preview.diagnostics} onNavigate={onNavigate} />
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-nss-success/25 bg-nss-success/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-nss-success" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-nss-text">Generated output is current</p>
                <p className="mt-0.5 text-[10px] text-nss-muted">
                  {preview.compiledRows.rows.length} Newton rows · package ID{' '}
                  {preview.questionPackage.id}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-medium text-nss-muted">
              Compiled: {preview.questionPackage.difficulty} · {preview.questionPackage.type} ·{' '}
              {preview.questionPackage.entryFormat ?? 'inferred entry'}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-nss-border bg-nss-surface px-3 py-2.5">
            <button
              type="button"
              onClick={() =>
                void handleCopy(
                  activeOutput === 'package'
                    ? preview.packageJson
                    : activeOutput === 'rows'
                      ? preview.newtonRowsJson
                      : preview.djangoJson,
                  activeOutput === 'package'
                    ? 'Question package JSON'
                    : activeOutput === 'rows'
                      ? 'Newton rows JSON'
                      : 'Django handoff JSON'
                )
              }
              className="flex items-center gap-1.5 rounded-md border border-nss-border bg-nss-panel px-2.5 py-1.5 text-[11px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary"
            >
              <Copy size={13} aria-hidden="true" />
              Copy visible JSON
            </button>
            <button
              type="button"
              disabled={isDownloading}
              onClick={() => void handleDownload()}
              className="flex items-center gap-1.5 rounded-md bg-nss-primary px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-nss-primary/90 disabled:cursor-wait disabled:opacity-60"
            >
              {isDownloading ? (
                <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={13} aria-hidden="true" />
              )}
              Download Django bundle
            </button>
            <span className="text-[10px] text-nss-success">
              Includes assignment fields, ordered rows, and the admin guide
            </span>
          </div>

          {actionNotice && (
            <p
              role={actionNotice.tone === 'error' ? 'alert' : 'status'}
              className={`mt-2 text-[10px] ${
                actionNotice.tone === 'error' ? 'text-nss-danger' : 'text-nss-success'
              }`}
            >
              {actionNotice.message}
            </p>
          )}

          {preview.diagnostics.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-nss-warning">
                Authoring advisories
              </p>
              <DiagnosticList diagnostics={preview.diagnostics} onNavigate={onNavigate} />
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-lg border border-nss-borderHigh bg-nss-surface">
            <div
              role="tablist"
              aria-label="Generated output format"
              className="flex items-center gap-1 border-b border-nss-border bg-nss-panel p-1.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeOutput === 'package'}
                onClick={() => setActiveOutput('package')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold ${
                  activeOutput === 'package'
                    ? 'bg-nss-primary/10 text-nss-primary'
                    : 'text-nss-muted hover:bg-nss-surface hover:text-nss-text'
                }`}
              >
                <Code2 size={13} aria-hidden="true" />
                Question package
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeOutput === 'rows'}
                onClick={() => setActiveOutput('rows')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold ${
                  activeOutput === 'rows'
                    ? 'bg-nss-primary/10 text-nss-primary'
                    : 'text-nss-muted hover:bg-nss-surface hover:text-nss-text'
                }`}
              >
                <Rows3 size={13} aria-hidden="true" />
                Newton rows ({preview.compiledRows.rows.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeOutput === 'django'}
                onClick={() => setActiveOutput('django')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold ${activeOutput === 'django' ? 'bg-nss-primary/10 text-nss-primary' : 'text-nss-muted hover:bg-nss-surface hover:text-nss-text'}`}
              >
                <Rows3 size={13} aria-hidden="true" /> Django handoff
              </button>
            </div>
            {activeOutput === 'rows' && (
              <div className="flex flex-wrap items-center gap-2 border-b border-nss-border bg-nss-panel px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Copy Django input
                </span>
                {preview.compiledRows.rows.map((row) => (
                  <button
                    key={row.order}
                    type="button"
                    onClick={() =>
                      void handleCopy(`${JSON.stringify(row.spec, null, 2)}\n`, `Row ${row.order}`)
                    }
                    className="rounded border border-nss-border bg-nss-surface px-2 py-1 text-[10px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary"
                  >
                    Copy row {row.order}
                  </button>
                ))}
              </div>
            )}
            <pre
              data-testid="generated-output-json"
              aria-label={
                activeOutput === 'package'
                  ? 'Generated question package JSON'
                  : activeOutput === 'rows'
                    ? 'Generated Newton rows JSON'
                    : 'Generated Django handoff JSON'
              }
              className="max-h-[32rem] overflow-auto p-4 text-[11px] leading-5 text-nss-text"
            >
              <code>
                {activeOutput === 'package'
                  ? preview.packageJson
                  : activeOutput === 'rows'
                    ? preview.newtonRowsJson
                    : preview.djangoJson}
              </code>
            </pre>
          </div>
        </div>
      )}
    </section>
  )
}
