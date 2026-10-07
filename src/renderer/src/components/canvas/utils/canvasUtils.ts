import { Node, XYPosition } from 'reactflow'
import { validatePlacement } from '@renderer/config/hierarchyRules'

let id = 1
export const getId = () => `node_${id++}`

function absolutePosition(node: Node, byId: Map<string, Node>): XYPosition {
  let { x, y } = node.position
  let parentId = node.parentNode
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }
  return { x, y }
}

function getTemplateId(node: Node): string | null {
  if (typeof node.data !== 'object' || node.data === null) return null
  const candidate = (node.data as { templateId?: unknown }).templateId
  return typeof candidate === 'string' ? candidate : null
}

export function getAbsoluteNodePosition(node: Node, nodes: readonly Node[]): XYPosition {
  return absolutePosition(node, new Map(nodes.map((candidate) => [candidate.id, candidate])))
}

export const findTargetContainer = (
  nodes: readonly Node[],
  position: XYPosition,
  excludeNodeId?: string,
  childTemplateId?: string | null
): Node | undefined => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const intersectingContainers = nodes.filter((node) => {
    if (node.type !== 'vpcNode' || node.id === excludeNodeId) return false
    if (!validatePlacement(childTemplateId, getTemplateId(node)).valid) return false

    const absolute = absolutePosition(node, byId)
    return (
      position.x > absolute.x &&
      position.x < absolute.x + (node.width || 0) &&
      position.y > absolute.y &&
      position.y < absolute.y + (node.height || 0)
    )
  })

  intersectingContainers.sort((a, b) => {
    const areaA = (a.width || 0) * (a.height || 0)
    const areaB = (b.width || 0) * (b.height || 0)
    return areaA - areaB
  })

  return intersectingContainers[0]
}

export const recomputeContainment = (nodes: Node[]): Node[] => {
  const containers = nodes.filter((node) => node.type === 'vpcNode')
  if (containers.length === 0) return nodes

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const absById = new Map(nodes.map((node) => [node.id, absolutePosition(node, byId)]))

  const centerOf = (node: Node): XYPosition => {
    const position = absById.get(node.id) as XYPosition
    return { x: position.x + (node.width ?? 0) / 2, y: position.y + (node.height ?? 0) / 2 }
  }

  const containsCenter = (container: Node, point: XYPosition): boolean => {
    const position = absById.get(container.id) as XYPosition
    return (
      point.x > position.x &&
      point.x < position.x + (container.width ?? 0) &&
      point.y > position.y &&
      point.y < position.y + (container.height ?? 0)
    )
  }

  // Parent links as decided so far in this pass. Each choice is checked against
  // it, not just the incoming graph: two containers that each hold the other's
  // center would otherwise pick each other, and React Flow's parent walk
  // overflows the stack on the cycle (#127).
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentNode]))
  const isSelfOrDescendant = (candidateId: string, nodeId: string): boolean => {
    const seen = new Set<string>()
    for (let p: string | undefined = candidateId; p && !seen.has(p); p = parentOf.get(p)) {
      if (p === nodeId) return true
      seen.add(p)
    }
    return false
  }

  let changed = false
  const next = nodes.map((node) => {
    const center = centerOf(node)
    const childTemplateId = getTemplateId(node)
    const candidates = containers
      .filter((container) => {
        if (isSelfOrDescendant(container.id, node.id)) return false
        if (!containsCenter(container, center)) return false
        return validatePlacement(childTemplateId, getTemplateId(container)).valid
      })
      .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))

    const desiredParentId = candidates[0]?.id
    parentOf.set(node.id, desiredParentId)
    if ((node.parentNode ?? undefined) === desiredParentId) return node

    changed = true
    const nodeAbs = absById.get(node.id) as XYPosition
    if (desiredParentId) {
      const parentAbs = absById.get(desiredParentId) as XYPosition
      return {
        ...node,
        parentNode: desiredParentId,
        expandParent: false,
        extent: undefined,
        zIndex: node.type === 'vpcNode' ? 1 : 10,
        position: { x: nodeAbs.x - parentAbs.x, y: nodeAbs.y - parentAbs.y }
      }
    }

    return {
      ...node,
      parentNode: undefined,
      extent: undefined,
      zIndex: 0,
      position: { x: nodeAbs.x, y: nodeAbs.y }
    }
  })

  return changed ? next : nodes
}
