import { addEdge, type Edge, type Node } from 'reactflow'
import { checkCanvasConnection, isConnectableNode, isSinkOnlyNode } from './connectionRules'
import {
  canPlaceTemplateIn,
  createPlacedNode,
  findConnectedSlot,
  findFreeChildSlot,
  fitContainersToChild,
  isConnectableTargetTemplate,
  isContainerNode,
  resolvePlacement,
  templateSize
} from './nodePlacement'
import { getAbsoluteNodePosition } from './canvasUtils'

/**
 * "Add inside" (a child of a Region / Availability Zone / Subnet) and "Add
 * connected" (a new downstream component wired to the selected one). Both reuse
 * the drag-and-drop placement path and return the whole next graph, so the
 * caller commits it as a single undo step.
 */

export type ContextualAddMode = 'child' | 'connected'

export interface ContextualAddRequest {
  mode: ContextualAddMode
  anchorNodeId: string
}

/** Which contextual add actions a node offers. */
export function contextualAddModesFor(node: Node | undefined): ContextualAddMode[] {
  if (!node) return []
  if (isContainerNode(node)) return ['child']
  if (isConnectableNode(node) && !isSinkOnlyNode(node)) return ['connected']
  return []
}

/** Whether a library template is offered by the picker for this anchor. */
export function isTemplateOfferedFor(
  mode: ContextualAddMode,
  anchor: Node | undefined,
  templateId: string
): boolean {
  if (!anchor) return false
  if (mode === 'child') return isContainerNode(anchor) && canPlaceTemplateIn(templateId, anchor)
  return isConnectableTargetTemplate(templateId)
}

export type ContextualAddResult =
  | { ok: true; nodes: Node[]; edges: Edge[]; nodeId: string; edgeId?: string }
  | { ok: false; error: string }

function deselected<T extends Node | Edge>(items: readonly T[]): T[] {
  return items.map((item) => (item.selected ? { ...item, selected: false } : item))
}

export function planContextualAdd({
  request,
  type,
  templateId,
  nodes,
  edges
}: {
  request: ContextualAddRequest
  type: string
  templateId: string
  nodes: readonly Node[]
  edges: readonly Edge[]
}): ContextualAddResult {
  const anchor = nodes.find((node) => node.id === request.anchorNodeId)
  if (!anchor) return { ok: false, error: 'That component no longer exists.' }
  const size = templateSize(type)

  if (request.mode === 'child') {
    if (!isContainerNode(anchor)) {
      return { ok: false, error: 'Only Regions, Availability Zones, and Subnets hold components.' }
    }
    const slot = findFreeChildSlot(anchor, nodes, size)
    const containerPosition = getAbsoluteNodePosition(anchor, nodes)
    const absolute = { x: containerPosition.x + slot.x, y: containerPosition.y + slot.y }
    const placement = resolvePlacement(nodes, templateId, absolute, anchor)
    if (placement.ok === false) return { ok: false, error: placement.error }

    const node = { ...createPlacedNode(nodes, type, templateId, absolute, anchor), selected: true }
    return {
      ok: true,
      nodes: fitContainersToChild([...deselected(nodes), node], node.id),
      edges: deselected(edges),
      nodeId: node.id
    }
  }

  if (!isConnectableTargetTemplate(templateId)) {
    return { ok: false, error: 'That component cannot receive a connection.' }
  }
  const absolute = findConnectedSlot(anchor, nodes, size)
  const center = { x: absolute.x + size.width / 2, y: absolute.y + size.height / 2 }
  // Stay in the anchor's container when the hierarchy allows it; otherwise fall
  // back to whatever valid container (or the root canvas) is under the slot.
  const anchorParent = anchor.parentNode
    ? nodes.find((node) => node.id === anchor.parentNode)
    : undefined
  const preferred =
    anchorParent && canPlaceTemplateIn(templateId, anchorParent) ? anchorParent : undefined
  const placement = resolvePlacement(nodes, templateId, center, preferred)
  if (placement.ok === false) return { ok: false, error: placement.error }

  const node = {
    ...createPlacedNode(nodes, type, templateId, absolute, placement.container),
    selected: true
  }
  const nextNodes = [...deselected(nodes), node]
  const connection = {
    source: anchor.id,
    target: node.id,
    sourceHandle: 'right-1-source',
    targetHandle: 'left-1-target'
  }
  const check = checkCanvasConnection({ connection, nodes: nextNodes, edges })
  if (!check.valid) return { ok: false, error: check.error ?? 'That connection is not allowed.' }

  const nextEdges = addEdge(connection, deselected(edges))
  const edge = nextEdges[nextEdges.length - 1]
  return {
    ok: true,
    nodes: fitContainersToChild(nextNodes, node.id),
    edges: nextEdges,
    nodeId: node.id,
    edgeId: edge?.id
  }
}
