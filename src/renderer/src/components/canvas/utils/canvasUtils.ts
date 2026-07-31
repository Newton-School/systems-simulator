import { Node, XYPosition } from 'reactflow'

let id = 1
export const getId = () => `node_${id++}`

/**
 * Resolves a node's absolute (world) position by walking its parent chain and
 * accumulating each ancestor's offset. React Flow stores child positions
 * relative to their parent, so containment maths must be done in world space.
 */
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

/** Ids of every node nested (transitively) under `rootId`. */
function descendantIds(rootId: string, nodes: Node[]): Set<string> {
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

/**
 * Re-derives every node's container membership from geometry using CENTER-INSIDE
 * semantics: a node belongs to the smallest (deepest) VPC container whose bounds
 * contain the node's center. Nodes whose center is inside no container are
 * released to the top level. Runs after any drag/resize so that both dragging a
 * node into a container AND dragging a container over existing nodes capture
 * correctly. Returns the same array reference when nothing changed.
 */
export const recomputeContainment = (nodes: Node[]): Node[] => {
  const containers = nodes.filter((n) => n.type === 'vpcNode')
  if (containers.length === 0) return nodes

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const absById = new Map(nodes.map((n) => [n.id, absolutePosition(n, byId)]))

  const centerOf = (n: Node): XYPosition => {
    const pos = absById.get(n.id) as XYPosition
    return { x: pos.x + (n.width ?? 0) / 2, y: pos.y + (n.height ?? 0) / 2 }
  }
  const containsCenter = (container: Node, point: XYPosition): boolean => {
    const pos = absById.get(container.id) as XYPosition
    return (
      point.x > pos.x &&
      point.x < pos.x + (container.width ?? 0) &&
      point.y > pos.y &&
      point.y < pos.y + (container.height ?? 0)
    )
  }

  let changed = false
  const next = nodes.map((node) => {
    const center = centerOf(node)
    const forbidden = descendantIds(node.id, nodes)
    const candidates = containers
      .filter((c) => c.id !== node.id && !forbidden.has(c.id) && containsCenter(c, center))
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

/**
 * Finds the smallest VPC node that intersects with the given position.
 * Prioritizes innermost nested VPCs by sorting by area.
 */
export const findTargetVpc = (
  nodes: Node[],
  position: XYPosition,
  excludeNodeId?: string
): Node | undefined => {
  const intersectingVpcs = nodes.filter(
    (n) =>
      n.type === 'vpcNode' &&
      n.id !== excludeNodeId && // Don't match self
      position.x > n.position.x &&
      position.x < n.position.x + (n.width || 0) &&
      position.y > n.position.y &&
      position.y < n.position.y + (n.height || 0)
  )

  // Sort by Area (Width * Height) ascending -> Smallest First
  intersectingVpcs.sort((a, b) => {
    const areaA = (a.width || 0) * (a.height || 0)
    const areaB = (b.width || 0) * (b.height || 0)
    return areaA - areaB
  })

  return intersectingVpcs[0]
}
