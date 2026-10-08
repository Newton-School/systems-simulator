import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, ChevronsLeft, CircleAlert, Pause, Play, X } from 'lucide-react'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import useStore from '@renderer/store/useStore'
import type { EdgeSimulationData } from '@renderer/types/ui'
import { useFocusNodeOnCanvas } from '../simulation/useFocusNodeOnCanvas'
import { LifecycleRail } from './LifecycleRail'
import { NodeIntakeLens } from './NodeIntakeLens'
import { PathDiff } from './PathDiff'
import { RequestFilmstrip } from './RequestFilmstrip'
import { RequestPathMap } from './RequestPathMap'
import { SequenceDiagram } from './SequenceDiagram'
import { StackTraceDebugger } from './StackTraceDebugger'
import { StateMachineView } from './StateMachineView'
import { STATE_LABEL, statusTone, type DebugViewProps } from './debuggerUi'
import { buildExpectedPath, formatDebugMs } from './requestLifecycle'
import { useRequestDebugSession } from './useRequestDebugSession'

export type DebugViewId = 'rail' | 'sequence' | 'stack' | 'state' | 'filmstrip' | 'intake' | 'path'

const LIFECYCLE_VIEWS: Array<{ id: DebugViewId; label: string }> = [
  { id: 'rail', label: 'Rail' },
  { id: 'sequence', label: 'Sequence' },
  { id: 'stack', label: 'Stack Trace' },
  { id: 'state', label: 'State Machine' },
  { id: 'filmstrip', label: 'Filmstrip' }
]
const ANALYSIS_VIEWS: Array<{ id: DebugViewId; label: string }> = [
  { id: 'intake', label: 'Intake Lens' },
  { id: 'path', label: 'Path Diff' }
]
const VIEW_STORAGE_KEY = 'nss.requestDebugger.view'
const PLAY_INTERVAL_MS = 900

function readStoredView(): DebugViewId {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
    if (stored && [...LIFECYCLE_VIEWS, ...ANALYSIS_VIEWS].some((view) => view.id === stored)) {
      return stored as DebugViewId
    }
  } catch {
    // Storage unavailable (private window, tests): fall back to the default view.
  }
  return 'rail'
}

function controlClass(active = false): string {
  return clsx(
    'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
    active
      ? 'border-nss-primary bg-nss-primary/10 text-nss-primary'
      : 'border-nss-border bg-nss-surface text-nss-muted hover:bg-nss-bg hover:text-nss-text'
  )
}

/**
 * Step-through debugger for one traced request (#156-#158): navigates the
 * request's recorded lifecycle (no engine re-run) across five lifecycle views
 * and two analysis views, with a hop-trail mini-map. The canvas overlay follows
 * the same step through the shared store session.
 */
export function RequestDebugger({
  output,
  topologyEdited = false
}: {
  output: SimulationOutput
  topologyEdited?: boolean
}) {
  const { lifecycle, stepIndex, step, setStep, close } = useRequestDebugSession()
  const canvasNodes = useStore((state) => state.nodes)
  const canvasEdges = useStore((state) => state.edges)
  const focusNode = useFocusNodeOnCanvas()
  const [view, setViewState] = useState<DebugViewId>(readStoredView)
  const [playing, setPlaying] = useState(false)

  const setView = useCallback((next: DebugViewId) => {
    setViewState(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Remembering the view is a convenience only.
    }
  }, [])

  const labelFor = useCallback(
    (id: string): string => {
      const fromRun = output.perNode[id]?.nodeLabel ?? output.perEdge[id]?.edgeLabel
      if (fromRun) return fromRun
      const canvasLabel = (
        canvasNodes.find((node) => node.id === id)?.data as { label?: unknown } | undefined
      )?.label
      return typeof canvasLabel === 'string' && canvasLabel.length > 0 ? canvasLabel : id
    },
    [canvasNodes, output.perEdge, output.perNode]
  )

  const expected = useMemo(
    () =>
      buildExpectedPath(
        lifecycle?.sourceNodeId ?? lifecycle?.actualPath[0] ?? null,
        canvasEdges.map((edge) => {
          const data = edge.data as Partial<EdgeSimulationData> | undefined
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            mode: data?.mode,
            weight: typeof data?.weight === 'number' && data.weight > 0 ? data.weight : undefined
          }
        })
      ),
    [canvasEdges, lifecycle]
  )

  const lastStep = lifecycle ? lifecycle.steps.length - 1 : 0
  useEffect(() => {
    if (!playing) return
    if (stepIndex >= lastStep) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => setStep(stepIndex + 1), PLAY_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [lastStep, playing, setStep, stepIndex])

  if (!lifecycle) {
    return (
      <div className="space-y-2 rounded-md border border-nss-border bg-nss-surface p-3 text-xs text-nss-muted">
        <p>
          This request is not in the run&apos;s trace sample, so there is nothing to step through.
        </p>
        <button type="button" className={controlClass()} onClick={close}>
          Back to traces
        </button>
      </div>
    )
  }

  const viewProps: DebugViewProps = {
    lifecycle,
    stepIndex,
    onStep: (index) => {
      setPlaying(false)
      setStep(index)
    },
    labelFor
  }
  const failureIndex = lifecycle.failureStepIndex
  const where = step?.nodeId
    ? labelFor(step.nodeId)
    : step?.edgeId
      ? `connection ${labelFor(step.edgeId)}`
      : ''

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      viewProps.onStep(Math.min(lastStep, stepIndex + 1))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      viewProps.onStep(Math.max(0, stepIndex - 1))
    }
  }

  return (
    <div
      className="space-y-3 outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`Request debugger for ${lifecycle.requestId}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-nss-muted">
          Request debugger
        </h3>
        <span className="font-mono text-xs text-nss-text">{lifecycle.requestId}</span>
        <span
          className={clsx(
            'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
            statusTone(lifecycle.status)
          )}
        >
          {lifecycle.status}
        </span>
        <span className="text-[11px] tabular-nums text-nss-muted">
          end-to-end {formatDebugMs(lifecycle.totalMs)} - {lifecycle.phases.length} stops -{' '}
          {lifecycle.steps.length} steps
        </span>
        <button
          type="button"
          className={clsx(controlClass(), 'ml-auto')}
          onClick={close}
          aria-label="Close debugger"
        >
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={controlClass()}
          onClick={() => viewProps.onStep(0)}
          disabled={stepIndex === 0}
          aria-label="First step"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={controlClass()}
          onClick={() => viewProps.onStep(stepIndex - 1)}
          disabled={stepIndex === 0}
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>
        <button
          type="button"
          className={controlClass()}
          onClick={() => viewProps.onStep(stepIndex + 1)}
          disabled={stepIndex >= lastStep}
        >
          Step <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={controlClass(playing)}
          onClick={() => {
            if (!playing && stepIndex >= lastStep) setStep(0)
            setPlaying(!playing)
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className={clsx(controlClass(), failureIndex !== null && 'hover:text-nss-danger')}
          onClick={() => failureIndex !== null && viewProps.onStep(failureIndex)}
          disabled={failureIndex === null}
          title={failureIndex === null ? 'This request did not fail' : undefined}
        >
          <CircleAlert className="h-3.5 w-3.5" /> Jump to{' '}
          {lifecycle.status === 'timeout' ? 'timeout' : 'rejection'}
        </button>
        <span className="ml-1 text-[11px] text-nss-muted">
          step <span className="tabular-nums text-nss-text">{stepIndex + 1}</span> /{' '}
          {lifecycle.steps.length}
          {step && (
            <>
              {' '}
              -{' '}
              <span className={step.failed ? 'text-nss-danger' : 'text-nss-text'}>
                {STATE_LABEL[step.state]}
              </span>
              {where ? ` at ${where}` : ''} @ {formatDebugMs(step.atMs)}
            </>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {[LIFECYCLE_VIEWS, ANALYSIS_VIEWS].map((group, groupIndex) => (
          <div
            key={groupIndex}
            className="inline-flex overflow-hidden rounded-md border border-nss-border"
          >
            {group.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={view === option.id}
                onClick={() => setView(option.id)}
                className={clsx(
                  'border-r border-nss-border px-2.5 py-1 text-[11px] font-medium last:border-r-0',
                  view === option.id
                    ? 'bg-nss-primary/10 text-nss-primary'
                    : 'bg-nss-surface text-nss-muted hover:text-nss-text'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_11rem]">
        <div className="min-w-0">
          {view === 'rail' && <LifecycleRail {...viewProps} />}
          {view === 'sequence' && <SequenceDiagram {...viewProps} />}
          {view === 'stack' && <StackTraceDebugger {...viewProps} />}
          {view === 'state' && <StateMachineView {...viewProps} />}
          {view === 'filmstrip' && <RequestFilmstrip {...viewProps} />}
          {view === 'intake' && <NodeIntakeLens {...viewProps} />}
          {view === 'path' && (
            <PathDiff {...viewProps} expected={expected} topologyEdited={topologyEdited} />
          )}
        </div>
        <RequestPathMap {...viewProps} expected={expected} onFocusNode={focusNode} />
      </div>

      <p className="text-[10px] text-nss-muted">
        Stepping walks this request&apos;s recorded timeline - nothing is re-simulated. Occupancy
        values are the node&apos;s counters at the moment the request reached admission; anything
        the engine did not record is marked as not recorded.
        {!lifecycle.exact && ' This trace has no phase record, so only completed hops are shown.'}
      </p>
    </div>
  )
}
