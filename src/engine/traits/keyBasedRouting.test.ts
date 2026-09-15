import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode, EdgeDefinition } from '../core/types'
import type { ResolveRoute } from '../routing'
import { keyBasedRoutingTrait } from './keyBasedRouting'

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: 'req-1',
    type: 'lookup',
    sizeBytes: 100,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata: {},
    ...overrides
  }
}

function makeNode(config: Record<string, unknown> = {}): ComponentNode {
  return {
    id: 'router',
    type: 'sharding',
    category: 'auxiliary',
    role: 'router',
    label: 'Shard Router',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

function makeRoute(targetNodeId: string): ResolveRoute {
  const edge: EdgeDefinition = {
    id: `router-${targetNodeId}`,
    source: 'router',
    target: targetNodeId,
    mode: 'synchronous',
    protocol: 'tcp',
    latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-rack' },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }

  return { targetNodeId, edge }
}

describe('keyBasedRoutingTrait', () => {
  it('routes the same key to the same shard deterministically', () => {
    const node = makeNode({ routingKeyField: 'tenantId' })
    const routes = [makeRoute('shard-b'), makeRoute('shard-a'), makeRoute('shard-c')]

    const first = keyBasedRoutingTrait.filterRoutes?.({
      node,
      request: makeRequest({ metadata: { tenantId: 'acme' } }),
      clock: 0n,
      candidates: routes
    })
    const second = keyBasedRoutingTrait.filterRoutes?.({
      node,
      request: makeRequest({ id: 'req-2', metadata: { tenantId: 'acme' } }),
      clock: 1n,
      candidates: routes
    })

    expect(first).toMatchObject({
      decision: 'key-routed',
      routes: [expect.any(Object)]
    })
    expect(second).toMatchObject({
      decision: 'key-routed',
      routes: [expect.any(Object)]
    })
    expect(first?.routes[0]?.targetNodeId).toBe(second?.routes[0]?.targetNodeId)
  })

  it('falls back to request id when the routing key is missing', () => {
    const result = keyBasedRoutingTrait.filterRoutes?.({
      node: makeNode({ routingKeyField: 'tenantId' }),
      request: makeRequest({ id: 'req-fallback' }),
      clock: 0n,
      candidates: [makeRoute('shard-a'), makeRoute('shard-b')]
    })

    expect(result).toMatchObject({
      decision: 'key-routed',
      payload: expect.objectContaining({
        routingKeyField: 'tenantId',
        routingKey: 'req-fallback',
        metricCounters: { keyRoutedRequests: 1 }
      })
    })
  })

  it('consistent hashing keeps surviving-shard keys put when a shard is removed', () => {
    const node = makeNode({ routingKeyField: 'k' })
    const shardOf = (candidates: ResolveRoute[], key: string): string =>
      keyBasedRoutingTrait.filterRoutes?.({
        node,
        request: makeRequest({ metadata: { k: key } }),
        clock: 0n,
        candidates
      })!.routes[0].targetNodeId

    const full = [makeRoute('shard-a'), makeRoute('shard-b'), makeRoute('shard-c')]
    const reduced = [makeRoute('shard-a'), makeRoute('shard-b')] // shard-c removed

    let moved = 0
    let onSurvivor = 0
    for (let i = 0; i < 600; i++) {
      const key = `key-${i}`
      const before = shardOf(full, key)
      if (before === 'shard-a' || before === 'shard-b') {
        onSurvivor++
        if (shardOf(reduced, key) !== before) moved++
      }
    }
    // Ring invariant: keys already on a surviving shard never move; only shard-c's keys reassign.
    expect(moved).toBe(0)
    expect(onSurvivor).toBeGreaterThan(0)
  })

  it('spreads keys across shards', () => {
    const node = makeNode({ routingKeyField: 'k' })
    const candidates = [makeRoute('shard-a'), makeRoute('shard-b'), makeRoute('shard-c')]
    const targets = new Set<string>()
    for (let i = 0; i < 100; i++) {
      targets.add(
        keyBasedRoutingTrait.filterRoutes?.({
          node,
          request: makeRequest({ metadata: { k: `key-${i}` } }),
          clock: 0n,
          candidates
        })!.routes[0].targetNodeId
      )
    }
    expect(targets.size).toBe(3)
  })
})
