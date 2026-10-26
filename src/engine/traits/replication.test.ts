import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { replicationTrait } from './replication'
import {
  SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY,
  SERVICE_TIME_LATENCY_PENALTY_MS_KEY
} from './serviceTimeOverride'

function request(type: string): Request {
  return {
    id: 'r',
    type,
    sizeBytes: 100,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata: {}
  } as unknown as Request
}

function leader(config: Record<string, unknown>): ComponentNode {
  return {
    id: 'p',
    type: 'relational-db',
    category: 'storage-and-data',
    label: 'p',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 },
    config: { replicationEnabled: true, replicaMembers: 'p,r1,r2', ...config }
  } as ComponentNode
}

describe('replication write acknowledgement', () => {
  it('adds the quorum wait to the write time instead of replacing the service time', () => {
    const write = request('write')
    replicationTrait.beforeArrival?.({
      node: leader({ writeAckPolicy: 'quorum', replicationLagMs: 40 }),
      request: write,
      clock: 0n,
      state: undefined
    })
    expect(write.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]).toBe(40)
    expect(write.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toBeUndefined()
  })

  it('adds nothing for a leader-only acknowledgement or for reads', () => {
    const primary = request('write')
    replicationTrait.beforeArrival?.({
      node: leader({ writeAckPolicy: 'primary', replicationLagMs: 40 }),
      request: primary,
      clock: 0n
    })
    expect(primary.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]).toBeUndefined()

    const read = request('read')
    replicationTrait.beforeArrival?.({
      node: leader({ writeAckPolicy: 'quorum', replicationLagMs: 40 }),
      request: read,
      clock: 0n
    })
    expect(read.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]).toBeUndefined()
  })
})
