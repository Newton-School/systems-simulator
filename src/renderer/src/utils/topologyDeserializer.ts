import type { Edge, Node } from 'reactflow'
import type { ComponentNode, TopologyJSON, TopologyLocation } from '../../../engine/core/types'
import {
  TopologyJSONSchema,
  validateTopology,
  type ValidationError
} from '../../../engine/validation/validator'
import { describeZodIssue, withSubjects } from '../../../engine/validation/issueMessages'
import { applyAutoLayout } from './autoLayout'
import type { NestedFileData } from './nodeTransformers'
import { topologyToCanvasFileData } from './topologyCanvasAdapter'

/**
 * TopologyJSON -> canvas import (#88).
 *
 * Accepts a parsed value or JSON text, validates it with the engine validator
 * (whose messages are already worded for people, not paths), lays nodes out
 * when the document has no positions, and returns canvas file data that the
 * regular load path applies. Nothing here touches the store, so a failed
 * import leaves the canvas exactly as it was.
 *
 * Two levels of problem:
 * - `errors` block the import: the document cannot be turned into a canvas
 *   (bad JSON, wrong shape, duplicate node IDs, connections to missing nodes).
 * - `problems` do not: the design is well-formed but the simulator will flag
 *   it on Run (a missing source, a sync cycle, ...). Importing still works so a
 *   work-in-progress export can always be re-imported and fixed on the canvas.
 */

export interface TopologyImportSuccess {
  success: true
  topology: TopologyJSON
  canvas: NestedFileData
  /** Validator warnings (advice; the design runs). */
  warnings: string[]
  /** Validator errors that do not block the import but will block a Run. */
  problems: ValidationError[]
  nodesImported: number
  edgesImported: number
  /** True when node positions were missing and the canvas was auto-laid out. */
  autoLaidOut: boolean
}

export interface TopologyImportFailure {
  success: false
  errors: ValidationError[]
}

export type TopologyImportResult = TopologyImportSuccess | TopologyImportFailure

/** Narrows an import result (the renderer is not compiled with strictNullChecks). */
export function isImportFailure(result: TopologyImportResult): result is TopologyImportFailure {
  return !result.success
}

function fail(message: string, path = ''): TopologyImportFailure {
  return { success: false, errors: [{ path, message }] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasPosition(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.position)) return false
  const { x, y } = value.position
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
}

/** Parses JSON text, turning a syntax error into a readable message with its position. */
export function parseJsonText(
  text: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.trim().length === 0) {
    return { ok: false, error: 'There is no JSON to import. Paste a TopologyJSON document.' }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `This is not valid JSON (${detail}).` }
  }
}

/** Well-formedness checks the canvas needs that the schema alone does not give. */
function structuralCanvasErrors(topology: TopologyJSON): ValidationError[] {
  const errors: ValidationError[] = []
  const nodeIds = new Set<string>()
  const locationIds = new Set((topology.locations ?? []).map((location) => location.id))
  topology.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id) || locationIds.has(node.id)) {
      errors.push({
        path: `nodes[${index}].id`,
        message: `Another component already uses the ID '${node.id}'. Component IDs must be unique.`
      })
    }
    nodeIds.add(node.id)
  })
  topology.edges.forEach((edge, index) => {
    for (const end of ['source', 'target'] as const) {
      if (!nodeIds.has(edge[end])) {
        errors.push({
          path: `edges[${index}].${end}`,
          message: `Its ${end} component '${edge[end]}' does not exist.`
        })
      }
    }
  })
  return withSubjects(errors, topology)
}

export function deserializeTopology(input: unknown): TopologyImportResult {
  if (!isRecord(input)) {
    return fail(
      'This is not a TopologyJSON document. Expected an object with id, name, global, nodes and edges.'
    )
  }

  // Positions are canvas layout, not engine input: a hand-written or generated
  // document may leave them out. Fill a placeholder so the schema accepts it,
  // then lay the canvas out below.
  const draft = structuredClone(input)
  let positionsMissing = false
  if (Array.isArray(draft.nodes)) {
    draft.nodes = draft.nodes.map((node: unknown) => {
      if (!isRecord(node) || hasPosition(node)) return node
      positionsMissing = true
      return { ...node, position: { x: 0, y: 0 } }
    })
  }

  const parsed = TopologyJSONSchema.safeParse(draft)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: describeZodIssue(issue, draft)
    }))
    return { success: false, errors: withSubjects(errors, draft) }
  }

  const blocking = structuralCanvasErrors(parsed.data)
  if (blocking.length > 0) {
    return { success: false, errors: blocking }
  }

  const validation = validateTopology(parsed.data)
  const topology = positionsMissing ? layoutTopology(parsed.data) : parsed.data

  return {
    success: true,
    topology,
    canvas: topologyToCanvasFileData(topology),
    warnings: validation.warnings ?? [],
    problems: validation.valid ? [] : (validation.errors ?? []),
    nodesImported: topology.nodes.length,
    edgesImported: topology.edges.length,
    autoLaidOut: positionsMissing
  }
}

export function deserializeTopologyText(text: string): TopologyImportResult {
  const parsed = parseJsonText(text)
  return 'error' in parsed ? fail(parsed.error) : deserializeTopology(parsed.value)
}

const CONTAINER_PADDING = 40
const CONTAINER_HEADER = 40
const LAYOUT_NODE_WIDTH = 220
const LAYOUT_NODE_HEIGHT = 140

function mostSpecificContainer(
  node: ComponentNode,
  locationIds: ReadonlySet<string>
): string | undefined {
  return [
    node.placement?.subnetId,
    node.placement?.availabilityZoneId,
    node.placement?.regionId
  ].find((id): id is string => Boolean(id && locationIds.has(id)))
}

/**
 * Lays out a topology whose node positions are missing: a left-to-right
 * layered layout (sources first) inside each container, with containers sized
 * to fit what they hold. Returns a copy with absolute node positions and
 * parent-relative location positions, the shape TopologyJSON uses.
 */
export function layoutTopology(topology: TopologyJSON): TopologyJSON {
  const locations = topology.locations ?? []
  const locationIds = new Set(locations.map((location) => location.id))

  let layoutNodes: Node[] = [
    ...locations.map(
      (location): Node => ({
        id: location.id,
        parentNode:
          location.parentId && locationIds.has(location.parentId) ? location.parentId : undefined,
        position: { x: 0, y: 0 },
        width: location.size?.width ?? LAYOUT_NODE_WIDTH,
        height: location.size?.height ?? LAYOUT_NODE_HEIGHT,
        data: { label: location.label }
      })
    ),
    ...topology.nodes.map(
      (node): Node => ({
        id: node.id,
        parentNode: mostSpecificContainer(node, locationIds),
        position: { x: 0, y: 0 },
        data: { label: node.label }
      })
    )
  ]
  const layoutEdges: Edge[] = topology.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target
  }))

  // Containers grow to fit their children, which moves their siblings, so lay
  // out once per nesting level (region > zone > subnet) plus a final pass.
  const sizedByAuthor = new Set(locations.filter((l) => l.size).map((l) => l.id))
  for (let pass = 0; pass < 4; pass++) {
    layoutNodes = applyAutoLayout(layoutNodes, layoutEdges)
    layoutNodes = sizeContainersToFit(layoutNodes, locationIds, sizedByAuthor)
  }

  const byId = new Map(layoutNodes.map((node) => [node.id, node]))
  const absolute = (id: string): { x: number; y: number } => {
    let x = 0
    let y = 0
    let current = byId.get(id)
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      x += current.position.x
      y += current.position.y
      current = current.parentNode ? byId.get(current.parentNode) : undefined
    }
    return { x, y }
  }

  return {
    ...topology,
    nodes: topology.nodes.map((node) => ({ ...node, position: absolute(node.id) })),
    ...(topology.locations
      ? {
          locations: topology.locations.map((location): TopologyLocation => {
            const laidOut = byId.get(location.id)
            return {
              ...location,
              position: laidOut ? { ...laidOut.position } : location.position,
              size:
                location.size ??
                (laidOut?.width && laidOut.height
                  ? { width: laidOut.width, height: laidOut.height }
                  : undefined)
            }
          })
        }
      : {})
  }
}

function sizeContainersToFit(
  nodes: Node[],
  containerIds: ReadonlySet<string>,
  sizedByAuthor: ReadonlySet<string>
): Node[] {
  const sizes = new Map<string, { width: number; height: number }>()
  for (const node of nodes) {
    if (!containerIds.has(node.id) || sizedByAuthor.has(node.id)) continue
    const children = nodes.filter((child) => child.parentNode === node.id)
    if (children.length === 0) continue
    const right = Math.max(
      ...children.map((child) => child.position.x + (child.width ?? LAYOUT_NODE_WIDTH))
    )
    const bottom = Math.max(
      ...children.map((child) => child.position.y + (child.height ?? LAYOUT_NODE_HEIGHT))
    )
    sizes.set(node.id, {
      width: right + CONTAINER_PADDING,
      height: bottom + CONTAINER_PADDING + CONTAINER_HEADER
    })
  }
  return nodes.map((node) => {
    const size = sizes.get(node.id)
    return size ? { ...node, ...size } : node
  })
}
