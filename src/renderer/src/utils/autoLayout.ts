import type { Edge, Node } from 'reactflow'

const ROOT_GROUP = '__root__'
const ROOT_MARGIN_X = 80
const ROOT_MARGIN_Y = 80
const CHILD_MARGIN_X = 40
const CHILD_MARGIN_Y = 40
const COLUMN_GAP = 200
const ROW_GAP = 80
const DEFAULT_NODE_WIDTH = 220
const DEFAULT_NODE_HEIGHT = 140

type GroupKey = string

function getNodeWidth(node: Node): number {
  return node.width ?? DEFAULT_NODE_WIDTH
}

function getNodeHeight(node: Node): number {
  return node.height ?? DEFAULT_NODE_HEIGHT
}

function compareNodes(a: Node, b: Node): number {
  if (a.position.y !== b.position.y) {
    return a.position.y - b.position.y
  }
  if (a.position.x !== b.position.x) {
    return a.position.x - b.position.x
  }

  const aLabel =
    typeof (a.data as { label?: unknown } | undefined)?.label === 'string'
      ? ((a.data as { label?: string }).label ?? '')
      : ''
  const bLabel =
    typeof (b.data as { label?: unknown } | undefined)?.label === 'string'
      ? ((b.data as { label?: string }).label ?? '')
      : ''

  return aLabel.localeCompare(bLabel) || a.id.localeCompare(b.id)
}

function buildLevels(nodes: Node[], edges: Edge[]): string[][] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  const incomingParents = new Map<string, string[]>()
  const levelById = new Map<string, number>()

  for (const node of nodes) {
    indegree.set(node.id, 0)
    outgoing.set(node.id, [])
    incomingParents.set(node.id, [])
    levelById.set(node.id, 0)
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      continue
    }

    outgoing.get(edge.source)?.push(edge.target)
    incomingParents.get(edge.target)?.push(edge.source)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort(compareNodes)
    .map((node) => node.id)

  const visited = new Set<string>()

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId || visited.has(currentId)) {
      continue
    }
    visited.add(currentId)

    const currentLevel = levelById.get(currentId) ?? 0
    for (const targetId of outgoing.get(currentId) ?? []) {
      levelById.set(targetId, Math.max(levelById.get(targetId) ?? 0, currentLevel + 1))
      indegree.set(targetId, (indegree.get(targetId) ?? 0) - 1)
      if ((indegree.get(targetId) ?? 0) <= 0) {
        queue.push(targetId)
        queue.sort((leftId, rightId) =>
          compareNodes(nodeById.get(leftId) as Node, nodeById.get(rightId) as Node)
        )
      }
    }
  }

  if (visited.size !== nodes.length) {
    let fallbackLevel = Math.max(0, ...Array.from(levelById.values()))
    for (const node of [...nodes].sort(compareNodes)) {
      if (visited.has(node.id)) {
        continue
      }
      fallbackLevel += 1
      levelById.set(node.id, fallbackLevel)
    }
  }

  const levels = new Map<number, string[]>()
  for (const node of nodes) {
    const level = levelById.get(node.id) ?? 0
    const bucket = levels.get(level)
    if (bucket) {
      bucket.push(node.id)
    } else {
      levels.set(level, [node.id])
    }
  }

  const sortedLevels = [...levels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ids], levelIndex, entries) => {
      if (levelIndex === 0) {
        return ids.sort((leftId, rightId) =>
          compareNodes(nodeById.get(leftId) as Node, nodeById.get(rightId) as Node)
        )
      }

      const previousIds = entries[levelIndex - 1]?.[1] ?? []
      const previousIndex = new Map(previousIds.map((id, index) => [id, index]))
      return ids.sort((leftId, rightId) => {
        const leftParents = incomingParents.get(leftId) ?? []
        const rightParents = incomingParents.get(rightId) ?? []

        const leftScore =
          leftParents.length > 0
            ? leftParents.reduce((sum, id) => sum + (previousIndex.get(id) ?? 0), 0) /
              leftParents.length
            : Number.MAX_SAFE_INTEGER
        const rightScore =
          rightParents.length > 0
            ? rightParents.reduce((sum, id) => sum + (previousIndex.get(id) ?? 0), 0) /
              rightParents.length
            : Number.MAX_SAFE_INTEGER

        if (leftScore !== rightScore) {
          return leftScore - rightScore
        }

        return compareNodes(nodeById.get(leftId) as Node, nodeById.get(rightId) as Node)
      })
    })

  return sortedLevels
}

function layoutGroup(nodes: Node[], edges: Edge[], groupKey: GroupKey): Node[] {
  if (nodes.length === 0) {
    return nodes
  }

  const levels = buildLevels(nodes, edges)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const nextPositionById = new Map<string, { x: number; y: number }>()

  let x = groupKey === ROOT_GROUP ? ROOT_MARGIN_X : CHILD_MARGIN_X

  for (const level of levels) {
    let y = groupKey === ROOT_GROUP ? ROOT_MARGIN_Y : CHILD_MARGIN_Y
    let columnWidth = 0

    for (const nodeId of level) {
      const node = nodeById.get(nodeId)
      if (!node) continue

      nextPositionById.set(nodeId, { x, y })
      columnWidth = Math.max(columnWidth, getNodeWidth(node))
      y += getNodeHeight(node) + ROW_GAP
    }

    x += columnWidth + COLUMN_GAP
  }

  return nodes.map((node) => {
    const nextPosition = nextPositionById.get(node.id)
    return nextPosition ? { ...node, position: nextPosition } : node
  })
}

export function applyAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const groups = new Map<GroupKey, Node[]>()

  for (const node of nodes) {
    const groupKey = node.parentNode ?? ROOT_GROUP
    const bucket = groups.get(groupKey)
    if (bucket) {
      bucket.push(node)
    } else {
      groups.set(groupKey, [node])
    }
  }

  const laidOutById = new Map<string, Node>()

  for (const [groupKey, groupNodes] of groups.entries()) {
    const groupNodeIds = new Set(groupNodes.map((node) => node.id))
    const groupEdges = edges.filter(
      (edge) => groupNodeIds.has(edge.source) && groupNodeIds.has(edge.target)
    )

    for (const node of layoutGroup(groupNodes, groupEdges, groupKey)) {
      laidOutById.set(node.id, node)
    }
  }

  return nodes.map((node) => laidOutById.get(node.id) ?? node)
}
