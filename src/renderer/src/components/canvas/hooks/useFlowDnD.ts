import { useCallback } from 'react'
import { ReactFlowInstance, NodeDragHandler, Node } from 'reactflow'
import { findTargetVpc, getId, recomputeContainment } from '../utils/canvasUtils'
import { instantiateTemplate } from '../../../../../engine/catalog/paletteTemplates'

interface UseFlowDnDProps {
  nodes: Node[]
  addNode: (node: Node) => void
  setNodes: (nodes: Node[]) => void
  instance: ReactFlowInstance | null
}

export const useFlowDnD = ({ nodes, addNode, setNodes, instance }: UseFlowDnDProps) => {
  // 1. Drag Over
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  // 2. Drop (New Node Creation)
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

      // Reusable logic to find target VPC
      const targetVpc = findTargetVpc(nodes, position)

      const newNode: Node = {
        id: getId(),
        type,
        position,
        data: instantiateTemplate(templateId)
      }

      if (targetVpc) {
        newNode.parentNode = targetVpc.id
        newNode.extent = 'parent'
        newNode.zIndex = 10 // Lift nested items
        newNode.position = {
          x: position.x - targetVpc.position.x,
          y: position.y - targetVpc.position.y
        }
      }

      addNode(newNode)
    },
    [instance, addNode, nodes]
  )

  // 3. Drag Stop — re-derive containment from geometry (center-inside).
  // Works whether the user dragged a node INTO a container or dragged a
  // container OVER existing nodes, and releases nodes whose center leaves their
  // container. Runs over the whole graph so nesting stays consistent.
  const onNodeDragStop: NodeDragHandler = useCallback(
    (_, node) => {
      const withDraggedPosition = nodes.map((n) =>
        n.id === node.id ? { ...n, position: node.position, parentNode: node.parentNode } : n
      )
      const recomputed = recomputeContainment(withDraggedPosition)
      if (recomputed !== withDraggedPosition) {
        setNodes(recomputed)
      }
    },
    [nodes, setNodes]
  )

  return { onDragOver, onDrop, onNodeDragStop }
}
