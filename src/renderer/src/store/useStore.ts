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
import { DEFAULT_SCENARIO_STATE } from '@renderer/types/ui'
import type { EdgeFailureCause, EdgeFlowEvent } from '../../../engine/core/events'
import type { WorkloadProfile } from '../../../engine/core/types'
import type { RoutingStrategy } from '../../../engine/catalog/nodeSpecTypes'

type FailureCountsByCause = Partial<Record<EdgeFailureCause, number>>

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

const EDGE_FLOW_WINDOW_MS = 6_000
const EDGE_FLOW_MAX_EVENTS = 25_000
const EDGE_FLOW_HISTORY_MAX_EVENTS = 10_000
const EDGE_FLOW_PLAYBACK_SPEED = 10
const EDGE_FLOW_LIVE_RETAINED_EVENTS_PER_BATCH = 100

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

function summarizeEdgeFlow(
  events: EdgeFlowRenderEvent[]
): Pick<
  EdgeFlowState,
  'attemptedPerSecond' | 'successPerSecond' | 'failedPerSecond' | 'failureRatio'
> {
  let attempted = 0
  let success = 0

  for (const event of events) {
    const weight = event.sampleWeight
    attempted += weight
    if (event.status === 'success') {
      success += weight
    }
  }

  const failed = attempted - success
  const first = events[0]?.displayAtMs
  const last = events[events.length - 1]?.displayAtMs
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

  // --- Actions ---
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  addNode: (node: Node) => void
  updateNodeData: (nodeId: string, patch: Partial<AnyNodeData>) => void
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
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  selectGraphElements: (selection: { nodeId?: string; edgeId?: string }) => void

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

  // Initial File State
  fileName: 'Untitled',
  isUnsaved: false,
  scenario: DEFAULT_SCENARIO_STATE,

  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes)
    })
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges)
    })
  },

  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(connection, get().edges)
    })
  },

  addNode: (node: Node) => {
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

    set({ nodes: [...currentNodes, safeNode] })
  },

  setNodes: (nodes: Node[]) => {
    set({ nodes })
  },

  setEdges: (edges: Edge[]) => {
    set({ edges })
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

  updateNodeData: (nodeId: string, patch: Partial<AnyNodeData>) => {
    set({
      nodes: get().nodes.map((node) => {
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
    })
  },

  updateEdgeData: (edgeId, patch) => {
    set({
      edges: get().edges.map((edge) => {
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
    })
  },

  setSimulationMetrics: (simulationMetricsByNode) => {
    set({ simulationMetricsByNode, metricLens: 'traffic' })
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
  updateScenario: (updater) => set((state) => ({ scenario: updater(state.scenario) }))
}))

export default useStore
