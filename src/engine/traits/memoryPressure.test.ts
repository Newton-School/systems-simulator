import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import { memoryPressureTrait } from './memoryPressure'

function makeRequest(): Request {
  return {
    id: 'req-1',
    type: 'GET',
    sizeBytes: 100,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata: {}
  }
}

function makeNode(config: Record<string, unknown> = {}): ComponentNode {
  return {
    id: 'cache',
    type: 'in-memory-cache',
    category: 'storage-and-data',
    role: 'storage',
    label: 'Cache',
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 20, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
    config
  }
}

describe('memoryPressureTrait', () => {
  it('adds combined working-set and GC pressure penalties to request service time', () => {
    const request = makeRequest()

    const decision = memoryPressureTrait.beforeArrival?.({
      node: makeNode({
        workingSetRatio: 2,
        workingSetPenaltyMs: 40,
        gcPressureStartRatio: 0.5,
        gcPauseMs: 20
      }),
      request,
      clock: 0n,
      nodeState: {
        id: 'cache',
        status: 'busy',
        activeWorkers: 4,
        queueLength: 11,
        utilization: 1,
        totalInSystem: 15
      }
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        memoryPressure: true,
        workingSetPressureRatio: 0.5,
        workingSetPenaltyMs: 20,
        memoryOccupancyRatio: 0.75,
        gcPressureRatio: 0.5,
        gcPenaltyMs: 10,
        memoryPressurePenaltyMs: 30,
        metricCounters: {
          memoryPressureEvents: 1,
          workingSetPressureEvents: 1,
          gcPressureEvents: 1
        }
      })
    })
    expect(request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]).toBe(30)
  })

  it('is a no-op when neither working-set nor GC pressure config is set', () => {
    const request = makeRequest()

    const decision = memoryPressureTrait.beforeArrival?.({
      node: makeNode(),
      request,
      clock: 0n,
      nodeState: {
        id: 'cache',
        status: 'busy',
        activeWorkers: 4,
        queueLength: 11,
        utilization: 1,
        totalInSystem: 15
      }
    })

    expect(decision).toEqual({ action: 'continue' })
    expect(request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]).toBeUndefined()
  })
})
