import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  internalsSymbol,
  Position,
  type Edge,
  type HandleElement,
  type Node
} from 'reactflow'
import type { EdgeRoutingStyle } from '@renderer/types/ui'

interface EdgePathInput {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
}

export interface EdgePathPoint {
  x: number
  y: number
}

export interface EdgePathGeometry extends EdgePathInput {
  path: string
  labelX: number
  labelY: number
  /** Route vertices when the geometry is a polyline. Curved routes omit this. */
  points?: EdgePathPoint[]
}

const OCTILINEAR_STUB_LENGTH = 24
const EPSILON = 0.001

function offsetFromPort(point: EdgePathPoint, position: Position, distance: number): EdgePathPoint {
  switch (position) {
    case Position.Top:
      return { x: point.x, y: point.y - distance }
    case Position.Right:
      return { x: point.x + distance, y: point.y }
    case Position.Bottom:
      return { x: point.x, y: point.y + distance }
    case Position.Left:
      return { x: point.x - distance, y: point.y }
  }
}

function samePoint(a: EdgePathPoint, b: EdgePathPoint): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

function isRedundantMiddlePoint(
  before: EdgePathPoint,
  current: EdgePathPoint,
  after: EdgePathPoint
): boolean {
  const ax = current.x - before.x
  const ay = current.y - before.y
  const bx = after.x - current.x
  const by = after.y - current.y
  return Math.abs(ax * by - ay * bx) < EPSILON && ax * bx + ay * by >= 0
}

function simplifyPolyline(points: EdgePathPoint[]): EdgePathPoint[] {
  const deduplicated = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1])
  )
  const simplified: EdgePathPoint[] = []

  for (const point of deduplicated) {
    while (
      simplified.length >= 2 &&
      isRedundantMiddlePoint(
        simplified[simplified.length - 2],
        simplified[simplified.length - 1],
        point
      )
    ) {
      simplified.pop()
    }
    simplified.push(point)
  }

  return simplified
}

function connectOctilinearly(from: EdgePathPoint, to: EdgePathPoint): EdgePathPoint[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (absX < EPSILON || absY < EPSILON || Math.abs(absX - absY) < EPSILON) {
    return [from, to]
  }

  if (absX > absY) {
    return [from, { x: from.x + Math.sign(dx) * (absX - absY), y: from.y }, to]
  }

  return [from, { x: from.x, y: from.y + Math.sign(dy) * (absY - absX) }, to]
}

/** Produces a polyline containing only horizontal, vertical, and 45° segments. */
export function getOctilinearPoints(input: EdgePathInput): EdgePathPoint[] {
  const source = { x: input.sourceX, y: input.sourceY }
  const target = { x: input.targetX, y: input.targetY }
  const distance = Math.hypot(target.x - source.x, target.y - source.y)
  const stubLength = Math.min(OCTILINEAR_STUB_LENGTH, distance / 4)
  const sourceStub = offsetFromPort(source, input.sourcePosition, stubLength)
  const targetStub = offsetFromPort(target, input.targetPosition, stubLength)
  const middle = connectOctilinearly(sourceStub, targetStub)

  return simplifyPolyline([source, ...middle, target])
}

function midpointAlongPolyline(points: EdgePathPoint[]): EdgePathPoint {
  const segments = points.slice(1).map((point, index) => ({
    from: points[index],
    to: point,
    length: Math.hypot(point.x - points[index].x, point.y - points[index].y)
  }))
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0)
  let remaining = totalLength / 2

  for (const segment of segments) {
    if (remaining <= segment.length && segment.length > 0) {
      const fraction = remaining / segment.length
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * fraction,
        y: segment.from.y + (segment.to.y - segment.from.y) * fraction
      }
    }
    remaining -= segment.length
  }

  return points[points.length - 1] ?? { x: 0, y: 0 }
}

function octilinearPath(
  input: EdgePathInput
): Pick<EdgePathGeometry, 'path' | 'labelX' | 'labelY' | 'points'> {
  const points = getOctilinearPoints(input)
  const label = midpointAlongPolyline(points)
  return {
    path: points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x},${point.y}`)
      .join(' '),
    labelX: label.x,
    labelY: label.y,
    points
  }
}

/** The one path generator used by normal edges, connection previews, and traces. */
export function getCanvasEdgePath(
  input: EdgePathInput,
  routingStyle: EdgeRoutingStyle
): EdgePathGeometry {
  if (routingStyle === 'octilinear') {
    return { ...input, ...octilinearPath(input) }
  }

  const [path, labelX, labelY] = (() => {
    switch (routingStyle) {
      case 'straight':
        return getStraightPath(input)
      case 'orthogonal':
        return getSmoothStepPath({ ...input, borderRadius: 0 })
      case 'rounded':
        return getSmoothStepPath({ ...input, borderRadius: 16 })
      case 'bezier':
        return getBezierPath(input)
    }
  })()

  return { ...input, path, labelX, labelY }
}

function findHandle(
  handles: HandleElement[] | null | undefined,
  handleId: string | null | undefined
): HandleElement | null {
  if (!handles || handles.length === 0) return null
  if (handles.length === 1 || !handleId) return handles[0]
  return handles.find((handle) => handle.id === handleId) ?? null
}

function handlePosition(
  node: Node,
  handle: HandleElement
): { x: number; y: number; position: Position } | null {
  const absolute = node.positionAbsolute ?? node.position
  const nodeWidth = node.width ?? 0
  const nodeHeight = node.height ?? 0
  if (nodeWidth <= 0 || nodeHeight <= 0) return null

  const x = absolute.x + (handle.x ?? 0)
  const y = absolute.y + (handle.y ?? 0)
  const width = handle.width || nodeWidth
  const height = handle.height || nodeHeight

  switch (handle.position) {
    case Position.Top:
      return { x: x + width / 2, y, position: handle.position }
    case Position.Right:
      return { x: x + width, y: y + height / 2, position: handle.position }
    case Position.Bottom:
      return { x: x + width / 2, y: y + height, position: handle.position }
    case Position.Left:
      return { x, y: y + height / 2, position: handle.position }
  }
}

/**
 * Reconstructs the exact React Flow handle coordinates for a stored edge. This
 * lets the request tracer generate the same SVG path as PacketEdge instead of a
 * visually similar, independently-calculated center-to-center route.
 */
export function resolveStoredEdgePath(
  edge: Edge,
  sourceNode: Node | undefined,
  targetNode: Node | undefined,
  routingStyle: EdgeRoutingStyle
): EdgePathGeometry | null {
  const sourceBounds = sourceNode?.[internalsSymbol]?.handleBounds
  const targetBounds = targetNode?.[internalsSymbol]?.handleBounds
  if (!sourceNode || !targetNode || !sourceBounds || !targetBounds) return null

  const sourceHandle = findHandle(sourceBounds.source, edge.sourceHandle)
  const targetHandle =
    findHandle(targetBounds.target, edge.targetHandle) ??
    findHandle(targetBounds.source, edge.targetHandle)
  if (!sourceHandle || !targetHandle) return null

  const source = handlePosition(sourceNode, sourceHandle)
  const target = handlePosition(targetNode, targetHandle)
  if (!source || !target) return null

  return getCanvasEdgePath(
    {
      sourceX: source.x,
      sourceY: source.y,
      targetX: target.x,
      targetY: target.y,
      sourcePosition: source.position,
      targetPosition: target.position
    },
    routingStyle
  )
}
