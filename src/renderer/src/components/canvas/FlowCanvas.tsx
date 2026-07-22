import { useState, useCallback, useEffect, useRef } from 'react'
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

interface FlowCanvasProps {
  showMetricLens?: boolean
  onNodeDoubleClick?: (event: React.MouseEvent, node: Node) => void
}

const FlowCanvasInternal = ({ showMetricLens = false, onNodeDoubleClick }: FlowCanvasProps) => {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)

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
      selectGraphElements({ edgeId: edge.id })
    },
    [selectGraphElements]
  )

  const onPaneClick = useCallback(() => {
    selectGraphElements({})
  }, [selectGraphElements])

  return (
    <div style={{ width: '100%', height: '100%' }} className="bg-nss-bg relative">
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
