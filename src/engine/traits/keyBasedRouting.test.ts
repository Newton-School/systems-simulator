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
})
