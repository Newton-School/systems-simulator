import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode, EdgeDefinition } from '../core/types'
import type { ResolveRoute } from '../routing'
import { dnsRoutingPolicyTrait } from './dnsRoutingPolicy'
import type { TraitStateStore } from './types'

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: 'req-1',
    type: 'resolve',
    sizeBytes: 64,
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

function makeStateStore(): TraitStateStore {
  const state = new Map<string, unknown>()
  return {
    get: (key) => state.get(key),
    set: (key, value) => void state.set(key, value)
  }
}

function makeNode(config: Record<string, unknown> = {}): ComponentNode {
  return {
    id: 'dns',
    type: 'internal-dns',
    category: 'dns-and-certs',
    role: 'router',
    label: 'Resolver',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

function makeRoute(targetNodeId: string, weight = 1): ResolveRoute {
  const edge: EdgeDefinition = {
    id: `dns-${targetNodeId}`,
    source: 'dns',
    target: targetNodeId,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 100,
    maxConcurrentRequests: 10,
    packetLossRate: 0,
    errorRate: 0,
    weight
  }

  return { targetNodeId, edge }
}

describe('dnsRoutingPolicyTrait', () => {
  it('caches repeated lookups and reports hit/miss counters', () => {
    const state = makeStateStore()
    const node = makeNode({ dnsCacheTtlSeconds: 30 })

    const first = dnsRoutingPolicyTrait.beforeArrival?.({
      node,
      request: makeRequest({ metadata: { host: 'catalog.internal' } }),
      clock: 0n,
      state
    })
    const second = dnsRoutingPolicyTrait.beforeArrival?.({
      node,
      request: makeRequest({ id: 'req-2', metadata: { host: 'catalog.internal' } }),
      clock: 1n,
      state
    })

    expect(first).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        dnsCacheHit: false,
        metricCounters: { dnsCacheMisses: 1 }
      })
    })
    expect(second).toMatchObject({
      action: 'continue',
      payload: expect.objectContaining({
        dnsCacheHit: true,
        metricCounters: { dnsCacheHits: 1 }
      })
    })
  })

  it('fails over to the next healthy target when the primary is unhealthy', () => {
    const result = dnsRoutingPolicyTrait.filterRoutes?.({
      node: makeNode({ dnsRoutingPolicy: 'failover' }),
      request: makeRequest(),
      clock: 0n,
      candidates: [makeRoute('primary', 10), makeRoute('secondary', 1)],
      isTargetHealthy: (nodeId) => nodeId !== 'primary'
    })

    expect(result).toMatchObject({
      decision: 'failover',
      routes: [expect.objectContaining({ targetNodeId: 'secondary' })]
    })
  })
})
