import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useStore from './useStore'
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
