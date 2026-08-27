import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import {
  lockLeaseTrait,
  readLockLeaseAttachments,
  releaseLockLeaseAttachment
} from './lockLease'
import type { TraitStateStore } from './types'

function makeState(): TraitStateStore {
  const store = new Map<string, unknown>()
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value)
    }
  }
}

function makeNode(config: Record<string, unknown> = {}) {
  return {
    id: 'lock',
    type: 'distributed-lock',
    config
  } as const
}

function makeRequest(id: string, metadata: Record<string, unknown> = {}): Request {
  return {
    id,
    type: 'reserve-seat',
    sizeBytes: 256,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata
  }
}

describe('lockLeaseTrait', () => {
  it('acquires a per-key lease, records an attachment, and exposes fencing when enabled', () => {
    const state = makeState()
    const request = makeRequest('req-1', { seatId: 'A-12' })
    const node = makeNode({
      lockKeyField: 'seatId',
      acquireMs: 3,
      leaseMs: 500,
      fencing: true
    })

    const arrival = lockLeaseTrait.beforeArrival?.({ node, request, clock: 0n, state })
    const routing = lockLeaseTrait.beforeRouting?.({ node, request, clock: 0n, state })

    expect(arrival).toMatchObject({
      action: 'continue',
      payload: { lockDecision: 'attempting', resourceKey: 'A-12', leaseMs: 500 }
    })
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual({
      type: 'constant',
      value: 3
    })
    expect(routing).toMatchObject({
      action: 'route',
      payload: {
        lockDecision: 'acquired',
        resourceKey: 'A-12',
        leaseMs: 500,
        fencingToken: 1,
        metricCounters: { lockAcquires: 1 }
      }
    })
    expect(readLockLeaseAttachments(request)).toEqual([
      { nodeId: 'lock', resourceKey: 'A-12', fencingToken: 1 }
    ])
  })

  it('rejects contending requests until the active lease is released', () => {
    const state = makeState()
    const node = makeNode({ lockKeyField: 'seatId', leaseMs: 1_000 })
    const first = makeRequest('req-1', { seatId: 'A-12' })
    const second = makeRequest('req-2', { seatId: 'A-12' })

    lockLeaseTrait.beforeArrival?.({ node, request: first, clock: 0n, state })
    lockLeaseTrait.beforeRouting?.({ node, request: first, clock: 0n, state })

    lockLeaseTrait.beforeArrival?.({ node, request: second, clock: 1n, state })
    const blocked = lockLeaseTrait.beforeRouting?.({ node, request: second, clock: 1n, state })

    expect(blocked).toMatchObject({
      action: 'rejected',
      reason: 'lock_contended',
      payload: {
        lockDecision: 'contended',
        resourceKey: 'A-12',
        metricCounters: { lockContentions: 1 }
      }
    })

    const [attachment] = readLockLeaseAttachments(first)
    expect(releaseLockLeaseAttachment(state, first.id, attachment)).toBe(true)

    const afterRelease = lockLeaseTrait.beforeRouting?.({
      node,
      request: second,
      clock: 2n,
      state
    })

    expect(afterRelease).toMatchObject({
      action: 'route',
      payload: { lockDecision: 'acquired', resourceKey: 'A-12' }
    })
  })

  it('passes requests without the configured key through unlocked', () => {
    const decision = lockLeaseTrait.beforeArrival?.({
      node: makeNode(),
      request: makeRequest('req-1'),
      clock: 0n,
      state: makeState()
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: { lockDecision: 'no-key', metricCounters: { lockKeyless: 1 } }
    })
  })
})
