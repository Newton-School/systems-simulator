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
  ScenarioState
} from '@renderer/types/ui'
import { DEFAULT_SCENARIO_STATE } from '@renderer/types/ui'
import type { EdgeFlowEvent } from '../../../engine/core/events'
import type { WorkloadProfile } from '../../../engine/core/types'

export type EdgeFlowRenderEvent = EdgeFlowEvent & {
  receivedAtMs: number
  displayAtMs: number
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
  avgAttemptedPerSecond: number
  avgSuccessPerSecond: number
  avgFailedPerSecond: number
  firstStartedAtMs: number
  lastStartedAtMs: number
}

export type EdgeFlowStatus = 'idle' | 'running' | 'complete'

export interface EdgeFlowRunConfig {
  workload: WorkloadProfile
  simulationDurationMs: number
}

const EDGE_FLOW_WINDOW_MS = 6_000
const EDGE_FLOW_MAX_EVENTS = 25_000
const EDGE_FLOW_PLAYBACK_SPEED = 10

const EMPTY_EDGE_FLOW_STATE: EdgeFlowState = {
  recent: [],
  attemptedPerSecond: 0,
  successPerSecond: 0,
  failedPerSecond: 0,
  failureRatio: 0,
  totalAttempted: 0,
  totalSuccess: 0,
  totalFailed: 0,
  avgAttemptedPerSecond: 0,
  avgSuccessPerSecond: 0,
  avgFailedPerSecond: 0,
  firstStartedAtMs: 0,
  lastStartedAtMs: 0
}

function summarizeEdgeFlow(
  events: EdgeFlowRenderEvent[]
): Pick<
  EdgeFlowState,
  'attemptedPerSecond' | 'successPerSecond' | 'failedPerSecond' | 'failureRatio'
> {
  const attempted = events.length
  const success = events.filter((event) => event.status === 'success').length
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

type RFState = {
  // --- Graph Data ---
  nodes: Node[]
  edges: Edge[]
  simulationMetricsByNode: Record<string, NodeSimulationMetrics>
  edgeFlowById: Record<string, EdgeFlowState>
  edgeFlowPlayback: { wallStartMs: number; simStartMs: number } | null
  edgeFlowStatus: EdgeFlowStatus
  edgeFlowRunConfig: EdgeFlowRunConfig | null

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
  recordEdgeFlowEvent: (event: EdgeFlowEvent) => void
  setEdgeFlowStatus: (status: EdgeFlowStatus) => void
  setEdgeFlowRunConfig: (config: EdgeFlowRunConfig) => void
  clearEdgeFlow: () => void
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
  edgeFlowById: {},
  edgeFlowPlayback: null,
  edgeFlowStatus: 'idle',
  edgeFlowRunConfig: null,

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
    set({ simulationMetricsByNode })
  },

  clearSimulationMetrics: () => {
    set({ simulationMetricsByNode: {} })
  },

  recordEdgeFlowEvent: (event) => {
    const now = Date.now()
    const playback = get().edgeFlowPlayback ?? {
      wallStartMs: now,
      simStartMs: event.startedAtMs
    }
    const edgeFlowById = get().edgeFlowById
    const previous = edgeFlowById[event.edgeId] ?? EMPTY_EDGE_FLOW_STATE
    const displayAtMs =
      playback.wallStartMs + (event.startedAtMs - playback.simStartMs) / EDGE_FLOW_PLAYBACK_SPEED
    const recent = [
      ...previous.recent,
      {
        ...event,
        receivedAtMs: now,
        displayAtMs
      }
    ]
      .filter((item) => displayAtMs - item.displayAtMs <= EDGE_FLOW_WINDOW_MS * 2)
      .slice(-EDGE_FLOW_MAX_EVENTS)
    const totalAttempted = previous.totalAttempted + 1
    const totalSuccess = previous.totalSuccess + (event.status === 'success' ? 1 : 0)
    const totalFailed = totalAttempted - totalSuccess
    const firstStartedAtMs =
      previous.totalAttempted === 0 ? event.startedAtMs : previous.firstStartedAtMs
    const lastStartedAtMs = Math.max(previous.lastStartedAtMs, event.startedAtMs)
    const durationSeconds = Math.max(1, (lastStartedAtMs - firstStartedAtMs) / 1000)

    set({
      edgeFlowStatus: 'running',
      edgeFlowPlayback: playback,
      edgeFlowById: {
        ...edgeFlowById,
        [event.edgeId]: {
          recent,
          ...summarizeEdgeFlow(recent),
          totalAttempted,
          totalSuccess,
          totalFailed,
          avgAttemptedPerSecond: totalAttempted / durationSeconds,
          avgSuccessPerSecond: totalSuccess / durationSeconds,
          avgFailedPerSecond: totalFailed / durationSeconds,
          firstStartedAtMs,
          lastStartedAtMs
        }
      }
    })
  },

  setEdgeFlowStatus: (status) => {
    set({ edgeFlowStatus: status })
  },

  setEdgeFlowRunConfig: (config) => {
    set({ edgeFlowRunConfig: config })
  },

  clearEdgeFlow: () => {
    set({
      edgeFlowById: {},
      edgeFlowPlayback: null,
      edgeFlowStatus: 'idle',
      edgeFlowRunConfig: null
    })
  },

  // File State Setters
  setFileName: (fileName) => set({ fileName }),
  setUnsaved: (isUnsaved) => set({ isUnsaved }),
  setScenario: (scenario) => set({ scenario }),
  updateScenario: (updater) => set((state) => ({ scenario: updater(state.scenario) }))
}))

export default useStore
