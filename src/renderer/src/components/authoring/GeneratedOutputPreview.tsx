import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  LoaderCircle,
  RotateCcw,
  Rows3
} from 'lucide-react'
import { useEffect, useState } from 'react'
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
  onDownloadQuestion: () => Promise<void>
  copyText?: (text: string) => Promise<void>
}

type OutputView = 'package' | 'question-html' | 'rows' | 'test-cases' | 'django'

interface EditableCodeBlockProps {
  value: string
  label: string
  copyLabel: string
  isCopied: boolean
  isDirty: boolean
  onChange: (value: string) => void
  onCopy: (value: string) => void
  onReset: () => void
  testId?: string
  className?: string
}

async function writeClipboardText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is not available in this environment.')
  }
  await navigator.clipboard.writeText(text)
}

function EditableCodeBlock({
  value,
  label,
  copyLabel,
  isCopied,
  isDirty,
  onChange,
  onCopy,
  onReset,
  testId,
  className = 'h-[32rem]'
}: EditableCodeBlockProps): React.JSX.Element {
  return (
    <div className="relative min-w-0 overflow-hidden bg-nss-surface">
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
        {isDirty && (
          <button
            type="button"
            aria-label={`Reset ${label}`}
            onClick={onReset}
            className="flex items-center gap-1.5 rounded-md border border-nss-warning/30 bg-nss-panel/95 px-2.5 py-1.5 text-[10px] font-semibold text-nss-warning shadow-sm backdrop-blur hover:border-nss-warning/60"
          >
            <RotateCcw size={12} aria-hidden="true" />
            Reset
          </button>
        )}
        <button
          type="button"
          aria-label={`Copy ${copyLabel}`}
          onClick={() => onCopy(value)}
          className="flex items-center gap-1.5 rounded-md border border-nss-borderHigh bg-nss-panel/95 px-2.5 py-1.5 text-[10px] font-semibold text-nss-text shadow-sm backdrop-blur hover:border-nss-primary/40 hover:text-nss-primary"
        >
          {isCopied ? (
            <Check size={12} className="text-nss-success" aria-hidden="true" />
          ) : (
            <Copy size={12} aria-hidden="true" />
          )}
          {isCopied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea
        data-testid={testId}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        wrap="off"
        className={`${className} block w-full resize-y overflow-auto border-0 bg-transparent px-4 pb-4 pt-12 font-mono text-[11px] leading-5 text-nss-text outline-none focus:ring-1 focus:ring-inset focus:ring-nss-primary/40`}
      />
      {isDirty && (
        <span className="pointer-events-none absolute bottom-2.5 right-3 rounded bg-nss-warning/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-nss-warning">
          Edited locally
        </span>
      )}
    </div>
  )
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
  onDownloadQuestion,
  copyText = writeClipboardText
}: GeneratedOutputPreviewProps): React.JSX.Element {
  const [activeOutput, setActiveOutput] = useState<OutputView>('test-cases')
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDownloadingQuestion, setIsDownloadingQuestion] = useState(false)
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null)
  const [editedBlocks, setEditedBlocks] = useState<Record<string, string>>({})
  const [actionNotice, setActionNotice] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)

  useEffect(() => {
    setEditedBlocks({})
    setCopiedBlock(null)
  }, [preview])

  const blockValue = (blockId: string, generatedValue: string): string =>
    editedBlocks[blockId] ?? generatedValue

  const handleBlockChange = (blockId: string, generatedValue: string, value: string): void => {
    setEditedBlocks((current) => {
      if (value === generatedValue) {
        const next = { ...current }
        delete next[blockId]
        return next
      }
      return { ...current, [blockId]: value }
    })
    setCopiedBlock(null)
  }

  const resetBlock = (blockId: string): void => {
    setEditedBlocks((current) => {
      const next = { ...current }
      delete next[blockId]
      return next
    })
    setCopiedBlock(null)
  }

  const handleCopy = async (text: string, label: string, blockId: string): Promise<void> => {
    try {
      await copyText(text)
      setCopiedBlock(blockId)
      setActionNotice({ tone: 'success', message: `${label} copied.` })
    } catch {
      setCopiedBlock(null)
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

  const handleDownloadQuestion = async (): Promise<void> => {
    setIsDownloadingQuestion(true)
    setActionNotice(null)
    try {
      await onDownloadQuestion()
    } finally {
      setIsDownloadingQuestion(false)
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
            Output from the strict runtime schema and shared Newton row codec. JSON and HTML blocks
            support temporary copy-only edits; use the visual stages for saved output and downloads.
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
              disabled={isDownloadingQuestion}
              onClick={() => void handleDownloadQuestion()}
              className="flex items-center gap-1.5 rounded-md bg-nss-primary px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-nss-primary/90 disabled:cursor-wait disabled:opacity-60"
            >
              {isDownloadingQuestion ? (
                <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={13} aria-hidden="true" />
              )}
              Download question (.json)
            </button>
            <button
              type="button"
              disabled={isDownloading}
              onClick={() => void handleDownload()}
              className="flex items-center gap-1.5 rounded-md border border-nss-border bg-nss-panel px-2.5 py-1.5 text-[11px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary disabled:cursor-wait disabled:opacity-60"
            >
              {isDownloading ? (
                <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={13} aria-hidden="true" />
              )}
              Download Django bundle
            </button>
            <span className="text-[10px] text-nss-success">
              Load the .json in the simulator, or hand off the Django bundle
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
              className="flex items-center gap-1 overflow-x-auto border-b border-nss-border bg-nss-panel p-1.5"
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
                aria-selected={activeOutput === 'question-html'}
                onClick={() => setActiveOutput('question-html')}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold ${
                  activeOutput === 'question-html'
                    ? 'bg-nss-primary/10 text-nss-primary'
                    : 'text-nss-muted hover:bg-nss-surface hover:text-nss-text'
                }`}
              >
                <Code2 size={13} aria-hidden="true" />
                Question text HTML
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
                aria-selected={activeOutput === 'test-cases'}
                onClick={() => setActiveOutput('test-cases')}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold ${
                  activeOutput === 'test-cases'
                    ? 'bg-nss-primary/10 text-nss-primary'
                    : 'text-nss-muted hover:bg-nss-surface hover:text-nss-text'
                }`}
              >
                <Rows3 size={13} aria-hidden="true" />
                Django test cases ({preview.django.rows.length})
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
            {activeOutput === 'test-cases' ? (
              <div data-testid="django-test-case-rows">
                <div className="border-b border-nss-border bg-nss-panel px-4 py-3">
                  <p className="text-[11px] font-semibold text-nss-text">
                    Django test-case mappings
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-nss-muted">
                    Copy each input into Django Admin in this exact order. Hidden stays false and
                    output stays empty.
                  </p>
                </div>
                <div className="divide-y divide-nss-border">
                  {preview.django.rows.map((row) => {
                    const inputJson = `${JSON.stringify(row.input, null, 2)}\n`
                    const blockId = `test-case-${row.order}`
                    const inputValue = blockValue(blockId, inputJson)
                    return (
                      <section
                        key={row.order}
                        aria-labelledby={`django-test-case-${row.order}`}
                        className="p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h4
                            id={`django-test-case-${row.order}`}
                            className="text-xs font-semibold text-nss-text"
                          >
                            Row {row.order}
                          </h4>
                          <span className="text-[9px] font-medium uppercase tracking-wide text-nss-muted">
                            hidden: false · output: empty
                          </span>
                        </div>
                        <div className="grid gap-4 md:grid-cols-[minmax(13rem,0.85fr)_minmax(0,1.35fr)]">
                          <label className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                            Title
                            <input
                              readOnly
                              aria-label={`Row ${row.order} title`}
                              value={row.title}
                              className="mt-1.5 block h-10 w-full rounded-md border border-nss-border bg-nss-input-bg px-3 font-mono text-[11px] normal-case tracking-normal text-nss-text outline-none"
                            />
                          </label>
                          <div className="min-w-0">
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                              Input JSON
                            </p>
                            <div className="overflow-hidden rounded-md border border-nss-borderHigh">
                              <EditableCodeBlock
                                value={inputValue}
                                label={`Row ${row.order} input JSON`}
                                copyLabel={`row ${row.order} input JSON`}
                                isCopied={copiedBlock === blockId}
                                isDirty={inputValue !== inputJson}
                                onChange={(value) => handleBlockChange(blockId, inputJson, value)}
                                onCopy={(value) =>
                                  void handleCopy(value, `Row ${row.order} input JSON`, blockId)
                                }
                                onReset={() => resetBlock(blockId)}
                                className="h-72"
                              />
                            </div>
                          </div>
                        </div>
                      </section>
                    )
                  })}
                </div>
              </div>
            ) : (
              <EditableCodeBlock
                value={blockValue(
                  activeOutput,
                  activeOutput === 'package'
                    ? preview.packageJson
                    : activeOutput === 'question-html'
                      ? preview.compiledRows.questionTextHtml
                      : activeOutput === 'rows'
                        ? preview.newtonRowsJson
                        : preview.djangoJson
                )}
                label={
                  activeOutput === 'package'
                    ? 'Generated question package JSON'
                    : activeOutput === 'question-html'
                      ? 'Generated question text HTML'
                      : activeOutput === 'rows'
                        ? 'Generated Newton rows JSON'
                        : 'Generated Django handoff JSON'
                }
                copyLabel={
                  activeOutput === 'package'
                    ? 'question package JSON'
                    : activeOutput === 'question-html'
                      ? 'question text HTML'
                      : activeOutput === 'rows'
                        ? 'Newton rows JSON'
                        : 'Django handoff JSON'
                }
                isCopied={copiedBlock === activeOutput}
                isDirty={activeOutput in editedBlocks}
                onChange={(value) =>
                  handleBlockChange(
                    activeOutput,
                    activeOutput === 'package'
                      ? preview.packageJson
                      : activeOutput === 'question-html'
                        ? preview.compiledRows.questionTextHtml
                        : activeOutput === 'rows'
                          ? preview.newtonRowsJson
                          : preview.djangoJson,
                    value
                  )
                }
                onCopy={(value) =>
                  void handleCopy(
                    value,
                    activeOutput === 'package'
                      ? 'Question package JSON'
                      : activeOutput === 'question-html'
                        ? 'Question text HTML'
                        : activeOutput === 'rows'
                          ? 'Newton rows JSON'
                          : 'Django handoff JSON',
                    activeOutput
                  )
                }
                onReset={() => resetBlock(activeOutput)}
                testId={
                  activeOutput === 'question-html'
                    ? 'generated-question-text-html'
                    : 'generated-output-json'
                }
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
