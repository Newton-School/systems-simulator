import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import type { Request } from '../core/events'
import { readOnlyTrait } from './readOnly'

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
    id: 'replica',
    type: 'relational-db',
    category: 'storage-and-data',
    role: 'storage',
    label: 'Read Replica',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 4 }, timeout: 1_000 },
    config
  }
}

describe('readOnlyTrait', () => {
  it('rejects writes on a node marked as a read replica', () => {
    const result = readOnlyTrait.beforeArrival?.({
      node: makeDbNode({ replicationRole: 'replica' }),
      request: makeRequest('write'),
      clock: 0n
    })
    expect(result).toMatchObject({ action: 'rejected', reason: 'read_only_node' })
  })

  it('allows reads on a node marked as a read replica', () => {
    const result = readOnlyTrait.beforeArrival?.({
      node: makeDbNode({ replicationRole: 'replica' }),
      request: makeRequest('read'),
      clock: 0n
    })
    expect(result).toMatchObject({ action: 'continue' })
  })

  it('does nothing on a primary node, even for writes', () => {
    const result = readOnlyTrait.beforeArrival?.({
      node: makeDbNode({ replicationRole: 'primary' }),
      request: makeRequest('write'),
      clock: 0n
    })
    expect(result).toMatchObject({ action: 'continue' })
  })

  it('does nothing when replicationRole is unset', () => {
    const result = readOnlyTrait.beforeArrival?.({
      node: makeDbNode(undefined),
      request: makeRequest('write'),
      clock: 0n
    })
    expect(result).toMatchObject({ action: 'continue' })
  })
})
