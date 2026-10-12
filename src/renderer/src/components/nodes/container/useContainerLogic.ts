import { useMemo, useCallback, useState, useEffect } from 'react'
import { Node } from 'reactflow'
import useStore from '@renderer/store/useStore'

const PADDING = 20
const DEFAULT_MIN_SIZE = 200

// Helper: Calculate True World Position (recursively)
const getAbsolutePosition = (node: Node, allNodes: Node[]) => {
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentNode

  while (parentId) {
    const parent = allNodes.find((n) => n.id === parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }
  return { x, y }
}

export const useContainerLogic = (id: string) => {
  const nodes = useStore((state) => state.nodes)
  const { setNodes } = useStore.getState()
  const [isUngrouped, setIsUngrouped] = useState(false)

  // Identify Children
  const children = useMemo(() => nodes.filter((n) => n.parentNode === id), [nodes, id])
  const hasChildren = children.length > 0

  // Revert Logic (Auto-reset state if new children are added)
  useEffect(() => {
    if (hasChildren && isUngrouped) {
      setIsUngrouped(false)
    }
  }, [hasChildren, isUngrouped])

  // Dynamic Size Calculation
  const minSize = useMemo(() => {
    if (!hasChildren) return { width: DEFAULT_MIN_SIZE, height: DEFAULT_MIN_SIZE }

    let maxRight = 0
    let maxBottom = 0

    children.forEach((child) => {
      const childRight = child.position.x + (child.width || 0)
      const childBottom = child.position.y + (child.height || 0)
      if (childRight > maxRight) maxRight = childRight
      if (childBottom > maxBottom) maxBottom = childBottom
    })

    return {
      width: Math.max(DEFAULT_MIN_SIZE, maxRight + PADDING),
      height: Math.max(DEFAULT_MIN_SIZE, maxBottom + PADDING)
    }
  }, [children, hasChildren])

  // Ungroup Handler
  const handleUngroup = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const currentNodes = useStore.getState().nodes
      const parentNode = currentNodes.find((n) => n.id === id)

      if (!parentNode) return

      const parentAbsPos = getAbsolutePosition(parentNode, currentNodes)

      const updatedNodes = currentNodes.map((node) => {
        if (node.parentNode === id) {
          return {
            ...node,
            parentNode: undefined,
            extent: undefined,
            zIndex: 0,
            position: {
              x: parentAbsPos.x + node.position.x,
              y: parentAbsPos.y + node.position.y
            }
          }
        }
        return node
      })

      setNodes(updatedNodes)
      setIsUngrouped(true)
    },
    [id, setNodes]
  )

  return {
    isUngrouped,
    hasChildren,
    minSize,
    handleUngroup
  }
}
