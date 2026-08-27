import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  ReactFlowInstance,
  ReactFlowProvider,
  Edge,
  Connection,
  ConnectionLineType,
  SelectionMode,
  updateEdge,
  Node
} from 'reactflow'
import 'reactflow/dist/style.css'

import EmptyFlowState from '../ui/EmptyFlowState'
import { RunToast } from '../ui/RunToast'
import { CanvasLegend } from './CanvasLegend'
import { MetricLensSwitcher } from './MetricLensSwitcher'
// Hooks & Config
import useStore from '@renderer/store/useStore'

import { useCopyPaste } from './hooks/useCopyPaste'
import { useFlowStore } from './hooks/useFlowStore'
import { useFlowDnD } from './hooks/useFlowDnD'
import { useFlowConfig, nodeTypes, GRID_COLOR } from './config/flowConfig'
import { useMagneticSnap } from './hooks/useMagneticSnap'
import { useHandleProximity } from './hooks/useHandleProximity'
import MagneticConnectionLine from './MagneticConnectionLine'
import { MAGNETIC_CONNECTION_RADIUS_PX } from './magneticSnapConfig'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar'
import {
  TEXT_LABEL_NODE_TYPE,
  type CanvasTextLabelData
} from '../../../../engine/catalog/canvasAnnotations'

interface FlowCanvasProps {
  showMetricLens?: boolean
  interactionLocked?: boolean
  onNodeDoubleClick?: (event: React.MouseEvent, node: Node) => void
}

function createTextLabelNode(position: { x: number; y: number }): Node<CanvasTextLabelData> {
  return {
    id: `label-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: TEXT_LABEL_NODE_TYPE,
    position,
    data: { text: 'Label' },
    draggable: true,
    selectable: true,
    deletable: true,
    selected: true
  }
}

function collectSelectedNodeIds(nodes: Node[], ignoredNodeIds = new Set<string>()): Set<string> {
  const selected = new Set(
    nodes.filter((node) => node.selected && !ignoredNodeIds.has(node.id)).map((node) => node.id)
  )
  let changed = true

  while (changed) {
    changed = false
    for (const node of nodes) {
      if (
        node.parentNode &&
        selected.has(node.parentNode) &&
        !selected.has(node.id) &&
        !ignoredNodeIds.has(node.id)
      ) {
        selected.add(node.id)
        changed = true
      }
    }
  }

  return selected
}

const FlowCanvasInternal = ({
  showMetricLens = false,
  interactionLocked = false,
  onNodeDoubleClick
}: FlowCanvasProps) => {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [activeTool, setActiveTool] = useState<CanvasTool>('pan')
  const [isConnectionDragging, setIsConnectionDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const shiftPreviousToolRef = useRef<CanvasTool | null>(null)

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setNodes,
    setEdges,
    setGraph,
    canUndoGraph,
    canRedoGraph,
    undoGraph,
    redoGraph
  } = useFlowStore()

  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const clearSimulationMetrics = useStore((state) => state.clearSimulationMetrics)
  const clearEdgeFlow = useStore((state) => state.clearEdgeFlow)
  const setRoutingStrategyVisualization = useStore((state) => state.setRoutingStrategyVisualization)
  const viewportFitVersion = useStore((state) => state.viewportFitVersion)
  const scaffoldNodeIds = useStore((state) => state.scaffoldNodeIds)
  const scaffoldEdgeIds = useStore((state) => state.scaffoldEdgeIds)
  const activeQuestion = useStore((state) => state.activeQuestion)
  const canEditScaffoldNodes = useStore(
    (state) => state.environmentProfile.capabilities.canEditScaffoldNodes
  )
  const attemptStatus = useStore((state) => state.attemptState?.status)
  const authoredLockedScaffoldEdgeIds = useMemo(
    () => new Set(activeQuestion?.scaffold.lockedEdgeIds ?? []),
    [activeQuestion]
  )

  const { edgeTypes, defaultEdgeOptions } = useFlowConfig()

  const {
    onConnectStart: onConnectStartBase,
    onConnectEnd: onConnectEndBase,
    onEdgeUpdateStart: onEdgeUpdateStartBase,
    onEdgeUpdateEnd: onEdgeUpdateEndBase
  } = useMagneticSnap()
  useHandleProximity()
  useCopyPaste({ disabled: interactionLocked })

  const onConnectStart = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onConnectStart']>
  >(
    (event, params) => {
      setIsConnectionDragging(true)
      onConnectStartBase(event, params)
    },
    [onConnectStartBase]
  )

  const onConnectEnd = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onConnectEnd']>
  >(() => {
    setIsConnectionDragging(false)
    onConnectEndBase()
  }, [onConnectEndBase])

  const onEdgeUpdateStart = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onEdgeUpdateStart']>
  >(
    (event, edge, handleType) => {
      setIsConnectionDragging(true)
      onEdgeUpdateStartBase(event, edge, handleType)
    },
    [onEdgeUpdateStartBase]
  )

  const onEdgeUpdateEnd = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onEdgeUpdateEnd']>
  >(() => {
    setIsConnectionDragging(false)
    onEdgeUpdateEndBase()
  }, [onEdgeUpdateEndBase])

  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (interactionLocked) {
        return
      }
      const edgeIsLocked =
        attemptStatus === 'LOCKED' ||
        (scaffoldEdgeIds.includes(oldEdge.id) &&
          (!canEditScaffoldNodes ||
            activeQuestion?.constraints.canModifyScaffold === false ||
            authoredLockedScaffoldEdgeIds.has(oldEdge.id)))
      if (edgeIsLocked) {
        return
      }
      setEdges(updateEdge(oldEdge, newConnection, edges))
    },
    [
      activeQuestion,
      attemptStatus,
      authoredLockedScaffoldEdgeIds,
      canEditScaffoldNodes,
      edges,
      interactionLocked,
      scaffoldEdgeIds,
      setEdges
    ]
  )

  const { onDragOver, onDrop, onNodeDragStop } = useFlowDnD({
    nodes,
    addNode,
    setNodes,
    instance: reactFlowInstance,
    onError: setValidationError
  })

  const handleConnect = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onConnect']>
  >(
    (connection) => {
      if (interactionLocked) {
        return
      }
      onConnect(connection)
    },
    [interactionLocked, onConnect]
  )

  const handleDrop = useCallback<NonNullable<React.ComponentProps<typeof ReactFlow>['onDrop']>>(
    (event) => {
      if (interactionLocked) {
        return
      }
      onDrop(event)
    },
    [interactionLocked, onDrop]
  )

  const isEmpty = nodes.length === 0
  const prevNodeCount = useRef(nodes.length)
  const hasCanvasContent = nodes.length > 0 || edges.length > 0
  const hasSelection = useMemo(
    () => nodes.some((node) => node.selected) || edges.some((edge) => edge.selected),
    [edges, nodes]
  )

  useEffect(() => {
    const isBulkLoad = Math.abs(nodes.length - prevNodeCount.current) > 1

    if (reactFlowInstance && isBulkLoad) {
      // Only fit view when many nodes are added at once (e.g. opening a saved file)
      window.requestAnimationFrame(() => {
        reactFlowInstance.fitView({
          padding: 0.2,
          maxZoom: 1.2,
          duration: 800
        })
      })
    }

    prevNodeCount.current = nodes.length
  }, [nodes.length, reactFlowInstance])

  useEffect(() => {
    if (!interactionLocked || activeTool !== 'text') {
      return
    }

    setActiveTool('pan')
  }, [activeTool, interactionLocked])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Shift' || event.repeat || shiftPreviousToolRef.current) {
        return
      }

      setActiveTool((currentTool) => {
        shiftPreviousToolRef.current = currentTool
        return 'select'
      })
    }

    const restorePreviousTool = () => {
      const previousTool = shiftPreviousToolRef.current
      if (!previousTool) return
      shiftPreviousToolRef.current = null
      setActiveTool(previousTool)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        restorePreviousTool()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', restorePreviousTool)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', restorePreviousTool)
    }
  }, [])

  useEffect(() => {
    if (!reactFlowInstance) {
      return
    }

    window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({
        padding: 0.2,
        maxZoom: 1.2,
        duration: 500
      })
    })
  }, [reactFlowInstance, viewportFitVersion])

  // Edge selection lives in the shared store so the right-hand inspector
  // (PropertiesPanel) can render its properties, exactly like node config.
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation()
      if (activeTool !== 'select') return

      const shouldToggleSelection =
        event.metaKey || event.ctrlKey || (event.shiftKey && !shiftPreviousToolRef.current)

      if (shouldToggleSelection) {
        setEdges(
          edges.map((item) => (item.id === edge.id ? { ...item, selected: !item.selected } : item)),
          { history: 'skip' }
        )
        return
      }

      selectGraphElements({ edgeId: edge.id })
    },
    [activeTool, edges, selectGraphElements, setEdges]
  )

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      setValidationError(null)

      if (interactionLocked) {
        if (activeTool === 'select') {
          selectGraphElements({})
        }
        return
      }

      if (activeTool === 'text' && reactFlowInstance) {
        const position = reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY
        })
        const labelNode = createTextLabelNode(position)
        setGraph(
          [...nodes.map((node) => ({ ...node, selected: false })), labelNode],
          edges.map((edge) => ({ ...edge, selected: false }))
        )
        return
      }

      if (activeTool === 'select') {
        selectGraphElements({})
      }
    },
    [activeTool, edges, interactionLocked, nodes, reactFlowInstance, selectGraphElements, setGraph]
  )

  const deleteSelection = useCallback(() => {
    if (attemptStatus === 'LOCKED' || interactionLocked) {
      return
    }

    const canRemoveScaffoldNodes =
      canEditScaffoldNodes && activeQuestion?.constraints.canRemoveScaffoldNodes !== false
    const canEditScaffoldEdges =
      canEditScaffoldNodes && activeQuestion?.constraints.canModifyScaffold !== false
    const lockedNodeIds = new Set(
      canRemoveScaffoldNodes
        ? []
        : scaffoldNodeIds.filter((nodeId) =>
            nodes.some((node) => node.id === nodeId && node.selected)
          )
    )
    const selectedNodeIds = collectSelectedNodeIds(nodes, lockedNodeIds)
    const lockedSelectedEdgeIds = new Set(
      edges
        .filter(
          (edge) =>
            edge.selected &&
            scaffoldEdgeIds.includes(edge.id) &&
            (!canEditScaffoldEdges ||
              activeQuestion?.constraints.canRemoveScaffoldNodes === false ||
              authoredLockedScaffoldEdgeIds.has(edge.id))
        )
        .map((edge) => edge.id)
    )
    const selectedEdgeIds = new Set(
      edges
        .filter((edge) => edge.selected && !lockedSelectedEdgeIds.has(edge.id))
        .map((edge) => edge.id)
    )

    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
      return
    }

    setGraph(
      nodes.filter((node) => !selectedNodeIds.has(node.id)),
      edges.filter(
        (edge) =>
          lockedSelectedEdgeIds.has(edge.id) ||
          (!selectedEdgeIds.has(edge.id) &&
            !selectedNodeIds.has(edge.source) &&
            !selectedNodeIds.has(edge.target))
      )
    )
    selectGraphElements({})
  }, [
    activeQuestion,
    attemptStatus,
    authoredLockedScaffoldEdgeIds,
    canEditScaffoldNodes,
    edges,
    nodes,
    scaffoldEdgeIds,
    scaffoldNodeIds,
    selectGraphElements,
    setGraph,
    interactionLocked
  ])

  const resetCanvas = useCallback(() => {
    if (attemptStatus === 'LOCKED' || interactionLocked) {
      return
    }

    const canRemoveScaffoldNodes =
      canEditScaffoldNodes && activeQuestion?.constraints.canRemoveScaffoldNodes !== false
    const canEditScaffoldEdges =
      canEditScaffoldNodes && activeQuestion?.constraints.canModifyScaffold !== false
    const preservedNodeIds = new Set(canRemoveScaffoldNodes ? [] : scaffoldNodeIds)
    const preservedEdgeIds = new Set<string>()

    for (const edge of edges) {
      const lockedScaffoldEdge =
        scaffoldEdgeIds.includes(edge.id) &&
        (!canEditScaffoldEdges ||
          activeQuestion?.constraints.canRemoveScaffoldNodes === false ||
          authoredLockedScaffoldEdgeIds.has(edge.id))
      if (!lockedScaffoldEdge) {
        continue
      }
      preservedEdgeIds.add(edge.id)
      preservedNodeIds.add(edge.source)
      preservedNodeIds.add(edge.target)
    }

    const nextNodes = nodes.filter((node) => preservedNodeIds.has(node.id))
    const nextEdges = edges.filter(
      (edge) =>
        preservedEdgeIds.has(edge.id) ||
        (scaffoldEdgeIds.includes(edge.id) &&
          preservedNodeIds.has(edge.source) &&
          preservedNodeIds.has(edge.target))
    )

    setGraph(nextNodes, nextEdges, { history: 'skip', resetHistory: true })
    selectGraphElements({})
    clearSimulationMetrics()
    clearEdgeFlow()
    setRoutingStrategyVisualization(null)
  }, [
    activeQuestion,
    attemptStatus,
    authoredLockedScaffoldEdgeIds,
    canEditScaffoldNodes,
    clearEdgeFlow,
    clearSimulationMetrics,
    edges,
    nodes,
    scaffoldEdgeIds,
    scaffoldNodeIds,
    selectGraphElements,
    setGraph,
    setRoutingStrategyVisualization,
    interactionLocked
  ])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false
      }

      return (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }

      const key = event.key.toLowerCase()
      const isModifierPressed = event.metaKey || event.ctrlKey

      if (isModifierPressed && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redoGraph()
        } else {
          undoGraph()
        }
        return
      }

      if (event.ctrlKey && key === 'y') {
        event.preventDefault()
        redoGraph()
        return
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && hasSelection) {
        event.preventDefault()
        deleteSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelection, hasSelection, redoGraph, undoGraph])

  const isPanTool = activeTool === 'pan'
  const isSelectTool = activeTool === 'select'
  const isTextTool = activeTool === 'text'
  const flowClassName = [
    isPanTool ? 'cursor-grab' : isTextTool ? 'cursor-text' : 'cursor-default',
    isConnectionDragging ? 'nss-connection-dragging' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div style={{ width: '100%', height: '100%' }} className="bg-nss-bg relative">
      <CanvasToolbar
        activeTool={activeTool}
        canRedo={attemptStatus !== 'LOCKED' && canRedoGraph}
        canUndo={attemptStatus !== 'LOCKED' && canUndoGraph}
        editingDisabled={interactionLocked}
        hasCanvasContent={hasCanvasContent}
        hasSelection={hasSelection}
        onToolChange={setActiveTool}
        onUndo={undoGraph}
        onRedo={redoGraph}
        onResetCanvas={resetCanvas}
        onDeleteSelection={deleteSelection}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineComponent={MagneticConnectionLine}
        connectionRadius={MAGNETIC_CONNECTION_RADIUS_PX}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onEdgeUpdate={onEdgeUpdate}
        onEdgeUpdateStart={onEdgeUpdateStart}
        onEdgeUpdateEnd={onEdgeUpdateEnd}
        onInit={setReactFlowInstance}
        onDrop={handleDrop}
        onDragOver={onDragOver}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodeDoubleClick={onNodeDoubleClick}
        deleteKeyCode={null}
        panOnDrag={isPanTool ? true : [1, 2]}
        panOnScroll={isPanTool}
        selectionOnDrag={isSelectTool}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        selectNodesOnDrag={false}
        elementsSelectable
        nodesDraggable={!isTextTool && !interactionLocked}
        nodesConnectable={!isTextTool && !interactionLocked}
        edgesUpdatable={!isTextTool && !interactionLocked}
        className={flowClassName}
      >
        <Background variant={BackgroundVariant.Dots} gap={30} size={1.2} color={GRID_COLOR} />
        <Controls className="!bg-nss-surface !border-nss-border" />
        <MiniMap className="!bg-nss-surface !border-nss-border" />
      </ReactFlow>
      {!isEmpty && showMetricLens && <MetricLensSwitcher />}
      {!isEmpty && showMetricLens && <CanvasLegend />}

      {/* Empty State */}
      <EmptyFlowState isEmpty={isEmpty} />
      {validationError && (
        <RunToast
          messages={[validationError]}
          tone="error"
          onClose={() => setValidationError(null)}
        />
      )}
    </div>
  )
}

export const FlowCanvas = (props: FlowCanvasProps) => (
  <ReactFlowProvider>
    <FlowCanvasInternal {...props} />
  </ReactFlowProvider>
)
