import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import type { ResolveRoute } from '../routing'
import { streamBrokerTrait } from './streamBroker'

function makeStreamNode(config: Record<string, unknown> | undefined = undefined): ComponentNode {
  return {
    id: 'stream',
    type: 'stream',
    category: 'messaging-and-streaming',
    role: 'processor',
    label: 'stream',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

function makeRequest(metadata: Record<string, unknown>) {
  return {
    id: 'req-1',
    metadata
  }
}

function route(targetNodeId: string): ResolveRoute {
  return {
    targetNodeId,
    edge: {
      id: `edge-${targetNodeId}`,
      source: 'stream',
      target: targetNodeId,
      mode: 'streaming',
      protocol: 'tcp',
      latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
      bandwidth: 1_000,
      maxConcurrentRequests: 1_000,
      packetLossRate: 0,
      errorRate: 0
    }
  }
}

describe('streamBrokerTrait', () => {
  it('acknowledges producers at append time and records a deterministic partition', () => {
    const decision = streamBrokerTrait.beforeArrival?.({
      node: makeStreamNode({ streamBrokerEnabled: true, partitionCount: 4 }),
      request: makeRequest({ partitionKey: 'tenant-42' }) as never,
      clock: 0n
    })

    expect(decision).toMatchObject({
      action: 'handled',
      latencyUs: 0n,
      payload: {
        forkConsumerRequest: true,
        metricCounters: { streamAppends: 1 }
      }
    })
    expect(
      (decision as { payload?: Record<string, unknown> }).payload?.['streamPartition']
    ).toSatisfy((value: unknown) => typeof value === 'number' && value >= 0 && value < 4)
  })

  it('keeps the same key partition-affine across deliveries', () => {
    const node = makeStreamNode({
      streamBrokerEnabled: true,
      partitionCount: 4,
      partitionKeyField: 'tenantId'
    })
    const firstRequest = makeRequest({ tenantId: 'tenant-a' }) as never
    const secondRequest = makeRequest({ tenantId: 'tenant-a' }) as never
    streamBrokerTrait.beforeArrival?.({ node, request: firstRequest, clock: 0n })
    streamBrokerTrait.beforeArrival?.({ node, request: secondRequest, clock: 0n })

    const candidates = [route('worker-a'), route('worker-b'), route('worker-c')]
    const first = streamBrokerTrait.filterRoutes?.({
      node,
      request: firstRequest,
      clock: 0n,
      candidates
    })
    const second = streamBrokerTrait.filterRoutes?.({
      node,
      request: secondRequest,
      clock: 0n,
      candidates
    })

    expect(first).toMatchObject({ routes: [{ targetNodeId: expect.any(String) }] })
    expect(second).toMatchObject({ routes: [{ targetNodeId: expect.any(String) }] })
    expect((first as { routes: ResolveRoute[] }).routes[0]?.targetNodeId).toBe(
      (second as { routes: ResolveRoute[] }).routes[0]?.targetNodeId
    )
  })

  it('delivers one copy per configured consumer group', () => {
    const node = makeStreamNode({
      streamBrokerEnabled: true,
      consumerGroupMode: true,
      partitionCount: 8
    })
    const request = makeRequest({ partitionKey: 'order-77' }) as never
    streamBrokerTrait.beforeArrival?.({ node, request, clock: 0n })

    const candidates = [route('search-a'), route('search-b'), route('email-a'), route('billing-a')]
    const selected = streamBrokerTrait.filterRoutes?.({
      node,
      request,
      clock: 0n,
      candidates,
      getNode: (nodeId) =>
        ({
          id: nodeId,
          type: 'batch-worker',
          category: 'compute',
          label: nodeId,
          position: { x: 0, y: 0 },
          config: {
            consumerGroup: nodeId.startsWith('search')
              ? 'search'
              : nodeId.startsWith('email')
                ? 'email'
                : 'billing'
          }
        }) as ComponentNode
    })

    expect(selected).toMatchObject({
      decision: 'consumer-group-delivery',
      payload: {
        metricCounters: { streamGroupDeliveries: 3 }
      }
    })
    expect((selected as { routes: ResolveRoute[] }).routes).toHaveLength(3)
    expect(
      new Set(
        (selected as { routes: ResolveRoute[] }).routes.map((current) => current.targetNodeId)
      )
    ).toHaveLength(3)
    expect(
      (selected as { routes: ResolveRoute[] }).routes.every(
        (current) => current.edge.mode === 'asynchronous'
      )
    ).toBe(true)
  })

  it('commits the delivered offset for every consumer group after success', () => {
    const values = new Map<string, unknown>()
    const state = {
      get: <T>(key: string) => values.get(key) as T,
      set: (key: string, value: unknown) => values.set(key, value)
    }
    const node = makeStreamNode({ streamBrokerEnabled: true, consumerGroupMode: true })
    const request = makeRequest({ partitionKey: 'order-9' }) as never
    streamBrokerTrait.beforeArrival?.({ node, request, clock: 0n, state })
    ;(request as { metadata: Record<string, unknown> }).metadata.__streamConsumerGroups = [
      'search',
      'email'
    ]

    expect(
      streamBrokerTrait.afterTerminal?.({ node, request, clock: 1n, state, status: 'success' })
    ).toMatchObject({
      streamOffsetCommitted: true,
      metricCounters: { streamOffsetCommits: 2 }
    })
  })
})
