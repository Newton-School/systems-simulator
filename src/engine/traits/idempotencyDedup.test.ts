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

  it('confirms a committed key and blocks a retry whose prior outcome is unknown', () => {
    const state = makeState()
    const node = makeNode({ commitOutcomeJournal: true })
    const firstRequest = makeRequest('req-1', { idempotencyKey: 'pay-001' })

    const first = idempotencyDedupTrait.beforeArrival?.({
      node,
      request: firstRequest,
      clock: 0n,
      state
    })
    expect(first).toMatchObject({
      action: 'continue',
      payload: { commitOutcomeDecision: 'intent-recorded' }
    })

    const committed = idempotencyDedupTrait.afterTerminal?.({
      node,
      request: firstRequest,
      clock: 10n,
      state,
      status: 'success'
    })
    expect(committed).toEqual({
      commitOutcomeDecision: 'commit-confirmed',
      idempotencyKey: 'pay-001'
    })

    const knownDuplicate = idempotencyDedupTrait.beforeArrival?.({
      node,
      request: makeRequest('req-2', { idempotencyKey: 'pay-001' }),
      clock: 20n,
      state
    })
    expect(knownDuplicate).toMatchObject({
      action: 'handled',
      payload: { commitOutcomeDecision: 'commit-confirmed' }
    })

    const interruptedRequest = makeRequest('req-3', { idempotencyKey: 'pay-002' })
    idempotencyDedupTrait.beforeArrival?.({
      node,
      request: interruptedRequest,
      clock: 30n,
      state
    })
    const unknown = idempotencyDedupTrait.afterTerminal?.({
      node,
      request: interruptedRequest,
      clock: 40n,
      state,
      status: 'timeout',
      reasonCode: 'deadline_exceeded'
    })
    expect(unknown).toMatchObject({ commitOutcomeDecision: 'outcome-unknown' })

    const blockedRetry = idempotencyDedupTrait.beforeArrival?.({
      node,
      request: makeRequest('req-4', { idempotencyKey: 'pay-002' }),
      clock: 50n,
      state
    })
    expect(blockedRetry).toMatchObject({
      action: 'rejected',
      reason: 'commit_outcome_unknown',
      payload: { commitOutcomeDecision: 'replay-blocked' }
    })
  })

  it('reconciles unknown outcomes through the modeled authoritative side-effect registry', () => {
    const state = makeState()
    const sharedState = makeState()
    const node = makeNode({
      commitOutcomeJournal: true,
      reconcileUnknownOutcomes: true,
      externalReconciliationMode: 'modeled'
    })
    const interruptedRequest = makeRequest('req-1', {
      idempotencyKey: 'pay-003',
      externalSideEffectCommitted: true
    })

    idempotencyDedupTrait.beforeArrival?.({
      node,
      request: interruptedRequest,
      clock: 0n,
      state,
      sharedState
    })
    idempotencyDedupTrait.afterTerminal?.({
      node,
      request: interruptedRequest,
      clock: 10n,
      state,
      sharedState,
      status: 'timeout',
      reasonCode: 'deadline_exceeded'
    })

    const reconciledRetry = idempotencyDedupTrait.beforeArrival?.({
      node,
      request: makeRequest('req-2', { idempotencyKey: 'pay-003' }),
      clock: 20n,
      state,
      sharedState
    })

    expect(reconciledRetry).toMatchObject({
      action: 'handled',
      payload: {
        commitOutcomeDecision: 'commit-confirmed',
        metricCounters: {
          idempotencyReconciliations: 1,
          externalReconciliationProbes: 1
        }
      }
    })
  })
})
