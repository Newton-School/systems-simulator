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
})
