import { useCallback } from 'react'
import { ReactFlowInstance, NodeDragHandler, Node, type Edge } from 'reactflow'
import type { EdgeSimulationData } from '@renderer/types/ui'
import { recomputeContainment } from '../utils/canvasUtils'
import { createPlacedNode, resolvePlacement } from '../utils/nodePlacement'

interface UseFlowDnDProps {
  nodes: Node[]
  edges: Edge[]
  addNode: (node: Node) => void
  setNodes: (nodes: Node[], options?: { history?: 'record' | 'skip' | 'drag-commit' }) => void
  setEdges: (edges: Edge[], options?: { history?: 'record' | 'skip' }) => void
  instance: ReactFlowInstance | null
  onError?: (message: string | null) => void
}

export const useFlowDnD = ({
  nodes,
  edges,
  addNode,
  setNodes,
  setEdges,
  instance,
  onError
}: UseFlowDnDProps) => {
  const placeNode = useCallback(
    (type: string, templateId: string, position: { x: number; y: number }): boolean => {
      const placement = resolvePlacement(nodes, templateId, position)
      if (placement.ok === false) {
        onError?.(placement.error)
        return false
      }

      onError?.(null)
      addNode(createPlacedNode(nodes, type, templateId, position, placement.container))
      return true
    },
    [addNode, nodes, onError]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow/type')
      const templateId = event.dataTransfer.getData('application/reactflow/template-id')

      if (!type || !templateId) return
      const position = instance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      }) || { x: 0, y: 0 }

      placeNode(type, templateId, position)
    },
    [instance, placeNode]
  )

  const onNodeDragStop: NodeDragHandler = useCallback(
    (_, node) => {
      // React Flow can emit a final drag-stop during a hot reload/unmount without
      // the node payload. Treat it as a cancelled drag instead of crashing the canvas.
      if (!node) return
      const withDraggedPosition = nodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, position: node.position, parentNode: node.parentNode }
          : candidate
      )
      const recomputed = recomputeContainment(withDraggedPosition)
      setNodes(recomputed, { history: 'drag-commit' })

      // Auto-layout routes describe the whole obstacle field. Once a node is
      // moved, return every connector to live endpoint-based routing until the
      // user runs Auto Layout again instead of drawing stale detours.
      if (edges.some((edge) => (edge.data as EdgeSimulationData | undefined)?.layoutRoute)) {
        setEdges(
          edges.map((edge) => {
            const data = edge.data as EdgeSimulationData | undefined
            if (!data?.layoutRoute) return edge
            const rest = { ...data }
            delete rest.layoutRoute
            return { ...edge, data: rest }
          }),
          { history: 'skip' }
        )
      }
    },
    [edges, nodes, setEdges, setNodes]
  )

  return { onDragOver, onDrop, onNodeDragStop, placeNode }
}
