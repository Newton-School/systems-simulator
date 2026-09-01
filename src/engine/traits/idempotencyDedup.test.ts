import { describe, expect, it } from 'vitest'
import { msToMicro } from '../core/time'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import { idempotencyDedupTrait } from './idempotencyDedup'
import type { TraitStateStore } from './types'

function makeNode(config: Record<string, unknown> = {}) {
  return {
    id: 'idempotency',
    type: 'idempotency-manager',
    config
  } as const
}

function makeRequest(id: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    type: 'create-payment',
    sizeBytes: 1024,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata
  } as const
}

function makeState(): TraitStateStore {
  const store = new Map<string, unknown>()
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value)
    }
  }
}

describe('idempotencyDedupTrait', () => {
  it('records a first-seen key, then short-circuits duplicates within the dedup window', () => {
    const state = makeState()
    const node = makeNode({
      dedupKeyField: 'idempotencyKey',
      dedupWindowMs: 1000,
      storeLookupMs: 2
    })

    const firstRequest = makeRequest('req-1', { idempotencyKey: 'pay-001' })
    const first = idempotencyDedupTrait.beforeArrival?.({
      node,
      request: firstRequest,
      clock: 0n,
      state
    })

    expect(first).toMatchObject({
      action: 'continue',
      payload: {
        idempotencyDecision: 'recorded',
        idempotencyKey: 'pay-001',
        metricCounters: { idempotencyUniqueKeys: 1 }
      }
    })
    expect(firstRequest.metadata.__semanticsIdempotencyDecision).toBe('recorded')
    expect(firstRequest.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual({
      type: 'constant',
      value: 2
    })

    const duplicateRequest = makeRequest('req-2', { idempotencyKey: 'pay-001' })
    const duplicate = idempotencyDedupTrait.beforeArrival?.({
      node,
      request: duplicateRequest,
      clock: msToMicro(250),
      state
    })

    expect(duplicate).toMatchObject({
      action: 'handled',
      latencyUs: 2000n,
      payload: {
        idempotencyDecision: 'duplicate',
        idempotencyKey: 'pay-001',
        metricCounters: { idempotencyDuplicateHits: 1 }
      }
    })
    expect(duplicateRequest.metadata.__semanticsIdempotencyDecision).toBe('duplicate')

    const afterExpiryRequest = makeRequest('req-3', { idempotencyKey: 'pay-001' })
    const afterExpiry = idempotencyDedupTrait.beforeArrival?.({
      node,
      request: afterExpiryRequest,
      clock: msToMicro(1500),
      state
    })

    expect(afterExpiry).toMatchObject({
      action: 'continue',
      payload: {
        idempotencyDecision: 'recorded',
        metricCounters: { idempotencyUniqueKeys: 1 }
      }
    })
  })

  it('lets requests without a key continue while still paying the lookup cost', () => {
    const request = makeRequest('req-1')
    const decision = idempotencyDedupTrait.beforeArrival?.({
      node: makeNode(),
      request,
      clock: 0n,
      state: makeState()
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: {
        idempotencyDecision: 'no-key',
        metricCounters: { idempotencyKeysMissing: 1 }
      }
    })
    expect(request.metadata.__semanticsIdempotencyDecision).toBe('no-key')
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual({
      type: 'constant',
      value: 2
    })
  })
})
