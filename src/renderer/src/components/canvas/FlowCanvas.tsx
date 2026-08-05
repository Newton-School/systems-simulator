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

function collectSelectedNodeIds(nodes: Node[]): Set<string> {
  const selected = new Set(nodes.filter((node) => node.selected).map((node) => node.id))
  let changed = true

  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentNode && selected.has(node.parentNode) && !selected.has(node.id)) {
        selected.add(node.id)
        changed = true
      }
    }
  }

  return selected
}

const FlowCanvasInternal = ({ showMetricLens = false, onNodeDoubleClick }: FlowCanvasProps) => {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [activeTool, setActiveTool] = useState<CanvasTool>('pan')
  const [validationError, setValidationError] = useState<string | null>(null)
  const shiftPreviousToolRef = useRef<CanvasTool | null>(null)

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, setNodes, setEdges } =
    useFlowStore()

  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const clearSimulationMetrics = useStore((state) => state.clearSimulationMetrics)
  const clearEdgeFlow = useStore((state) => state.clearEdgeFlow)
  const setRoutingStrategyVisualization = useStore((state) => state.setRoutingStrategyVisualization)
  const viewportFitVersion = useStore((state) => state.viewportFitVersion)

  const { edgeTypes, defaultEdgeOptions } = useFlowConfig()

  const { onConnectStart, onConnectEnd, onEdgeUpdateStart, onEdgeUpdateEnd } = useMagneticSnap()
  useHandleProximity()
  useCopyPaste()

  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges(updateEdge(oldEdge, newConnection, edges))
    },
    [edges, setEdges]
  )

  const { onDragOver, onDrop, onNodeDragStop } = useFlowDnD({
    nodes,
    addNode,
    setNodes,
    instance: reactFlowInstance,
    onError: setValidationError
  })

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

      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        setEdges(
          edges.map((item) =>
            item.id === edge.id ? { ...item, selected: !Boolean(item.selected) } : item
          )
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

      if (activeTool === 'text' && reactFlowInstance) {
        const position = reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY
        })
        const labelNode = createTextLabelNode(position)
        setNodes([...nodes.map((node) => ({ ...node, selected: false })), labelNode])
        setEdges(edges.map((edge) => ({ ...edge, selected: false })))
        return
      }

      if (activeTool === 'select') {
        selectGraphElements({})
      }
    },
    [activeTool, edges, nodes, reactFlowInstance, selectGraphElements, setEdges, setNodes]
  )

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = collectSelectedNodeIds(nodes)
    const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id))

    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
      return
    }

    setNodes(nodes.filter((node) => !selectedNodeIds.has(node.id)))
    setEdges(
      edges.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id) &&
          !selectedNodeIds.has(edge.source) &&
          !selectedNodeIds.has(edge.target)
      )
    )
    selectGraphElements({})
  }, [edges, nodes, selectGraphElements, setEdges, setNodes])

  const resetCanvas = useCallback(() => {
    setNodes([])
    setEdges([])
    selectGraphElements({})
    clearSimulationMetrics()
    clearEdgeFlow()
    setRoutingStrategyVisualization(null)
  }, [
    clearEdgeFlow,
    clearSimulationMetrics,
    selectGraphElements,
    setEdges,
    setNodes,
    setRoutingStrategyVisualization
  ])

  const isPanTool = activeTool === 'pan'
  const isSelectTool = activeTool === 'select'
  const isTextTool = activeTool === 'text'

  return (
    <div style={{ width: '100%', height: '100%' }} className="bg-nss-bg relative">
      <CanvasToolbar
        activeTool={activeTool}
        hasCanvasContent={hasCanvasContent}
        hasSelection={hasSelection}
        onToolChange={setActiveTool}
        onResetCanvas={resetCanvas}
        onDeleteSelection={deleteSelection}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodeDoubleClick={onNodeDoubleClick}
        deleteKeyCode={['Backspace', 'Delete']}
        panOnDrag={isPanTool ? true : [1, 2]}
        panOnScroll={isPanTool}
        selectionOnDrag={isSelectTool}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        selectNodesOnDrag={false}
        elementsSelectable
        nodesDraggable={!isTextTool}
        nodesConnectable={!isPanTool && !isTextTool}
        edgesUpdatable={!isPanTool && !isTextTool}
        className={isPanTool ? 'cursor-grab' : isTextTool ? 'cursor-text' : 'cursor-default'}
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
