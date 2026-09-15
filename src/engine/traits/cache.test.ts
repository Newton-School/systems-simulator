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
      rendererType: 'serviceNode',
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

    function requestWithKey(key: string): Request {
      const request = makeRequest()
      request.metadata.__key = key
      return request
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
      const first = cacheTrait.beforeArrival?.({
        node,
        request: requestWithKey('seatId-0'),
        clock: 0n,
        state
      })
      const second = cacheTrait.beforeArrival?.({
        node,
        request: requestWithKey('seatId-0'),
        clock: 0n,
        state
      })

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
        const d = cacheTrait.beforeArrival?.({
          node,
          request: requestWithKey(key),
          clock: 0n,
          state
        })
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
        (key) =>
          (
            cacheTrait.beforeArrival?.({ node, request: requestWithKey(key), clock: 0n, state })
              ?.payload as { cacheOutcome?: string }
          )?.cacheOutcome
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
})
