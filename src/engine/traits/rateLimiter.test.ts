import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import type { TraitStateStore } from './types'
import { rateLimiterTrait } from './rateLimiter'

function makeStateStore(): TraitStateStore {
  const store = new Map<string, unknown>()
  return {
    get: <T,>(key: string) => store.get(key) as T | undefined,
    set: <T,>(key: string, value: T) => {
      store.set(key, value)
    }
  }
}

function makeGatewayNode(config: Record<string, unknown> | undefined = undefined): ComponentNode {
  return {
    id: 'gw',
    type: 'api-gateway',
    category: 'network-and-edge',
    role: 'router',
    label: 'Gateway',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

describe('rateLimiterTrait', () => {
  it('passes requests through when no rate limit is configured', () => {
    const state = makeStateStore()
    const result = rateLimiterTrait.beforeArrival?.({
      node: makeGatewayNode(),
      request: {} as never,
      clock: 0n,
      state
    })
    expect(result).toMatchObject({ action: 'continue' })
  })

  it('consumes tokens and rejects once the bucket is exhausted', () => {
    const state = makeStateStore()
    const node = makeGatewayNode({ maxTokens: 2, refillRatePerSecond: 0 })

    const first = rateLimiterTrait.beforeArrival?.({ node, request: {} as never, clock: 0n, state })
    expect(first).toMatchObject({ action: 'continue' })

    const second = rateLimiterTrait.beforeArrival?.({ node, request: {} as never, clock: 0n, state })
    expect(second).toMatchObject({ action: 'continue' })

    const third = rateLimiterTrait.beforeArrival?.({ node, request: {} as never, clock: 0n, state })
    expect(third).toMatchObject({ action: 'rejected', reason: 'rate_limited' })
  })

  it('refills tokens against the simulation clock, not wall time', () => {
    const state = makeStateStore()
    const node = makeGatewayNode({ maxTokens: 1, refillRatePerSecond: 1 })

    rateLimiterTrait.beforeArrival?.({ node, request: {} as never, clock: 0n, state })
    const exhausted = rateLimiterTrait.beforeArrival?.({
      node,
      request: {} as never,
      clock: 0n,
      state
    })
    expect(exhausted).toMatchObject({ action: 'rejected' })

    // 1 second later (in simulation microseconds) the bucket should have refilled by exactly 1 token.
    const afterOneSecond = rateLimiterTrait.beforeArrival?.({
      node,
      request: {} as never,
      clock: 1_000_000n,
      state
    })
    expect(afterOneSecond).toMatchObject({ action: 'continue' })
  })
})
