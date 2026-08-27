import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useStore from './useStore'
import { resolveEnvironmentProfile } from '../../../engine/analysis/environmentProfile'
import type { EdgeFlowEvent } from '../../../engine/core/events'

function buildEvent(
  overrides: Partial<EdgeFlowEvent> & Pick<EdgeFlowEvent, 'edgeId' | 'sequence'>
): EdgeFlowEvent {
  const startedAtMs = overrides.startedAtMs ?? overrides.sequence * 10

  return {
    sequence: overrides.sequence,
    requestId: overrides.requestId ?? `req-${overrides.sequence}`,
    edgeId: overrides.edgeId,
    sourceNodeId: overrides.sourceNodeId ?? 'source',
    targetNodeId: overrides.targetNodeId ?? 'target',
    startedAtMs,
    completedAtMs: overrides.completedAtMs ?? startedAtMs + 5,
    latencyMs: overrides.latencyMs ?? 5,
    status: overrides.status ?? 'success',
    failureCause: overrides.failureCause
  }
}

describe('useStore edge flow batching', () => {
  beforeEach(() => {
    useStore.getState().clearEdgeFlow()
    useStore.getState().setEdgeFlowRunConfig({
      simulationDurationMs: 120_000,
      warmupDurationMs: 50,
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
      }
    })
  })

  afterEach(() => {
    useStore.getState().clearEdgeFlow()
    vi.restoreAllMocks()
  })

  it('matches the single-event reducer semantics for the same events', () => {
    const events = [
      buildEvent({ edgeId: 'edge-a', sequence: 1, startedAtMs: 10, completedAtMs: 20 }),
      buildEvent({
        edgeId: 'edge-a',
        sequence: 2,
        startedAtMs: 60,
        completedAtMs: 75,
        latencyMs: 15,
        status: 'timeout',
        failureCause: 'deadline_exceeded'
      }),
      buildEvent({ edgeId: 'edge-b', sequence: 3, startedAtMs: 90, completedAtMs: 98 })
    ]

    vi.spyOn(Date, 'now').mockReturnValue(1_000)

    useStore.getState().recordEdgeFlowEventBatch(events)
    const batchedState = useStore.getState()
    const batchedSnapshot = {
      edgeFlowStatus: batchedState.edgeFlowStatus,
      edgeFlowPlayback: batchedState.edgeFlowPlayback,
      edgeFlowHistory: batchedState.edgeFlowHistory,
      edgeFlowById: batchedState.edgeFlowById
    }

    useStore.getState().clearEdgeFlow()
    useStore.getState().setEdgeFlowRunConfig({
      simulationDurationMs: 120_000,
      warmupDurationMs: 50,
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
      }
    })

    for (const event of events) {
      useStore.getState().recordEdgeFlowEvent(event)
    }

    const sequentialState = useStore.getState()
    const sequentialSnapshot = {
      edgeFlowStatus: sequentialState.edgeFlowStatus,
      edgeFlowPlayback: sequentialState.edgeFlowPlayback,
      edgeFlowHistory: sequentialState.edgeFlowHistory,
      edgeFlowById: sequentialState.edgeFlowById
    }

    expect(batchedSnapshot).toEqual(sequentialSnapshot)
  })

  it('preserves untouched edge state references across a batch update', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)

    useStore
      .getState()
      .recordEdgeFlowEventBatch([
        buildEvent({ edgeId: 'edge-a', sequence: 1 }),
        buildEvent({ edgeId: 'edge-b', sequence: 2 })
      ])

    const before = useStore.getState()
    const edgeARef = before.edgeFlowById['edge-a']
    const edgeBRef = before.edgeFlowById['edge-b']

    useStore.getState().recordEdgeFlowEventBatch([
      buildEvent({
        edgeId: 'edge-a',
        sequence: 3,
        startedAtMs: 30,
        completedAtMs: 35,
        latencyMs: 5
      })
    ])

    const after = useStore.getState()

    expect(after.edgeFlowById['edge-a']).not.toBe(edgeARef)
    expect(after.edgeFlowById['edge-b']).toBe(edgeBRef)
  })

  it('samples retained live events while preserving exact totals', () => {
    vi.spyOn(Date, 'now').mockReturnValue(3_000)

    const events = Array.from({ length: 1_600 }, (_, index) =>
      buildEvent({
        edgeId: 'edge-a',
        sequence: index + 1,
        startedAtMs: index,
        completedAtMs: index + 5
      })
    )

    useStore.getState().recordEdgeFlowEventBatch(events)

    const state = useStore.getState()
    const flow = state.edgeFlowById['edge-a']

    expect(flow.totalAttempted).toBe(1_600)
    expect(flow.totalSuccess).toBe(1_600)
    expect(flow.recent.length).toBe(100)
    expect(state.edgeFlowHistory.length).toBe(100)
    expect(flow.recent[0]?.sampleWeight).toBe(16)
    expect(flow.attemptedPerSecond).toBeGreaterThan(950)
    expect(flow.attemptedPerSecond).toBeLessThan(1_050)
  })

  it('preserves a selected runtime metric lens across live metric updates', () => {
    useStore.getState().setSimulationMetrics({
      'node-a': {
        throughput: 10
      }
    })
    expect(useStore.getState().metricLens).toBe('traffic')

    useStore.getState().setMetricLens('saturation')
    useStore.getState().setSimulationMetrics({
      'node-a': {
        throughput: 20,
        utilization: 80
      }
    })

    expect(useStore.getState().metricLens).toBe('saturation')
  })
})

describe('useStore scaffold-node lock', () => {
  function node(id: string) {
    return { id, type: 'service', position: { x: 0, y: 0 }, data: { label: id } }
  }

  function edge(id: string, source: string, target: string) {
    return { id, source, target, data: { latencyValue: 1 } }
  }

  beforeEach(() => {
    useStore.getState().setActiveQuestion({
      id: 'q1',
      scaffold: {
        type: 'partial',
        topology: {
          nodes: [{ id: 'scaffold-1' }, { id: 'scaffold-2' }],
          edges: [{ id: 'scaffold-edge', source: 'scaffold-1', target: 'scaffold-2' }]
        }
      }
    } as any)
    useStore
      .getState()
      .setNodes([node('scaffold-1'), node('scaffold-2'), node('student-1')] as any)
    useStore
      .getState()
      .setEdges([edge('scaffold-edge', 'scaffold-1', 'scaffold-2'), edge('student-edge', 'scaffold-2', 'student-1')] as any)
  })

  afterEach(() => {
    useStore.getState().setActiveQuestion(null)
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile())
    useStore.getState().setNodes([])
    useStore.getState().setEdges([])
  })

  it('derives scaffold node and edge ids from the active question scaffold', () => {
    expect(useStore.getState().scaffoldNodeIds).toEqual(['scaffold-1', 'scaffold-2'])
    expect(useStore.getState().scaffoldEdgeIds).toEqual(['scaffold-edge'])
  })

  it('blocks deleting and editing locked scaffold nodes but not student nodes', () => {
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile('ASSIGNMENT'))

    // Deleting a locked scaffold node is dropped; deleting a student node works.
    useStore.getState().onNodesChange([{ type: 'remove', id: 'scaffold-1' }])
    expect(useStore.getState().nodes.map((n) => n.id)).toContain('scaffold-1')
    useStore.getState().onNodesChange([{ type: 'remove', id: 'student-1' }])
    expect(useStore.getState().nodes.map((n) => n.id)).not.toContain('student-1')

    // Editing a locked scaffold node is a no-op; editing a student node applies.
    useStore.getState().updateNodeData('scaffold-1', { label: 'HACKED' } as any)
    const scaffoldNode = useStore.getState().nodes.find((n) => n.id === 'scaffold-1')
    expect((scaffoldNode?.data as { label: string }).label).toBe('scaffold-1')
  })

  it('blocks scaffold-node movement in locked profiles while still letting student nodes move', () => {
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile('ASSIGNMENT'))

    useStore.getState().onNodesChange([
      { type: 'position', id: 'scaffold-1', position: { x: 50, y: 25 }, dragging: false } as any
    ])
    useStore.getState().onNodesChange([
      { type: 'position', id: 'student-1', position: { x: 80, y: 40 }, dragging: false } as any
    ])

    const scaffoldNode = useStore.getState().nodes.find((n) => n.id === 'scaffold-1')
    const studentNode = useStore.getState().nodes.find((n) => n.id === 'student-1')
    expect(scaffoldNode?.position).toEqual({ x: 0, y: 0 })
    expect(studentNode?.position).toEqual({ x: 80, y: 40 })
  })

  it('blocks deleting scaffold edges in locked profiles but still lets student edges go away', () => {
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile('ASSIGNMENT'))

    useStore.getState().onEdgesChange([{ type: 'remove', id: 'scaffold-edge' }])
    useStore.getState().onEdgesChange([{ type: 'remove', id: 'student-edge' }])

    expect(useStore.getState().edges.map((edge) => edge.id)).toContain('scaffold-edge')
    expect(useStore.getState().edges.map((edge) => edge.id)).not.toContain('student-edge')
  })

  it('allows editing scaffold nodes when the profile permits (AUTHOR)', () => {
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile('AUTHOR'))
    useStore.getState().updateNodeData('scaffold-1', { label: 'edited' } as any)
    const scaffoldNode = useStore.getState().nodes.find((n) => n.id === 'scaffold-1')
    expect((scaffoldNode?.data as { label: string }).label).toBe('edited')

    useStore.getState().onNodesChange([{ type: 'remove', id: 'scaffold-1' }])
    expect(useStore.getState().nodes.map((n) => n.id)).not.toContain('scaffold-1')
  })

  it('keeps explicitly locked scaffold nodes and edges immutable even when AUTHOR can edit other scaffold parts', () => {
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile('AUTHOR'))
    useStore.getState().setActiveQuestion({
      id: 'q1',
      scaffold: {
        type: 'partial',
        topology: {
          nodes: [{ id: 'scaffold-1' }, { id: 'scaffold-2' }],
          edges: [{ id: 'scaffold-edge', source: 'scaffold-1', target: 'scaffold-2' }]
        },
        lockedNodeIds: ['scaffold-1'],
        lockedEdgeIds: ['scaffold-edge']
      },
      constraints: {
        canModifyScaffold: true,
        canRemoveScaffoldNodes: true
      }
    } as any)

    useStore.getState().updateNodeData('scaffold-1', { label: 'edited' } as any)
    useStore.getState().onNodesChange([{ type: 'remove', id: 'scaffold-1' }])
    useStore.getState().onEdgesChange([{ type: 'remove', id: 'scaffold-edge' }])
    useStore.getState().updateEdgeData('scaffold-edge', { label: 'blocked' })

    const lockedNode = useStore.getState().nodes.find((node) => node.id === 'scaffold-1')
    const lockedEdge = useStore.getState().edges.find((edge) => edge.id === 'scaffold-edge')
    expect((lockedNode?.data as { label: string }).label).toBe('scaffold-1')
    expect(useStore.getState().nodes.map((node) => node.id)).toContain('scaffold-1')
    expect(lockedEdge?.label).toBeUndefined()
    expect(useStore.getState().edges.map((edge) => edge.id)).toContain('scaffold-edge')
  })

  it('lets authored scaffold constraints stay authoritative even in AUTHOR mode', () => {
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile('AUTHOR'))
    useStore.getState().setActiveQuestion({
      id: 'q1',
      scaffold: {
        type: 'partial',
        topology: {
          nodes: [{ id: 'scaffold-1' }],
          edges: []
        }
      },
      constraints: {
        canModifyScaffold: false,
        canRemoveScaffoldNodes: false
      }
    } as any)

    useStore.getState().updateNodeData('scaffold-1', { label: 'edited' } as any)
    useStore.getState().onNodesChange([
      { type: 'position', id: 'scaffold-1', position: { x: 20, y: 20 }, dragging: false } as any
    ])
    useStore.getState().onNodesChange([{ type: 'remove', id: 'scaffold-1' }])

    const scaffoldNode = useStore.getState().nodes.find((n) => n.id === 'scaffold-1')
    expect((scaffoldNode?.data as { label: string }).label).toBe('scaffold-1')
    expect(scaffoldNode?.position).toEqual({ x: 0, y: 0 })
    expect(useStore.getState().nodes.map((n) => n.id)).toContain('scaffold-1')
  })
})

describe('useStore host lifecycle (lock / reveal)', () => {
  beforeEach(() => {
    useStore.getState().setActiveQuestion(null)
    useStore.getState().setEnvironmentProfile(resolveEnvironmentProfile())
    useStore
      .getState()
      .setNodes([
        { id: 'n1', type: 'service', position: { x: 0, y: 0 }, data: { label: 'n1' } }
      ] as any)
  })

  afterEach(() => {
    useStore.getState().setAttemptState(null)
    useStore.getState().setResultsRevealed(false)
    useStore.getState().setNodes([])
  })

  it('freezes every node once the attempt is LOCKED', () => {
    useStore.getState().setAttemptState({ status: 'LOCKED' } as any)

    // Deleting, editing and adding are all blocked while frozen.
    useStore.getState().onNodesChange([{ type: 'remove', id: 'n1' }])
    expect(useStore.getState().nodes.map((n) => n.id)).toContain('n1')

    useStore.getState().updateNodeData('n1', { label: 'nope' } as any)
    expect((useStore.getState().nodes[0].data as { label: string }).label).toBe('n1')

    useStore
      .getState()
      .addNode({ id: 'n2', type: 'service', position: { x: 1, y: 1 }, data: {} } as any)
    expect(useStore.getState().nodes.map((n) => n.id)).not.toContain('n2')
  })

  it('exposes a reveal flag that defaults false and can be toggled', () => {
    expect(useStore.getState().resultsRevealed).toBe(false)
    useStore.getState().setResultsRevealed(true)
    expect(useStore.getState().resultsRevealed).toBe(true)
  })
})
