import { useCallback } from 'react'
import { ReactFlowInstance, NodeDragHandler, Node } from 'reactflow'
import {
  findTargetContainer,
  getAbsoluteNodePosition,
  getId,
  recomputeContainment
} from '../utils/canvasUtils'
import { instantiateTemplate } from '../../../../../engine/catalog/paletteTemplates'
import { validatePlacement } from '../../../config/hierarchyRules'

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
      const targetContainer = findTargetContainer(nodes, position, undefined, templateId)
      const parentTemplateId = targetContainer
        ? ((targetContainer.data as { templateId?: string })?.templateId ?? null)
        : null
      const validation = validatePlacement(templateId, parentTemplateId)

      if (!validation.valid) {
        onError?.(validation.error ?? 'Invalid placement.')
        return false
      }

      onError?.(null)

      const newNode: Node = {
        id: getId(),
        type,
        position,
        data: instantiateTemplate(templateId)
      }

      if (targetContainer) {
        const containerPosition = getAbsoluteNodePosition(targetContainer, nodes)
        newNode.parentNode = targetContainer.id
        newNode.extent = 'parent'
        newNode.zIndex = newNode.type === 'vpcNode' ? 1 : 10
        newNode.position = {
          x: position.x - containerPosition.x,
          y: position.y - containerPosition.y
        }
      }

      addNode(newNode)
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
