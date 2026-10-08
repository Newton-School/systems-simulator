import { useCallback } from 'react'
import { ReactFlowInstance, NodeDragHandler, Node } from 'reactflow'
import { recomputeContainment } from '../utils/canvasUtils'
import { createPlacedNode, resolvePlacement } from '../utils/nodePlacement'

interface UseFlowDnDProps {
  nodes: Node[]
  addNode: (node: Node) => void
  setNodes: (nodes: Node[], options?: { history?: 'record' | 'skip' | 'drag-commit' }) => void
  instance: ReactFlowInstance | null
  onError?: (message: string | null) => void
}

export const useFlowDnD = ({ nodes, addNode, setNodes, instance, onError }: UseFlowDnDProps) => {
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
    },
    [nodes, setNodes]
  )

  return { onDragOver, onDrop, onNodeDragStop, placeNode }
}
