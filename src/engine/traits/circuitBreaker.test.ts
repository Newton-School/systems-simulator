import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { msToMicro } from '../core/time'
import {
  attachCircuitBreakerTracking,
  beginCircuitBreakerRouting,
  clearCircuitBreakerTracking,
  readCircuitBreakerTracking,
  recordCircuitBreakerOutcome
} from './circuitBreaker'
import type { TraitStateStore } from './types'

function makeStateStore(): TraitStateStore {
  const state = new Map<string, unknown>()
  return {
    get: (key) => state.get(key),
    set: (key, value) => void state.set(key, value)
  }
}

function makeNode(): ComponentNode {
  return {
    id: 'sidecar',
    type: 'sidecar',
    category: 'compute',
    role: 'processor',
    label: 'Sidecar',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    resilience: {
      circuitBreaker: {
        failureThreshold: 0.5,
        failureCount: 2,
        recoveryTimeout: 1_000,
        halfOpenRequests: 1
      }
    }
  }
}

function makeRequest(): Request {
  return {
    id: 'req-1',
    type: 'charge',
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

describe('circuitBreaker', () => {
  it('opens after enough failures and fast-rejects further routing', () => {
    const store = makeStateStore()
    const node = makeNode()

    expect(beginCircuitBreakerRouting(store, node, 0n)).toMatchObject({ action: 'route' })
    expect(recordCircuitBreakerOutcome(store, node, false, 0n)).toMatchObject({ phase: 'closed' })

    expect(beginCircuitBreakerRouting(store, node, 1n)).toMatchObject({ action: 'route' })
    expect(recordCircuitBreakerOutcome(store, node, false, 1n)).toMatchObject({
      transition: 'open',
      phase: 'open'
    })

    expect(beginCircuitBreakerRouting(store, node, 2n)).toMatchObject({
      action: 'rejected',
      reason: 'circuit_breaker_open'
    })
  })

  it('allows a half-open probe after recovery and closes on success', () => {
    const store = makeStateStore()
    const node = makeNode()

    recordCircuitBreakerOutcome(store, node, false, 0n)
    recordCircuitBreakerOutcome(store, node, false, 1n)

    const halfOpen = beginCircuitBreakerRouting(store, node, msToMicro(1_100))
    expect(halfOpen).toMatchObject({
      action: 'route',
      payload: expect.objectContaining({ circuitBreakerPhase: 'half-open' })
    })

    expect(recordCircuitBreakerOutcome(store, node, true, msToMicro(1_100))).toMatchObject({
      transition: 'close',
      phase: 'closed'
    })
    expect(beginCircuitBreakerRouting(store, node, msToMicro(1_101))).toMatchObject({
      action: 'route',
      payload: expect.objectContaining({ circuitBreakerPhase: 'closed' })
    })
  })

  it('tracks downstream ownership on the request metadata', () => {
    const request = makeRequest()

    attachCircuitBreakerTracking(request, 'sidecar', 'payments')
    expect(readCircuitBreakerTracking(request)).toEqual({
      trackerNodeId: 'sidecar',
      targetNodeId: 'payments'
    })

    clearCircuitBreakerTracking(request)
    expect(readCircuitBreakerTracking(request)).toBeNull()
  })
})
