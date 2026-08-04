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
import { CanvasLegend } from './CanvasLegend'
import { MetricLensSwitcher } from './MetricLensSwitcher'
// Hooks & Config
import useStore from '@renderer/store/useStore'

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
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, setNodes, setEdges } =
    useFlowStore()

  const selectGraphElements = useStore((state) => state.selectGraphElements)

  const { edgeTypes, defaultEdgeOptions } = useFlowConfig()

  const { onConnectStart, onConnectEnd, onEdgeUpdateStart, onEdgeUpdateEnd } = useMagneticSnap()
  useHandleProximity()

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
    instance: reactFlowInstance
  })

  const isEmpty = nodes.length === 0
  const prevNodeCount = useRef(nodes.length)
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

  const isPanTool = activeTool === 'pan'
  const isSelectTool = activeTool === 'select'
  const isTextTool = activeTool === 'text'

  return (
    <div style={{ width: '100%', height: '100%' }} className="bg-nss-bg relative">
      <CanvasToolbar
        activeTool={activeTool}
        hasSelection={hasSelection}
        onToolChange={setActiveTool}
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
        panOnDrag={isPanTool ? true : [1, 2]}
        panOnScroll={isPanTool}
        selectionOnDrag={isSelectTool}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        elementsSelectable={!isPanTool}
        nodesDraggable={!isPanTool}
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
    </div>
  )
}

export const FlowCanvas = (props: FlowCanvasProps) => (
  <ReactFlowProvider>
    <FlowCanvasInternal {...props} />
  </ReactFlowProvider>
)
