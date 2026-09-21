import { ArrowLeft, AlertTriangle, Boxes, Eye, Lock, Maximize2, PlayCircle } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { QuestionAuthoringPreview } from '../../../../engine/analysis/questionAuthoringCompiler'
import { buildQuestionTextHtml } from '../../../../engine/analysis/questionTextHtml'
import useStore from '../../store/useStore'
import { sanitizeQuestionPromptHtml } from '../../utils/questionPromptHtml'
import { topologyToCanvasFileData } from '../../utils/topologyCanvasAdapter'
import { convertNestedToFlat } from '../../utils/nodeTransformers'
import type { ComponentLibraryFilter } from '../library/ComponentLibrarySidebarPanel'

const QuestionPanel = lazy(async () => {
  const module = await import('../question/QuestionPanel')
  return { default: module.QuestionPanel }
})

const FlowCanvas = lazy(async () => {
  const module = await import('../canvas/FlowCanvas')
  return { default: module.FlowCanvas }
})

const ComponentLibrarySidebarPanel = lazy(async () => {
  const module = await import('../library/ComponentLibrarySidebarPanel')
  return { default: module.ComponentLibrarySidebarPanel }
})

const PropertiesPanel = lazy(async () => {
  const module = await import('../properties/PropertiesPanel')
  return { default: module.PropertiesPanel }
})

function InteractiveLearnerWorkspace({
  preview
}: {
  preview: Extract<QuestionAuthoringPreview, { status: 'ready' }>
}): React.JSX.Element {
  const [leftView, setLeftView] = useState<'question' | 'library'>('question')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryFilter, setLibraryFilter] = useState<ComponentLibraryFilter>('common')
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const question = preview.questionPackage

  useEffect(() => {
    const store = useStore.getState()
    store.setAttemptState(null)
    store.clearJustificationAnswers()
    store.setActiveQuestion(question)
    store.setActiveQuestionPromptHtml(buildQuestionTextHtml(question.prompt))
    const topology = question.scaffold.topology
    if (topology) {
      const canvas = topologyToCanvasFileData(topology)
      store.setGraph(convertNestedToFlat(canvas.nodes), canvas.edges, {
        history: 'skip',
        resetHistory: true
      })
      if (canvas.scenario) store.setScenario(canvas.scenario)
    } else {
      store.setGraph([], [], { history: 'skip', resetHistory: true })
    }

    return () => {
      const current = useStore.getState()
      current.setActiveQuestion(null)
      current.setActiveQuestionPromptHtml(null)
      current.setAttemptState(null)
      current.clearJustificationAnswers()
      current.setGraph([], [], { history: 'skip', resetHistory: true })
    }
  }, [question])

  useEffect(() => {
    if (!workspaceOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setWorkspaceOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [workspaceOpen])

  const workspaceClassName = workspaceOpen
    ? 'fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-nss-bg text-nss-text'
    : 'border-t border-nss-border'
  const canvasGridClassName = workspaceOpen
    ? 'grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)_21rem] bg-nss-bg max-xl:grid-cols-[16rem_minmax(0,1fr)] max-lg:grid-cols-1'
    : 'grid h-[44rem] min-h-[36rem] grid-cols-[18rem_minmax(0,1fr)_19rem] bg-nss-bg max-xl:grid-cols-[16rem_minmax(0,1fr)] max-lg:grid-cols-1'

  return (
    <div
      className={workspaceClassName}
      role={workspaceOpen ? 'dialog' : undefined}
      aria-modal={workspaceOpen ? 'true' : undefined}
      aria-label={workspaceOpen ? 'Full-screen learner simulator preview' : undefined}
    >
      <div className="flex items-center justify-between border-b border-nss-border bg-nss-surface px-4 py-2">
        <div className="flex items-center gap-3">
          {workspaceOpen && (
            <button
              type="button"
              onClick={() => setWorkspaceOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-nss-border bg-nss-panel text-nss-muted hover:text-nss-text"
              aria-label="Back to Preview stage"
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
          )}
          <div>
            <p className="text-xs font-semibold text-nss-text">Interactive learner workspace</p>
            <p className="text-[10px] text-nss-muted">
              {workspaceOpen
                ? question.title
                : 'Uses the production question panel, canvas, component library, and properties editor.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-nss-border bg-nss-panel p-0.5">
            <button
              type="button"
              onClick={() => setLeftView('question')}
              className={`rounded px-2.5 py-1 text-[10px] font-semibold ${leftView === 'question' ? 'bg-nss-primary text-white' : 'text-nss-muted'}`}
            >
              Question
            </button>
            <button
              type="button"
              onClick={() => setLeftView('library')}
              className={`rounded px-2.5 py-1 text-[10px] font-semibold ${leftView === 'library' ? 'bg-nss-primary text-white' : 'text-nss-muted'}`}
            >
              Components
            </button>
          </div>
          {workspaceOpen ? (
            <button
              type="button"
              onClick={() => setWorkspaceOpen(false)}
              className="rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
            >
              Done previewing
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setWorkspaceOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-nss-border bg-nss-panel px-2.5 py-1.5 text-[10px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/50"
            >
              <Maximize2 size={13} aria-hidden="true" />
              Full screen
            </button>
          )}
        </div>
      </div>
      <div className={canvasGridClassName}>
        <aside className="min-h-0 overflow-auto border-r border-nss-border bg-nss-panel max-lg:hidden">
          <Suspense
            fallback={<div className="p-4 text-xs text-nss-muted">Loading learner panel…</div>}
          >
            {leftView === 'question' ? (
              <QuestionPanel key={preview.packageJson} />
            ) : (
              <ComponentLibrarySidebarPanel
                query={libraryQuery}
                filter={libraryFilter}
                onQueryChange={setLibraryQuery}
                onFilterChange={setLibraryFilter}
              />
            )}
          </Suspense>
        </aside>
        <div className="relative min-h-0">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs text-nss-muted">
                Loading learner canvas…
              </div>
            }
          >
            <FlowCanvas showMetricLens={false} />
          </Suspense>
        </div>
        <aside className="min-h-0 overflow-auto border-l border-nss-border bg-nss-panel max-xl:hidden">
          <Suspense
            fallback={<div className="p-4 text-xs text-nss-muted">Loading properties…</div>}
          >
            <PropertiesPanel />
          </Suspense>
        </aside>
      </div>
    </div>
  )
}

export function LearnerExperiencePreview({
  preview
}: {
  preview: QuestionAuthoringPreview
}): React.JSX.Element {
  if (preview.status === 'blocked') {
    return (
      <section className="rounded-xl border border-nss-danger/30 bg-nss-danger/10 p-5">
        <div className="flex items-center gap-2 text-nss-danger">
          <AlertTriangle size={16} />
          <h3 className="text-sm font-semibold">Learner preview is blocked</h3>
        </div>
        <p className="mt-2 text-xs text-nss-muted">
          Complete the required authoring fields first. The preview only renders a schema-valid
          runtime question.
        </p>
      </section>
    )
  }
  const question = preview.questionPackage
  const html = sanitizeQuestionPromptHtml(buildQuestionTextHtml(question.prompt))
  const topology = question.scaffold.topology
  return (
    <section className="overflow-hidden rounded-xl border border-nss-border bg-nss-panel shadow-sm">
      <div className="flex items-center justify-between border-b border-nss-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Eye size={16} className="text-nss-primary" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-primary">
              Compiled learner experience
            </p>
            <h3 className="text-base font-semibold text-nss-text">{question.title}</h3>
          </div>
        </div>
        <span className="rounded-full border border-nss-success/25 bg-nss-success/10 px-2.5 py-1 text-[9px] font-semibold uppercase text-nss-success">
          Runtime-valid
        </span>
      </div>
      <div className="grid min-h-[34rem] lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <article className="border-r border-nss-border p-6">
          <div className="flex flex-wrap gap-2">
            {[question.difficulty, question.type, question.entryFormat, ...(question.tags ?? [])]
              .filter(Boolean)
              .map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-nss-surface px-2.5 py-1 text-[10px] font-semibold text-nss-muted"
                >
                  {tag}
                </span>
              ))}
          </div>
          {question.description && (
            <p className="mt-4 text-sm leading-6 text-nss-muted">{question.description}</p>
          )}
          <div
            className="mt-5 text-sm leading-6 text-nss-text/90 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-xs [&_h3]:font-semibold [&_li]:mb-1 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {question.justify?.length ? (
            <div className="mt-6">
              <p className="text-xs font-semibold text-nss-text">Required explanations</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs text-nss-muted">
                {question.justify.map((prompt) => (
                  <li key={prompt.id}>{prompt.decision}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </article>
        <aside className="space-y-4 bg-nss-surface/50 p-5">
          <div className="rounded-lg border border-nss-border bg-nss-panel p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-nss-text">
              <Boxes size={14} /> Starting design
            </p>
            <p className="mt-2 text-[11px] leading-5 text-nss-muted">
              {topology
                ? `${topology.nodes.length} nodes and ${topology.edges.length} connections are provided.`
                : 'Learners start with a blank canvas.'}
            </p>
            {topology && (
              <ul className="mt-3 space-y-1 text-[10px] text-nss-muted">
                {topology.nodes.slice(0, 8).map((node) => (
                  <li key={node.id}>
                    {node.label || node.id} · {node.type}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-nss-border bg-nss-panel p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-nss-text">
              <Lock size={14} /> Editing contract
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
              <dt className="text-nss-muted">Modify scaffold</dt>
              <dd className="text-right text-nss-text">
                {question.constraints.canModifyScaffold ? 'Allowed' : 'Locked'}
              </dd>
              <dt className="text-nss-muted">Remove nodes</dt>
              <dd className="text-right text-nss-text">
                {question.constraints.canRemoveScaffoldNodes ? 'Allowed' : 'Locked'}
              </dd>
              <dt className="text-nss-muted">Locked elements</dt>
              <dd className="text-right text-nss-text">
                {(question.scaffold.lockedNodeIds?.length ?? 0) +
                  (question.scaffold.lockedEdgeIds?.length ?? 0)}
              </dd>
            </dl>
          </div>
          <div className="rounded-lg border border-nss-border bg-nss-panel p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-nss-text">
              <PlayCircle size={14} /> Test access
            </p>
            <p className="mt-2 text-[11px] leading-5 text-nss-muted">
              {question.suite.dryRunCase
                ? `Learners can dry-run “${question.suite.dryRunCase.description || question.suite.dryRunCase.id}”.`
                : 'No learner-visible dry run.'}{' '}
              {question.suite.visibleToStudent
                ? 'Grading scenarios are visible.'
                : 'Grading scenarios remain hidden.'}
            </p>
          </div>
        </aside>
      </div>
      <InteractiveLearnerWorkspace preview={preview} />
    </section>
  )
}
