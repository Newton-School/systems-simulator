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

const SAVED_SEEDS_KEY = 'ns_simulator_saved_seeds'

function loadSavedSeeds(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_SEEDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

function persistSeeds(seeds: string[]) {
  try {
    localStorage.setItem(SAVED_SEEDS_KEY, JSON.stringify(seeds))
  } catch {
    // Ignore localStorage errors
  }
}

type RFState = {
  // --- Graph Data ---
  nodes: Node[]
  edges: Edge[]
  simulationMetricsByNode: Record<string, NodeSimulationMetrics>

  // --- File State ---
  fileName: string | null
  isUnsaved: boolean
  scenario: ScenarioState
  savedSeeds: string[]

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
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  selectGraphElements: (selection: { nodeId?: string; edgeId?: string }) => void

  // --- File Actions ---
  setFileName: (name: string | null) => void
  setUnsaved: (unsaved: boolean) => void
  setScenario: (scenario: ScenarioState) => void
  updateScenario: (updater: (scenario: ScenarioState) => ScenarioState) => void
  saveSeed: (seed: string) => void
  removeSeed: (seed: string) => void
}

const useStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  simulationMetricsByNode: {},

  // Initial File State
  fileName: 'Untitled',
  isUnsaved: false,
  scenario: DEFAULT_SCENARIO_STATE,
  savedSeeds: loadSavedSeeds(),

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

  // File State Setters
  setFileName: (fileName) => set({ fileName }),
  setUnsaved: (isUnsaved) => set({ isUnsaved }),
  setScenario: (scenario) => set({ scenario }),
  updateScenario: (updater) => set((state) => ({ scenario: updater(state.scenario) })),

  saveSeed: (seed: string) => {
    const trimmed = seed.trim()
    if (!trimmed || trimmed === 'default-seed') return
    const current = get().savedSeeds
    if (current.includes(trimmed)) return
    const next = [...current, trimmed]
    persistSeeds(next)
    set({ savedSeeds: next })
  },
  removeSeed: (seed: string) => {
    const next = get().savedSeeds.filter((s) => s !== seed)
    persistSeeds(next)
    set({ savedSeeds: next })
  }
}))

export default useStore
