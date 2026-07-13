import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { consumerLagTrait } from './consumerLag'

function makeRequest(): Request {
  return {
    id: 'req-1',
    type: 'publish',
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

function makeNode(): ComponentNode {
  return {
    id: 'stream',
    type: 'stream',
    category: 'messaging-and-streaming',
    role: 'storage',
    label: 'Kafka Topic',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 }
  }
}

describe('consumerLagTrait', () => {
  it('reports backlog from total items in system', () => {
    const decision = consumerLagTrait.beforeArrival?.({
      node: makeNode(),
      request: makeRequest(),
      clock: 0n,
      nodeState: {
        id: 'stream',
        status: 'busy',
        activeWorkers: 1,
        queueLength: 6,
        utilization: 1,
        totalInSystem: 7
      }
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: {
        consumerLag: 7,
        metricCounters: {
          consumerLagSamples: 1,
          consumerLagAccumulated: 7
        }
      }
    })
  })
})
