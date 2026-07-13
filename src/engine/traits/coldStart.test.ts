import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { msToMicro } from '../core/time'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import { coldStartTrait } from './coldStart'
import type { TraitStateStore } from './types'

function makeRequest(): Request {
  return {
    id: 'req-1',
    type: 'invoke',
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

function makeStateStore(): TraitStateStore {
  const state = new Map<string, unknown>()
  return {
    get: (key) => state.get(key),
    set: (key, value) => void state.set(key, value)
  }
}

function makeNode(config: Record<string, unknown> = {}): ComponentNode {
  return {
    id: 'lambda',
    type: 'serverless-function',
    category: 'compute',
    role: 'processor',
    label: 'Lambda',
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 20, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 },
    config
  }
}

describe('coldStartTrait', () => {
  it('adds a cold-start penalty on the first request after idle', () => {
    const request = makeRequest()
    const state = makeStateStore()

    const first = coldStartTrait.beforeArrival?.({
      node: makeNode({
        coldStartLatency: { type: 'constant', value: 120 },
        idleTimeoutMs: 5_000,
        maxConcurrency: 2
      }),
      request,
      clock: 0n,
      state,
      nodeState: {
        id: 'lambda',
        status: 'idle',
        activeWorkers: 0,
        queueLength: 0,
        utilization: 0,
        totalInSystem: 0
      }
    })

    expect(first).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        coldStart: true,
        coldStartMs: 120,
        metricCounters: { coldStarts: 1 }
      })
    })
    expect(request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]).toBe(120)

    const second = coldStartTrait.beforeArrival?.({
      node: makeNode({
        coldStartLatency: { type: 'constant', value: 120 },
        idleTimeoutMs: 5_000,
        maxConcurrency: 2
      }),
      request,
      clock: msToMicro(1_000),
      state,
      nodeState: {
        id: 'lambda',
        status: 'idle',
        activeWorkers: 0,
        queueLength: 0,
        utilization: 0,
        totalInSystem: 0
      }
    })

    expect(second).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        coldStart: false,
        idleTimeoutMs: 5_000
      })
    })
    expect(request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]).toBe(120)
  })

  it('rejects requests when max concurrency is already reached', () => {
    const decision = coldStartTrait.beforeArrival?.({
      node: makeNode({ maxConcurrency: 2 }),
      request: makeRequest(),
      clock: 0n,
      state: makeStateStore(),
      nodeState: {
        id: 'lambda',
        status: 'busy',
        activeWorkers: 2,
        queueLength: 0,
        utilization: 1,
        totalInSystem: 2
      }
    })

    expect(decision).toMatchObject({
      action: 'rejected',
      reason: 'max_concurrency_exceeded',
      payload: expect.objectContaining({
        maxConcurrency: 2,
        metricCounters: { coldStartThrottles: 1 }
      })
    })
  })
})
