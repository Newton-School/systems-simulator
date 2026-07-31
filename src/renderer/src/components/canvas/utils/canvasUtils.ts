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

function descendantIds(rootId: string, nodes: readonly Node[]): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentNode) continue
    const list = childrenByParent.get(node.parentNode)
    if (list) list.push(node.id)
    else childrenByParent.set(node.parentNode, [node.id])
  }

  const out = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const child of childrenByParent.get(current) ?? []) {
      if (!out.has(child)) {
        out.add(child)
        stack.push(child)
      }
    }
  }

  return out
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

  let changed = false
  const next = nodes.map((node) => {
    const center = centerOf(node)
    const forbidden = descendantIds(node.id, nodes)
    const childTemplateId = getTemplateId(node)
    const candidates = containers
      .filter((container) => {
        if (container.id === node.id || forbidden.has(container.id)) return false
        if (!containsCenter(container, center)) return false
        return validatePlacement(childTemplateId, getTemplateId(container)).valid
      })
      .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))

    const desiredParentId = candidates[0]?.id
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
