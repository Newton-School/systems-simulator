import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import type { Request } from '../core/events'
import type { ResolveRoute } from '../routing'
import { broadcastFanoutTrait } from './broadcastFanout'

function makeRequest(metadata: Record<string, unknown> = {}): Request {
  return {
    id: 'req-1',
    type: 'event',
    sizeBytes: 100,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata
  }
}

function route(targetNodeId: string): ResolveRoute {
  return {
    targetNodeId,
    edge: {
      id: `e-${targetNodeId}`,
      source: 'broker',
      target: targetNodeId,
      mode: 'asynchronous',
      protocol: 'grpc',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 1000,
      maxConcurrentRequests: 1000,
      packetLossRate: 0,
      errorRate: 0
    }
  }
}

function consumer(id: string, group?: string): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    config: group ? { consumerGroup: group } : {}
  }
}

function brokerNode(consumerGroupMode: boolean): ComponentNode {
  return {
    id: 'broker',
    type: 'message-broker',
    category: 'messaging-and-streaming',
    label: 'broker',
    position: { x: 0, y: 0 },
    config: { consumerGroupMode }
  }
}

function invoke(
  broker: ComponentNode,
  candidates: ResolveRoute[],
  consumers: ComponentNode[],
  request = makeRequest()
) {
  const byId = new Map(consumers.map((c) => [c.id, c]))
  return broadcastFanoutTrait.filterRoutes?.({
    node: broker,
    request,
    clock: 0n,
    candidates,
    getNode: (id: string) => byId.get(id)
  })
}

describe('broadcastFanoutTrait', () => {
  it('marks broker nodes with the broadcast routing hint', () => {
    expect(broadcastFanoutTrait.routingStrategyHint).toBe('broadcast')
  })

  it('leaves all routes intact (topic fan-out) when consumer groups are off', () => {
    const candidates = [route('a'), route('b'), route('c')]
    const result = invoke(brokerNode(false), candidates, [
      consumer('a'),
      consumer('b'),
      consumer('c')
    ])
    expect(result?.routes).toHaveLength(3)
  })

  it('delivers to exactly one member within a single consumer group', () => {
    const candidates = [route('w1'), route('w2'), route('w3')]
    const consumers = [
      consumer('w1', 'workers'),
      consumer('w2', 'workers'),
      consumer('w3', 'workers')
    ]
    const result = invoke(brokerNode(true), candidates, consumers)
    expect(result?.routes).toHaveLength(1)
    expect(result?.decision).toBe('consumer-group-delivery')
  })

  it('delivers one copy per group (fan-out across groups, share within)', () => {
    const candidates = [route('a1'), route('a2'), route('b1'), route('b2')]
    const consumers = [
      consumer('a1', 'analytics'),
      consumer('a2', 'analytics'),
      consumer('b1', 'billing'),
      consumer('b2', 'billing')
    ]
    const result = invoke(brokerNode(true), candidates, consumers)
    expect(result?.routes).toHaveLength(2)
    const groups = new Set(
      result?.routes.map((r) => (['a1', 'a2'].includes(r.targetNodeId) ? 'analytics' : 'billing'))
    )
    expect(groups).toEqual(new Set(['analytics', 'billing']))
  })

  it('treats an ungrouped subscriber as its own group (still gets every message)', () => {
    const candidates = [route('w1'), route('w2'), route('solo')]
    const consumers = [consumer('w1', 'workers'), consumer('w2', 'workers'), consumer('solo')]
    const result = invoke(brokerNode(true), candidates, consumers)
    // One member of "workers" + the solo subscriber = 2 deliveries.
    expect(result?.routes).toHaveLength(2)
    expect(result?.routes.map((r) => r.targetNodeId)).toContain('solo')
  })

  it('is deterministic: the same message key always picks the same member', () => {
    const candidates = [route('w1'), route('w2'), route('w3')]
    const consumers = [
      consumer('w1', 'workers'),
      consumer('w2', 'workers'),
      consumer('w3', 'workers')
    ]
    const pick = () =>
      invoke(brokerNode(true), candidates, consumers, makeRequest({ __key: 'order-9' }))?.routes[0]
        ?.targetNodeId
    expect(pick()).toBe(pick())
  })

  it('spreads distinct message keys across members within a group', () => {
    const candidates = [route('w1'), route('w2'), route('w3')]
    const consumers = [
      consumer('w1', 'workers'),
      consumer('w2', 'workers'),
      consumer('w3', 'workers')
    ]
    const targets = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const r = invoke(brokerNode(true), candidates, consumers, makeRequest({ __key: `k-${i}` }))
      targets.add(r!.routes[0].targetNodeId)
    }
    expect(targets.size).toBeGreaterThan(1)
  })
})
