import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, ImperativePanelHandle } from 'react-resizable-panels'

// Store
import useStore, { type EdgeFlowState } from '@renderer/store/useStore'

// Hooks
import { useFlowPersistence } from '@renderer/hooks/useFlowPersistence'
import { useConfirmDialog } from '@renderer/hooks/useConfirmDialog'
import { useSimulation } from '@renderer/hooks/useSimulation'
import { useTopologySerializer } from '@renderer/hooks/useTopologySerializer'
import { validateTopology } from '../../../../engine/validation/validator'
import type { LatencyPercentiles } from '../../../../engine/metrics'
import type { TimeSeriesSnapshot } from '../../../../engine/analysis/output'
import type { ValidationError } from '../../../../engine/validation/validator'

// Organisms
import {
  LibraryActivityRail,
  LibrarySidebarContent,
  type LibrarySidebarTab
} from '../library/LibrarySidebar'
import { FlowCanvas } from '../canvas/FlowCanvas'
import { Header } from './Header'
import { SampleScenarioPicker } from '../samples/SampleScenarioPicker'
import { SAMPLE_SCENARIOS, type SampleScenario } from '@renderer/config/sampleScenarios'

// Atoms
import { ResizeHandle } from '../ui/ResizeHandle'
import { RunToast } from '../ui/RunToast'
import { RoutingVisualizationToast } from '../ui/RoutingVisualizationToast'
import type { CanvasNodeDataV2 } from '../../../../engine/catalog/nodeSpecTypes'
import type {
  FaultTargetOption,
  NodeSimulationMetrics,
  ScenarioRunContext,
  SourceNodeOption
} from '@renderer/types/ui'

type RunIssueTone = 'warning' | 'error'

const LEFT_LIBRARY_DEFAULT_SIZE = 20
const LEFT_LIBRARY_MIN_SIZE = 12
const LEFT_LIBRARY_MAX_SIZE = 25

const PropertiesPanel = lazy(async () => {
  const module = await import('../properties/PropertiesPanel')
  return { default: module.PropertiesPanel }
})

const ResultsTray = lazy(async () => {
  const module = await import('../simulation/ResultsTray')
  return { default: module.ResultsTray }
})

function titleCaseField(field: string): string {
  switch (field) {
    case 'latencyP99':
      return 'Latency target (p99)'
    case 'availabilityTarget':
      return 'Availability target'
    case 'errorBudget':
      return 'Error budget'
    default:
      return field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
  }
}

function formatValidationIssue(
  error: ValidationError,
  nodes: ReturnType<typeof useStore.getState>['nodes'],
  edges: ReturnType<typeof useStore.getState>['edges']
): string {
  if (error.path === 'workload.sourceNodeId') {
    return error.message
  }

  const nodeMatch = error.path.match(/^nodes\.(\d+)\.(.+)$/)
  if (nodeMatch) {
    const nodeIndex = Number(nodeMatch[1])
    const node = nodes[nodeIndex]
    const rawFieldPath = nodeMatch[2]
    const lastSegment = rawFieldPath.split('.').pop() ?? rawFieldPath
    const nodeLabel = (node?.data as CanvasNodeDataV2 | undefined)?.label ?? `Node ${nodeIndex + 1}`

    if (error.message.includes('received undefined')) {
      return `${nodeLabel}: ${titleCaseField(lastSegment)} is missing.`
    }

    return `${nodeLabel}: ${titleCaseField(lastSegment)} - ${error.message}`
  }

  const edgeMatch = error.path.match(/^edges(?:\.|\[)(\d+)(?:\]|\.)?(.+)?$/)
  if (edgeMatch) {
    const edgeIndex = Number(edgeMatch[1])
    const edge = edges[edgeIndex]
    const sourceNode = nodes.find((node) => node.id === edge?.source)
    const targetNode = nodes.find((node) => node.id === edge?.target)
    const sourceLabel = (sourceNode?.data as CanvasNodeDataV2 | undefined)?.label ?? edge?.source
    const targetLabel = (targetNode?.data as CanvasNodeDataV2 | undefined)?.label ?? edge?.target
    const edgeLabel =
      typeof edge?.label === 'string' && edge.label.length > 0
        ? edge.label
        : sourceLabel && targetLabel
          ? `${sourceLabel} -> ${targetLabel}`
          : (edge?.id ?? `Edge ${edgeIndex + 1}`)

    if (error.message.includes('received undefined')) {
      const rawFieldPath = edgeMatch[2]?.replace(/^\./, '') ?? ''
      const lastSegment = rawFieldPath.split('.').pop() ?? 'field'
      return `${edgeLabel}: ${titleCaseField(lastSegment)} is missing.`
    }

    return `${edgeLabel}: ${error.message}`
  }

  return error.path ? `${error.path}: ${error.message}` : error.message
}

function PanelFallback({ label }: { label: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-nss-panel text-xs text-nss-muted">
      {label}
    </div>
  )
}

function roundNullable(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100
}

function roundLatencyPercentiles(latency: LatencyPercentiles): LatencyPercentiles {
  return {
    p50: roundNullable(latency.p50),
    p90: roundNullable(latency.p90),
    p95: roundNullable(latency.p95),
    p99: roundNullable(latency.p99),
    min: roundNullable(latency.min),
    max: roundNullable(latency.max),
    mean: roundNullable(latency.mean)
  }
}

type StoreNode = ReturnType<typeof useStore.getState>['nodes'][number]
type StoreEdge = ReturnType<typeof useStore.getState>['edges'][number]

function isSourceNode(node: StoreNode): boolean {
  const data = node.data as Partial<CanvasNodeDataV2>
  return data.structuralRole === 'source' || data.profile === 'source'
}

function sumEdgeFlows(
  edges: StoreEdge[],
  edgeFlowById: Record<string, EdgeFlowState>
): Pick<
  EdgeFlowState,
  | 'attemptedPerSecond'
  | 'successPerSecond'
  | 'failedPerSecond'
  | 'totalAttempted'
  | 'totalSuccess'
  | 'totalFailed'
> {
  return edges.reduce(
    (sum, edge) => {
      const flow = edgeFlowById[edge.id]
      if (!flow) return sum

      return {
        attemptedPerSecond: sum.attemptedPerSecond + flow.attemptedPerSecond,
        successPerSecond: sum.successPerSecond + flow.successPerSecond,
        failedPerSecond: sum.failedPerSecond + flow.failedPerSecond,
        totalAttempted: sum.totalAttempted + flow.totalAttempted,
        totalSuccess: sum.totalSuccess + flow.totalSuccess,
        totalFailed: sum.totalFailed + flow.totalFailed
      }
    },
    {
      attemptedPerSecond: 0,
      successPerSecond: 0,
      failedPerSecond: 0,
      totalAttempted: 0,
      totalSuccess: 0,
      totalFailed: 0
    }
  )
}

function buildLiveNodeMetrics({
  snapshot,
  nodes,
  edges,
  edgeFlowById
}: {
  snapshot: TimeSeriesSnapshot
  nodes: StoreNode[]
  edges: StoreEdge[]
  edgeFlowById: Record<string, EdgeFlowState>
}): Record<string, NodeSimulationMetrics> {
  return Object.fromEntries(
    nodes.map((node) => {
      const nodeSnapshot = snapshot.node[node.id]
      const incoming = sumEdgeFlows(
        edges.filter((edge) => edge.target === node.id),
        edgeFlowById
      )
      const outgoing = sumEdgeFlows(
        edges.filter((edge) => edge.source === node.id),
        edgeFlowById
      )
      const source = isSourceNode(node)
      const totalInSystem = nodeSnapshot?.totalInSystem ?? 0
      const arrived = source ? outgoing.totalAttempted : incoming.totalSuccess
      const completed =
        source || outgoing.totalAttempted > 0
          ? outgoing.totalAttempted
          : Math.max(0, incoming.totalSuccess - totalInSystem)
      const attempted = source ? outgoing.totalAttempted : incoming.totalAttempted
      const failed = source ? 0 : incoming.totalFailed
      const errorRate = attempted > 0 ? Math.round((failed / attempted) * 1000) / 10 : 0
      const throughput = source
        ? outgoing.attemptedPerSecond
        : outgoing.successPerSecond > 0
          ? outgoing.successPerSecond
          : incoming.successPerSecond

      return [
        node.id,
        {
          throughput: Math.round(throughput * 10) / 10,
          postWarmupArrived: arrived,
          postWarmupProcessed: completed,
          postWarmupRejected: failed,
          postWarmupTimedOut: 0,
          postWarmupConnectionReset: 0,
          postWarmupInFlight: totalInSystem,
          queueDepth: Math.round((nodeSnapshot?.queueLength ?? 0) * 10) / 10,
          utilization: Math.round((nodeSnapshot?.utilization ?? 0) * 1000) / 10,
          errorRate,
          active: source ? outgoing.totalAttempted > 0 : arrived > 0 || totalInSystem > 0,
          latencyNodeLocal: {
            p50: null,
            p90: null,
            p95: null,
            p99: null,
            min: null,
            max: null,
            mean: null
          },
          availability: Math.round((100 - errorRate) * 10) / 10,
          totalArrived: arrived,
          totalRejected: failed,
          peakInSystem: totalInSystem,
          finalInSystem: totalInSystem
        }
      ]
    })
  )
}

export const WorkspaceLayout = () => {
  // Sidebar State
  const [isLeftOpen, setIsLeftOpen] = useState(true)
  const [leftSidebarTab, setLeftSidebarTab] = useState<LibrarySidebarTab>('library')
  const [isRightOpen, setIsRightOpen] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [showSamples, setShowSamples] = useState(false)
  const [runIssues, setRunIssues] = useState<{ messages: string[]; tone: RunIssueTone }>({
    messages: [],
    tone: 'warning'
  })
  const [lastRunContext, setLastRunContext] = useState<ScenarioRunContext | null>(null)
  const lastLiveNodeMetricsSnapshotAtRef = useRef<number | null>(null)

  // Panel refs — panels stay in the DOM always; we collapse/expand imperatively
  // so that opening one side never redistributes the other side's size.
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)

  useEffect(() => {
    if (isLeftOpen) leftPanelRef.current?.expand()
    else leftPanelRef.current?.collapse()
  }, [isLeftOpen])

  useEffect(() => {
    if (isRightOpen) rightPanelRef.current?.expand()
    else rightPanelRef.current?.collapse()
  }, [isRightOpen])

  const fileName = useStore((s) => s.fileName)
  const isUnsaved = useStore((s) => s.isUnsaved)
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const scenario = useStore((s) => s.scenario)
  const updateScenario = useStore((s) => s.updateScenario)
  const setSimulationMetrics = useStore((s) => s.setSimulationMetrics)
  const clearSimulationMetrics = useStore((s) => s.clearSimulationMetrics)
  const selectGraphElements = useStore((s) => s.selectGraphElements)
  const runInspectorPinned = useStore((s) => s.runInspectorPinned)
  const setRunInspectorPinned = useStore((s) => s.setRunInspectorPinned)
  const routingVisualization = useStore((s) => s.routingStrategyVisualization)
  const setRoutingVisualization = useStore((s) => s.setRoutingStrategyVisualization)
  const { confirm, dialog } = useConfirmDialog()
  const confirmDiscardChanges = useCallback(
    () =>
      confirm({
        title: 'Discard unsaved changes?',
        description: 'Open another scenario and lose the edits in the current workspace?',
        confirmLabel: 'Discard and Open',
        cancelLabel: 'Keep Editing'
      }),
    [confirm]
  )

  const { handleSave, handleOpen, loadFromData } = useFlowPersistence(confirmDiscardChanges)

  const selectedNodeId = nodes.find((n) => n.selected)?.id
  const selectedEdgeId = edges.find((e) => e.selected)?.id
  const hasElectronCloseBridge = typeof window.nssimulator?.onCloseRequest === 'function'
  const handleLeftSidebarTabSelect = useCallback((tab: LibrarySidebarTab) => {
    setLeftSidebarTab(tab)
    setIsLeftOpen(true)
  }, [])

  useEffect(() => {
    if (!isUnsaved || hasElectronCloseBridge) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasElectronCloseBridge, isUnsaved])

  useEffect(() => {
    const onCloseRequest = window.nssimulator?.onCloseRequest
    if (typeof onCloseRequest !== 'function') {
      return
    }

    return onCloseRequest(() => useStore.getState().isUnsaved)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey
      if (!isMod || !event.shiftKey || event.key.toLowerCase() !== 'o') {
        return
      }

      event.preventDefault()
      setShowSamples(true)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!selectedNodeId && !selectedEdgeId && !runInspectorPinned) {
      setIsRightOpen(false)
    }
  }, [runInspectorPinned, selectedNodeId, selectedEdgeId])

  useEffect(() => {
    if (runInspectorPinned) {
      setIsRightOpen(true)
    }
  }, [runInspectorPinned])

  // Selecting an edge opens the inspector on its properties, mirroring how
  // double-clicking a node opens the node config.
  useEffect(() => {
    if (selectedEdgeId) {
      setIsRightOpen(true)
    }
  }, [selectedEdgeId])

  // Simulation
  const sim = useSimulation()
  const { serialize } = useTopologySerializer()
  const handleLoadScenario = useCallback(
    async (scenarioId: string) => {
      const sampleId = scenarioId.startsWith('sample:') ? scenarioId.slice('sample:'.length) : ''

      const sampleScenario = SAMPLE_SCENARIOS.find(
        (entry) => entry.id === sampleId || entry.id === scenarioId
      )

      if (!sampleScenario) {
        setRunIssues({ messages: [`Unknown scenario '${scenarioId}'.`], tone: 'error' })
        return
      }

      const loaded = await loadFromData(sampleScenario.raw, `${sampleScenario.id}.json`)
      if (!loaded) {
        return
      }

      sim.reset()
      clearSimulationMetrics()
      setShowResults(false)
      setLastRunContext(null)
      setRunIssues({ messages: [], tone: 'warning' })
      setRoutingVisualization(null)
      selectGraphElements({})
      setIsRightOpen(false)
    },
    [clearSimulationMetrics, loadFromData, selectGraphElements, setRoutingVisualization, sim]
  )

  useEffect(() => {
    if (sim.results || !sim.snapshot || (sim.status !== 'running' && sim.status !== 'paused')) {
      return
    }

    if (lastLiveNodeMetricsSnapshotAtRef.current === sim.snapshot.timestamp) {
      return
    }
    lastLiveNodeMetricsSnapshotAtRef.current = sim.snapshot.timestamp

    setSimulationMetrics(
      buildLiveNodeMetrics({
        snapshot: sim.snapshot,
        nodes,
        edges,
        edgeFlowById: useStore.getState().edgeFlowById
      })
    )
    if (!runInspectorPinned && !selectedNodeId && !selectedEdgeId) {
      setRunInspectorPinned(true)
    }
    setIsRightOpen(true)
  }, [
    edges,
    nodes,
    runInspectorPinned,
    selectedEdgeId,
    selectedNodeId,
    setRunInspectorPinned,
    setSimulationMetrics,
    sim.results,
    sim.snapshot,
    sim.status
  ])

  useEffect(() => {
    if (!sim.results) return
    setIsRightOpen(true)
    const inFlightByNode = new Map(
      sim.results.conservationCheck.map((result) => [result.nodeId, result.inFlight])
    )

    const metricsByNode = Object.fromEntries(
      Object.entries(sim.results.perNode).map(([nodeId, metrics]) => [
        nodeId,
        {
          throughput: Math.round(metrics.throughput * 10) / 10,
          postWarmupArrived: metrics.postWarmupArrived,
          postWarmupProcessed: metrics.postWarmupProcessed,
          postWarmupRejected: metrics.postWarmupRejected,
          postWarmupTimedOut: metrics.postWarmupTimedOut,
          postWarmupConnectionReset: metrics.postWarmupConnectionReset,
          postWarmupInFlight: inFlightByNode.get(nodeId) ?? 0,
          queueDepth: Math.round(metrics.avgQueueLength * 10) / 10,
          utilization: Math.round(metrics.utilization * 1000) / 10,
          errorRate: Math.round(metrics.errorRate * 10000) / 100,
          active: metrics.postWarmupArrived > 0,
          avgServiceTime: Math.round(metrics.avgServiceTime * 100) / 100,
          latencyP50: Math.round(metrics.latencyP50 * 100) / 100,
          latencyP95: Math.round(metrics.latencyP95 * 100) / 100,
          latencyP99: Math.round(metrics.latencyP99 * 100) / 100,
          successLatencySamples: metrics.successLatencySamples,
          timeToErrorSamples: metrics.timeToErrorSamples,
          latencyWindowErrorRate: metrics.latencyWindowErrorRate,
          latencyNodeLocal: roundLatencyPercentiles(metrics.latencyNodeLocal),
          timeToErrorByCause: metrics.timeToErrorByCause,
          availability: Math.round(metrics.availability * 1000) / 10,
          cacheHits: metrics.cacheHits,
          cacheMisses: metrics.cacheMisses,
          cacheHitRatio: Math.round(metrics.cacheHitRatio * 1000) / 10,
          rejectionsByReason: metrics.rejectionsByReason,
          traitCounters: metrics.traitCounters,
          totalArrived: metrics.totalArrived,
          totalRejected: metrics.totalRejected,
          peakInSystem: metrics.peakInSystem,
          finalInSystem: metrics.finalInSystem
        }
      ])
    )

    setSimulationMetrics(metricsByNode)
  }, [sim.results, setSimulationMetrics])

  useEffect(() => {
    if (sim.status === 'idle') {
      clearSimulationMetrics()
    }
  }, [sim.status, clearSimulationMetrics])

  function startSimulation() {
    const { topology, errors, runContext } = serialize()

    if (!topology || !runContext || errors.length > 0) {
      setRunIssues({
        messages: errors.length > 0 ? errors : ['Unable to serialize topology.'],
        tone: 'error'
      })
      return
    }

    const validation = validateTopology(topology)
    if (!validation.valid) {
      const validationErrors = validation.errors?.map((error) =>
        formatValidationIssue(error, nodes, edges)
      ) ?? ['Topology validation failed.']
      setRunIssues({ messages: validationErrors, tone: 'error' })
      return
    }

    setRunIssues({ messages: validation.warnings ?? [], tone: 'warning' })
    setShowResults(true)
    setLastRunContext(runContext)
    clearSimulationMetrics()
    const flowStore = useStore.getState()
    flowStore.clearEdgeFlow()
    flowStore.setEdgeFlowRunConfig({
      workload: runContext.workload,
      simulationDurationMs: runContext.global.simulationDuration,
      warmupDurationMs: runContext.global.warmupDuration
    })
    flowStore.setEdgeFlowStatus('running')
    sim.run(topology)
    flowStore.setRunInspectorPinned(true)
    setIsRightOpen(true)
  }

  function handleRun() {
    startSimulation()
  }

  // Leave the post-run state and return to pre-run setup: discard the run's
  // results (node metrics, edge flow) and reset the lens back to the pre-run
  // family. The topology itself is untouched. sim.reset() clears the edge flow
  // and flips status to idle, which cascades into clearSimulationMetrics.
  const handleResetRun = useCallback(() => {
    sim.reset()
    clearSimulationMetrics()
    setShowResults(false)
    setLastRunContext(null)
    setRunIssues({ messages: [], tone: 'warning' })
    setRunInspectorPinned(false)
  }, [clearSimulationMetrics, setRunInspectorPinned, sim])

  const handleSampleLoad = useCallback(
    async (sample: SampleScenario) => {
      const loaded = await loadFromData(sample.raw, `${sample.id}.json`)
      if (!loaded) return

      sim.reset()
      clearSimulationMetrics()
      setShowResults(false)
      setLastRunContext(null)
      setRunIssues({ messages: [], tone: 'warning' })
      setShowSamples(false)
    },
    [clearSimulationMetrics, loadFromData, sim]
  )

  const isRunning = sim.status === 'running'
  const isPaused = sim.status === 'paused' && !sim.stopped
  const isPostRun = sim.status === 'complete'
  const sourceNodes: SourceNodeOption[] = nodes
    .filter((node) => (node.data as CanvasNodeDataV2).profile === 'source')
    .map((node) => {
      const data = node.data as CanvasNodeDataV2
      return {
        id: node.id,
        label: data.label && data.label.trim().length > 0 ? `${data.label} (${node.id})` : node.id,
        workload: data.source?.defaultWorkload ?? {
          pattern: 'poisson',
          baseRps: 100,
          bursty: { burstRps: 500, burstDuration: 2000, normalDuration: 8000 },
          spike: { spikeTime: 30_000, spikeRps: 1000, spikeDuration: 5000 },
          sawtooth: { peakRps: 300, rampDuration: 10_000 }
        }
      }
    })

  // Non-source components can be targeted with an injected fault.
  const faultTargets: FaultTargetOption[] = nodes
    .filter((node) => {
      const data = node.data as CanvasNodeDataV2
      return data.profile !== 'source' && data.structuralRole !== 'composite'
    })
    .map((node) => {
      const data = node.data as CanvasNodeDataV2
      return {
        id: node.id,
        label: data.label && data.label.trim().length > 0 ? `${data.label} (${node.id})` : node.id
      }
    })

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-nss-bg text-nss-text">
      {/* Header */}
      <Header
        toggleLeft={() => setIsLeftOpen((prev) => !prev)}
        toggleRight={() => setIsRightOpen((prev) => !prev)}
        isLeftOpen={isLeftOpen}
        isRightOpen={isRightOpen}
        onSave={handleSave}
        onOpen={handleOpen}
        fileName={fileName}
        isUnsaved={isUnsaved}
        onRun={handleRun}
        onReset={handleResetRun}
        isPostRun={isPostRun}
        onPause={sim.pause}
        onResume={sim.resume}
        onStop={() => {
          sim.stop()
          setRunIssues({ messages: [], tone: 'warning' })
        }}
        isRunning={isRunning}
        isPaused={isPaused}
        sourceNodes={sourceNodes}
        faultTargets={faultTargets}
        scenario={scenario}
        onScenarioChange={updateScenario}
      />

      {runIssues.messages.length > 0 && (
        <RunToast
          messages={runIssues.messages}
          tone={runIssues.tone}
          onClose={() => setRunIssues({ messages: [], tone: 'warning' })}
        />
      )}

      {routingVisualization && (
        <RoutingVisualizationToast
          state={routingVisualization}
          onClose={() => setRoutingVisualization(null)}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative h-full flex">
        <LibraryActivityRail activeTab={leftSidebarTab} onSelect={handleLeftSidebarTabSelect} />

        <PanelGroup
          direction="horizontal"
          autoSaveId="main-layout-horizontal"
          className="min-w-0 flex-1"
        >
          {/* Left library content — the activity rail stays outside this collapsible panel */}
          <Panel
            ref={leftPanelRef}
            collapsible
            defaultSize={LEFT_LIBRARY_DEFAULT_SIZE}
            minSize={LEFT_LIBRARY_MIN_SIZE}
            maxSize={LEFT_LIBRARY_MAX_SIZE}
            order={1}
            id="left-panel"
          >
            <LibrarySidebarContent activeTab={leftSidebarTab} onLoadScenario={handleLoadScenario} />
          </Panel>
          <ResizeHandle vertical id="resize-left-catalog" />

          {/* Center Column */}
          <Panel order={2} minSize={30} id="center-panel">
            <PanelGroup direction="vertical" autoSaveId="main-layout-vertical">
              {/* Canvas */}
              <Panel defaultSize={showResults ? 65 : 100} minSize={10} order={1}>
                <div className="relative h-full">
                  <FlowCanvas
                    showMetricLens
                    onNodeDoubleClick={(_, node) => {
                      selectGraphElements({ nodeId: node.id })
                      setIsRightOpen(true)
                    }}
                  />

                  {!showResults && sim.results && (
                    <button
                      type="button"
                      onClick={() => setShowResults(true)}
                      className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-nss-border bg-nss-panel/95 px-4 py-2 text-sm font-semibold text-nss-text shadow-lg backdrop-blur transition-colors hover:border-nss-primary/50 hover:text-nss-primary"
                    >
                      Show Results
                    </button>
                  )}
                </div>
              </Panel>

              {/* Results Tray */}
              {showResults && sim.status !== 'idle' && (
                <>
                  <ResizeHandle id="resize-results" />
                  <Panel defaultSize={35} minSize={15} maxSize={90} order={2}>
                    <Suspense fallback={<PanelFallback label="Loading simulation results..." />}>
                      <ResultsTray
                        status={sim.status}
                        stopped={sim.stopped}
                        progress={sim.progress}
                        eventsProcessed={sim.eventsProcessed}
                        runStartedAtMs={sim.runStartedAtMs}
                        snapshot={sim.snapshot}
                        results={sim.results}
                        error={sim.error}
                        runContext={lastRunContext}
                        onClose={() => {
                          setShowResults(false)
                        }}
                      />
                    </Suspense>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          {/* Right Sidebar — always in DOM, collapsed/expanded via ref */}
          <ResizeHandle vertical id="resize-right-inspector" />
          <Panel
            ref={rightPanelRef}
            collapsible
            defaultSize={25}
            minSize={15}
            maxSize={40}
            order={3}
            id="right-panel"
          >
            <Suspense fallback={<PanelFallback label="Loading inspector..." />}>
              <PropertiesPanel />
            </Suspense>
          </Panel>
        </PanelGroup>
      </div>

      {showSamples && (
        <SampleScenarioPicker
          samples={SAMPLE_SCENARIOS}
          onLoad={handleSampleLoad}
          onClose={() => setShowSamples(false)}
        />
      )}

      {dialog}
    </div>
  )
}
