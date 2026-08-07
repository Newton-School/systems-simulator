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
  setNodes: (nodes: Node[], options?: { history?: 'record' | 'skip' }) => void
  instance: ReactFlowInstance | null
  onError?: (message: string | null) => void
}

export const useFlowDnD = ({ nodes, addNode, setNodes, instance, onError }: UseFlowDnDProps) => {
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

      const targetContainer = findTargetContainer(nodes, position, undefined, templateId)
      const parentTemplateId = targetContainer
        ? ((targetContainer.data as { templateId?: string })?.templateId ?? null)
        : null
      const validation = validatePlacement(templateId, parentTemplateId)

      if (!validation.valid) {
        onError?.(validation.error ?? 'Invalid placement.')
        return
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
    },
    [addNode, instance, nodes, onError]
  )

  const onNodeDragStop: NodeDragHandler = useCallback(
    (_, node) => {
      const withDraggedPosition = nodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, position: node.position, parentNode: node.parentNode }
          : candidate
      )
      const recomputed = recomputeContainment(withDraggedPosition)
      if (recomputed !== withDraggedPosition) {
        setNodes(recomputed, { history: 'skip' })
      }
    },
    [nodes, setNodes]
  )

  return { onDragOver, onDrop, onNodeDragStop }
}
