import type {
  ELK as ElkApi,
  ElkEdgeSection,
  ElkExtendedEdge,
  ElkNode,
  ElkPoint
} from 'elkjs/lib/elk-api'
import { Position, type Edge, type Node } from 'reactflow'
import type { EdgeLayoutRoute, EdgeSimulationData } from '@renderer/types/ui'

const ROOT_GROUP = '__root__'
const ROOT_MARGIN_X = 80
const ROOT_MARGIN_Y = 80
const CHILD_MARGIN_X = 40
const CHILD_MARGIN_Y = 40
const COLUMN_GAP = 200
const ROW_GAP = 80
const DEFAULT_NODE_WIDTH = 220
const DEFAULT_NODE_HEIGHT = 140
const CONTAINER_PADDING = 40
const CONTAINER_HEADER = 56
const HANDLE_OFFSETS = [0.25, 0.5, 0.75] as const
const TEXT_LABEL_NODE_TYPE = 'textLabelNode'

let elkPromise: Promise<ElkApi> | undefined

async function getLayoutEngine(): Promise<ElkApi> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then(
    ({ default: ElkConstructor }) => new ElkConstructor()
  )
  return elkPromise
}

type GroupKey = string

interface NodeGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface AutoLayoutResult {
  nodes: Node[]
  edges: Edge[]
}

function styleDimension(node: Node, dimension: 'width' | 'height'): number | undefined {
  const value = node.style?.[dimension]
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getNodeWidth(node: Node): number {
  return node.width ?? styleDimension(node, 'width') ?? DEFAULT_NODE_WIDTH
}

function getNodeHeight(node: Node): number {
  return node.height ?? styleDimension(node, 'height') ?? DEFAULT_NODE_HEIGHT
}

function compareNodes(a: Node, b: Node): number {
  if (a.position.y !== b.position.y) return a.position.y - b.position.y
  if (a.position.x !== b.position.x) return a.position.x - b.position.x

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

function isLayoutNode(node: Node): boolean {
  return node.type !== TEXT_LABEL_NODE_TYPE && !node.hidden
}

function buildElkNode(node: Node, childrenByParent: Map<string, Node[]>): ElkNode {
  const children = (childrenByParent.get(node.id) ?? [])
    .sort(compareNodes)
    .map((child) => buildElkNode(child, childrenByParent))
  const hasChildren = children.length > 0

  return {
    id: node.id,
    width: getNodeWidth(node),
    height: getNodeHeight(node),
    ...(hasChildren ? { children } : {}),
    layoutOptions: hasChildren
      ? {
          'elk.padding': `[top=${CONTAINER_HEADER},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`
        }
      : undefined
  }
}

function buildElkGraph(nodes: Node[], edges: Edge[]): ElkNode {
  const layoutNodes = nodes.filter(isLayoutNode)
  const nodeIds = new Set(layoutNodes.map((node) => node.id))
  const childrenByParent = new Map<string, Node[]>()

  for (const node of layoutNodes) {
    const parentId = node.parentNode && nodeIds.has(node.parentNode) ? node.parentNode : ROOT_GROUP
    const siblings = childrenByParent.get(parentId)
    if (siblings) siblings.push(node)
    else childrenByParent.set(parentId, [node])
  }

  const elkEdges: ElkExtendedEdge[] = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }))

  return {
    id: ROOT_GROUP,
    children: (childrenByParent.get(ROOT_GROUP) ?? [])
      .sort(compareNodes)
      .map((node) => buildElkNode(node, childrenByParent)),
    edges: elkEdges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '120',
      'elk.spacing.nodeNode': '80',
      'elk.spacing.edgeEdge': '20',
      'elk.spacing.edgeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '160',
      'elk.layered.spacing.edgeNodeBetweenLayers': '50',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '24',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.compaction.connectedComponents': 'true',
      'elk.layered.thoroughness': '20',
      'elk.randomSeed': '1'
    }
  }
}

function collectNodeLayout(
  elkNodes: ElkNode[] | undefined,
  originalById: Map<string, Node>,
  nextById: Map<string, Node>,
  geometryById: Map<string, NodeGeometry>,
  parentAbsolute = { x: ROOT_MARGIN_X, y: ROOT_MARGIN_Y },
  rootLevel = true
): void {
  for (const elkNode of elkNodes ?? []) {
    const original = originalById.get(elkNode.id)
    if (!original) continue

    const relativeX = elkNode.x ?? 0
    const relativeY = elkNode.y ?? 0
    const position = rootLevel
      ? { x: ROOT_MARGIN_X + relativeX, y: ROOT_MARGIN_Y + relativeY }
      : { x: relativeX, y: relativeY }
    const absolute = rootLevel
      ? position
      : { x: parentAbsolute.x + relativeX, y: parentAbsolute.y + relativeY }
    const width = elkNode.width ?? getNodeWidth(original)
    const height = elkNode.height ?? getNodeHeight(original)
    const hasChildren = (elkNode.children?.length ?? 0) > 0

    nextById.set(elkNode.id, {
      ...original,
      position,
      ...(hasChildren ? { style: { ...original.style, width, height } } : {})
    })
    geometryById.set(elkNode.id, { ...absolute, width, height })

    collectNodeLayout(elkNode.children, originalById, nextById, geometryById, absolute, false)
  }
}

function sectionPoints(sections: ElkEdgeSection[] | undefined): ElkPoint[] {
  if (!sections || sections.length === 0) return []

  const byId = new Map(sections.map((section) => [section.id, section]))
  let section: ElkEdgeSection | undefined =
    sections.find((candidate) => !candidate.incomingSections?.length) ?? sections[0]
  const points: ElkPoint[] = []
  const visited = new Set<string>()

  while (section && !visited.has(section.id)) {
    visited.add(section.id)
    const current = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
    if (points.length > 0) current.shift()
    points.push(...current)
    const nextId = section.outgoingSections?.[0]
    section = nextId ? byId.get(nextId) : undefined
  }

  return points
}

function translatePoint(point: ElkPoint): ElkPoint {
  return { x: point.x + ROOT_MARGIN_X, y: point.y + ROOT_MARGIN_Y }
}

function nearestSide(point: ElkPoint, geometry: NodeGeometry): Position {
  const distances: Array<[Position, number]> = [
    [Position.Left, Math.abs(point.x - geometry.x)],
    [Position.Right, Math.abs(point.x - (geometry.x + geometry.width))],
    [Position.Top, Math.abs(point.y - geometry.y)],
    [Position.Bottom, Math.abs(point.y - (geometry.y + geometry.height))]
  ]
  distances.sort((left, right) => left[1] - right[1])
  return distances[0][0]
}

function nearestHandleIndex(point: ElkPoint, side: Position, geometry: NodeGeometry): number {
  const ratio =
    side === Position.Left || side === Position.Right
      ? (point.y - geometry.y) / geometry.height
      : (point.x - geometry.x) / geometry.width

  return HANDLE_OFFSETS.reduce(
    (best, offset, index) =>
      Math.abs(offset - ratio) < Math.abs(HANDLE_OFFSETS[best] - ratio) ? index : best,
    0
  )
}

function handleAnchor(side: Position, index: number, geometry: NodeGeometry): ElkPoint {
  const offset = HANDLE_OFFSETS[index] ?? HANDLE_OFFSETS[1]
  switch (side) {
    case Position.Left:
      return { x: geometry.x, y: geometry.y + geometry.height * offset }
    case Position.Right:
      return { x: geometry.x + geometry.width, y: geometry.y + geometry.height * offset }
    case Position.Top:
      return { x: geometry.x + geometry.width * offset, y: geometry.y }
    case Position.Bottom:
      return { x: geometry.x + geometry.width * offset, y: geometry.y + geometry.height }
  }
}

function edgeWithLayoutRoute(
  edge: Edge,
  elkEdge: ElkExtendedEdge | undefined,
  geometryById: Map<string, NodeGeometry>
): Edge {
  const sourceGeometry = geometryById.get(edge.source)
  const targetGeometry = geometryById.get(edge.target)
  const points = sectionPoints(elkEdge?.sections).map(translatePoint)
  if (!sourceGeometry || !targetGeometry || points.length < 2) return edge

  const sourceSide = nearestSide(points[0], sourceGeometry)
  const targetSide = nearestSide(points[points.length - 1], targetGeometry)
  const sourceIndex = nearestHandleIndex(points[0], sourceSide, sourceGeometry)
  const targetIndex = nearestHandleIndex(points[points.length - 1], targetSide, targetGeometry)
  const route: EdgeLayoutRoute = {
    source: handleAnchor(sourceSide, sourceIndex, sourceGeometry),
    target: handleAnchor(targetSide, targetIndex, targetGeometry),
    bends: points.slice(1, -1)
  }

  return {
    ...edge,
    sourceHandle: `${sourceSide}-${sourceIndex}-source`,
    targetHandle: `${targetSide}-${targetIndex}-target`,
    data: { ...((edge.data ?? {}) as EdgeSimulationData), layoutRoute: route }
  }
}

/**
 * Produces a hierarchy-aware, deterministic architecture-diagram layout. ELK
 * places nodes and containers, minimizes crossings, selects sensible sides for
 * each connection, and supplies obstacle-avoiding orthogonal edge routes.
 */
export async function applyAutoLayout(nodes: Node[], edges: Edge[]): Promise<AutoLayoutResult> {
  if (nodes.filter(isLayoutNode).length === 0) return { nodes, edges }

  const elk = await getLayoutEngine()
  const laidOutGraph = await elk.layout(buildElkGraph(nodes, edges))
  const originalById = new Map(nodes.map((node) => [node.id, node]))
  const nextById = new Map<string, Node>()
  const geometryById = new Map<string, NodeGeometry>()
  collectNodeLayout(laidOutGraph.children, originalById, nextById, geometryById)

  const elkEdgeById = new Map((laidOutGraph.edges ?? []).map((edge) => [edge.id, edge]))
  return {
    nodes: nodes.map((node) => nextById.get(node.id) ?? node),
    edges: edges.map((edge) => edgeWithLayoutRoute(edge, elkEdgeById.get(edge.id), geometryById))
  }
}

/** Synchronous import fallback; the canvas action applies the full ELK layout. */
export function applyFallbackAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const groups = new Map<GroupKey, Node[]>()
  for (const node of nodes) {
    const groupKey = node.parentNode ?? ROOT_GROUP
    const bucket = groups.get(groupKey)
    if (bucket) bucket.push(node)
    else groups.set(groupKey, [node])
  }

  const laidOutById = new Map<string, Node>()
  for (const [groupKey, groupNodes] of groups.entries()) {
    const groupNodeIds = new Set(groupNodes.map((node) => node.id))
    const groupEdges = edges.filter(
      (edge) => groupNodeIds.has(edge.source) && groupNodeIds.has(edge.target)
    )
    const levels = buildLevels(groupNodes, groupEdges)
    const nodeById = new Map(groupNodes.map((node) => [node.id, node]))
    let x = groupKey === ROOT_GROUP ? ROOT_MARGIN_X : CHILD_MARGIN_X

    for (const level of levels) {
      let y = groupKey === ROOT_GROUP ? ROOT_MARGIN_Y : CHILD_MARGIN_Y
      let columnWidth = 0
      for (const nodeId of level) {
        const node = nodeById.get(nodeId)
        if (!node) continue
        laidOutById.set(nodeId, { ...node, position: { x, y } })
        columnWidth = Math.max(columnWidth, getNodeWidth(node))
        y += getNodeHeight(node) + ROW_GAP
      }
      x += columnWidth + COLUMN_GAP
    }
  }

  return nodes.map((node) => laidOutById.get(node.id) ?? node)
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
    if (!currentId || visited.has(currentId)) continue
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
      if (visited.has(node.id)) continue
      fallbackLevel += 1
      levelById.set(node.id, fallbackLevel)
    }
  }

  const levels = new Map<number, string[]>()
  for (const node of nodes) {
    const level = levelById.get(node.id) ?? 0
    const bucket = levels.get(level)
    if (bucket) bucket.push(node.id)
    else levels.set(level, [node.id])
  }

  const entries = [...levels.entries()].sort((a, b) => a[0] - b[0])
  return entries.map(([, ids], levelIndex) => {
    if (levelIndex === 0) {
      return ids.sort((leftId, rightId) =>
        compareNodes(nodeById.get(leftId) as Node, nodeById.get(rightId) as Node)
      )
    }

    const previousIds = entries[levelIndex - 1]?.[1] ?? []
    const previousIndex = new Map(previousIds.map((id, index) => [id, index]))
    return ids.sort((leftId, rightId) => {
      const score = (id: string): number => {
        const parents = incomingParents.get(id) ?? []
        return parents.length > 0
          ? parents.reduce((sum, parentId) => sum + (previousIndex.get(parentId) ?? 0), 0) /
              parents.length
          : Number.MAX_SAFE_INTEGER
      }
      return (
        score(leftId) - score(rightId) ||
        compareNodes(nodeById.get(leftId) as Node, nodeById.get(rightId) as Node)
      )
    })
  })
}
