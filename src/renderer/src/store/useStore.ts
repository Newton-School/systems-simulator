import { create } from 'zustand'
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges
} from 'reactflow'
import type {
  NodeSimulationMetrics,
  AnyNodeData,
  EdgeSimulationData,
  ScenarioState,
  MetricLens,
  DisplaySettings
} from '@renderer/types/ui'
import type { CanvasTextLabelData } from '../../../engine/catalog/canvasAnnotations'
import { DEFAULT_SCENARIO_STATE } from '@renderer/types/ui'
import type { EdgeFailureCause, EdgeFlowEvent } from '../../../engine/core/events'
import type { WorkloadProfile } from '../../../engine/core/types'
import type { AttemptState, QuestionPackage } from '../../../engine/analysis/question'
import {
  DEFAULT_ENVIRONMENT_PROFILE,
  type EnvironmentProfile
} from '../../../engine/analysis/environmentProfile'
import type { NewtonSaveMode } from '../../../engine/analysis/newtonGamePlayground'
import type { SimulationOutput } from '../../../engine/analysis/output'
import {
  loadDisplaySettings,
  persistDisplaySettings
} from '@renderer/utils/displaySettingsPersistence'

/**
 * A scaffold node's edit/removal permissions come from the intersection of the
 * EnvironmentProfile and the authored question constraints. Enforced in the store
 * so no UI path can bypass it.
 */
function isScaffoldNode(nodeId: string, scaffoldNodeIds: readonly string[]): boolean {
  return scaffoldNodeIds.includes(nodeId)
}

function isAuthoredLockedScaffoldNode(
  nodeId: string,
  activeQuestion: QuestionPackage | null
): boolean {
  return activeQuestion?.scaffold.lockedNodeIds?.includes(nodeId) ?? false
}

function isNodeEditLocked(
  nodeId: string,
  scaffoldNodeIds: readonly string[],
  activeQuestion: QuestionPackage | null,
  profile: EnvironmentProfile,
  attemptStatus: AttemptState['status'] | undefined
): boolean {
  if (attemptStatus === 'LOCKED') {
    return true
  }
  if (!isScaffoldNode(nodeId, scaffoldNodeIds)) {
    return false
  }
  return (
    !profile.capabilities.canEditScaffoldNodes ||
    activeQuestion?.constraints?.canModifyScaffold === false ||
    isAuthoredLockedScaffoldNode(nodeId, activeQuestion)
  )
}

function isNodeRemovalLocked(
  nodeId: string,
  scaffoldNodeIds: readonly string[],
  activeQuestion: QuestionPackage | null,
  profile: EnvironmentProfile,
  attemptStatus: AttemptState['status'] | undefined
): boolean {
  if (attemptStatus === 'LOCKED') {
    return true
  }
  if (!isScaffoldNode(nodeId, scaffoldNodeIds)) {
    return false
  }
  return (
    !profile.capabilities.canEditScaffoldNodes ||
    activeQuestion?.constraints?.canRemoveScaffoldNodes === false ||
    isAuthoredLockedScaffoldNode(nodeId, activeQuestion)
  )
}

function isScaffoldEdge(edgeId: string, scaffoldEdgeIds: readonly string[]): boolean {
  return scaffoldEdgeIds.includes(edgeId)
}

function isAuthoredLockedScaffoldEdge(
  edgeId: string,
  activeQuestion: QuestionPackage | null
): boolean {
  return activeQuestion?.scaffold.lockedEdgeIds?.includes(edgeId) ?? false
}

function isEdgeEditLocked(
  edgeId: string,
  scaffoldEdgeIds: readonly string[],
  activeQuestion: QuestionPackage | null,
  profile: EnvironmentProfile,
  attemptStatus: AttemptState['status'] | undefined
): boolean {
  if (attemptStatus === 'LOCKED') {
    return true
  }
  if (!isScaffoldEdge(edgeId, scaffoldEdgeIds)) {
    return false
  }
  return (
    !profile.capabilities.canEditScaffoldNodes ||
    activeQuestion?.constraints?.canModifyScaffold === false ||
    isAuthoredLockedScaffoldEdge(edgeId, activeQuestion)
  )
}

function isEdgeRemovalLocked(
  edgeId: string,
  scaffoldEdgeIds: readonly string[],
  activeQuestion: QuestionPackage | null,
  profile: EnvironmentProfile,
  attemptStatus: AttemptState['status'] | undefined
): boolean {
  if (attemptStatus === 'LOCKED') {
    return true
  }
  if (!isScaffoldEdge(edgeId, scaffoldEdgeIds)) {
    return false
  }
  return (
    !profile.capabilities.canEditScaffoldNodes ||
    activeQuestion?.constraints?.canRemoveScaffoldNodes === false ||
    isAuthoredLockedScaffoldEdge(edgeId, activeQuestion)
  )
}
import type { RoutingStrategy } from '../../../engine/catalog/nodeSpecTypes'

type FailureCountsByCause = Partial<Record<EdgeFailureCause, number>>
type GraphSnapshot = { nodes: Node[]; edges: Edge[] }
type GraphMutationOptions = {
  history?: 'record' | 'skip' | 'drag-commit'
  resetHistory?: boolean
}
type IndexedNodeRecord = { index: number; node: Node }
type IndexedEdgeRecord = { index: number; edge: Edge }
type AtomicGraphHistoryEntry =
  | { kind: 'replace-graph'; before: GraphSnapshot; after: GraphSnapshot }
  | { kind: 'move-nodes'; before: Node[]; after: Node[] }
  | { kind: 'update-node'; before: Node; after: Node }
  | { kind: 'update-edge'; before: Edge; after: Edge }
  | { kind: 'add-node'; node: IndexedNodeRecord }
  | { kind: 'remove-nodes'; nodes: IndexedNodeRecord[] }
  | { kind: 'add-edge'; edge: IndexedEdgeRecord }
  | { kind: 'remove-edges'; edges: IndexedEdgeRecord[] }
type GraphHistoryEntry =
  | AtomicGraphHistoryEntry
  | { kind: 'composite'; entries: AtomicGraphHistoryEntry[] }
type GraphDragSession = {
  beforeNodes: Node[]
}
type GraphHistoryState = {
  past: GraphHistoryEntry[]
  future: GraphHistoryEntry[]
  dragSession: GraphDragSession | null
}

const RUNTIME_METRIC_LENSES: ReadonlySet<MetricLens> = new Set([
  'traffic',
  'saturation',
  'latency',
  'errors',
  'throughput'
])
const displaySettingsInitial = loadDisplaySettings()

export type EdgeFlowRenderEvent = EdgeFlowEvent & {
  receivedAtMs: number
  displayAtMs: number
  sampleWeight: number
}

export interface EdgeFlowState {
  recent: EdgeFlowRenderEvent[]
  attemptedPerSecond: number
  successPerSecond: number
  failedPerSecond: number
  failureRatio: number
  totalAttempted: number
  totalSuccess: number
  totalFailed: number
  totalPostWarmupAttempted: number
  totalPostWarmupSuccess: number
  totalPostWarmupFailed: number
  avgAttemptedPerSecond: number
  avgSuccessPerSecond: number
  avgFailedPerSecond: number
  avgPostWarmupSuccessPerSecond: number
  firstStartedAtMs: number
  lastStartedAtMs: number
  totalFailedByCause: FailureCountsByCause
  totalPostWarmupFailedByCause: FailureCountsByCause
}

export type EdgeFlowStatus = 'idle' | 'running' | 'complete'

export interface RoutingStrategyVisualizationState {
  sourceNodeId: string
  sourceLabel: string
  strategy: RoutingStrategy
}

export interface EdgeFlowRunConfig {
  workload: WorkloadProfile
  simulationDurationMs: number
  warmupDurationMs: number
}

type CanvasNodeDataPatch = Partial<AnyNodeData> | Partial<CanvasTextLabelData>

const EDGE_FLOW_WINDOW_MS = 6_000
const EDGE_FLOW_MAX_EVENTS = 25_000
const EDGE_FLOW_HISTORY_MAX_EVENTS = 10_000
const EDGE_FLOW_PLAYBACK_SPEED = 10
const EDGE_FLOW_LIVE_RETAINED_EVENTS_PER_BATCH = 100
const GRAPH_HISTORY_LIMIT = 100
const NODE_PRESENTATION_IGNORED_KEYS = new Set(['selected', 'dragging'])
const EDGE_PRESENTATION_IGNORED_KEYS = new Set(['selected'])
const NODE_MOVE_KEYS = new Set(['position', 'positionAbsolute', 'parentNode', 'extent', 'zIndex'])
const NODE_NON_MOVE_IGNORED_KEYS = new Set([...NODE_PRESENTATION_IGNORED_KEYS, ...NODE_MOVE_KEYS])
const GRAPH_HISTORY_KIND_PRIORITY: Record<AtomicGraphHistoryEntry['kind'], number> = {
  'replace-graph': 0,
  'remove-edges': 1,
  'remove-nodes': 2,
  'move-nodes': 3,
  'update-node': 4,
  'update-edge': 5,
  'add-node': 6,
  'add-edge': 7
}
const EMPTY_GRAPH_HISTORY: GraphHistoryState = {
  past: [],
  future: [],
  dragSession: null
}

const EMPTY_EDGE_FLOW_STATE: EdgeFlowState = {
  recent: [],
  attemptedPerSecond: 0,
  successPerSecond: 0,
  failedPerSecond: 0,
  failureRatio: 0,
  totalAttempted: 0,
  totalSuccess: 0,
  totalFailed: 0,
  totalPostWarmupAttempted: 0,
  totalPostWarmupSuccess: 0,
  totalPostWarmupFailed: 0,
  avgAttemptedPerSecond: 0,
  avgSuccessPerSecond: 0,
  avgFailedPerSecond: 0,
  avgPostWarmupSuccessPerSecond: 0,
  firstStartedAtMs: 0,
  lastStartedAtMs: 0,
  totalFailedByCause: {},
  totalPostWarmupFailedByCause: {}
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function deepEqualUnknown(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) {
    return true
  }

  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
      return false
    }

    return first.every((value, index) => deepEqualUnknown(value, second[index]))
  }

  if (!isObjectRecord(first) || !isObjectRecord(second)) {
    return false
  }

  const firstKeys = Object.keys(first)
  const secondKeys = Object.keys(second)
  if (firstKeys.length !== secondKeys.length) {
    return false
  }

  return firstKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(second, key) && deepEqualUnknown(first[key], second[key])
  )
}

function deepEqualIgnoringKeys(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  ignoredKeys: ReadonlySet<string>
): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)])

  for (const key of keys) {
    if (ignoredKeys.has(key)) {
      continue
    }

    if (!deepEqualUnknown(first[key], second[key])) {
      return false
    }
  }

  return true
}

function hasRelativeOrderChanged<T extends { id: string }>(
  beforeItems: readonly T[],
  afterItems: readonly T[],
  addedIds: ReadonlySet<string>,
  removedIds: ReadonlySet<string>
): boolean {
  const beforeCommonIds = beforeItems
    .filter((item) => !removedIds.has(item.id))
    .map((item) => item.id)
  const afterCommonIds = afterItems.filter((item) => !addedIds.has(item.id)).map((item) => item.id)

  if (beforeCommonIds.length !== afterCommonIds.length) {
    return true
  }

  return beforeCommonIds.some((id, index) => id !== afterCommonIds[index])
}

function buildCompositeHistoryEntry(
  entries: readonly AtomicGraphHistoryEntry[]
): GraphHistoryEntry | null {
  if (entries.length === 0) {
    return null
  }

  return entries.length === 1 ? entries[0] : { kind: 'composite', entries: [...entries] }
}

function cloneNodeForHistory(node: Node): Node {
  return {
    ...node,
    position: { ...node.position },
    ...(node.positionAbsolute ? { positionAbsolute: { ...node.positionAbsolute } } : {}),
    ...(node.data && typeof node.data === 'object' ? { data: { ...node.data } } : {})
  }
}

function cloneEdgeForHistory(edge: Edge): Edge {
  return {
    ...edge,
    ...(edge.data && typeof edge.data === 'object' ? { data: { ...edge.data } } : {})
  }
}

function cloneGraphSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
  return {
    nodes: snapshot.nodes.map(cloneNodeForHistory),
    edges: snapshot.edges.map(cloneEdgeForHistory)
  }
}

function snapshotGraph(state: Pick<RFState, 'nodes' | 'edges'>): GraphSnapshot {
  return cloneGraphSnapshot({ nodes: state.nodes, edges: state.edges })
}

function replaceNodesById(nodes: readonly Node[], replacements: readonly Node[]): Node[] {
  if (replacements.length === 0) {
    return [...nodes]
  }

  const replacementsById = new Map(replacements.map((node) => [node.id, cloneNodeForHistory(node)]))
  return nodes.map((node) => replacementsById.get(node.id) ?? node)
}

function replaceEdgesById(edges: readonly Edge[], replacements: readonly Edge[]): Edge[] {
  if (replacements.length === 0) {
    return [...edges]
  }

  const replacementsById = new Map(replacements.map((edge) => [edge.id, cloneEdgeForHistory(edge)]))
  return edges.map((edge) => replacementsById.get(edge.id) ?? edge)
}

function removeNodesById(nodes: readonly Node[], nodeIds: ReadonlySet<string>): Node[] {
  if (nodeIds.size === 0) {
    return [...nodes]
  }

  return nodes.filter((node) => !nodeIds.has(node.id))
}

function removeEdgesById(edges: readonly Edge[], edgeIds: ReadonlySet<string>): Edge[] {
  if (edgeIds.size === 0) {
    return [...edges]
  }

  return edges.filter((edge) => !edgeIds.has(edge.id))
}

function insertNodesAtIndices(
  nodes: readonly Node[],
  records: readonly IndexedNodeRecord[]
): Node[] {
  const restored = [...nodes]
  const sorted = [...records].sort((first, second) => first.index - second.index)

  for (const record of sorted) {
    restored.splice(Math.min(record.index, restored.length), 0, cloneNodeForHistory(record.node))
  }

  return restored
}

function insertEdgesAtIndices(
  edges: readonly Edge[],
  records: readonly IndexedEdgeRecord[]
): Edge[] {
  const restored = [...edges]
  const sorted = [...records].sort((first, second) => first.index - second.index)

  for (const record of sorted) {
    restored.splice(Math.min(record.index, restored.length), 0, cloneEdgeForHistory(record.edge))
  }

  return restored
}

function captureIndexedNodes(
  nodes: readonly Node[],
  nodeIds: ReadonlySet<string>
): IndexedNodeRecord[] {
  return nodes.reduce<IndexedNodeRecord[]>((records, node, index) => {
    if (nodeIds.has(node.id)) {
      records.push({ index, node: cloneNodeForHistory(node) })
    }
    return records
  }, [])
}

function captureIndexedEdges(
  edges: readonly Edge[],
  edgeIds: ReadonlySet<string>
): IndexedEdgeRecord[] {
  return edges.reduce<IndexedEdgeRecord[]>((records, edge, index) => {
    if (edgeIds.has(edge.id)) {
      records.push({ index, edge: cloneEdgeForHistory(edge) })
    }
    return records
  }, [])
}

function captureNodesById(nodes: readonly Node[], nodeIds: ReadonlySet<string>): Node[] {
  return nodes.filter((node) => nodeIds.has(node.id)).map(cloneNodeForHistory)
}

function pointsEqual(
  first: { x: number; y: number } | undefined,
  second: { x: number; y: number } | undefined
): boolean {
  if (first === second) {
    return true
  }
  if (!first || !second) {
    return first === second
  }
  return first.x === second.x && first.y === second.y
}

function hasNodeMoveChanged(first: Node, second: Node): boolean {
  return (
    !pointsEqual(first.position, second.position) ||
    !pointsEqual(first.positionAbsolute, second.positionAbsolute) ||
    first.parentNode !== second.parentNode ||
    first.extent !== second.extent ||
    first.zIndex !== second.zIndex
  )
}

function areNodesStructurallyEqualIgnoringPresentation(first: Node, second: Node): boolean {
  return deepEqualIgnoringKeys(
    first as Record<string, unknown>,
    second as Record<string, unknown>,
    NODE_PRESENTATION_IGNORED_KEYS
  )
}

function areEdgesStructurallyEqualIgnoringPresentation(first: Edge, second: Edge): boolean {
  return deepEqualIgnoringKeys(
    first as Record<string, unknown>,
    second as Record<string, unknown>,
    EDGE_PRESENTATION_IGNORED_KEYS
  )
}

function isNodeMoveOnlyChange(first: Node, second: Node): boolean {
  return (
    hasNodeMoveChanged(first, second) &&
    deepEqualIgnoringKeys(
      first as Record<string, unknown>,
      second as Record<string, unknown>,
      NODE_NON_MOVE_IGNORED_KEYS
    )
  )
}

function buildMoveNodesHistoryEntry(
  beforeNodes: readonly Node[],
  afterNodes: readonly Node[]
): GraphHistoryEntry | null {
  const beforeById = new Map(beforeNodes.map((node) => [node.id, node]))
  const movedBefore: Node[] = []
  const movedAfter: Node[] = []

  for (const afterNode of afterNodes) {
    const beforeNode = beforeById.get(afterNode.id)
    if (!beforeNode || !hasNodeMoveChanged(beforeNode, afterNode)) {
      continue
    }

    movedBefore.push(cloneNodeForHistory(beforeNode))
    movedAfter.push(cloneNodeForHistory(afterNode))
  }

  return movedBefore.length > 0
    ? { kind: 'move-nodes', before: movedBefore, after: movedAfter }
    : null
}

function sortGraphHistoryEntries(
  entries: readonly AtomicGraphHistoryEntry[]
): AtomicGraphHistoryEntry[] {
  return [...entries].sort(
    (first, second) =>
      GRAPH_HISTORY_KIND_PRIORITY[first.kind] - GRAPH_HISTORY_KIND_PRIORITY[second.kind]
  )
}

function buildNodeHistoryEntries(
  beforeNodes: readonly Node[],
  afterNodes: readonly Node[]
): AtomicGraphHistoryEntry[] | undefined {
  const beforeNodeIds = new Set(beforeNodes.map((node) => node.id))
  const afterNodeIds = new Set(afterNodes.map((node) => node.id))
  const removedNodeIds = new Set([...beforeNodeIds].filter((nodeId) => !afterNodeIds.has(nodeId)))
  const addedNodeIds = new Set([...afterNodeIds].filter((nodeId) => !beforeNodeIds.has(nodeId)))

  if (hasRelativeOrderChanged(beforeNodes, afterNodes, addedNodeIds, removedNodeIds)) {
    return undefined
  }

  const entries: AtomicGraphHistoryEntry[] = []

  if (removedNodeIds.size > 0) {
    entries.push({
      kind: 'remove-nodes',
      nodes: captureIndexedNodes(beforeNodes, removedNodeIds)
    })
  }

  const beforeNodesById = new Map(beforeNodes.map((node) => [node.id, node]))
  const movedBefore: Node[] = []
  const movedAfter: Node[] = []

  for (const afterNode of afterNodes) {
    const beforeNode = beforeNodesById.get(afterNode.id)
    if (!beforeNode) {
      continue
    }

    if (areNodesStructurallyEqualIgnoringPresentation(beforeNode, afterNode)) {
      continue
    }

    if (isNodeMoveOnlyChange(beforeNode, afterNode)) {
      movedBefore.push(cloneNodeForHistory(beforeNode))
      movedAfter.push(cloneNodeForHistory(afterNode))
      continue
    }

    entries.push({
      kind: 'update-node',
      before: cloneNodeForHistory(beforeNode),
      after: cloneNodeForHistory(afterNode)
    })
  }

  if (movedBefore.length > 0) {
    entries.push({
      kind: 'move-nodes',
      before: movedBefore,
      after: movedAfter
    })
  }

  afterNodes.forEach((node, index) => {
    if (!addedNodeIds.has(node.id)) {
      return
    }

    entries.push({
      kind: 'add-node',
      node: {
        index,
        node: cloneNodeForHistory(node)
      }
    })
  })

  return entries
}

function buildEdgeHistoryEntries(
  beforeEdges: readonly Edge[],
  afterEdges: readonly Edge[]
): AtomicGraphHistoryEntry[] | undefined {
  const beforeEdgeIds = new Set(beforeEdges.map((edge) => edge.id))
  const afterEdgeIds = new Set(afterEdges.map((edge) => edge.id))
  const removedEdgeIds = new Set([...beforeEdgeIds].filter((edgeId) => !afterEdgeIds.has(edgeId)))
  const addedEdgeIds = new Set([...afterEdgeIds].filter((edgeId) => !beforeEdgeIds.has(edgeId)))

  if (hasRelativeOrderChanged(beforeEdges, afterEdges, addedEdgeIds, removedEdgeIds)) {
    return undefined
  }

  const entries: AtomicGraphHistoryEntry[] = []

  if (removedEdgeIds.size > 0) {
    entries.push({
      kind: 'remove-edges',
      edges: captureIndexedEdges(beforeEdges, removedEdgeIds)
    })
  }

  const beforeEdgesById = new Map(beforeEdges.map((edge) => [edge.id, edge]))

  for (const afterEdge of afterEdges) {
    const beforeEdge = beforeEdgesById.get(afterEdge.id)
    if (!beforeEdge) {
      continue
    }

    if (areEdgesStructurallyEqualIgnoringPresentation(beforeEdge, afterEdge)) {
      continue
    }

    entries.push({
      kind: 'update-edge',
      before: cloneEdgeForHistory(beforeEdge),
      after: cloneEdgeForHistory(afterEdge)
    })
  }

  afterEdges.forEach((edge, index) => {
    if (!addedEdgeIds.has(edge.id)) {
      return
    }

    entries.push({
      kind: 'add-edge',
      edge: {
        index,
        edge: cloneEdgeForHistory(edge)
      }
    })
  })

  return entries
}

function buildSetNodesHistoryEntry(
  beforeNodes: readonly Node[],
  afterNodes: readonly Node[]
): GraphHistoryEntry | null | undefined {
  const entries = buildNodeHistoryEntries(beforeNodes, afterNodes)
  return entries === undefined ? undefined : buildCompositeHistoryEntry(entries)
}

function buildSetEdgesHistoryEntry(
  beforeEdges: readonly Edge[],
  afterEdges: readonly Edge[]
): GraphHistoryEntry | null | undefined {
  const entries = buildEdgeHistoryEntries(beforeEdges, afterEdges)
  return entries === undefined ? undefined : buildCompositeHistoryEntry(entries)
}

function buildSetGraphHistoryEntry(
  beforeSnapshot: GraphSnapshot,
  afterSnapshot: GraphSnapshot
): GraphHistoryEntry | null | undefined {
  const nodeEntries = buildNodeHistoryEntries(beforeSnapshot.nodes, afterSnapshot.nodes)
  const edgeEntries = buildEdgeHistoryEntries(beforeSnapshot.edges, afterSnapshot.edges)

  if (nodeEntries === undefined || edgeEntries === undefined) {
    return undefined
  }

  return buildCompositeHistoryEntry(sortGraphHistoryEntries([...nodeEntries, ...edgeEntries]))
}

function createReplaceGraphHistoryEntry(
  state: RFState,
  nextSnapshot: GraphSnapshot
): GraphHistoryEntry {
  return {
    kind: 'replace-graph',
    before: snapshotGraph(state),
    after: cloneGraphSnapshot(nextSnapshot)
  }
}

function pushGraphHistoryEntry(
  graphHistory: GraphHistoryState,
  entry: GraphHistoryEntry
): GraphHistoryState {
  return {
    past: [...graphHistory.past, entry].slice(-GRAPH_HISTORY_LIMIT),
    future: [],
    dragSession: null
  }
}

function clearGraphDragSession(graphHistory: GraphHistoryState): GraphHistoryState {
  if (graphHistory.dragSession === null) {
    return graphHistory
  }

  return {
    ...graphHistory,
    dragSession: null
  }
}

function beginGraphDragSession(state: RFState, nodeIds: ReadonlySet<string>): GraphHistoryState {
  if (nodeIds.size === 0) {
    return state.graphHistory
  }

  const captured = captureNodesById(state.nodes, nodeIds)
  if (captured.length === 0) {
    return state.graphHistory
  }

  const existing = state.graphHistory.dragSession
  if (!existing) {
    return {
      ...state.graphHistory,
      dragSession: { beforeNodes: captured }
    }
  }

  const existingIds = new Set(existing.beforeNodes.map((node) => node.id))
  const missing = captured.filter((node) => !existingIds.has(node.id))
  if (missing.length === 0) {
    return state.graphHistory
  }

  return {
    ...state.graphHistory,
    dragSession: {
      beforeNodes: [...existing.beforeNodes, ...missing]
    }
  }
}

function resolveGraphMutation(
  state: RFState,
  nextSnapshot: GraphSnapshot,
  options?: GraphMutationOptions,
  entry?: GraphHistoryEntry | null
): Pick<RFState, 'graphHistory' | 'graphRevision'> {
  const graphChanged = nextSnapshot.nodes !== state.nodes || nextSnapshot.edges !== state.edges

  if (!graphChanged) {
    return {
      graphHistory:
        options?.history === 'drag-commit'
          ? clearGraphDragSession(state.graphHistory)
          : state.graphHistory,
      graphRevision: state.graphRevision
    }
  }

  if (options?.resetHistory) {
    return {
      graphHistory: EMPTY_GRAPH_HISTORY,
      graphRevision: state.graphRevision + 1
    }
  }

  if (options?.history === 'skip') {
    return {
      graphHistory: clearGraphDragSession(state.graphHistory),
      graphRevision: state.graphRevision + 1
    }
  }

  if (options?.history === 'drag-commit') {
    if (!entry) {
      return {
        graphHistory: clearGraphDragSession(state.graphHistory),
        graphRevision: state.graphRevision
      }
    }

    return {
      graphHistory: pushGraphHistoryEntry(state.graphHistory, entry),
      graphRevision: state.graphRevision + 1
    }
  }

  return {
    graphHistory: pushGraphHistoryEntry(
      state.graphHistory,
      entry ?? createReplaceGraphHistoryEntry(state, nextSnapshot)
    ),
    graphRevision: state.graphRevision + 1
  }
}

function resolveDerivedGraphMutation(
  state: RFState,
  nextSnapshot: GraphSnapshot,
  options: GraphMutationOptions | undefined,
  entry: GraphHistoryEntry | null | undefined
): Pick<RFState, 'graphHistory' | 'graphRevision'> {
  if (entry === undefined) {
    return resolveGraphMutation(state, nextSnapshot, options)
  }

  if (entry === null) {
    return resolveGraphMutation(state, nextSnapshot, { ...options, history: 'skip' })
  }

  return resolveGraphMutation(state, nextSnapshot, options, entry)
}

function applyGraphHistoryEntry(
  snapshot: GraphSnapshot,
  entry: GraphHistoryEntry,
  direction: 'undo' | 'redo'
): GraphSnapshot {
  switch (entry.kind) {
    case 'composite': {
      const orderedEntries = direction === 'undo' ? [...entry.entries].reverse() : entry.entries

      return orderedEntries.reduce(
        (currentSnapshot, currentEntry) =>
          applyGraphHistoryEntry(currentSnapshot, currentEntry, direction),
        snapshot
      )
    }
    case 'replace-graph':
      return cloneGraphSnapshot(direction === 'undo' ? entry.before : entry.after)
    case 'move-nodes':
      return {
        nodes: replaceNodesById(snapshot.nodes, direction === 'undo' ? entry.before : entry.after),
        edges: [...snapshot.edges]
      }
    case 'update-node':
      return {
        nodes: replaceNodesById(snapshot.nodes, [
          direction === 'undo' ? entry.before : entry.after
        ]),
        edges: [...snapshot.edges]
      }
    case 'update-edge':
      return {
        nodes: [...snapshot.nodes],
        edges: replaceEdgesById(snapshot.edges, [direction === 'undo' ? entry.before : entry.after])
      }
    case 'add-node':
      return direction === 'undo'
        ? {
            nodes: removeNodesById(snapshot.nodes, new Set([entry.node.node.id])),
            edges: [...snapshot.edges]
          }
        : {
            nodes: insertNodesAtIndices(snapshot.nodes, [entry.node]),
            edges: [...snapshot.edges]
          }
    case 'remove-nodes':
      return direction === 'undo'
        ? {
            nodes: insertNodesAtIndices(snapshot.nodes, entry.nodes),
            edges: [...snapshot.edges]
          }
        : {
            nodes: removeNodesById(
              snapshot.nodes,
              new Set(entry.nodes.map((record) => record.node.id))
            ),
            edges: [...snapshot.edges]
          }
    case 'add-edge':
      return direction === 'undo'
        ? {
            nodes: [...snapshot.nodes],
            edges: removeEdgesById(snapshot.edges, new Set([entry.edge.edge.id]))
          }
        : {
            nodes: [...snapshot.nodes],
            edges: insertEdgesAtIndices(snapshot.edges, [entry.edge])
          }
    case 'remove-edges':
      return direction === 'undo'
        ? {
            nodes: [...snapshot.nodes],
            edges: insertEdgesAtIndices(snapshot.edges, entry.edges)
          }
        : {
            nodes: [...snapshot.nodes],
            edges: removeEdgesById(
              snapshot.edges,
              new Set(entry.edges.map((record) => record.edge.id))
            )
          }
  }
}

function shouldRecordNodeChanges(changes: NodeChange[]): boolean {
  return changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')
}

function shouldRecordEdgeChanges(changes: EdgeChange[]): boolean {
  return changes.some((change) => change.type !== 'select')
}

function hasNodePositionChange(changes: NodeChange[]): boolean {
  return changes.some((change) => change.type === 'position')
}

function hasActiveNodeDrag(changes: NodeChange[]): boolean {
  return changes.some((change) => change.type === 'position' && change.dragging)
}

function collectChangedNodeIds(changes: NodeChange[]): Set<string> {
  return changes.reduce<Set<string>>((ids, change) => {
    if ('id' in change && change.type === 'position') {
      ids.add(change.id)
    }
    return ids
  }, new Set<string>())
}

function collectRemovedNodeIds(changes: NodeChange[]): Set<string> {
  return changes.reduce<Set<string>>((ids, change) => {
    if ('id' in change && change.type === 'remove') {
      ids.add(change.id)
    }
    return ids
  }, new Set<string>())
}

function collectRemovedEdgeIds(changes: EdgeChange[]): Set<string> {
  return changes.reduce<Set<string>>((ids, change) => {
    if ('id' in change && change.type === 'remove') {
      ids.add(change.id)
    }
    return ids
  }, new Set<string>())
}

function hasRecordPatchChanges(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): boolean {
  return Object.entries(patch).some(([key, value]) => !Object.is(current?.[key], value))
}

function summarizeEdgeFlow(
  events: EdgeFlowRenderEvent[]
): Pick<
  EdgeFlowState,
  'attemptedPerSecond' | 'successPerSecond' | 'failedPerSecond' | 'failureRatio'
> {
  const lastStartedAtMs = events[events.length - 1]?.startedAtMs
  const windowedEvents =
    lastStartedAtMs === undefined
      ? []
      : events.filter((event) => lastStartedAtMs - event.startedAtMs <= EDGE_FLOW_WINDOW_MS)
  let attempted = 0
  let success = 0

  for (const event of windowedEvents) {
    const weight = event.sampleWeight
    attempted += weight
    if (event.status === 'success') {
      success += weight
    }
  }

  const failed = attempted - success
  const first = windowedEvents[0]?.startedAtMs
  const last = windowedEvents[windowedEvents.length - 1]?.startedAtMs
  const spanSeconds = Math.max(
    1,
    first !== undefined && last !== undefined ? (last - first) / 1000 : 1
  )

  return {
    attemptedPerSecond: attempted / spanSeconds,
    successPerSecond: success / spanSeconds,
    failedPerSecond: failed / spanSeconds,
    failureRatio: attempted > 0 ? failed / attempted : 0
  }
}

function incrementFailureCauseInPlace(
  counts: FailureCountsByCause,
  cause: EdgeFailureCause | undefined
) {
  if (!cause) {
    return
  }

  counts[cause] = (counts[cause] ?? 0) + 1
}

function mergeEdgeFlowState(
  previous: EdgeFlowState,
  countedEvents: EdgeFlowEvent[],
  retainedEvents: EdgeFlowRenderEvent[],
  warmupDurationMs: number
): EdgeFlowState {
  const lastEvent = countedEvents[countedEvents.length - 1]
  if (!lastEvent) {
    return previous
  }

  const lastRetainedEvent = retainedEvents[retainedEvents.length - 1]
  const recent = previous.recent
    .concat(retainedEvents)
    .filter(
      (item) =>
        !lastRetainedEvent ||
        lastRetainedEvent.displayAtMs - item.displayAtMs <= EDGE_FLOW_WINDOW_MS * 2
    )
    .slice(-EDGE_FLOW_MAX_EVENTS)
  const totalAttempted = previous.totalAttempted + countedEvents.length
  let totalSuccess = previous.totalSuccess
  let totalPostWarmupAttempted = previous.totalPostWarmupAttempted
  let totalPostWarmupSuccess = previous.totalPostWarmupSuccess
  const totalFailedByCause = { ...previous.totalFailedByCause }
  const totalPostWarmupFailedByCause = { ...previous.totalPostWarmupFailedByCause }

  for (const event of countedEvents) {
    const isPostWarmupEvent = event.completedAtMs >= warmupDurationMs

    if (event.status === 'success') {
      totalSuccess++
      if (isPostWarmupEvent) {
        totalPostWarmupSuccess++
      }
    }

    if (isPostWarmupEvent) {
      totalPostWarmupAttempted++
    }

    incrementFailureCauseInPlace(totalFailedByCause, event.failureCause)
    if (isPostWarmupEvent) {
      incrementFailureCauseInPlace(totalPostWarmupFailedByCause, event.failureCause)
    }
  }

  const totalFailed = totalAttempted - totalSuccess
  const totalPostWarmupFailed = totalPostWarmupAttempted - totalPostWarmupSuccess
  const firstStartedAtMs =
    previous.totalAttempted === 0 ? (countedEvents[0]?.startedAtMs ?? 0) : previous.firstStartedAtMs
  const lastStartedAtMs =
    previous.totalAttempted === 0
      ? lastEvent.startedAtMs
      : Math.max(previous.lastStartedAtMs, lastEvent.startedAtMs)
  const durationSeconds = Math.max(1, (lastStartedAtMs - firstStartedAtMs) / 1000)
  const postWarmupDurationSeconds = Math.max(
    1,
    (Math.max(lastStartedAtMs, warmupDurationMs) - warmupDurationMs) / 1000
  )

  return {
    recent,
    ...summarizeEdgeFlow(recent),
    totalAttempted,
    totalSuccess,
    totalFailed,
    totalPostWarmupAttempted,
    totalPostWarmupSuccess,
    totalPostWarmupFailed,
    avgAttemptedPerSecond: totalAttempted / durationSeconds,
    avgSuccessPerSecond: totalSuccess / durationSeconds,
    avgFailedPerSecond: totalFailed / durationSeconds,
    avgPostWarmupSuccessPerSecond: totalPostWarmupSuccess / postWarmupDurationSeconds,
    firstStartedAtMs,
    lastStartedAtMs,
    totalFailedByCause,
    totalPostWarmupFailedByCause
  }
}

function shouldRetainEdgeFlowEvent(
  event: EdgeFlowEvent,
  index: number,
  sampleStride: number
): boolean {
  return event.status !== 'success' || index % sampleStride === 0
}

type RFState = {
  // --- Graph Data ---
  nodes: Node[]
  edges: Edge[]
  simulationMetricsByNode: Record<string, NodeSimulationMetrics>
  metricLens: MetricLens
  edgeFlowById: Record<string, EdgeFlowState>
  edgeFlowHistory: EdgeFlowRenderEvent[]
  edgeFlowPlayback: { wallStartMs: number; simStartMs: number } | null
  edgeFlowStatus: EdgeFlowStatus
  edgeFlowRunConfig: EdgeFlowRunConfig | null
  runInspectorPinned: boolean
  runInspectorDrilldownActive: boolean
  routingStrategyVisualization: RoutingStrategyVisualizationState | null

  // --- File State ---
  fileName: string | null
  isUnsaved: boolean
  scenario: ScenarioState
  displaySettings: DisplaySettings

  // --- Question mode ---
  /** The question the student is attempting, if any (injected by the host or a sample loader). */
  activeQuestion: QuestionPackage | null
  setActiveQuestion: (question: QuestionPackage | null) => void
  /** Ids of canvas nodes that came from the active question's scaffold (provenance). */
  scaffoldNodeIds: string[]
  /** Ids of canvas edges that came from the active question's scaffold (provenance). */
  scaffoldEdgeIds: string[]
  /** Raw host-authored HTML prompt for Newton assignment mode, when present. */
  activeQuestionPromptHtml: string | null
  setActiveQuestionPromptHtml: (html: string | null) => void
  /** User-visible host launch/configuration error for embedded assignment mode. */
  hostLaunchErrorMessage: string | null
  setHostLaunchErrorMessage: (message: string | null) => void
  /**
   * Non-blocking authoring notice shown when a question loaded in preview mode
   * (prompt visible) but its grading config is missing or invalid. Cleared once a
   * fully-authored question loads.
   */
  authoringWarning: string | null
  setAuthoringWarning: (message: string | null) => void
  attemptState: AttemptState | null
  setAttemptState: (attempt: AttemptState | null) => void
  /** Newton host save compatibility mode for the active question. */
  newtonSaveMode: NewtonSaveMode | null
  setNewtonSaveMode: (mode: NewtonSaveMode | null) => void
  /** The student's free-text answers to the active question's justify prompts, by prompt id. */
  justificationAnswers: Record<string, string>
  setJustificationAnswer: (promptId: string, text: string) => void
  clearJustificationAnswers: () => void
  /** Local/dev question load: a package to load through the full workspace loader (canvas reset +
   * scaffold), consumed by WorkspaceLayout. Lets authors load questions without an iframe host. */
  questionLoadRequest: QuestionPackage | null
  requestQuestionLoad: (question: QuestionPackage) => void
  clearQuestionLoadRequest: () => void
  /** The resolved presentation profile (visibility + capabilities) for question mode. */
  environmentProfile: EnvironmentProfile
  setEnvironmentProfile: (profile: EnvironmentProfile) => void
  /** Host `reveal` command: force rubric results visible regardless of profile timing. */
  resultsRevealed: boolean
  setResultsRevealed: (revealed: boolean) => void
  /** Last completed run's output — lets the always-on cost chip switch estimates
   *  to measured (consumption throughput, egress bytes). Cleared on reset/new run. */
  lastRunOutput: SimulationOutput | null
  setLastRunOutput: (output: SimulationOutput | null) => void
  viewportFitVersion: number
  requestViewportFit: () => void

  // --- Actions ---
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  addNode: (node: Node) => void
  updateNodeData: (nodeId: string, patch: CanvasNodeDataPatch) => void
  updateEdgeData: (
    edgeId: string,
    patch: { label?: string; data?: Partial<EdgeSimulationData> }
  ) => void
  setSimulationMetrics: (metrics: Record<string, NodeSimulationMetrics>) => void
  clearSimulationMetrics: () => void
  setMetricLens: (lens: MetricLens) => void
  recordEdgeFlowEvent: (event: EdgeFlowEvent) => void
  recordEdgeFlowEventBatch: (events: EdgeFlowEvent[]) => void
  setEdgeFlowStatus: (status: EdgeFlowStatus) => void
  setEdgeFlowRunConfig: (config: EdgeFlowRunConfig) => void
  setRunInspectorPinned: (pinned: boolean) => void
  setRunInspectorDrilldownActive: (active: boolean) => void
  clearEdgeFlow: () => void
  setRoutingStrategyVisualization: (state: RoutingStrategyVisualizationState | null) => void
  setNodes: (nodes: Node[], options?: GraphMutationOptions) => void
  setEdges: (edges: Edge[], options?: GraphMutationOptions) => void
  setGraph: (nodes: Node[], edges: Edge[], options?: GraphMutationOptions) => void
  selectGraphElements: (selection: { nodeId?: string; edgeId?: string }) => void
  graphHistory: GraphHistoryState
  graphRevision: number
  undoGraph: () => void
  redoGraph: () => void

  // --- File Actions ---
  setFileName: (name: string | null) => void
  setUnsaved: (unsaved: boolean) => void
  setScenario: (scenario: ScenarioState) => void
  updateScenario: (updater: (scenario: ScenarioState) => ScenarioState) => void
  updateDisplaySettings: (updater: (settings: DisplaySettings) => DisplaySettings) => void
}

const useStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  simulationMetricsByNode: {},
  metricLens: displaySettingsInitial.defaultMetricLens,
  edgeFlowById: {},
  edgeFlowHistory: [],
  edgeFlowPlayback: null,
  edgeFlowStatus: 'idle',
  edgeFlowRunConfig: null,
  runInspectorPinned: false,
  runInspectorDrilldownActive: false,
  routingStrategyVisualization: null,
  graphHistory: EMPTY_GRAPH_HISTORY,
  graphRevision: 0,

  // Initial File State
  fileName: 'Untitled',
  isUnsaved: false,
  scenario: DEFAULT_SCENARIO_STATE,
  displaySettings: displaySettingsInitial,
  activeQuestion: null,
  scaffoldNodeIds: [],
  scaffoldEdgeIds: [],
  activeQuestionPromptHtml: null,
  hostLaunchErrorMessage: null,
  authoringWarning: null,
  attemptState: null,
  newtonSaveMode: null,
  justificationAnswers: {},
  questionLoadRequest: null,
  environmentProfile: DEFAULT_ENVIRONMENT_PROFILE,
  resultsRevealed: false,
  lastRunOutput: null,
  viewportFitVersion: 0,

  onNodesChange: (changes: NodeChange[]) => {
    set((state) => {
      // Locked scaffold nodes stay selectable, but movement/resize/removal changes
      // are dropped here so React Flow cannot mutate them through onNodesChange.
      const permitted = changes.filter((change) => {
        if (!('id' in change)) {
          return true
        }
        if (change.type === 'select') {
          return true
        }
        if (change.type === 'remove') {
          return !isNodeRemovalLocked(
            change.id,
            state.scaffoldNodeIds,
            state.activeQuestion,
            state.environmentProfile,
            state.attemptState?.status
          )
        }
        return !isNodeEditLocked(
          change.id,
          state.scaffoldNodeIds,
          state.activeQuestion,
          state.environmentProfile,
          state.attemptState?.status
        )
      })
      const nodes = applyNodeChanges(permitted, state.nodes)
      const hasMeaningfulChange = shouldRecordNodeChanges(permitted)
      const isDragging = hasActiveNodeDrag(permitted)
      const hasPositionChange = hasNodePositionChange(permitted)

      if (!hasMeaningfulChange) {
        return {
          nodes,
          graphHistory: state.graphHistory
        }
      }

      if (isDragging) {
        return {
          nodes,
          graphHistory: beginGraphDragSession(state, collectChangedNodeIds(permitted))
        }
      }

      if (hasPositionChange && state.graphHistory.dragSession) {
        return {
          nodes,
          graphHistory: state.graphHistory
        }
      }

      const removedNodeIds = collectRemovedNodeIds(permitted)
      const historyEntry = hasPositionChange
        ? buildMoveNodesHistoryEntry(
            captureNodesById(state.nodes, collectChangedNodeIds(permitted)),
            captureNodesById(nodes, collectChangedNodeIds(permitted))
          )
        : removedNodeIds.size > 0
          ? {
              kind: 'remove-nodes' as const,
              nodes: captureIndexedNodes(state.nodes, removedNodeIds)
            }
          : null
      const mutation = resolveGraphMutation(
        state,
        { nodes, edges: state.edges },
        undefined,
        historyEntry
      )

      return {
        nodes,
        ...mutation
      }
    })
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set((state) => {
      const permitted = changes.filter((change) => {
        const edgeId = 'id' in change ? change.id : null
        if (edgeId === null) {
          return true
        }
        if (change.type === 'select') {
          return true
        }
        if (change.type === 'remove') {
          return !isEdgeRemovalLocked(
            edgeId,
            state.scaffoldEdgeIds,
            state.activeQuestion,
            state.environmentProfile,
            state.attemptState?.status
          )
        }
        return !isEdgeEditLocked(
          edgeId,
          state.scaffoldEdgeIds,
          state.activeQuestion,
          state.environmentProfile,
          state.attemptState?.status
        )
      })
      const edges = applyEdgeChanges(permitted, state.edges)
      const removedEdgeIds = collectRemovedEdgeIds(permitted)
      const historyEntry =
        removedEdgeIds.size > 0
          ? {
              kind: 'remove-edges' as const,
              edges: captureIndexedEdges(state.edges, removedEdgeIds)
            }
          : null
      const mutation = shouldRecordEdgeChanges(permitted)
        ? resolveGraphMutation(state, { nodes: state.nodes, edges }, undefined, historyEntry)
        : { graphHistory: state.graphHistory, graphRevision: state.graphRevision }

      return {
        edges,
        ...mutation
      }
    })
  },

  onConnect: (connection: Connection) => {
    set((state) => {
      const edges = addEdge(connection, state.edges)
      const nextEdge = edges[edges.length - 1]
      const historyEntry =
        nextEdge && edges.length === state.edges.length + 1
          ? {
              kind: 'add-edge' as const,
              edge: {
                index: edges.length - 1,
                edge: cloneEdgeForHistory(nextEdge)
              }
            }
          : null
      const mutation = resolveGraphMutation(
        state,
        { nodes: state.nodes, edges },
        undefined,
        historyEntry
      )

      return {
        edges,
        ...mutation
      }
    })
  },

  undoGraph: () => {
    set((state) => {
      if (state.attemptState?.status === 'LOCKED') {
        return {}
      }

      const previous = state.graphHistory.past[state.graphHistory.past.length - 1]
      if (!previous) {
        return {}
      }

      const restored = applyGraphHistoryEntry(snapshotGraph(state), previous, 'undo')
      return {
        nodes: restored.nodes,
        edges: restored.edges,
        graphRevision: state.graphRevision + 1,
        graphHistory: {
          past: state.graphHistory.past.slice(0, -1),
          future: [previous, ...state.graphHistory.future].slice(0, GRAPH_HISTORY_LIMIT),
          dragSession: null
        }
      }
    })
  },

  redoGraph: () => {
    set((state) => {
      if (state.attemptState?.status === 'LOCKED') {
        return {}
      }

      const next = state.graphHistory.future[0]
      if (!next) {
        return {}
      }

      const restored = applyGraphHistoryEntry(snapshotGraph(state), next, 'redo')
      return {
        nodes: restored.nodes,
        edges: restored.edges,
        graphRevision: state.graphRevision + 1,
        graphHistory: {
          past: [...state.graphHistory.past, next].slice(-GRAPH_HISTORY_LIMIT),
          future: state.graphHistory.future.slice(1),
          dragSession: null
        }
      }
    })
  },

  addNode: (node: Node) => {
    // A frozen attempt (host `lock`) admits no new nodes.
    if (get().attemptState?.status === 'LOCKED') {
      return
    }
    const currentNodes = get().nodes
    let newId = node.id

    // Check if ID exists. If yes, append timestamp/random to make it unique.
    if (currentNodes.some((n) => n.id === newId)) {
      newId = `${newId}_${Math.floor(Math.random() * 10000)}`
    }

    const isVpcContainer = node.type === 'vpcNode'

    let calculatedZIndex = node.zIndex

    if (isVpcContainer) {
      if (node.parentNode) {
        const parentObj = currentNodes.find((n) => n.id === node.parentNode)

        const parentZIndex = parentObj?.zIndex !== undefined ? parentObj.zIndex : -10
        calculatedZIndex = parentZIndex + 1
      } else {
        calculatedZIndex = -10
      }
    }
    const safeNode = {
      ...node,
      id: newId,
      ...(isVpcContainer && { zIndex: calculatedZIndex })
    }

    set((state) => {
      const nodes = [...state.nodes, safeNode]
      const mutation = resolveGraphMutation(state, { nodes, edges: state.edges }, undefined, {
        kind: 'add-node',
        node: {
          index: nodes.length - 1,
          node: cloneNodeForHistory(safeNode)
        }
      })

      return {
        nodes,
        ...mutation
      }
    })
  },

  setNodes: (nodes: Node[], options) => {
    set((state) => {
      const nextSnapshot = { nodes, edges: state.edges }

      if (options?.resetHistory || options?.history === 'skip') {
        return {
          nodes,
          ...resolveGraphMutation(state, nextSnapshot, options)
        }
      }

      const historyEntry =
        options?.history === 'drag-commit' && state.graphHistory.dragSession
          ? buildMoveNodesHistoryEntry(
              state.graphHistory.dragSession.beforeNodes,
              captureNodesById(
                nodes,
                new Set(state.graphHistory.dragSession.beforeNodes.map((node) => node.id))
              )
            )
          : buildSetNodesHistoryEntry(state.nodes, nodes)
      const mutation = resolveDerivedGraphMutation(state, nextSnapshot, options, historyEntry)

      return {
        nodes,
        ...mutation
      }
    })
  },

  setEdges: (edges: Edge[], options) => {
    set((state) => {
      const nextSnapshot = { nodes: state.nodes, edges }

      if (options?.resetHistory || options?.history === 'skip') {
        return {
          edges,
          ...resolveGraphMutation(state, nextSnapshot, options)
        }
      }

      return {
        edges,
        ...resolveDerivedGraphMutation(
          state,
          nextSnapshot,
          options,
          buildSetEdgesHistoryEntry(state.edges, edges)
        )
      }
    })
  },

  setGraph: (nodes: Node[], edges: Edge[], options) => {
    set((state) => {
      const nextSnapshot = { nodes, edges }

      if (options?.resetHistory || options?.history === 'skip') {
        return {
          nodes,
          edges,
          ...resolveGraphMutation(state, nextSnapshot, options)
        }
      }

      return {
        nodes,
        edges,
        ...resolveDerivedGraphMutation(
          state,
          nextSnapshot,
          options,
          buildSetGraphHistoryEntry({ nodes: state.nodes, edges: state.edges }, nextSnapshot)
        )
      }
    })
  },

  selectGraphElements: ({ nodeId, edgeId }) => {
    set({
      runInspectorPinned:
        nodeId !== undefined || edgeId !== undefined ? false : get().runInspectorPinned,
      runInspectorDrilldownActive:
        nodeId !== undefined || edgeId !== undefined ? false : get().runInspectorDrilldownActive,
      nodes: get().nodes.map((node) => ({
        ...node,
        selected: nodeId !== undefined && node.id === nodeId
      })),
      edges: get().edges.map((edge) => ({
        ...edge,
        selected: edgeId !== undefined && edge.id === edgeId
      }))
    })
  },

  updateNodeData: (nodeId: string, patch: CanvasNodeDataPatch) => {
    const { activeQuestion, scaffoldNodeIds, environmentProfile, attemptState } = get()
    if (
      isNodeEditLocked(
        nodeId,
        scaffoldNodeIds,
        activeQuestion,
        environmentProfile,
        attemptState?.status
      )
    ) {
      return
    }
    set((state) => {
      const existingNode = state.nodes.find((node) => node.id === nodeId)
      if (!existingNode) {
        return {}
      }

      const typedPatch = patch as Record<string, unknown>
      if (
        !hasRecordPatchChanges(existingNode.data as Record<string, unknown> | undefined, typedPatch)
      ) {
        return {}
      }

      const nextNode = {
        ...existingNode,
        data: {
          ...(existingNode.data as Record<string, unknown>),
          ...typedPatch
        }
      }
      const nodes = state.nodes.map((node) => (node.id === nodeId ? nextNode : node))
      const mutation = resolveGraphMutation(state, { nodes, edges: state.edges }, undefined, {
        kind: 'update-node',
        before: cloneNodeForHistory(existingNode),
        after: cloneNodeForHistory(nextNode)
      })

      return {
        nodes,
        ...mutation
      }
    })
  },

  updateEdgeData: (edgeId, patch) => {
    const { activeQuestion, scaffoldEdgeIds, environmentProfile, attemptState } = get()
    if (
      isEdgeEditLocked(
        edgeId,
        scaffoldEdgeIds,
        activeQuestion,
        environmentProfile,
        attemptState?.status
      )
    ) {
      return
    }
    set((state) => {
      const existingEdge = state.edges.find((edge) => edge.id === edgeId)
      if (!existingEdge) {
        return {}
      }

      const nextData = patch.data
        ? {
            ...((existingEdge.data as Record<string, unknown> | undefined) ?? {}),
            ...patch.data
          }
        : existingEdge.data
      const labelChanged = patch.label !== undefined && patch.label !== existingEdge.label
      const dataChanged =
        patch.data !== undefined &&
        hasRecordPatchChanges(
          (existingEdge.data as Record<string, unknown> | undefined) ?? {},
          patch.data as Record<string, unknown>
        )

      if (!labelChanged && !dataChanged) {
        return {}
      }

      const nextEdge = {
        ...existingEdge,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(nextData !== undefined ? { data: nextData } : {})
      }
      const edges = state.edges.map((edge) => (edge.id === edgeId ? nextEdge : edge))
      const mutation = resolveGraphMutation(state, { nodes: state.nodes, edges }, undefined, {
        kind: 'update-edge',
        before: cloneEdgeForHistory(existingEdge),
        after: cloneEdgeForHistory(nextEdge)
      })

      return {
        edges,
        ...mutation
      }
    })
  },

  setSimulationMetrics: (simulationMetricsByNode) => {
    set((state) => ({
      simulationMetricsByNode,
      metricLens: RUNTIME_METRIC_LENSES.has(state.metricLens) ? state.metricLens : 'traffic'
    }))
  },

  setMetricLens: (metricLens) => {
    set({ metricLens })
  },

  clearSimulationMetrics: () => {
    set((state) => ({
      simulationMetricsByNode: {},
      metricLens: state.displaySettings.defaultMetricLens
    }))
  },

  recordEdgeFlowEvent: (event) => {
    get().recordEdgeFlowEventBatch([event])
  },

  recordEdgeFlowEventBatch: (events) => {
    if (events.length === 0) {
      return
    }

    const receivedAtMs = Date.now()

    set((state) => {
      const playback = state.edgeFlowPlayback ?? {
        wallStartMs: receivedAtMs,
        simStartMs: events[0]?.startedAtMs ?? 0
      }
      const countedEventsByEdgeId = new Map<string, EdgeFlowEvent[]>()
      const retainedEventsByEdgeId = new Map<string, EdgeFlowRenderEvent[]>()
      const retainedEvents: EdgeFlowRenderEvent[] = []

      for (const event of events) {
        const counted = countedEventsByEdgeId.get(event.edgeId)
        if (counted) {
          counted.push(event)
        } else {
          countedEventsByEdgeId.set(event.edgeId, [event])
        }
      }

      for (const [edgeId, edgeEvents] of countedEventsByEdgeId) {
        const retainedTarget = Math.max(
          1,
          Math.ceil((EDGE_FLOW_LIVE_RETAINED_EVENTS_PER_BATCH * edgeEvents.length) / events.length)
        )
        const sampleStride = Math.max(1, Math.ceil(edgeEvents.length / retainedTarget))

        edgeEvents.forEach((event, index) => {
          if (!shouldRetainEdgeFlowEvent(event, index, sampleStride)) {
            return
          }

          const displayAtMs =
            playback.wallStartMs +
            (event.startedAtMs - playback.simStartMs) / EDGE_FLOW_PLAYBACK_SPEED
          const renderedEvent: EdgeFlowRenderEvent = {
            ...event,
            receivedAtMs,
            displayAtMs,
            sampleWeight: event.status === 'success' ? sampleStride : 1
          }
          const existing = retainedEventsByEdgeId.get(edgeId)
          if (existing) {
            existing.push(renderedEvent)
          } else {
            retainedEventsByEdgeId.set(edgeId, [renderedEvent])
          }
          retainedEvents.push(renderedEvent)
        })
      }

      retainedEvents.sort(
        (first, second) =>
          first.startedAtMs - second.startedAtMs ||
          first.sequence - second.sequence ||
          first.edgeId.localeCompare(second.edgeId)
      )
      const edgeFlowById = { ...state.edgeFlowById }
      const warmupDurationMs = state.edgeFlowRunConfig?.warmupDurationMs ?? 0

      for (const [edgeId, edgeEvents] of countedEventsByEdgeId) {
        const previous = edgeFlowById[edgeId] ?? EMPTY_EDGE_FLOW_STATE
        edgeFlowById[edgeId] = mergeEdgeFlowState(
          previous,
          edgeEvents,
          retainedEventsByEdgeId.get(edgeId) ?? [],
          warmupDurationMs
        )
      }

      return {
        edgeFlowStatus: 'running' as const,
        edgeFlowPlayback: playback,
        edgeFlowHistory: state.edgeFlowHistory
          .concat(retainedEvents)
          .slice(-EDGE_FLOW_HISTORY_MAX_EVENTS),
        edgeFlowById
      }
    })
  },

  setEdgeFlowStatus: (status) => {
    set({ edgeFlowStatus: status })
  },

  setEdgeFlowRunConfig: (config) => {
    set({ edgeFlowRunConfig: config })
  },

  setRunInspectorPinned: (pinned) => {
    set({
      runInspectorPinned: pinned,
      ...(pinned ? { runInspectorDrilldownActive: false } : {})
    })
  },

  setRunInspectorDrilldownActive: (active) => {
    set({ runInspectorDrilldownActive: active })
  },

  clearEdgeFlow: () => {
    set({
      edgeFlowById: {},
      edgeFlowHistory: [],
      edgeFlowPlayback: null,
      edgeFlowStatus: 'idle',
      edgeFlowRunConfig: null,
      runInspectorPinned: false,
      runInspectorDrilldownActive: false
    })
  },

  setRoutingStrategyVisualization: (routingStrategyVisualization) => {
    set({ routingStrategyVisualization })
  },

  // File State Setters
  setFileName: (fileName) => set({ fileName }),
  setUnsaved: (isUnsaved) => set({ isUnsaved }),
  setScenario: (scenario) => set({ scenario }),
  setActiveQuestion: (activeQuestion) =>
    set({
      activeQuestion,
      // A node's scaffold provenance is canonical: its id is in the authored
      // scaffold topology, independent of what a resumed attempt loaded.
      scaffoldNodeIds:
        activeQuestion && activeQuestion.scaffold.type !== 'empty'
          ? activeQuestion.scaffold.topology.nodes.map((node) => node.id)
          : [],
      scaffoldEdgeIds:
        activeQuestion && activeQuestion.scaffold.type !== 'empty'
          ? activeQuestion.scaffold.topology.edges.map((edge) => edge.id)
          : []
    }),
  setActiveQuestionPromptHtml: (activeQuestionPromptHtml) => set({ activeQuestionPromptHtml }),
  setHostLaunchErrorMessage: (hostLaunchErrorMessage) => set({ hostLaunchErrorMessage }),
  setAuthoringWarning: (authoringWarning) => set({ authoringWarning }),
  setAttemptState: (attemptState) => set({ attemptState }),
  setNewtonSaveMode: (newtonSaveMode) => set({ newtonSaveMode }),
  setJustificationAnswer: (promptId, text) =>
    set((state) => ({
      justificationAnswers: { ...state.justificationAnswers, [promptId]: text }
    })),
  clearJustificationAnswers: () => set({ justificationAnswers: {} }),
  requestQuestionLoad: (questionLoadRequest) => set({ questionLoadRequest }),
  clearQuestionLoadRequest: () => set({ questionLoadRequest: null }),
  setEnvironmentProfile: (environmentProfile) => set({ environmentProfile }),
  setResultsRevealed: (resultsRevealed) => set({ resultsRevealed }),
  setLastRunOutput: (lastRunOutput) => set({ lastRunOutput }),
  requestViewportFit: () =>
    set((state) => ({
      viewportFitVersion: state.viewportFitVersion + 1
    })),
  updateScenario: (updater) => set((state) => ({ scenario: updater(state.scenario) })),
  updateDisplaySettings: (updater) =>
    set((state) => {
      const displaySettings = updater(state.displaySettings)
      persistDisplaySettings(displaySettings)

      return {
        displaySettings,
        ...(Object.keys(state.simulationMetricsByNode).length === 0
          ? { metricLens: displaySettings.defaultMetricLens }
          : {})
      }
    })
}))

export default useStore
