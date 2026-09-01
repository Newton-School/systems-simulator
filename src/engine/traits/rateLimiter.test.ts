import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import type { BeforeArrivalDecision, TraitStateStore } from './types'
import { rateLimiterTrait } from './rateLimiter'

function makeStateStore(): TraitStateStore {
  const store = new Map<string, unknown>()
  return {
    get: <T>(key: string) => store.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      store.set(key, value)
    }
  }
}

function makeGatewayNode(
  config: Record<string, unknown> | undefined = undefined,
  id = 'gw'
): ComponentNode {
  return {
    id,
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

function makeRequest(metadata: Record<string, unknown> = {}): {
  metadata: Record<string, unknown>
} {
  return { metadata }
}

/** Pulls the admit/breach counters out of a beforeArrival decision. */
function counters(decision: BeforeArrivalDecision | undefined): Record<string, number> {
  const payload = decision && 'payload' in decision ? decision.payload : undefined
  const raw = payload?.['metricCounters']
  return (raw as Record<string, number>) ?? {}
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

    const second = rateLimiterTrait.beforeArrival?.({
      node,
      request: {} as never,
      clock: 0n,
      state
    })
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

  it('fixed-window admits up to the limit, then rejects within the window', () => {
    const state = makeStateStore()
    const shared = makeStateStore()
    const node = makeGatewayNode({
      algorithm: 'fixed-window',
      limit: 2,
      windowMs: 1000,
      rateLimitKeyField: 'clientId'
    })
    const run = (clock: bigint): BeforeArrivalDecision | undefined =>
      rateLimiterTrait.beforeArrival?.({
        node,
        request: makeRequest({ clientId: 'c1' }) as never,
        clock,
        state,
        sharedState: shared
      })

    expect(run(0n)).toMatchObject({ action: 'continue' })
    expect(run(100_000n)).toMatchObject({ action: 'continue' })
    expect(run(200_000n)).toMatchObject({ action: 'rejected', reason: 'rate_limited' })
  })

  it('surfaces the fixed-window edge-doubling bug as a breach; sliding-window does not', () => {
    // Identical arrival pattern: a burst straddling a window boundary.
    const arrivals = [900_000n, 950_000n, 999_000n, 1_000_000n, 1_050_000n, 1_100_000n]
    const cfg = { limit: 3, windowMs: 1000, rateLimitKeyField: 'clientId' }

    const tally = (algorithm: string): { admitted: number; breaches: number } => {
      const state = makeStateStore()
      const shared = makeStateStore()
      const node = makeGatewayNode({ ...cfg, algorithm })
      let admitted = 0
      let breaches = 0
      for (const clock of arrivals) {
        const d = rateLimiterTrait.beforeArrival?.({
          node,
          request: makeRequest({ clientId: 'c1' }) as never,
          clock,
          state,
          sharedState: shared
        })
        const c = counters(d)
        admitted += c.rateAdmitted ?? 0
        breaches += c.rateLimitBreaches ?? 0
      }
      return { admitted, breaches }
    }

    const fixed = tally('fixed-window')
    const sliding = tally('sliding-window')

    // Fixed window admits across the boundary and the shared oracle flags breaches.
    expect(fixed.admitted).toBeGreaterThan(3)
    expect(fixed.breaches).toBeGreaterThan(0)
    // Sliding window is exact — never more than `limit` in any rolling window, no breach.
    expect(sliding.breaches).toBe(0)
  })

  it('two uncoordinated local limiters over-admit one key (the synchronization bug)', () => {
    // Each node is individually correct (sliding-window, limit 3) with its OWN
    // per-node state, but they share the run-scoped oracle. Same key hitting both
    // ⇒ the global rolling count exceeds the limit ⇒ breaches.
    const shared = makeStateStore()
    const cfg = {
      algorithm: 'sliding-window',
      limit: 3,
      windowMs: 1000,
      rateLimitKeyField: 'clientId'
    }
    const nodeA = makeGatewayNode(cfg, 'limiterA')
    const nodeB = makeGatewayNode(cfg, 'limiterB')
    const stateA = makeStateStore()
    const stateB = makeStateStore()

    let breaches = 0
    for (let i = 0; i < 3; i++) {
      const clock = BigInt(i * 10_000)
      for (const [node, state] of [
        [nodeA, stateA],
        [nodeB, stateB]
      ] as const) {
        const d = rateLimiterTrait.beforeArrival?.({
          node,
          request: makeRequest({ clientId: 'c1' }) as never,
          clock,
          state,
          sharedState: shared
        })
        breaches += counters(d).rateLimitBreaches ?? 0
      }
    }
    // 6 admits for one key inside the window, limit 3 ⇒ the excess admits breach.
    expect(breaches).toBeGreaterThan(0)
  })

  it('a per-key limiter reached without the key field is counted keyless, not blocked', () => {
    const state = makeStateStore()
    const shared = makeStateStore()
    const node = makeGatewayNode({
      algorithm: 'sliding-window',
      limit: 1,
      windowMs: 1000,
      rateLimitKeyField: 'clientId'
    })
    const d = rateLimiterTrait.beforeArrival?.({
      node,
      request: makeRequest({}) as never,
      clock: 0n,
      state,
      sharedState: shared
    })
    expect(d).toMatchObject({ action: 'continue' })
    expect(counters(d).rateKeyless).toBe(1)
  })

  it('isolates counters per key', () => {
    const state = makeStateStore()
    const shared = makeStateStore()
    const node = makeGatewayNode({
      algorithm: 'sliding-window',
      limit: 1,
      windowMs: 1000,
      rateLimitKeyField: 'clientId'
    })
    const run = (clientId: string): BeforeArrivalDecision | undefined =>
      rateLimiterTrait.beforeArrival?.({
        node,
        request: makeRequest({ clientId }) as never,
        clock: 0n,
        state,
        sharedState: shared
      })

    expect(run('c1')).toMatchObject({ action: 'continue' })
    expect(run('c1')).toMatchObject({ action: 'rejected' })
    // A different client has its own budget.
    expect(run('c2')).toMatchObject({ action: 'continue' })
  })
})
