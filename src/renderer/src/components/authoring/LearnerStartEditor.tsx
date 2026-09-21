import {
  ArrowLeft,
  Boxes,
  Database,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Server,
  Users
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import { instantiateTemplate } from '../../../../engine/catalog/paletteTemplates'
import type { TopologyJSON } from '../../../../engine/core/types'
import { useTopologySerializer } from '../../hooks/useTopologySerializer'
import useStore from '../../store/useStore'
import { topologyToCanvasFileData } from '../../utils/topologyCanvasAdapter'
import { convertNestedToFlat } from '../../utils/nodeTransformers'
import type { ComponentLibraryFilter } from '../library/ComponentLibrarySidebarPanel'

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

interface LearnerStartEditorProps {
  questionId: string
  questionTitle: string
  topology?: TopologyJSON
  onTopologyChange: (topology: TopologyJSON | undefined) => void
}

const STARTER_COMPONENTS = [
  { templateId: 'client-user', label: 'Traffic source', icon: Users },
  { templateId: 'backend-server', label: 'API server', icon: Server },
  { templateId: 'primary-db', label: 'SQL database', icon: Database }
] as const

function topologyFingerprint(topology: TopologyJSON | undefined): string {
  return JSON.stringify(topology ?? null)
}

export function LearnerStartEditor({
  questionId,
  questionTitle,
  topology,
  onTopologyChange
}: LearnerStartEditorProps): React.JSX.Element {
  const nodes = useStore((state) => state.nodes)
  const graphRevision = useStore((state) => state.graphRevision)
  const addNode = useStore((state) => state.addNode)
  const setGraph = useStore((state) => state.setGraph)
  const setScenario = useStore((state) => state.setScenario)
  const { serialize } = useTopologySerializer()
  const [syncError, setSyncError] = useState<string | null>(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryFilter, setLibraryFilter] = useState<ComponentLibraryFilter>('common')
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const hydratingRef = useRef(false)
  const hydratedRevisionRef = useRef<number | null>(null)
  const storedFingerprint = useMemo(() => topologyFingerprint(topology), [topology])

  useEffect(() => {
    hydratingRef.current = true

    if (topology) {
      const canvas = topologyToCanvasFileData(topology)
      setGraph(convertNestedToFlat(canvas.nodes), canvas.edges, {
        history: 'skip',
        resetHistory: true
      })
      if (canvas.scenario) setScenario(canvas.scenario)
    } else {
      setGraph([], [], { history: 'skip', resetHistory: true })
    }

    hydratedRevisionRef.current = useStore.getState().graphRevision
    setSyncError(null)
    queueMicrotask(() => {
      hydratingRef.current = false
    })
  }, [setGraph, setScenario, storedFingerprint, topology])

  useEffect(
    () => () => {
      useStore.getState().setGraph([], [], { history: 'skip', resetHistory: true })
    },
    []
  )

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

  useEffect(() => {
    if (hydratingRef.current || hydratedRevisionRef.current === graphRevision) return

    const result = serialize()
    if (!result.topology) {
      if (nodes.length === 0 && topology) onTopologyChange(undefined)
      setSyncError(nodes.length === 0 ? null : (result.errors[0] ?? 'Canvas is not valid yet.'))
      return
    }

    const snapshot: TopologyJSON = {
      ...result.topology,
      id: topology?.id ?? `${questionId}-scaffold`,
      name: topology?.name ?? `${questionTitle.trim() || 'Untitled question'} scaffold`,
      version: topology?.version ?? result.topology.version
    }
    setSyncError(null)

    if (topologyFingerprint(snapshot) !== storedFingerprint) {
      onTopologyChange(snapshot)
    }
  }, [
    graphRevision,
    nodes.length,
    onTopologyChange,
    questionId,
    questionTitle,
    serialize,
    storedFingerprint,
    topology
  ])

  const handleAddComponent = useCallback(
    (templateId: (typeof STARTER_COMPONENTS)[number]['templateId']) => {
      const data = instantiateTemplate(templateId)
      const index = useStore.getState().nodes.length
      const node: Node = {
        id: `authoring-${templateId}-${index + 1}`,
        type: data.rendererType,
        position: {
          x: 80 + (index % 3) * 240,
          y: 100 + Math.floor(index / 3) * 180
        },
        data
      }
      addNode(node)
    },
    [addNode]
  )

  const handleClear = useCallback(() => {
    setGraph([], [], { history: 'record', resetHistory: true })
    setSyncError(null)
    onTopologyChange(undefined)
  }, [onTopologyChange, setGraph])

  if (!workspaceOpen) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-nss-border bg-nss-panel shadow-sm"
        aria-labelledby="learner-start-title"
      >
        <div className="px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
                Learner starting state
              </p>
              <h3 id="learner-start-title" className="mt-1 text-base font-semibold text-nss-text">
                Scaffold canvas
              </h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
                Build the topology learners receive before they begin. The workspace uses the full
                window so the component library, canvas, and inspector all remain usable.
              </p>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide ${
                topology
                  ? 'border-nss-success/25 bg-nss-success/10 text-nss-success'
                  : 'border-nss-border bg-nss-surface text-nss-muted'
              }`}
            >
              {topology
                ? `${topology.nodes.length} nodes · ${topology.edges.length} edges`
                : 'Blank'}
            </span>
          </div>

          {topology ? (
            <>
              <div className="relative mt-5 h-64 overflow-hidden rounded-lg border border-nss-borderHigh bg-nss-bg shadow-inner">
                <div className="pointer-events-none absolute inset-0">
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center text-xs text-nss-muted">
                        Loading scaffold preview…
                      </div>
                    }
                  >
                    <FlowCanvas interactionLocked presentationMode />
                  </Suspense>
                </div>
                <button
                  type="button"
                  onClick={() => setWorkspaceOpen(true)}
                  aria-label="Open scaffold canvas workspace"
                  className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nss-primary/60"
                >
                  <span className="sr-only">Open scaffold canvas workspace</span>
                </button>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setWorkspaceOpen(true)}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-nss-primary hover:bg-nss-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/50"
                >
                  <Maximize2 size={14} aria-hidden="true" />
                  Open canvas workspace
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setWorkspaceOpen(true)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-nss-primary/25 bg-nss-primary/10 px-4 py-5 text-sm font-semibold text-nss-primary transition-colors hover:border-nss-primary/45 hover:bg-nss-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/50"
            >
              <Maximize2 size={17} aria-hidden="true" />
              Create starting topology
            </button>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] text-nss-muted">
            <span>Full component catalogue · large canvas · component inspector</span>
            <span>
              {topology ? 'Snapshot stored in draft' : 'Blank-canvas entry remains active'}
            </span>
          </div>
        </div>
      </section>
    )
  }

  const workspaceColumns = `${libraryOpen ? '17rem ' : ''}minmax(0, 1fr)${inspectorOpen ? ' 21rem' : ''}`

  return (
    <section
      className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-nss-bg text-nss-text"
      aria-labelledby="learner-start-title"
      aria-modal="true"
      role="dialog"
    >
      <div className="border-b border-nss-border bg-nss-panel px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setWorkspaceOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-nss-border bg-nss-surface text-nss-muted hover:text-nss-text"
              aria-label="Back to Start stage"
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
                Learner starting state
              </p>
              <h3 id="learner-start-title" className="text-sm font-semibold text-nss-text">
                Scaffold canvas
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceOpen(false)}
            className="rounded-md bg-nss-primary px-4 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
          >
            Done editing
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-nss-border bg-nss-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2" aria-label="Starter component palette">
          <button
            type="button"
            onClick={() => setLibraryOpen((current) => !current)}
            className="flex items-center gap-1.5 rounded-md border border-nss-border bg-nss-panel px-2.5 py-1.5 text-[11px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary"
          >
            {libraryOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
            Components
          </button>
          <button
            type="button"
            onClick={() => setInspectorOpen((current) => !current)}
            className="flex items-center gap-1.5 rounded-md border border-nss-border bg-nss-panel px-2.5 py-1.5 text-[11px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary"
          >
            {inspectorOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
            Inspector
          </button>
          <span className="mx-1 h-5 w-px bg-nss-border" aria-hidden="true" />
          <span className="mr-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            <Boxes size={13} aria-hidden="true" />
            Quick add
          </span>
          {STARTER_COMPONENTS.map((component) => {
            const Icon = component.icon
            return (
              <button
                key={component.templateId}
                type="button"
                onClick={() => handleAddComponent(component.templateId)}
                className="flex items-center gap-1.5 rounded-md border border-nss-border bg-nss-panel px-2.5 py-1.5 text-[11px] font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary"
              >
                <Plus size={12} aria-hidden="true" />
                <Icon size={13} aria-hidden="true" />
                {component.label}
              </button>
            )
          })}
        </div>
        {topology && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-nss-muted hover:bg-nss-danger/10 hover:text-nss-danger"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Return to blank canvas
          </button>
        )}
      </div>

      {syncError && (
        <p
          role="alert"
          className="border-b border-nss-warning/25 bg-nss-warning/10 px-4 py-2 text-[11px] text-nss-warning"
        >
          Canvas not stored yet: {syncError}
        </p>
      )}

      <div
        className="grid min-h-0 flex-1 bg-nss-bg"
        style={{ gridTemplateColumns: workspaceColumns }}
        data-testid="scaffold-canvas"
      >
        {libraryOpen && (
          <aside className="flex min-h-0 flex-col border-r border-nss-border bg-nss-panel">
            <Suspense
              fallback={
                <div className="p-4 text-xs text-nss-muted">Loading component library…</div>
              }
            >
              <ComponentLibrarySidebarPanel
                query={libraryQuery}
                filter={libraryFilter}
                onQueryChange={setLibraryQuery}
                onFilterChange={setLibraryFilter}
              />
            </Suspense>
          </aside>
        )}
        <div className="relative min-h-0">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs text-nss-muted">
                Loading scaffold canvas…
              </div>
            }
          >
            <FlowCanvas />
          </Suspense>
        </div>
        {inspectorOpen && (
          <aside className="min-h-0 overflow-hidden border-l border-nss-border bg-nss-panel">
            <Suspense
              fallback={<div className="p-4 text-xs text-nss-muted">Loading inspector…</div>}
            >
              <PropertiesPanel />
            </Suspense>
          </aside>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-nss-border px-4 py-3 text-[10px] text-nss-muted">
        <span>
          Full component catalogue · click or drag a component, then configure it on the right
        </span>
        <span>{topology ? 'Snapshot stored in draft' : 'Blank-canvas entry remains active'}</span>
      </div>
    </section>
  )
}
