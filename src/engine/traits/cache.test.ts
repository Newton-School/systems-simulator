import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { cacheCapabilityModule, cacheTrait } from './cache'

function makeRequest(): Request {
  return {
    id: 'req-1',
    type: 'GET',
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

function makeNode(type: ComponentNode['type'], config: Record<string, unknown>): ComponentNode {
  return {
    id: `${type}-1`,
    type,
    category: type === 'reverse-proxy' || type === 'cdn' ? 'network-and-edge' : 'storage-and-data',
    role: type === 'reverse-proxy' || type === 'cdn' ? 'router' : 'storage',
    label: type,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
    config
  }
}

describe('cacheTrait', () => {
  it('returns handled on a cache hit', () => {
    const decision = cacheTrait.beforeArrival?.({
      node: makeNode('in-memory-cache', { cacheHitRate: 1, cacheHitLatencyMs: 0.1 }),
      request: makeRequest(),
      clock: 0n,
      random: () => 0
    })

    expect(decision).toMatchObject({
      action: 'handled',
      payload: expect.objectContaining({
        cacheOutcome: 'hit',
        servedFromCache: true
      })
    })
  })

  it('returns continue on a cache miss', () => {
    const decision = cacheTrait.beforeArrival?.({
      node: makeNode('cdn', { cacheHitRate: 0, cacheHitLatencyMs: 1 }),
      request: makeRequest(),
      clock: 0n,
      random: () => 0.99
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        cacheOutcome: 'miss'
      })
    })
  })

  it('explains empty cache config fallbacks in field metadata', () => {
    const fields = cacheCapabilityModule.config?.sections[0]?.fields ?? []
    const data = {
      schemaVersion: 2,
      componentType: 'in-memory-cache',
      structuralRole: 'storage',
      profile: 'datastore',
      rendererType: 'standardNode',
      label: 'Redis Cache',
      sim: {}
    } as const

    const hitRate = fields.find((field) => field.path === 'sim.cacheHitRate')
    const hitLatency = fields.find((field) => field.path === 'sim.cacheHitLatencyMs')
    const ttl = fields.find((field) => field.path === 'sim.ttlSeconds')

    expect(typeof hitRate?.placeholder === 'function' ? hitRate.placeholder(data) : undefined).toBe(
      'Default: 0.00 (cache disabled when empty)'
    )
    expect(
      typeof hitLatency?.placeholder === 'function' ? hitLatency.placeholder(data) : undefined
    ).toBe('Default cache-hit latency: 0.1ms')
    expect(ttl?.accuracy).toBe('not-simulated')
  })

  describe('derived-lru model', () => {
    function makeState(): {
      get: <T>(k: string) => T | undefined
      set: (k: string, v: unknown) => void
    } {
      const store = new Map<string, unknown>()
      return {
        get: <T>(k: string) => store.get(k) as T | undefined,
        set: (k: string, v: unknown) => void store.set(k, v)
      }
    }

    let nextId = 0
    function requestWithKey(key: string): Request {
      const request = makeRequest()
      request.id = `req-${nextId++}`
      request.metadata.__key = key
      return request
    }

    /** One access whose miss (if any) completes, filling the key on response. */
    function access(node: ComponentNode, state: ReturnType<typeof makeState>, key: string) {
      const request = requestWithKey(key)
      const decision = cacheTrait.beforeArrival?.({ node, request, clock: 0n, state })
      if (decision?.action === 'continue') {
        cacheTrait.afterTerminal?.({ node, request, clock: 0n, state, status: 'success' })
      }
      return decision
    }

    const lruConfig = {
      cacheModel: 'derived-lru',
      cacheRamMb: 0.002, // 2000 bytes ÷ 1000-byte values ⇒ capacity 2 items
      valueSizeBytes: 1000,
      cacheHitLatencyMs: 0.1
    }

    it('misses on first access to a key, then hits on repeat (warming)', () => {
      const node = makeNode('in-memory-cache', lruConfig)
      const state = makeState()
      const first = access(node, state, 'seatId-0')
      const second = access(node, state, 'seatId-0')

      expect(first).toMatchObject({ action: 'continue', payload: { cacheOutcome: 'miss' } })
      expect(second).toMatchObject({
        action: 'handled',
        payload: { cacheOutcome: 'hit', cacheModel: 'derived-lru', cacheCapacityItems: 2 }
      })
    })

    it('evicts the least-recently-used key past capacity', () => {
      const node = makeNode('in-memory-cache', lruConfig) // capacity 2
      const state = makeState()
      const seq = ['a', 'b', 'a', 'c', 'b'] // c evicts b's slot? recency: after a,b then a(hit)->MRU a; c miss evicts LRU=b; b now miss
      const outcomes = seq.map((key) => {
        const d = access(node, state, key)
        return (d?.payload as { cacheOutcome?: string })?.cacheOutcome
      })
      // a:miss, b:miss, a:hit (refresh), c:miss+evict b (LRU), b:miss again
      expect(outcomes).toEqual(['miss', 'miss', 'hit', 'miss', 'miss'])
    })

    it('serves everything from cache when capacity covers the whole keyspace', () => {
      const node = makeNode('in-memory-cache', {
        ...lruConfig,
        cacheRamMb: 1 // 1e6 bytes ÷ 1000 ⇒ capacity 1000 ≫ working set
      })
      const state = makeState()
      const keys = Array.from({ length: 10 }, (_, i) => `seatId-${i % 5}`) // 5 distinct, repeated
      const outcomes = keys.map(
        (key) => (access(node, state, key)?.payload as { cacheOutcome?: string })?.cacheOutcome
      )
      // First 5 warm the cache (miss), the repeat 5 all hit.
      expect(outcomes.slice(0, 5)).toEqual(['miss', 'miss', 'miss', 'miss', 'miss'])
      expect(outcomes.slice(5)).toEqual(['hit', 'hit', 'hit', 'hit', 'hit'])
    })

    it('falls back to the declared model when the request has no key', () => {
      const node = makeNode('in-memory-cache', { ...lruConfig, cacheHitRate: 1 })
      const decision = cacheTrait.beforeArrival?.({
        node,
        request: makeRequest(), // no __key
        clock: 0n,
        random: () => 0,
        state: makeState()
      })
      // No key ⇒ derived path skipped ⇒ declared cacheHitRate=1 ⇒ hit.
      expect(decision).toMatchObject({ action: 'handled', payload: { cacheOutcome: 'hit' } })
    })

    it('falls back to the declared model when capacity inputs are missing', () => {
      const node = makeNode('in-memory-cache', {
        cacheModel: 'derived-lru',
        cacheHitRate: 0
        // no cacheRamMb / valueSizeBytes
      })
      const decision = cacheTrait.beforeArrival?.({
        node,
        request: requestWithKey('seatId-0'),
        clock: 0n,
        random: () => 0.99,
        state: makeState()
      })
      expect(decision).toMatchObject({ action: 'continue', payload: { cacheOutcome: 'miss' } })
    })
  })
  describe('fill on response and request collapsing', () => {
    function makeState() {
      const store = new Map<string, unknown>()
      return {
        get: <T>(k: string) => store.get(k) as T | undefined,
        set: (k: string, v: unknown) => void store.set(k, v)
      }
    }
    function keyed(id: string, key?: string): Request {
      const request = makeRequest()
      request.id = id
      if (key !== undefined) request.metadata.__key = key
      return request
    }
    const lru = {
      cacheModel: 'derived-lru',
      cacheRamMb: 1,
      valueSizeBytes: 1000,
      cacheHitLatencyMs: 0.1
    }

    it('keeps missing a key while its first fetch is still in flight (no collapsing)', () => {
      const node = makeNode('in-memory-cache', lru)
      const state = makeState()
      const a = cacheTrait.beforeArrival?.({ node, request: keyed('a', 'hot'), clock: 0n, state })
      const b = cacheTrait.beforeArrival?.({ node, request: keyed('b', 'hot'), clock: 0n, state })
      expect(a).toMatchObject({ action: 'continue', payload: { cacheOutcome: 'miss' } })
      expect(b).toMatchObject({ action: 'continue', payload: { cacheOutcome: 'miss' } })
      cacheTrait.afterTerminal?.({
        node,
        request: keyed('a', 'hot'),
        clock: 0n,
        state,
        status: 'success'
      })
      const c = cacheTrait.beforeArrival?.({ node, request: keyed('c', 'hot'), clock: 0n, state })
      expect(c).toMatchObject({ action: 'handled', payload: { cacheOutcome: 'hit' } })
    })

    it('does not fill the key when the fetch fails', () => {
      const node = makeNode('in-memory-cache', lru)
      const state = makeState()
      cacheTrait.beforeArrival?.({ node, request: keyed('a', 'hot'), clock: 0n, state })
      cacheTrait.afterTerminal?.({
        node,
        request: keyed('a', 'hot'),
        clock: 0n,
        state,
        status: 'timeout'
      })
      const b = cacheTrait.beforeArrival?.({ node, request: keyed('b', 'hot'), clock: 0n, state })
      expect(b).toMatchObject({ action: 'continue', payload: { cacheOutcome: 'miss' } })
    })

    it('parks concurrent misses for the same key behind one leader', () => {
      const node = makeNode('in-memory-cache', { ...lru, requestCollapsing: true })
      const state = makeState()
      const leader = cacheTrait.beforeArrival?.({
        node,
        request: keyed('a', 'hot'),
        clock: 0n,
        state
      })
      const follower = cacheTrait.beforeArrival?.({
        node,
        request: keyed('b', 'hot'),
        clock: 0n,
        state
      })
      const otherKey = cacheTrait.beforeArrival?.({
        node,
        request: keyed('c', 'cold'),
        clock: 0n,
        state
      })
      expect(leader).toMatchObject({
        action: 'continue',
        payload: { collapse: 'leader', metricCounters: { cacheMisses: 1, collapseLeaders: 1 } }
      })
      expect(follower).toMatchObject({
        action: 'parked',
        leaderRequestId: 'a',
        payload: { cacheOutcome: 'miss', metricCounters: { cacheMisses: 1, collapsedMisses: 1 } }
      })
      expect(otherKey).toMatchObject({ action: 'continue', payload: { collapse: 'leader' } })
    })

    it('releases leadership when the leader terminates, so the next miss leads', () => {
      const node = makeNode('in-memory-cache', { ...lru, requestCollapsing: true })
      const state = makeState()
      cacheTrait.beforeArrival?.({ node, request: keyed('a', 'hot'), clock: 0n, state })
      cacheTrait.afterTerminal?.({
        node,
        request: keyed('a', 'hot'),
        clock: 0n,
        state,
        status: 'rejected'
      })
      const next = cacheTrait.beforeArrival?.({
        node,
        request: keyed('b', 'hot'),
        clock: 0n,
        state
      })
      expect(next).toMatchObject({ action: 'continue', payload: { collapse: 'leader' } })
    })

    it('treats a retry of the leader as the same leader, not a follower', () => {
      const node = makeNode('in-memory-cache', { ...lru, requestCollapsing: true })
      const state = makeState()
      cacheTrait.beforeArrival?.({ node, request: keyed('a', 'hot'), clock: 0n, state })
      const retry = cacheTrait.beforeArrival?.({
        node,
        request: keyed('a', 'hot'),
        clock: 0n,
        state
      })
      expect(retry).toMatchObject({
        action: 'continue',
        payload: { collapse: 'leader', metricCounters: { cacheMisses: 1 } }
      })
      expect(
        (retry?.payload?.metricCounters as Record<string, number>).collapseLeaders
      ).toBeUndefined()
    })

    it('collapses misses on the declared-rate model too when requests carry keys', () => {
      const node = makeNode('in-memory-cache', { cacheHitRate: 0, requestCollapsing: true })
      const state = makeState()
      cacheTrait.beforeArrival?.({ node, request: keyed('a', 'k'), clock: 0n, state })
      const b = cacheTrait.beforeArrival?.({ node, request: keyed('b', 'k'), clock: 0n, state })
      expect(b).toMatchObject({ action: 'parked', leaderRequestId: 'a' })
    })

    it('has nothing to group when requests carry no key', () => {
      const node = makeNode('in-memory-cache', { ...lru, requestCollapsing: true })
      const state = makeState()
      const a = cacheTrait.beforeArrival?.({ node, request: keyed('a'), clock: 0n, state })
      const b = cacheTrait.beforeArrival?.({ node, request: keyed('b'), clock: 0n, state })
      for (const decision of [a, b]) {
        expect(decision).toMatchObject({
          action: 'continue',
          payload: { collapse: 'no-key', metricCounters: { cacheMisses: 1, collapseNoKey: 1 } }
        })
      }
    })

    it('exposes the toggle in the Caching section', () => {
      const fields = cacheCapabilityModule.config?.sections.flatMap((section) => section.fields)
      expect(fields?.find((field) => field.path === 'sim.requestCollapsing')).toMatchObject({
        type: 'boolean',
        label: 'Request collapsing'
      })
    })
  })
})
