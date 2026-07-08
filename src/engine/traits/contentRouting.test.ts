import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode, EdgeDefinition } from '../core/types'
import type { ResolveRoute } from '../routing'
import { contentRoutingTrait } from './contentRouting'

function makeRequest(overrides: Partial<Request> = {}): Request {
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
    metadata: {},
    ...overrides
  }
}

function makeGatewayNode(config: Record<string, unknown> | undefined = undefined): ComponentNode {
  return {
    id: 'gw',
    type: 'load-balancer-l7',
    category: 'network-and-edge',
    role: 'router',
    label: 'L7 LB',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

function makeRoute(targetNodeId: string): ResolveRoute {
  const edge: EdgeDefinition = {
    id: `gw-${targetNodeId}`,
    source: 'gw',
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

describe('contentRoutingTrait', () => {
  it('routes matching requests to the rule target, ignoring other candidates', () => {
    const result = contentRoutingTrait.filterRoutes?.({
      node: makeGatewayNode({
        routingRules: [{ matchField: 'type', matchValue: 'write', targetNodeId: 'db-primary' }]
      }),
      request: makeRequest({ type: 'write' }),
      clock: 0n,
      candidates: [makeRoute('db-primary'), makeRoute('db-replica')]
    })

    expect(result).toMatchObject({
      decision: 'content-routed',
      routes: [expect.objectContaining({ targetNodeId: 'db-primary' })]
    })
  })

  it('falls through to the default strategy when no rule matches', () => {
    const result = contentRoutingTrait.filterRoutes?.({
      node: makeGatewayNode({
        routingRules: [{ matchField: 'type', matchValue: 'write', targetNodeId: 'db-primary' }]
      }),
      request: makeRequest({ type: 'read' }),
      clock: 0n,
      candidates: [makeRoute('db-primary'), makeRoute('db-replica')]
    })

    expect(result).toMatchObject({
      decision: 'no-rule-matched',
      routes: [
        expect.objectContaining({ targetNodeId: 'db-primary' }),
        expect.objectContaining({ targetNodeId: 'db-replica' })
      ]
    })
  })

  it('passes candidates through unchanged when no rules are configured', () => {
    const result = contentRoutingTrait.filterRoutes?.({
      node: makeGatewayNode(),
      request: makeRequest(),
      clock: 0n,
      candidates: [makeRoute('db-primary')]
    })

    expect(result).toMatchObject({
      decision: 'no-rules-configured',
      routes: [expect.objectContaining({ targetNodeId: 'db-primary' })]
    })
  })

  it('falls back to all candidates when the matched target is unreachable from this node', () => {
    const result = contentRoutingTrait.filterRoutes?.({
      node: makeGatewayNode({
        routingRules: [{ matchField: 'type', matchValue: 'write', targetNodeId: 'not-connected' }]
      }),
      request: makeRequest({ type: 'write' }),
      clock: 0n,
      candidates: [makeRoute('db-primary'), makeRoute('db-replica')]
    })

    expect(result).toMatchObject({
      decision: 'matched-target-unreachable',
      routes: [
        expect.objectContaining({ targetNodeId: 'db-primary' }),
        expect.objectContaining({ targetNodeId: 'db-replica' })
      ]
    })
  })

  it('matches on path and host fields read from request metadata', () => {
    const result = contentRoutingTrait.filterRoutes?.({
      node: makeGatewayNode({
        routingRules: [{ matchField: 'host', matchValue: 'api.internal', targetNodeId: 'api-svc' }]
      }),
      request: makeRequest({ metadata: { host: 'api.internal' } }),
      clock: 0n,
      candidates: [makeRoute('api-svc'), makeRoute('web-svc')]
    })

    expect(result).toMatchObject({
      decision: 'content-routed',
      routes: [expect.objectContaining({ targetNodeId: 'api-svc' })]
    })
  })
})
