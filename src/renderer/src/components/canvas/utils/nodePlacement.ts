import type { Node, XYPosition } from 'reactflow'
import { validatePlacement } from '@renderer/config/hierarchyRules'
import {
  getPaletteTemplate,
  instantiateTemplate
} from '../../../../../engine/catalog/paletteTemplates'
import { findTargetContainer, getAbsoluteNodePosition, getId } from './canvasUtils'

/**
 * Node placement shared by library drag-and-drop, tap-to-place, and the
 * contextual "Add inside" / "Add connected" actions, so every path creates
 * nodes the same way (template data, parenting, z-order, hierarchy rules).
 */

export const DEFAULT_COMPONENT_SIZE = { width: 256, height: 120 }
export const DEFAULT_CONTAINER_SIZE = { width: 200, height: 200 }
const CONTAINER_PADDING = 24
/** Room for the container's header (icon, label, actions) above its children. */
const CONTAINER_HEADER = 56
const SLOT_GAP = 24
const CONNECTED_GAP_X = 140
const CONNECTED_GAP_Y = 40
const MAX_SLOT_ROWS = 60

export interface Size {
  width: number
  height: number
}

export function nodeTemplateId(node: Node | undefined): string | null {
  if (!node || typeof node.data !== 'object' || node.data === null) return null
  const candidate = (node.data as { templateId?: unknown }).templateId
  return typeof candidate === 'string' ? candidate : null
}

export function isContainerNode(node: Node | undefined): boolean {
  return node?.type === 'containerNode'
}

function styleDimension(node: Node, key: 'width' | 'height'): number | undefined {
  const value = (node.style as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Measured size when React Flow has it, then the styled size, then a default. */
export function nodeSize(node: Node): Size {
  const fallback = isContainerNode(node) ? DEFAULT_CONTAINER_SIZE : DEFAULT_COMPONENT_SIZE
  return {
    width: node.width ?? styleDimension(node, 'width') ?? fallback.width,
    height: node.height ?? styleDimension(node, 'height') ?? fallback.height
  }
}

export function templateSize(type: string): Size {
  return type === 'containerNode' ? DEFAULT_CONTAINER_SIZE : DEFAULT_COMPONENT_SIZE
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function overlaps(a: Rect, b: Rect, margin = 12): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin &&
    a.y + a.height + margin > b.y
  )
}

/** Placement validity for a template inside a container (or the root canvas). */
export function canPlaceTemplateIn(templateId: string, container: Node | undefined): boolean {
  return validatePlacement(templateId, container ? nodeTemplateId(container) : null).valid
}

/**
 * Templates that make sense as the far end of a new connection: not a source
 * (sources only send traffic) and not a container (containers carry no traffic).
 */
export function isConnectableTargetTemplate(templateId: string): boolean {
  const template = getPaletteTemplate(templateId)
  if (!template) return false
  if (template.rendererType === 'containerNode') return false
  if (template.structuralRole === 'composite' || template.structuralRole === 'source') return false
  return template.profile !== 'source'
}

/**
 * First free grid slot inside a container, in the container's own coordinates.
 * Columns follow the container's current width; when every slot in view is
 * taken, the slot lands on a new row below and the container grows to fit.
 */
export function findFreeChildSlot(
  container: Node,
  nodes: readonly Node[],
  childSize: Size
): XYPosition {
  const containerSize = nodeSize(container)
  const children = nodes
    .filter((node) => node.parentNode === container.id)
    .map((node) => ({ ...node.position, ...nodeSize(node) }))
  const columns = Math.max(
    1,
    Math.floor((containerSize.width - CONTAINER_PADDING) / (childSize.width + SLOT_GAP))
  )

  for (let row = 0; row < MAX_SLOT_ROWS; row++) {
    for (let column = 0; column < columns; column++) {
      const candidate = {
        x: CONTAINER_PADDING + column * (childSize.width + SLOT_GAP),
        y: CONTAINER_HEADER + row * (childSize.height + SLOT_GAP),
        ...childSize
      }
      if (!children.some((child) => overlaps(candidate, child))) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }

  const lowest = children.reduce((max, child) => Math.max(max, child.y + child.height), 0)
  return { x: CONTAINER_PADDING, y: lowest + SLOT_GAP }
}

/**
 * Absolute position for a node connected downstream of `source`: to its right,
 * stepping down past anything already there.
 */
export function findConnectedSlot(
  source: Node,
  nodes: readonly Node[],
  childSize: Size
): XYPosition {
  const sourcePosition = getAbsoluteNodePosition(source, nodes)
  const sourceSize = nodeSize(source)
  const occupied = nodes
    .filter((node) => !isContainerNode(node) && node.id !== source.id)
    .map((node) => ({ ...getAbsoluteNodePosition(node, nodes), ...nodeSize(node) }))
  const x = sourcePosition.x + sourceSize.width + CONNECTED_GAP_X

  for (let step = 0; step < MAX_SLOT_ROWS; step++) {
    const candidate = {
      x,
      y: sourcePosition.y + step * (childSize.height + CONNECTED_GAP_Y),
      ...childSize
    }
    if (!occupied.some((rect) => overlaps(candidate, rect))) {
      return { x: candidate.x, y: candidate.y }
    }
  }
  return { x, y: sourcePosition.y }
}

function uniqueNodeId(nodes: readonly Node[]): string {
  const taken = new Set(nodes.map((node) => node.id))
  let id = getId()
  while (taken.has(id)) id = getId()
  return id
}

/** Container z-order follows nesting depth, matching the store's addNode rule. */
function containerZIndex(nodes: readonly Node[], parentId: string | undefined): number {
  if (!parentId) return -10
  const parent = nodes.find((node) => node.id === parentId)
  return (parent?.zIndex ?? -10) + 1
}

export interface PlacementPlan {
  ok: true
  container: Node | undefined
}

export type PlacementResult = PlacementPlan | { ok: false; error: string }

/**
 * Decide which container a template dropped at `position` belongs to. An explicit
 * container (the "Add inside" action) wins; otherwise it is the innermost valid
 * container under the point, as with drag-and-drop.
 */
export function resolvePlacement(
  nodes: readonly Node[],
  templateId: string,
  position: XYPosition,
  explicitContainer?: Node
): PlacementResult {
  const container = explicitContainer ?? findTargetContainer(nodes, position, undefined, templateId)
  const validation = validatePlacement(templateId, container ? nodeTemplateId(container) : null)
  if (!validation.valid) {
    return { ok: false, error: validation.error ?? 'Invalid placement.' }
  }
  return { ok: true, container }
}

/** Build the node for a template at an absolute canvas position. */
export function createPlacedNode(
  nodes: readonly Node[],
  type: string,
  templateId: string,
  absolutePosition: XYPosition,
  container: Node | undefined
): Node {
  const node: Node = {
    id: uniqueNodeId(nodes),
    type,
    position: absolutePosition,
    data: instantiateTemplate(templateId)
  }
  if (type === 'containerNode') node.zIndex = containerZIndex(nodes, container?.id)

  if (container) {
    const containerPosition = getAbsoluteNodePosition(container, nodes)
    node.parentNode = container.id
    node.extent = 'parent'
    if (type !== 'containerNode') node.zIndex = 10
    node.position = {
      x: absolutePosition.x - containerPosition.x,
      y: absolutePosition.y - containerPosition.y
    }
  }
  return node
}

/**
 * Grow `child`'s ancestor containers so the child sits fully inside each one.
 * Containment is decided by the child's center, so a container that is too
 * small would silently drop the child on the next layout pass.
 */
export function fitContainersToChild(nodes: readonly Node[], childId: string): Node[] {
  const next = [...nodes]
  const indexById = new Map(next.map((node, index) => [node.id, index]))
  let child = next[indexById.get(childId) ?? -1]
  const seen = new Set<string>()

  while (child?.parentNode && !seen.has(child.parentNode)) {
    seen.add(child.parentNode)
    const parentIndex = indexById.get(child.parentNode)
    if (parentIndex === undefined) break
    const parent = next[parentIndex]
    const parentSize = nodeSize(parent)
    const childSize = nodeSize(child)
    const neededWidth = child.position.x + childSize.width + CONTAINER_PADDING
    const neededHeight = child.position.y + childSize.height + CONTAINER_PADDING
    if (neededWidth > parentSize.width || neededHeight > parentSize.height) {
      const width = Math.max(parentSize.width, neededWidth)
      const height = Math.max(parentSize.height, neededHeight)
      next[parentIndex] = {
        ...parent,
        width,
        height,
        style: { ...parent.style, width, height }
      }
    }
    child = next[parentIndex]
  }
  return next
}
