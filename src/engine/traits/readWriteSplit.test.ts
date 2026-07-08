import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import type { Request } from '../core/events'
import { readWriteSplitTrait } from './readWriteSplit'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'

function makeRequest(type: string): Request {
  return {
    id: 'req-1',
    type,
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

function makeDbNode(config: Record<string, unknown> | undefined): ComponentNode {
  return {
    id: 'db',
    type: 'relational-db',
    category: 'storage-and-data',
    role: 'storage',
    label: 'Primary DB',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
    config
  }
}

const readLatency = { type: 'exponential', lambda: 0.25 } as const
const writeLatency = { type: 'exponential', lambda: 0.1 } as const

describe('readWriteSplitTrait', () => {
  it('overrides service time with writeLatency for write requests', () => {
    const request = makeRequest('write')
    readWriteSplitTrait.beforeArrival?.({
      node: makeDbNode({ readLatency, writeLatency }),
      request,
      clock: 0n
    })
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual(writeLatency)
  })

  it('overrides service time with readLatency for read requests', () => {
    const request = makeRequest('read')
    readWriteSplitTrait.beforeArrival?.({
      node: makeDbNode({ readLatency, writeLatency }),
      request,
      clock: 0n
    })
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual(readLatency)
  })

  it('leaves the default distribution untouched for other request types', () => {
    const request = makeRequest('GET')
    readWriteSplitTrait.beforeArrival?.({
      node: makeDbNode({ readLatency, writeLatency }),
      request,
      clock: 0n
    })
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toBeUndefined()
  })

  it('does nothing on a node explicitly marked as a read replica', () => {
    const request = makeRequest('write')
    const result = readWriteSplitTrait.beforeArrival?.({
      node: makeDbNode({ replicationRole: 'replica', readLatency, writeLatency }),
      request,
      clock: 0n
    })
    expect(result).toMatchObject({ action: 'continue' })
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toBeUndefined()
  })
})
