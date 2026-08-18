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
  MetricLens
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

/**
 * A node's edits/deletions are locked when either (a) the whole attempt is frozen
 * by a host `lock` command, or (b) it is a scaffold-provided node and the active
 * EnvironmentProfile disallows editing scaffold nodes. Enforced in the store so no
 * UI path can bypass it.
 */
function isNodeEditLocked(
  nodeId: string,
  scaffoldNodeIds: readonly string[],
  profile: EnvironmentProfile,
  attemptStatus: AttemptState['status'] | undefined
): boolean {
  if (attemptStatus === 'LOCKED') {
    return true
  }
  return !profile.capabilities.canEditScaffoldNodes && scaffoldNodeIds.includes(nodeId)
}
import type { RoutingStrategy } from '../../../engine/catalog/nodeSpecTypes'

type FailureCountsByCause = Partial<Record<EdgeFailureCause, number>>
type GraphSnapshot = { nodes: Node[]; edges: Edge[] }
type GraphMutationOptions = { history?: 'record' | 'skip'; resetHistory?: boolean }
type GraphHistoryState = {
  past: GraphSnapshot[]
  future: GraphSnapshot[]
  dragSnapshot: GraphSnapshot | null
}

const RUNTIME_METRIC_LENSES: ReadonlySet<MetricLens> = new Set([
  'traffic',
  'saturation',
  'latency',
  'errors',
  'throughput'
])

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
const EMPTY_GRAPH_HISTORY: GraphHistoryState = {
  past: [],
  future: [],
  dragSnapshot: null
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

function areGraphSnapshotsEqual(first: GraphSnapshot, second: GraphSnapshot): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function pushGraphHistory(state: RFState): GraphHistoryState {
  const snapshot = snapshotGraph(state)
  const lastSnapshot = state.graphHistory.past[state.graphHistory.past.length - 1]

  if (lastSnapshot && areGraphSnapshotsEqual(lastSnapshot, snapshot)) {
    return { ...state.graphHistory, future: [], dragSnapshot: null }
  }

  return {
    past: [...state.graphHistory.past, snapshot].slice(-GRAPH_HISTORY_LIMIT),
    future: [],
    dragSnapshot: null
  }
}

function pushGraphDragHistory(state: RFState): GraphHistoryState {
  if (state.graphHistory.dragSnapshot) {
    return state.graphHistory
  }

  return {
    ...pushGraphHistory(state),
    dragSnapshot: snapshotGraph(state)
  }
}

function resolveGraphHistory(
  state: RFState,
  nextSnapshot: GraphSnapshot,
  options?: GraphMutationOptions
): GraphHistoryState {
  if (options?.resetHistory) {
    return EMPTY_GRAPH_HISTORY
  }

  if (options?.history === 'skip') {
    return state.graphHistory
  }

  if (areGraphSnapshotsEqual(snapshotGraph(state), nextSnapshot)) {
    return state.graphHistory
  }

  return pushGraphHistory(state)
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

  // --- Question mode ---
  /** The question the student is attempting, if any (injected by the host or a sample loader). */
  activeQuestion: QuestionPackage | null
  setActiveQuestion: (question: QuestionPackage | null) => void
  /** Ids of canvas nodes that came from the active question's scaffold (provenance). */
  scaffoldNodeIds: string[]
  /** Raw host-authored HTML prompt for Newton assignment mode, when present. */
  activeQuestionPromptHtml: string | null
  setActiveQuestionPromptHtml: (html: string | null) => void
  /** User-visible host launch/configuration error for embedded assignment mode. */
  hostLaunchErrorMessage: string | null
  setHostLaunchErrorMessage: (message: string | null) => void
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
  undoGraph: () => void
  redoGraph: () => void

  // --- File Actions ---
  setFileName: (name: string | null) => void
  setUnsaved: (unsaved: boolean) => void
  setScenario: (scenario: ScenarioState) => void
  updateScenario: (updater: (scenario: ScenarioState) => ScenarioState) => void
}

const useStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  simulationMetricsByNode: {},
  metricLens: 'concurrency',
  edgeFlowById: {},
  edgeFlowHistory: [],
  edgeFlowPlayback: null,
  edgeFlowStatus: 'idle',
  edgeFlowRunConfig: null,
  runInspectorPinned: false,
  runInspectorDrilldownActive: false,
  routingStrategyVisualization: null,
  graphHistory: EMPTY_GRAPH_HISTORY,

  // Initial File State
  fileName: 'Untitled',
  isUnsaved: false,
  scenario: DEFAULT_SCENARIO_STATE,
  activeQuestion: null,
  scaffoldNodeIds: [],
  activeQuestionPromptHtml: null,
  hostLaunchErrorMessage: null,
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
      // Drop deletions of locked nodes (scaffold-locked or a frozen attempt); all
      // other changes pass through.
      const permitted = changes.filter(
        (change) =>
          !(
            change.type === 'remove' &&
            isNodeEditLocked(
              change.id,
              state.scaffoldNodeIds,
              state.environmentProfile,
              state.attemptState?.status
            )
          )
      )
      const nodes = applyNodeChanges(permitted, state.nodes)
      const hasMeaningfulChange = shouldRecordNodeChanges(permitted)
      const isDragging = hasActiveNodeDrag(permitted)
      const hasPositionChange = hasNodePositionChange(permitted)
      const graphHistory = !hasMeaningfulChange
        ? state.graphHistory
        : isDragging
          ? pushGraphDragHistory(state)
          : {
              ...(hasPositionChange && state.graphHistory.dragSnapshot
                ? state.graphHistory
                : resolveGraphHistory(state, { nodes, edges: state.edges })),
              dragSnapshot: null
            }

      return {
        nodes,
        graphHistory
      }
    })
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set((state) => {
      const edges = applyEdgeChanges(changes, state.edges)
      return {
        edges,
        graphHistory: shouldRecordEdgeChanges(changes)
          ? resolveGraphHistory(state, { nodes: state.nodes, edges })
          : state.graphHistory
      }
    })
  },

  onConnect: (connection: Connection) => {
    set((state) => {
      const edges = addEdge(connection, state.edges)
      return {
        edges,
        graphHistory: resolveGraphHistory(state, { nodes: state.nodes, edges })
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

      const current = snapshotGraph(state)
      const restored = cloneGraphSnapshot(previous)
      return {
        nodes: restored.nodes,
        edges: restored.edges,
        graphHistory: {
          past: state.graphHistory.past.slice(0, -1),
          future: [current, ...state.graphHistory.future].slice(0, GRAPH_HISTORY_LIMIT),
          dragSnapshot: null
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

      const current = snapshotGraph(state)
      const restored = cloneGraphSnapshot(next)
      return {
        nodes: restored.nodes,
        edges: restored.edges,
        graphHistory: {
          past: [...state.graphHistory.past, current].slice(-GRAPH_HISTORY_LIMIT),
          future: state.graphHistory.future.slice(1),
          dragSnapshot: null
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
      return {
        nodes,
        graphHistory: resolveGraphHistory(state, { nodes, edges: state.edges })
      }
    })
  },

  setNodes: (nodes: Node[], options) => {
    set((state) => ({
      nodes,
      graphHistory: resolveGraphHistory(state, { nodes, edges: state.edges }, options)
    }))
  },

  setEdges: (edges: Edge[], options) => {
    set((state) => ({
      edges,
      graphHistory: resolveGraphHistory(state, { nodes: state.nodes, edges }, options)
    }))
  },

  setGraph: (nodes: Node[], edges: Edge[], options) => {
    set((state) => ({
      nodes,
      edges,
      graphHistory: resolveGraphHistory(state, { nodes, edges }, options)
    }))
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
    const { scaffoldNodeIds, environmentProfile, attemptState } = get()
    if (isNodeEditLocked(nodeId, scaffoldNodeIds, environmentProfile, attemptState?.status)) {
      return
    }
    set((state) => {
      const nodes = state.nodes.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...(node.data as Record<string, unknown>),
              ...(patch as Record<string, unknown>)
            }
          }
        }
        return node
      })

      return {
        nodes,
        graphHistory: resolveGraphHistory(state, { nodes, edges: state.edges })
      }
    })
  },

  updateEdgeData: (edgeId, patch) => {
    set((state) => {
      const edges = state.edges.map((edge) => {
        if (edge.id === edgeId) {
          const nextData = patch.data
            ? {
                ...((edge.data as Record<string, unknown> | undefined) ?? {}),
                ...patch.data
              }
            : edge.data
          return {
            ...edge,
            ...(patch.label !== undefined ? { label: patch.label } : {}),
            ...(nextData !== undefined ? { data: nextData } : {})
          }
        }
        return edge
      })

      return {
        edges,
        graphHistory: resolveGraphHistory(state, { nodes: state.nodes, edges })
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
    set({ simulationMetricsByNode: {}, metricLens: 'concurrency' })
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
      // A node's scaffold provenance is canonical: its id is in the question's
      // partial-scaffold topology. Independent of what a resumed attempt loaded.
      scaffoldNodeIds:
        activeQuestion?.scaffold.type === 'partial'
          ? activeQuestion.scaffold.topology.nodes.map((node) => node.id)
          : []
    }),
  setActiveQuestionPromptHtml: (activeQuestionPromptHtml) => set({ activeQuestionPromptHtml }),
  setHostLaunchErrorMessage: (hostLaunchErrorMessage) => set({ hostLaunchErrorMessage }),
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
  updateScenario: (updater) => set((state) => ({ scenario: updater(state.scenario) }))
}))

export default useStore
