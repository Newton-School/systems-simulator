import type { Edge, Node } from 'reactflow'
import type { TopologyJSON } from '../../../../engine/core/types'
import { hasInstanceModel } from '../../../../engine/nodes/resourceDerivation'
import type { ScenarioState } from '@renderer/types/ui'
import {
  topologyEdgeToCanvasData,
  topologyNodeToCanvasData
} from '@renderer/utils/topologyCanvasAdapter'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'

/**
 * Pure model behind the JSON Topology Viewer (#87): the tree it renders, the
 * search filter, and how an edit to one TopologyJSON field becomes a change to
 * the canvas store. The canvas stays the source of truth; an edit is applied
 * to the canvas and then the TopologyJSON view is re-derived from it.
 */

export type TreePath = readonly (string | number)[]

export interface TreeRef {
  kind: 'node' | 'edge'
  id: string
}

export interface TreeEntry {
  /** Stable key for expansion state and React keys (the joined path). */
  key: string
  path: TreePath
  /** Row label: a field name, or a component/connection name for list items. */
  label: string
  kind: 'object' | 'array' | 'leaf'
  value?: unknown
  children?: TreeEntry[]
  /** Item count shown next to section headers (`nodes [4]`). */
  badge?: number
  /** One-line preview of a collapsed object/array. */
  preview?: string
  /** The canvas element this row stands for (component and connection rows). */
  ref?: TreeRef
  /** Why this leaf can't be edited, when that depends on the rest of the element. */
  readOnlyReason?: string
}

const DERIVED_QUEUE_REASON =
  'Derived from the instance in Resources (vCPU and RAM); change the instance to change concurrency.'

/**
 * Fields the export shows but the run ignores because they are derived. A node on
 * the instance model gets its workers and queue capacity from the hardware, so a
 * declared `queue.workers` / `queue.capacity` would be an edit with no effect.
 */
const IGNORED_RESOURCE_REASON =
  'Not used by the run: workers and queue space are derived from the instance type and count (or the queue settings without an instance type).'

export function derivedFieldReason(topology: TopologyJSON, path: TreePath): string | null {
  const [section, index, group, field] = path
  if (section !== 'nodes' || typeof index !== 'number') return null
  if (group === 'resources' && (field === 'workersPerInstance' || field === 'queueSlots')) {
    return IGNORED_RESOURCE_REASON
  }
  if (group !== 'queue') return null
  if (field !== 'workers' && field !== 'capacity') return null
  const node = topology.nodes[index]
  return node && hasInstanceModel(node.resources) ? DERIVED_QUEUE_REASON : null
}

function markDerived(entry: TreeEntry, topology: TopologyJSON): TreeEntry {
  if (entry.kind === 'leaf') {
    const reason = derivedFieldReason(topology, entry.path)
    return reason ? { ...entry, readOnlyReason: reason } : entry
  }
  return entry.children
    ? { ...entry, children: entry.children.map((child) => markDerived(child, topology)) }
    : entry
}

export function pathKey(path: TreePath): string {
  return path.map(String).join('.')
}

/** Dropdown options for enum fields, keyed by field name (and parent where ambiguous). */
const ENUM_OPTIONS: Record<string, readonly string[]> = {
  mode: ['synchronous', 'asynchronous', 'streaming', 'conditional'],
  protocol: ['https', 'grpc', 'tcp', 'udp', 'websocket', 'amqp', 'kafka'],
  pathType: ['same-rack', 'same-dc', 'cross-zone', 'cross-region', 'internet'],
  pattern: ['constant', 'poisson', 'bursty', 'diurnal', 'spike', 'sawtooth', 'replay'],
  discipline: ['fifo', 'lifo', 'priority', 'wfq'],
  timeResolution: ['millisecond', 'microsecond'],
  routingStrategy: [
    'round-robin',
    'weighted',
    'random',
    'least-conn',
    'least-response-time',
    'p2c',
    'sticky',
    'ip-hash',
    'broadcast',
    'conditional',
    'passthrough'
  ],
  cacheEngine: ['redis', 'memcached'],
  cacheStrategy: ['cache-aside', 'read-through', 'write-through', 'write-behind'],
  cacheModel: ['declared-rate', 'derived-lru'],
  dataModel: ['document', 'key-value', 'wide-column'],
  workloadKind: ['io-bound', 'cpu-bound'],
  writeAckPolicy: ['primary', 'quorum'],
  dnsRoutingPolicy: ['simple', 'weighted', 'failover', 'latency-based', 'geolocation']
}

/** Fields that identify or place an element; shown, never edited in the tree. */
const READ_ONLY_FIELDS = new Set(['id', 'type', 'category', 'role', 'source', 'target'])

export type LeafEditor =
  | { kind: 'number' }
  | { kind: 'text' }
  | { kind: 'boolean' }
  | { kind: 'enum'; options: readonly string[] }
  | { kind: 'readonly'; reason: string }

/** How a leaf can be edited in the tree. */
export function leafEditor(path: TreePath, value: unknown, readOnlyReason?: string): LeafEditor {
  if (readOnlyReason) return { kind: 'readonly', reason: readOnlyReason }
  const field = String(path[path.length - 1])
  const section = path[0]
  if (section === 'locations' || section === 'networkModel' || section === 'invariants') {
    return { kind: 'readonly', reason: 'Edit containers on the canvas.' }
  }
  if (section === 'scenarios') {
    return { kind: 'readonly', reason: 'Scenario references are kept as imported.' }
  }
  if (path.includes('position') || path.includes('placement')) {
    return { kind: 'readonly', reason: 'Move components on the canvas.' }
  }
  if (path.includes('distribution') && field === 'type') {
    return { kind: 'readonly', reason: 'Change the distribution model in the inspector.' }
  }
  if (path.length === 3 && (section === 'nodes' || section === 'edges')) {
    if (READ_ONLY_FIELDS.has(field)) {
      return { kind: 'readonly', reason: 'Identity fields cannot be edited here.' }
    }
  }
  if (section === 'workload' && field === 'sourceNodeId') {
    return { kind: 'readonly', reason: 'Choose the traffic source in the run settings.' }
  }
  if (section === 'faults' && field === 'targetId') {
    return { kind: 'readonly', reason: 'Choose the fault target in the run settings.' }
  }
  if (typeof value === 'boolean') return { kind: 'boolean' }
  if (typeof value === 'number') return { kind: 'number' }
  if (typeof value === 'string') {
    const options = ENUM_OPTIONS[field]
    return options ? { kind: 'enum', options } : { kind: 'text' }
  }
  return { kind: 'readonly', reason: 'Only text, number and on/off values are editable here.' }
}

function preview(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.length}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? ''
  const parts = Object.entries(value)
    .filter(([, inner]) => inner !== undefined)
    .map(([key, inner]) =>
      typeof inner === 'object' && inner !== null
        ? `${key}: ${Array.isArray(inner) ? '[...]' : '{...}'}`
        : `${key}: ${JSON.stringify(inner)}`
    )
  const text = parts.slice(0, 3).join(', ')
  return `{ ${text}${parts.length > 3 ? ', ...' : ''} }`
}

function build(path: TreePath, label: string, value: unknown, ref?: TreeRef): TreeEntry {
  const key = pathKey(path)
  if (Array.isArray(value)) {
    return {
      key,
      path,
      label,
      kind: 'array',
      value,
      preview: preview(value),
      ref,
      children: value.map((item, index) => build([...path, index], String(index), item))
    }
  }
  if (typeof value === 'object' && value !== null) {
    return {
      key,
      path,
      label,
      kind: 'object',
      value,
      preview: preview(value),
      ref,
      children: Object.entries(value)
        .filter(([, inner]) => inner !== undefined)
        .map(([field, inner]) => build([...path, field], field, inner))
    }
  }
  return { key, path, label, kind: 'leaf', value, ref }
}

const SECTION_ORDER = [
  'nodes',
  'edges',
  'workload',
  'faults',
  'global',
  'locations',
  'networkModel',
  'invariants',
  'scenarios'
] as const

/** The viewer tree: design identity leaves, then one section per TopologyJSON root key. */
export function buildTopologyTree(topology: TopologyJSON): TreeEntry[] {
  const labelById = new Map(topology.nodes.map((node) => [node.id, node.label || node.id]))
  const entries: TreeEntry[] = [
    build(['name'], 'name', topology.name),
    build(['id'], 'id', topology.id),
    build(['version'], 'version', topology.version)
  ]

  for (const section of SECTION_ORDER) {
    const value = topology[section]
    if (value === undefined) continue
    if (section === 'nodes') {
      entries.push({
        key: 'nodes',
        path: ['nodes'],
        label: 'nodes',
        kind: 'array',
        badge: topology.nodes.length,
        children: topology.nodes.map((node, index) =>
          markDerived(
            {
              ...build(['nodes', index], node.label || node.id, node, {
                kind: 'node',
                id: node.id
              }),
              preview: node.type
            },
            topology
          )
        )
      })
      continue
    }
    if (section === 'edges') {
      entries.push({
        key: 'edges',
        path: ['edges'],
        label: 'edges',
        kind: 'array',
        badge: topology.edges.length,
        children: topology.edges.map((edge, index) => ({
          ...build(
            ['edges', index],
            `${labelById.get(edge.source) ?? edge.source} -> ${labelById.get(edge.target) ?? edge.target}`,
            edge,
            { kind: 'edge', id: edge.id }
          ),
          preview: `${edge.mode}, ${edge.protocol}`
        }))
      })
      continue
    }
    const entry = build([section], section, value)
    entries.push(Array.isArray(value) ? { ...entry, badge: value.length } : entry)
  }
  return entries
}

/**
 * Keeps entries whose field name, path or value matches `query` (case
 * insensitive), with their ancestors. A matching component/connection row keeps
 * its whole subtree so "api" shows the API component, not just its label.
 */
export function filterTopologyTree(entries: TreeEntry[], query: string): TreeEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries
  const matches = (entry: TreeEntry) =>
    entry.label.toLowerCase().includes(needle) ||
    (entry.kind === 'leaf' && String(entry.value).toLowerCase().includes(needle))

  const visit = (entry: TreeEntry): TreeEntry | null => {
    if (entry.ref && matches(entry)) return entry
    const children = (entry.children ?? [])
      .map(visit)
      .filter((child): child is TreeEntry => child !== null)
    if (children.length > 0) return { ...entry, children }
    return matches(entry) ? { ...entry, children: entry.children ? [] : undefined } : null
  }
  return entries.map(visit).filter((entry): entry is TreeEntry => entry !== null)
}

/** Keys of every ancestor of matched rows, so a search result is shown expanded. */
export function collectBranchKeys(entries: TreeEntry[]): string[] {
  const keys: string[] = []
  const walk = (entry: TreeEntry) => {
    if (entry.children && entry.children.length > 0) {
      keys.push(entry.key)
      entry.children.forEach(walk)
    }
  }
  entries.forEach(walk)
  return keys
}

export function getAtPath(root: unknown, path: TreePath): unknown {
  let current = root
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

function setAtPath<T>(root: T, path: TreePath, value: unknown): T {
  if (path.length === 0) return value as T
  const copy = (Array.isArray(root) ? [...root] : { ...(root as object) }) as Record<
    string | number,
    unknown
  >
  const [head, ...rest] = path
  copy[head!] = setAtPath(copy[head!] ?? {}, rest, value)
  return copy as T
}

interface LeafChange {
  path: string[]
  value: unknown
}

/** Leaf-level differences from `before` to `after`; arrays compare as whole values. */
function leafChanges(before: unknown, after: unknown, path: string[] = []): LeafChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  const isObject = (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)])
    return [...keys].flatMap((key) =>
      leafChanges(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        [...path, key]
      )
    )
  }
  return [{ path, value: after === undefined ? undefined : structuredClone(after) }]
}

function applyChanges(target: unknown, changes: LeafChange[]): Record<string, unknown> {
  let next = structuredClone((target ?? {}) as Record<string, unknown>)
  for (const change of changes) {
    if (change.value === undefined) {
      const parent = getAtPath(next, change.path.slice(0, -1))
      if (parent && typeof parent === 'object') {
        delete (parent as Record<string, unknown>)[change.path[change.path.length - 1]!]
      }
    } else {
      next = setAtPath(next, change.path, change.value)
    }
  }
  return next
}

export interface CanvasSnapshot {
  nodes: Node[]
  edges: Edge[]
  scenario: ScenarioState
}

export type TopologyEditResult =
  | {
      ok: true
      /** Top-level data fields to merge into a node (`updateNodeData`). */
      nodePatch?: { nodeId: string; patch: Record<string, unknown> }
      /** Label/data to merge into an edge (`updateEdgeData`). */
      edgePatch?: { edgeId: string; label?: string; data?: Record<string, unknown> }
      scenario?: ScenarioState
    }
  | { ok: false; message: string }

/** Narrows an edit result (the renderer is not compiled with strictNullChecks). */
export function isEditFailure(
  result: TopologyEditResult
): result is { ok: false; message: string } {
  return !result.ok
}

function topLevelPatch(current: Record<string, unknown>, changes: LeafChange[]) {
  const next = applyChanges(current, changes)
  const patch: Record<string, unknown> = {}
  for (const change of changes) {
    const field = change.path[0]!
    patch[field] = next[field]
  }
  return patch
}

/**
 * Turns "set `path` to `value` in the TopologyJSON view" into a canvas change.
 * The edited element is converted to canvas data before and after the edit and
 * only the difference is applied, so canvas-only state (handles, layout, UI
 * flags) is untouched. The result is checked by re-serializing: an edit the
 * canvas cannot represent (a derived or clamped value) is refused with a
 * reason instead of silently doing something else.
 */
export function planTopologyEdit(
  snapshot: CanvasSnapshot,
  topology: TopologyJSON,
  path: TreePath,
  value: unknown,
  options: { connectorMode?: boolean } = {}
): TopologyEditResult {
  const [section, index] = path
  const derived = derivedFieldReason(topology, path)
  if (derived) return { ok: false, message: derived }
  const edited = setAtPath(topology, path, value)
  let plan: TopologyEditResult

  if (section === 'nodes' && typeof index === 'number') {
    const node = topology.nodes[index]
    const rfNode = node && snapshot.nodes.find((candidate) => candidate.id === node.id)
    if (!node || !rfNode)
      return { ok: false, message: 'That component is no longer on the canvas.' }
    const before = topologyNodeToCanvasData(node, topology.workload)
    const after = topologyNodeToCanvasData(edited.nodes[index]!, topology.workload)
    const changes = leafChanges(before, after)
    if (changes.length === 0) return unsupported()
    plan = {
      ok: true,
      nodePatch: {
        nodeId: node.id,
        patch: topLevelPatch(rfNode.data as Record<string, unknown>, changes)
      }
    }
  } else if (section === 'edges' && typeof index === 'number') {
    const edge = topology.edges[index]
    const rfEdge = edge && snapshot.edges.find((candidate) => candidate.id === edge.id)
    if (!edge || !rfEdge) {
      return { ok: false, message: 'That connection is no longer on the canvas.' }
    }
    const before = topologyEdgeToCanvasData(edge)
    const after = topologyEdgeToCanvasData(edited.edges[index]!)
    const dataChanges = leafChanges(before.data, after.data)
    const labelChanged = before.label !== after.label
    if (dataChanges.length === 0 && !labelChanged) return unsupported()
    plan = {
      ok: true,
      edgePatch: {
        edgeId: edge.id,
        ...(labelChanged ? { label: after.label ?? '' } : {}),
        ...(dataChanges.length > 0
          ? { data: topLevelPatch((rfEdge.data ?? {}) as Record<string, unknown>, dataChanges) }
          : {})
      }
    }
  } else if (section === 'workload' && topology.workload) {
    const sourceId = topology.workload.sourceNodeId
    const source = topology.nodes.find((node) => node.id === sourceId)
    const rfSource = snapshot.nodes.find((node) => node.id === sourceId)
    if (!source || !rfSource) return unsupported()
    const field = String(path[1])
    // A run-settings override for this field wins over the source's default,
    // so edit the override when there is one.
    if (snapshot.scenario.workloadOverride && field in snapshot.scenario.workloadOverride) {
      plan = {
        ok: true,
        scenario: {
          ...snapshot.scenario,
          workloadOverride: setAtPath(snapshot.scenario.workloadOverride, path.slice(1), value)
        }
      }
    } else {
      const before = topologyNodeToCanvasData(source, topology.workload)
      const after = topologyNodeToCanvasData(source, edited.workload)
      const changes = leafChanges(before?.source, after?.source).map((change) => ({
        ...change,
        path: ['source', ...change.path]
      }))
      if (changes.length === 0) return unsupported()
      plan = {
        ok: true,
        nodePatch: {
          nodeId: sourceId,
          patch: topLevelPatch(rfSource.data as Record<string, unknown>, changes)
        }
      }
    }
  } else if (section === 'global') {
    const field = String(path[1])
    plan = {
      ok: true,
      scenario:
        field === 'timeResolution'
          ? {
              ...snapshot.scenario,
              topologyMeta: { ...snapshot.scenario.topologyMeta, timeResolution: value as never }
            }
          : { ...snapshot.scenario, global: { ...snapshot.scenario.global, [field]: value } }
    }
  } else if (section === 'faults' && typeof index === 'number') {
    plan = {
      ok: true,
      scenario: {
        ...snapshot.scenario,
        faults: setAtPath(snapshot.scenario.faults ?? [], path.slice(1), value)
      }
    }
  } else if (section === 'id' || section === 'name' || section === 'version') {
    plan = {
      ok: true,
      scenario: {
        ...snapshot.scenario,
        topologyMeta: { ...snapshot.scenario.topologyMeta, [section]: value }
      }
    }
  } else {
    return unsupported()
  }

  return verifyPlan(snapshot, plan, path, value, options)
}

function unsupported(): TopologyEditResult {
  return {
    ok: false,
    message: 'This value is derived from other settings and cannot be edited here.'
  }
}

/** Apply the plan to a copy of the canvas and confirm the field now exports as `value`. */
function verifyPlan(
  snapshot: CanvasSnapshot,
  plan: TopologyEditResult,
  path: TreePath,
  value: unknown,
  options: { connectorMode?: boolean }
): TopologyEditResult {
  if (isEditFailure(plan)) return plan
  const nodes = plan.nodePatch
    ? snapshot.nodes.map((node) =>
        node.id === plan.nodePatch!.nodeId
          ? { ...node, data: { ...node.data, ...plan.nodePatch!.patch } }
          : node
      )
    : snapshot.nodes
  const edges = plan.edgePatch
    ? snapshot.edges.map((edge) =>
        edge.id === plan.edgePatch!.edgeId
          ? {
              ...edge,
              ...(plan.edgePatch!.label !== undefined ? { label: plan.edgePatch!.label } : {}),
              ...(plan.edgePatch!.data
                ? { data: { ...(edge.data ?? {}), ...plan.edgePatch!.data } }
                : {})
            }
          : edge
      )
    : snapshot.edges
  const result = serializeCanvasToTopology(
    { nodes, edges, scenario: plan.scenario ?? snapshot.scenario },
    { connectorMode: options.connectorMode, lenient: true }
  )
  if (!result.topology || !Object.is(getAtPath(result.topology, path), value)) {
    return unsupported()
  }
  return plan
}
