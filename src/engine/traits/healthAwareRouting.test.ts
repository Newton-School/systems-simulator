import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode, EdgeDefinition } from '../core/types'
import type { ResolveRoute } from '../routing'
import { healthAwareRoutingTrait } from './healthAwareRouting'

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

function makeRouterNode(config: Record<string, unknown> | undefined = undefined): ComponentNode {
  return {
    id: 'lb',
    type: 'load-balancer',
    category: 'network-and-edge',
    role: 'router',
    label: 'LB',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

function makeRoute(targetNodeId: string): ResolveRoute {
  const edge: EdgeDefinition = {
    id: `lb-${targetNodeId}`,
    source: 'lb',
    target: targetNodeId,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }

  return { targetNodeId, edge }
}

describe('healthAwareRoutingTrait', () => {
  it('filters out unhealthy targets when health checks are enabled', () => {
    const result = healthAwareRoutingTrait.filterRoutes?.({
      node: makeRouterNode(),
      request: makeRequest(),
      clock: 0n,
      candidates: [makeRoute('worker-a'), makeRoute('worker-b')],
      isTargetHealthy: (nodeId) => nodeId !== 'worker-b',
      isEdgeHealthy: () => true
    })

    expect(result).toMatchObject({
      decision: 'filtered-unhealthy-targets',
      routes: [expect.objectContaining({ targetNodeId: 'worker-a' })]
    })
  })

  it('preserves candidates when health checks are disabled', () => {
    const result = healthAwareRoutingTrait.filterRoutes?.({
      node: makeRouterNode({ healthCheckEnabled: false }),
      request: makeRequest(),
      clock: 0n,
      candidates: [makeRoute('worker-a'), makeRoute('worker-b')],
      isTargetHealthy: (nodeId) => nodeId !== 'worker-b',
      isEdgeHealthy: () => true
    })

    expect(result).toMatchObject({
      decision: 'disabled',
      routes: [
        expect.objectContaining({ targetNodeId: 'worker-a' }),
        expect.objectContaining({ targetNodeId: 'worker-b' })
      ]
    })
  })

  it('returns no_healthy_targets when every candidate is unhealthy', () => {
    const result = healthAwareRoutingTrait.filterRoutes?.({
      node: makeRouterNode(),
      request: makeRequest(),
      clock: 0n,
      candidates: [makeRoute('worker-a')],
      isTargetHealthy: () => false,
      isEdgeHealthy: () => true
    })

    expect(result).toMatchObject({
      decision: 'no-healthy-targets',
      rejectionReason: 'no_healthy_targets',
      routes: []
    })
  })
})
