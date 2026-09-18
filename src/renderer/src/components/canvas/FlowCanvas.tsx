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
  Node,
  type Viewport
} from 'reactflow'
import 'reactflow/dist/style.css'

import EmptyFlowState from '../ui/EmptyFlowState'
import { RunToast } from '../ui/RunToast'
import { CanvasLegend } from './CanvasLegend'
import { RequestTraceOverlay } from './RequestTraceOverlay'
import { MetricLensSwitcher } from './MetricLensSwitcher'
// Hooks & Config
import useStore from '@renderer/store/useStore'

import { useCopyPaste } from './hooks/useCopyPaste'
import { useFlowStore } from './hooks/useFlowStore'
import { useFlowDnD } from './hooks/useFlowDnD'
import { nodeTypes, edgeTypes, defaultEdgeOptions, GRID_COLOR } from './config/flowConfig'
import { useMagneticSnap } from './hooks/useMagneticSnap'
import { useHandleProximity } from './hooks/useHandleProximity'
import MagneticConnectionLine from './MagneticConnectionLine'
import { MAGNETIC_CONNECTION_RADIUS_PX } from './magneticSnapConfig'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar'
import { CanvasAnnotationLayer } from './CanvasAnnotationLayer'
import type { AnnotationTool } from '@renderer/types/annotations'
import {
  TEXT_LABEL_NODE_TYPE,
  type CanvasTextLabelData
} from '../../../../engine/catalog/canvasAnnotations'
import {
  isEditableShortcutTarget,
  isModalOpen,
  isPrimaryModifier
} from '@renderer/config/keyboardShortcuts'

interface FlowCanvasProps {
  showMetricLens?: boolean
  interactionLocked?: boolean
  onNodeDoubleClick?: (event: React.MouseEvent, node: Node) => void
  onEdgeDoubleClick?: (event: React.MouseEvent, edge: Edge) => void
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
  onNodeDoubleClick,
  onEdgeDoubleClick
}: FlowCanvasProps) => {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [selectedTool, setSelectedTool] = useState<CanvasTool>('pan')
  const [canvasViewport, setCanvasViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [tapConnectSourceId, setTapConnectSourceId] = useState<string | null>(null)
  const [temporarySelectActive, setTemporarySelectActive] = useState(false)
  const [temporaryPanActive, setTemporaryPanActive] = useState(false)
  const [isConnectionDragging, setIsConnectionDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const activeTool: CanvasTool = temporaryPanActive
    ? 'pan'
    : temporarySelectActive
      ? 'select'
      : selectedTool
  const annotationToolActive =
    activeTool === 'pen' ||
    activeTool === 'highlighter' ||
    activeTool === 'arrow' ||
    activeTool === 'note' ||
    activeTool === 'eraser'
  const edgeRoutingStyle = useStore((state) => state.displaySettings.edgeRoutingStyle)
  const canAnnotate = useStore((state) => state.environmentProfile.capabilities.canAnnotate)
  const annotations = useStore((state) => state.annotations)
  const annotationHistory = useStore((state) => state.annotationHistory)
  const pendingNodePlacement = useStore((state) => state.pendingNodePlacement)
  const setPendingNodePlacement = useStore((state) => state.setPendingNodePlacement)
  const clearAnnotations = useStore((state) => state.clearAnnotations)
  const undoAnnotation = useStore((state) => state.undoAnnotation)
  const redoAnnotation = useStore((state) => state.redoAnnotation)

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

  const { onDragOver, onDrop, onNodeDragStop, placeNode } = useFlowDnD({
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
    const annotationTool =
      selectedTool === 'text' ||
      selectedTool === 'pen' ||
      selectedTool === 'laser' ||
      selectedTool === 'highlighter' ||
      selectedTool === 'arrow' ||
      selectedTool === 'note' ||
      selectedTool === 'eraser'
    if ((!interactionLocked && (canAnnotate || !annotationTool)) || !annotationTool) {
      return
    }

    setSelectedTool('pan')
  }, [canAnnotate, interactionLocked, selectedTool])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target) || isModalOpen()) {
        return
      }

      if (event.key === 'Shift') {
        setTemporarySelectActive(true)
        return
      }

      if (event.code === 'Space' && !isPrimaryModifier(event) && !event.altKey) {
        event.preventDefault()
        setTemporaryPanActive(true)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setTemporarySelectActive(false)
      }
      if (event.code === 'Space') {
        setTemporaryPanActive(false)
      }
    }

    const clearTemporaryTools = () => {
      setTemporarySelectActive(false)
      setTemporaryPanActive(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearTemporaryTools)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearTemporaryTools)
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
      // React Flow's SVG edge wrapper can swallow `dblclick` for some custom
      // edge renderers. The second click still carries detail=2, so use it as
      // a reliable fallback for opening the connector inspector.
      if (event.detail >= 2) {
        onEdgeDoubleClick?.(event, edge)
      }
      if (activeTool !== 'select' && activeTool !== 'pan') return

      const shouldToggleSelection = event.metaKey || event.ctrlKey || event.shiftKey

      if (shouldToggleSelection) {
        setEdges(
          edges.map((item) => (item.id === edge.id ? { ...item, selected: !item.selected } : item)),
          { history: 'skip' }
        )
        return
      }

      selectGraphElements({ edgeId: edge.id })
    },
    [activeTool, edges, onEdgeDoubleClick, selectGraphElements, setEdges]
  )

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      setValidationError(null)

      if (pendingNodePlacement && reactFlowInstance && !interactionLocked) {
        const position = reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY
        })
        if (placeNode(pendingNodePlacement.type, pendingNodePlacement.templateId, position)) {
          setPendingNodePlacement(null)
          setSelectedTool('pan')
        }
        return
      }

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

      if (activeTool === 'select' || activeTool === 'pan') {
        selectGraphElements({})
      }
    },
    [
      activeTool,
      edges,
      interactionLocked,
      nodes,
      pendingNodePlacement,
      placeNode,
      reactFlowInstance,
      selectGraphElements,
      setGraph,
      setPendingNodePlacement
    ]
  )

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (activeTool !== 'connect' || interactionLocked) return
      event.preventDefault()
      event.stopPropagation()

      if (!tapConnectSourceId) {
        setTapConnectSourceId(node.id)
        selectGraphElements({ nodeId: node.id })
        return
      }

      if (tapConnectSourceId !== node.id) {
        onConnect({
          source: tapConnectSourceId,
          target: node.id,
          sourceHandle: 'right-1-source',
          targetHandle: 'left-1-target'
        })
      }
      setTapConnectSourceId(null)
      selectGraphElements({})
    },
    [activeTool, interactionLocked, onConnect, selectGraphElements, tapConnectSourceId]
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target) || isModalOpen()) {
        return
      }

      const key = event.key.toLowerCase()
      const isModifierPressed = isPrimaryModifier(event)

      if (isModifierPressed && key === 'z') {
        event.preventDefault()
        if (attemptStatus !== 'LOCKED' && !interactionLocked) {
          if (event.shiftKey) {
            if (annotationHistory.future.length > 0 && (annotationToolActive || !canRedoGraph)) {
              redoAnnotation()
            } else {
              redoGraph()
            }
          } else {
            if (annotationHistory.past.length > 0 && (annotationToolActive || !canUndoGraph)) {
              undoAnnotation()
            } else {
              undoGraph()
            }
          }
        }
        return
      }

      if (event.ctrlKey && key === 'y') {
        event.preventDefault()
        if (attemptStatus !== 'LOCKED' && !interactionLocked) {
          if (annotationHistory.future.length > 0 && (annotationToolActive || !canRedoGraph)) {
            redoAnnotation()
          } else {
            redoGraph()
          }
        }
        return
      }

      if (isModifierPressed && key === 'a') {
        event.preventDefault()
        setGraph(
          nodes.map((node) => ({ ...node, selected: true })),
          edges.map((edge) => ({ ...edge, selected: true })),
          { history: 'skip' }
        )
        return
      }

      if (!isModifierPressed && !event.altKey && (key === 'v' || key === '1')) {
        event.preventDefault()
        setSelectedTool('select')
        return
      }

      if (!isModifierPressed && !event.altKey && (key === 'h' || key === '2')) {
        event.preventDefault()
        setSelectedTool('pan')
        return
      }

      if (!isModifierPressed && !event.altKey && key === '3') {
        if (!interactionLocked && window.matchMedia('(pointer: coarse)').matches) {
          event.preventDefault()
          setSelectedTool('connect')
        }
        return
      }

      if (!isModifierPressed && !event.altKey && key === 't') {
        if (!interactionLocked) {
          event.preventDefault()
          setSelectedTool('text')
        }
        return
      }

      if (!isModifierPressed && !event.altKey && key === 'f') {
        event.preventDefault()
        reactFlowInstance?.fitView({ padding: 0.2, maxZoom: 1.2, duration: 300 })
        return
      }

      if (!isModifierPressed && !event.altKey && key === '0') {
        event.preventDefault()
        void reactFlowInstance?.zoomTo(1, { duration: 180 })
        return
      }

      if (!isModifierPressed && !event.altKey && (event.key === '+' || event.key === '=')) {
        event.preventDefault()
        void reactFlowInstance?.zoomIn({ duration: 160 })
        return
      }

      if (!isModifierPressed && !event.altKey && event.key === '-') {
        event.preventDefault()
        void reactFlowInstance?.zoomOut({ duration: 160 })
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        selectGraphElements({})
        return
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && hasSelection) {
        event.preventDefault()
        deleteSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    attemptStatus,
    annotationHistory.future.length,
    annotationHistory.past.length,
    annotationToolActive,
    canRedoGraph,
    canUndoGraph,
    deleteSelection,
    edges,
    hasSelection,
    interactionLocked,
    nodes,
    reactFlowInstance,
    redoGraph,
    redoAnnotation,
    selectGraphElements,
    setGraph,
    undoGraph,
    undoAnnotation
  ])

  const isPanTool = activeTool === 'pan'
  const isSelectTool = activeTool === 'select'
  const isTextTool = activeTool === 'text'
  const isConnectTool = activeTool === 'connect'
  const activeAnnotationTool: AnnotationTool | null =
    activeTool === 'pen' ||
    activeTool === 'laser' ||
    activeTool === 'highlighter' ||
    activeTool === 'arrow' ||
    activeTool === 'note' ||
    activeTool === 'eraser'
      ? activeTool
      : null
  const annotationModeActive = activeAnnotationTool !== null
  const persistentAnnotationModeActive =
    activeAnnotationTool !== null && activeAnnotationTool !== 'laser'
  const useAnnotationHistory =
    annotationHistory.past.length > 0 && (persistentAnnotationModeActive || !canUndoGraph)
  const useAnnotationFuture =
    annotationHistory.future.length > 0 && (persistentAnnotationModeActive || !canRedoGraph)
  const flowClassName = [
    isPanTool
      ? 'cursor-grab'
      : isTextTool
        ? 'cursor-text'
        : isConnectTool
          ? 'cursor-crosshair'
          : 'cursor-default',
    isPanTool ? 'nss-pan-tool' : '',
    isConnectTool ? 'nss-connect-tool' : '',
    isConnectionDragging ? 'nss-connection-dragging' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        ...(annotationModeActive
          ? {
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none'
            }
          : {})
      }}
      className="bg-nss-bg relative"
    >
      <CanvasToolbar
        activeTool={activeTool}
        canAnnotate={canAnnotate}
        canRedo={attemptStatus !== 'LOCKED' && (useAnnotationFuture || canRedoGraph)}
        canUndo={attemptStatus !== 'LOCKED' && (useAnnotationHistory || canUndoGraph)}
        editingDisabled={interactionLocked}
        hasAnnotations={annotations.length > 0}
        hasCanvasContent={hasCanvasContent}
        hasSelection={hasSelection}
        onClearAnnotations={clearAnnotations}
        onToolChange={(tool) => {
          setSelectedTool(tool)
          setTapConnectSourceId(null)
        }}
        onUndo={useAnnotationHistory ? undoAnnotation : undoGraph}
        onRedo={useAnnotationFuture ? redoAnnotation : redoGraph}
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
        connectionLineType={
          edgeRoutingStyle === 'bezier'
            ? ConnectionLineType.Bezier
            : edgeRoutingStyle === 'straight' || edgeRoutingStyle === 'octilinear'
              ? ConnectionLineType.Straight
              : edgeRoutingStyle === 'orthogonal'
                ? ConnectionLineType.Step
                : ConnectionLineType.SmoothStep
        }
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
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onMove={(_, viewport) => setCanvasViewport(viewport)}
        deleteKeyCode={null}
        panOnDrag={annotationModeActive ? false : isPanTool ? true : [1, 2]}
        panOnScroll={isPanTool}
        selectionOnDrag={isSelectTool}
        selectionMode={SelectionMode.Partial}
        // Shift drives the marquee (box) selection; Cmd/Ctrl adds to the
        // selection. These MUST differ — when selectionKeyCode and
        // multiSelectionKeyCode are the same key, React Flow's box-select and
        // multi-select collide and the marquee grabs the entire graph.
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        selectNodesOnDrag={false}
        elementsSelectable
        nodesDraggable={
          !isTextTool && !isConnectTool && !annotationModeActive && !interactionLocked
        }
        nodesConnectable={!isTextTool && !annotationModeActive && !interactionLocked}
        edgesUpdatable={!isTextTool && !annotationModeActive && !interactionLocked}
        className={flowClassName}
      >
        <Background variant={BackgroundVariant.Dots} gap={30} size={1.2} color={GRID_COLOR} />
        <Controls className="!bg-nss-surface !border-nss-border" />
        <MiniMap className="nss-compact-minimap !bg-nss-surface !border-nss-border" />
      </ReactFlow>
      {canAnnotate ? (
        <CanvasAnnotationLayer activeTool={activeAnnotationTool} viewport={canvasViewport} />
      ) : null}
      {pendingNodePlacement ? (
        <div className="pointer-events-auto absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-nss-primary/30 bg-nss-panel/95 px-4 py-2 text-xs font-medium text-nss-text shadow-lg backdrop-blur">
          Tap the canvas to place {pendingNodePlacement.label}
          <button
            type="button"
            onClick={() => setPendingNodePlacement(null)}
            className="text-nss-muted hover:text-nss-text"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {isConnectTool && tapConnectSourceId ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-nss-primary/30 bg-nss-panel/95 px-4 py-2 text-xs font-medium text-nss-text shadow-lg backdrop-blur">
          Tap a destination node
        </div>
      ) : null}
      {!isEmpty && showMetricLens && <MetricLensSwitcher />}
      {!isEmpty && showMetricLens && <CanvasLegend />}
      <RequestTraceOverlay />

      {/* Empty State */}
      <EmptyFlowState
        isEmpty={isEmpty}
        hidden={annotationToolActive || activeTool === 'laser' || activeTool === 'text'}
      />
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
