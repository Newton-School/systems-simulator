import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import { storageProfileTrait } from './storageProfile'

function makeRequest(type: string): Request {
  return {
    id: `req-${type}`,
    type,
    sizeBytes: 1024,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata: {}
  }
}

function makeNode(
  type: ComponentNode['type'],
  config: Record<string, unknown> = {}
): ComponentNode {
  return {
    id: `node-${type}`,
    type,
    category: 'storage-and-data',
    role: 'storage',
    label: type,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
    config
  }
}

describe('storageProfileTrait', () => {
  it('uses point-read defaults for kv stores and penalizes scans heavily', () => {
    const readRequest = makeRequest('read')
    const scanRequest = makeRequest('scan-export')
    const node = makeNode('kv-store')

    const readDecision = storageProfileTrait.beforeArrival?.({
      node,
      request: readRequest,
      clock: 0n
    })
    const scanDecision = storageProfileTrait.beforeArrival?.({
      node,
      request: scanRequest,
      clock: 0n
    })

    expect(readDecision).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        storageOperation: 'read',
        storageLatencyMs: 1
      })
    })
    expect(scanDecision).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        storageOperation: 'scan',
        storageLatencyMs: 85
      })
    })
    expect(readRequest.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual({
      type: 'constant',
      value: 1
    })
    expect(scanRequest.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual({
      type: 'constant',
      value: 85
    })
  })

  it('applies the same profile when key-value is selected on a NoSQL database', () => {
    const request = makeRequest('read')
    const decision = storageProfileTrait.beforeArrival?.({
      node: makeNode('nosql-db', { dataModel: 'key-value' }),
      request,
      clock: 0n
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({ storageOperation: 'read', storageLatencyMs: 1 })
    })
  })

  it('respects authored per-operation overrides', () => {
    const request = makeRequest('publish-event')
    const node = makeNode('time-series-db', { storageIngestMs: 2.5 })

    const decision = storageProfileTrait.beforeArrival?.({
      node,
      request,
      clock: 0n
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        storageOperation: 'ingest',
        storageLatencyMs: 2.5,
        metricCounters: { storageProfileIngests: 1 }
      })
    })
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual({
      type: 'constant',
      value: 2.5
    })
  })
})
