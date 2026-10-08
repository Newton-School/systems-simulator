import type { Connection, Edge, Node } from 'reactflow'
import type { ComponentType, EdgeDefinition } from '../../../../../engine/core/types'
import { inferStructuralRole } from '../../../../../engine/catalog/componentSpecs'
import { isCanvasAnnotationNodeType } from '../../../../../engine/catalog/canvasAnnotations'
import { getEdgeConstraints } from '../../../../../engine/defaults/edgeConstraints'
import {
  getEdgeProtocolPresentation,
  getEdgeModePresentation
} from '@renderer/config/edgeSemantics'
import type { EdgeSimulationData } from '@renderer/types/ui'

/**
 * Canvas connection rules, shared by "draw a new connection" and "drag an
 * existing connection's end to a different component" so both behave the same.
 *
 * Blocking rules mirror what the topology validator treats as meaningless:
 * self-loops, endpoints that are not components (containers, text labels),
 * traffic into a source, traffic out of a sink, and a second connection between
 * the same two components. Protocol and mode fit is advisory (the validator only
 * warns), so a reroute that keeps an explicit protocol or mode that is unusual
 * for the new pair is allowed, with a warning.
 */

export interface ConnectionCheck {
  valid: boolean
  error?: string
  warnings: string[]
}

interface NodeDataLike {
  label?: unknown
  componentType?: unknown
  structuralRole?: unknown
  profile?: unknown
  source?: unknown
}

function dataOf(node: Node | undefined): NodeDataLike {
  return node && typeof node.data === 'object' && node.data !== null
    ? (node.data as NodeDataLike)
    : {}
}

function componentTypeOf(node: Node | undefined): ComponentType | undefined {
  const value = dataOf(node).componentType
  return typeof value === 'string' ? (value as ComponentType) : undefined
}

export function nodeDisplayLabel(node: Node | undefined): string {
  const label = dataOf(node).label
  return typeof label === 'string' && label.trim().length > 0 ? label : 'This component'
}

function structuralRoleOf(node: Node | undefined): string | undefined {
  const data = dataOf(node)
  if (typeof data.structuralRole === 'string') return data.structuralRole
  return inferStructuralRole(componentTypeOf(node))
}

/** Sources only send traffic (Traffic Source, Client, a node carrying a workload). */
export function isSourceOnlyNode(node: Node | undefined): boolean {
  const data = dataOf(node)
  return (
    structuralRoleOf(node) === 'source' ||
    data.profile === 'source' ||
    (typeof data.source === 'object' && data.source !== null)
  )
}

/** Sinks only receive traffic (Output Sink, External Service, alerting hooks). */
export function isSinkOnlyNode(node: Node | undefined): boolean {
  return structuralRoleOf(node) === 'sink'
}

/** Containers and annotations have no connection handles and carry no traffic. */
export function isConnectableNode(node: Node | undefined): boolean {
  if (!node) return false
  if (node.type === 'vpcNode' || isCanvasAnnotationNodeType(node.type)) return false
  return structuralRoleOf(node) !== 'composite'
}

export interface ConnectionCheckInput {
  connection: Pick<Connection, 'source' | 'target'>
  nodes: readonly Node[]
  edges: readonly Edge[]
  /** The edge being rerouted; it is ignored by the duplicate check. */
  ignoreEdgeId?: string
  /** Settings carried over from the rerouted edge, checked for fit (advisory). */
  carriedData?: EdgeSimulationData
}

export function checkCanvasConnection({
  connection,
  nodes,
  edges,
  ignoreEdgeId,
  carriedData
}: ConnectionCheckInput): ConnectionCheck {
  const { source, target } = connection
  if (!source || !target) {
    return { valid: false, error: 'Connect both ends to a component.', warnings: [] }
  }
  if (source === target) {
    return {
      valid: false,
      error:
        'This connection starts and ends on the same component. Connect it to a different component.',
      warnings: []
    }
  }

  const sourceNode = nodes.find((node) => node.id === source)
  const targetNode = nodes.find((node) => node.id === target)
  if (!sourceNode || !targetNode) {
    return { valid: false, error: 'That component no longer exists.', warnings: [] }
  }
  if (!isConnectableNode(sourceNode) || !isConnectableNode(targetNode)) {
    return {
      valid: false,
      error: 'Regions, zones, subnets, and labels cannot be connected. Connect the components.',
      warnings: []
    }
  }
  if (isSourceOnlyNode(targetNode)) {
    return {
      valid: false,
      error: `${nodeDisplayLabel(targetNode)} is a source. Sources only send traffic, so they cannot receive a connection.`,
      warnings: []
    }
  }
  if (isSinkOnlyNode(sourceNode)) {
    return {
      valid: false,
      error: `${nodeDisplayLabel(sourceNode)} only receives traffic, so it cannot start a connection.`,
      warnings: []
    }
  }
  const duplicate = edges.some(
    (edge) => edge.id !== ignoreEdgeId && edge.source === source && edge.target === target
  )
  if (duplicate) {
    return {
      valid: false,
      error: `${nodeDisplayLabel(sourceNode)} is already connected to ${nodeDisplayLabel(targetNode)}.`,
      warnings: []
    }
  }

  const warnings: string[] = []
  if (carriedData) {
    const constraints = getEdgeConstraints(componentTypeOf(sourceNode), componentTypeOf(targetNode))
    const protocol = carriedData.protocol as EdgeDefinition['protocol'] | undefined
    if (protocol && !constraints.allowedProtocols.includes(protocol)) {
      const reason = constraints.reasons.protocol[protocol]
      warnings.push(
        `Kept ${getEdgeProtocolPresentation(protocol).shortLabel} from the original connection.${reason ? ` ${reason}` : ''}`
      )
    }
    const mode = carriedData.mode as EdgeDefinition['mode'] | undefined
    if (mode && !constraints.allowedModes.includes(mode)) {
      const reason = constraints.reasons.mode[mode]
      warnings.push(
        `Kept the ${getEdgeModePresentation(mode).title.toLowerCase()} mode from the original connection.${reason ? ` ${reason}` : ''}`
      )
    }
  }

  return { valid: true, warnings }
}

export type ReconnectResult =
  | { ok: true; edges: Edge[]; warnings: string[] }
  | { ok: false; error: string }

/**
 * Move one end of an existing edge. Unlike React Flow's `reconnectEdge`, the edge
 * keeps its id (faults, scaffold locks, and saved references point at it), its
 * position in the list, and every setting (label, protocol, mode, latency,
 * weights). Only the endpoints and handles change.
 */
export function reconnectCanvasEdge(
  oldEdge: Edge,
  connection: Connection,
  nodes: readonly Node[],
  edges: readonly Edge[]
): ReconnectResult {
  const current = edges.find((edge) => edge.id === oldEdge.id)
  if (!current) return { ok: false, error: 'That connection no longer exists.' }

  const unchanged =
    connection.source === current.source &&
    connection.target === current.target &&
    (connection.sourceHandle ?? null) === (current.sourceHandle ?? null) &&
    (connection.targetHandle ?? null) === (current.targetHandle ?? null)
  if (unchanged) return { ok: true, edges: [...edges], warnings: [] }

  const check = checkCanvasConnection({
    connection,
    nodes,
    edges,
    ignoreEdgeId: current.id,
    carriedData: (current.data ?? undefined) as EdgeSimulationData | undefined
  })
  if (!check.valid) return { ok: false, error: check.error ?? 'That connection is not allowed.' }

  const nextEdge: Edge = {
    ...current,
    source: connection.source as string,
    target: connection.target as string,
    sourceHandle: connection.sourceHandle ?? null,
    targetHandle: connection.targetHandle ?? null
  }
  return {
    ok: true,
    edges: edges.map((edge) => (edge.id === current.id ? nextEdge : edge)),
    warnings: check.warnings
  }
}
