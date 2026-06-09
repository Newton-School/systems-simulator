import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, ImperativePanelHandle } from 'react-resizable-panels'

// Store
import useStore from '@renderer/store/useStore'

// Hooks
import { useFlowPersistence } from '@renderer/hooks/useFlowPersistence'
import { useConfirmDialog } from '@renderer/hooks/useConfirmDialog'
import { useSimulation } from '@renderer/hooks/useSimulation'
import { useTopologySerializer } from '@renderer/hooks/useTopologySerializer'
import { validateTopology } from '../../../../engine/validation/validator'
import type { ValidationError } from '../../../../engine/validation/validator'

// Organisms
import { LibrarySidebar } from '../library/LibrarySidebar'
import { PropertiesPanel } from '../properties/PropertiesPanel'
import { FlowCanvas } from '../canvas/FlowCanvas'
import { Header } from './Header'
import { ResultsTray } from '../simulation/ResultsTray'

// Atoms
import { ResizeHandle } from '../ui/ResizeHandle'
import { RunToast } from '../ui/RunToast'
import type { CanvasNodeDataV2 } from '../../../../engine/catalog/nodeSpecTypes'
import type { ScenarioRunContext, SourceNodeOption } from '@renderer/types/ui'

type RunIssueTone = 'warning' | 'error'

function formatValidationIssue(error: ValidationError): string {
  if (error.path === 'workload.sourceNodeId') {
    return error.message
  }

  return error.path ? `${error.path}: ${error.message}` : error.message
}

export const WorkspaceLayout = () => {
  // Sidebar State
  const [isLeftOpen, setIsLeftOpen] = useState(true)
  const [isRightOpen, setIsRightOpen] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [runIssues, setRunIssues] = useState<{ messages: string[]; tone: RunIssueTone }>({
    messages: [],
    tone: 'warning'
  })
  const [lastRunContext, setLastRunContext] = useState<ScenarioRunContext | null>(null)

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
  const scenario = useStore((s) => s.scenario)
  const updateScenario = useStore((s) => s.updateScenario)
  const setSimulationMetrics = useStore((s) => s.setSimulationMetrics)
  const clearSimulationMetrics = useStore((s) => s.clearSimulationMetrics)
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

  const { handleSave, handleOpen } = useFlowPersistence(confirmDiscardChanges)

  const selectedNodeId = nodes.find((n) => n.selected)?.id

  useEffect(() => {
    if (!isUnsaved) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isUnsaved])

  useEffect(() => {
    if (selectedNodeId) {
      setIsRightOpen(true)
    } else {
      setIsRightOpen(false)
    }
  }, [selectedNodeId])

  // Simulation
  const sim = useSimulation()
  const { serialize } = useTopologySerializer()

  useEffect(() => {
    if (!sim.results) return

    const metricsByNode = Object.fromEntries(
      Object.entries(sim.results.perNode).map(([nodeId, metrics]) => [
        nodeId,
        {
          throughput: Math.round(metrics.throughput * 10) / 10,
          queueDepth: Math.round(metrics.avgQueueLength * 10) / 10,
          utilization: Math.round(metrics.utilization * 1000) / 10,
          errorRate: Math.round(metrics.errorRate * 10000) / 100,
          active: metrics.postWarmupArrived > 0
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

    if (!topology || errors.length > 0) {
      setRunIssues({
        messages: errors.length > 0 ? errors : ['Unable to serialize topology.'],
        tone: 'error'
      })
      return
    }

    const validation = validateTopology(topology)
    if (!validation.valid) {
      const validationErrors = validation.errors?.map(formatValidationIssue) ?? [
        'Topology validation failed.'
      ]
      setRunIssues({ messages: validationErrors, tone: 'error' })
      return
    }

    setRunIssues({ messages: validation.warnings ?? [], tone: 'warning' })
    setShowResults(true)
    setLastRunContext(runContext)
    clearSimulationMetrics()
    sim.run(topology)
  }

  function handleRun() {
    startSimulation()
  }

  const isRunning = sim.status === 'running'
  const isPaused = sim.status === 'paused'
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
        onPause={sim.pause}
        onResume={sim.resume}
        onStop={() => {
          sim.stop()
          clearSimulationMetrics()
          setShowResults(false)
          setLastRunContext(null)
          setRunIssues({ messages: [], tone: 'warning' })
        }}
        isRunning={isRunning}
        isPaused={isPaused}
        sourceNodes={sourceNodes}
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

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative h-full">
        <PanelGroup direction="horizontal" autoSaveId="main-layout-horizontal">
          {/* Left Sidebar — always in DOM, collapsed/expanded via ref */}
          <Panel
            ref={leftPanelRef}
            collapsible
            defaultSize={20}
            minSize={10}
            maxSize={30}
            order={1}
            id="left-panel"
          >
            <LibrarySidebar />
          </Panel>
          <ResizeHandle vertical id="resize-left-catalog" />

          {/* Center Column */}
          <Panel order={2} minSize={30} id="center-panel">
            <PanelGroup direction="vertical" autoSaveId="main-layout-vertical">
              {/* Canvas */}
              <Panel defaultSize={showResults ? 65 : 100} minSize={10} order={1}>
                <FlowCanvas />
              </Panel>

              {/* Results Tray */}
              {showResults && sim.status !== 'idle' && (
                <>
                  <ResizeHandle id="resize-results" />
                  <Panel defaultSize={35} minSize={15} maxSize={90} order={2}>
                    <ResultsTray
                      status={sim.status}
                      progress={sim.progress}
                      eventsProcessed={sim.eventsProcessed}
                      results={sim.results}
                      error={sim.error}
                      runContext={lastRunContext}
                      onClose={() => {
                        setShowResults(false)
                        sim.reset()
                        clearSimulationMetrics()
                        setLastRunContext(null)
                      }}
                    />
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
            <PropertiesPanel />
          </Panel>
        </PanelGroup>
      </div>

      {dialog}
    </div>
  )
}
