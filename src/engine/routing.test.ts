import { describe, expect, it } from 'vitest'
import { Request } from './core/events'
import { ComponentNode, EdgeDefinition } from './core/types'
import { RoutingTable } from './routing'
import { createRandom } from './stochastic/random'
import { resolveTraits } from './traits/resolveTraits'
import type { NodeBehaviourTrait, TraitResolver } from './traits/types'

function makeRequest(type = 'GET'): Request {
  return {
    id: 'req-1',
    type,
    sizeBytes: 256,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata: {}
  }
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<EdgeDefinition> = {}
): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 1000,
    packetLossRate: 0,
    errorRate: 0,
    ...overrides
  }
}

function makeNode(id: string, type: ComponentNode['type'] = 'microservice'): ComponentNode {
  return {
    id,
    type,
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 }
  }
}

describe('RoutingTable', () => {
  it('returns all outgoing edges for a source node', () => {
    const edges = [
      makeEdge('e1', 'node-a', 'node-b'),
      makeEdge('e2', 'node-a', 'node-c'),
      makeEdge('e3', 'node-x', 'node')
    ]

    const routing = new RoutingTable(edges, createRandom('outgoing'))
    const outgoing = routing.getOutgoingEdges('node-a')

    expect(outgoing).toHaveLength(2)
    expect(outgoing.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('single target always resolves to the same edge', () => {
    const routing = new RoutingTable([makeEdge('e1', 'node-a', 'node-b')], createRandom('single'))
    const request = makeRequest()

    for (let i = 0; i < 100; i++) {
      const resolved = routing.resolveTarget('node-a', request)
      expect(resolved).toHaveLength(1)
      expect(resolved[0].targetNodeId).toBe('node-b')
      expect(resolved[0].edge.id).toBe('e1')
    }
  })

  it('weighted routing matches configured weight ratios within 5% over 10,000 calls', () => {
    const edges = [
      makeEdge('e1', 'router', 'a', { weight: 3 }),
      makeEdge('e2', 'router', 'b', { weight: 2 }),
      makeEdge('e3', 'router', 'c', { weight: 1 })
    ]

    const routing = new RoutingTable(edges, createRandom('weighted'))
    const request = makeRequest()
    const counts = { a: 0, b: 0, c: 0 }

    for (let i = 0; i < 10_000; i++) {
      const resolved = routing.resolveTarget('router', request)
      expect(resolved).toHaveLength(1)
      counts[resolved[0].targetNodeId as keyof typeof counts]++
    }

    const ratioA = counts.a / 10_000
    const ratioB = counts.b / 10_000
    const ratioC = counts.c / 10_000

    expect(ratioA).toBeGreaterThan(0.45)
    expect(ratioA).toBeLessThan(0.55)
    expect(ratioB).toBeGreaterThan(0.28)
    expect(ratioB).toBeLessThan(0.38)
    expect(ratioC).toBeGreaterThan(0.11)
    expect(ratioC).toBeLessThan(0.22)
  })

  it('fan-out returns all asynchronous targets in parallel', () => {
    const edges = [
      makeEdge('e1', 'node-a', 'node-b', { mode: 'asynchronous' }),
      makeEdge('e2', 'node-a', 'node-c', { mode: 'asynchronous' }),
      makeEdge('e3', 'node-a', 'node-d', { mode: 'asynchronous' })
    ]

    const routing = new RoutingTable(edges, createRandom('fanout'))
    const resolved = routing.resolveTarget('node-a', makeRequest())

    expect(resolved).toHaveLength(3)
    expect(resolved.map((r) => r.targetNodeId).sort()).toEqual(['node-b', 'node-c', 'node-d'])
  })

  it('round-robin cycles through targets using type-derived routing hints', () => {
    const edges = [
      makeEdge('e1', 'my-router-1', 'a'),
      makeEdge('e2', 'my-router-1', 'b'),
      makeEdge('e3', 'my-router-1', 'c')
    ]
    const nodes = [makeNode('my-router-1', 'load-balancer')]

    const routing = new RoutingTable(edges, createRandom('rr'), nodes)
    const request = makeRequest()

    const picks = Array.from({ length: 7 }, () => routing.resolveTarget('my-router-1', request)[0])
    expect(picks.map((r) => r.targetNodeId)).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a'])
  })

  it('round-robin cycles through targets when routingStrategy is explicit on the node config', () => {
    const edges = [
      makeEdge('e1', 'router-1', 'a'),
      makeEdge('e2', 'router-1', 'b'),
      makeEdge('e3', 'router-1', 'c')
    ]
    const nodes: ComponentNode[] = [
      {
        ...makeNode('router-1'),
        config: { routingStrategy: 'round-robin' }
      }
    ]

    const routing = new RoutingTable(edges, createRandom('rr-config'), nodes)
    const picks = Array.from(
      { length: 6 },
      () => routing.resolveTarget('router-1', makeRequest())[0]
    )

    expect(picks.map((route) => route.targetNodeId)).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })

  it('plain services do not round-robin just because their id looks like a load balancer', () => {
    const edges = [
      makeEdge('e1', 'lb-ish-thing', 'a'),
      makeEdge('e2', 'lb-ish-thing', 'b'),
      makeEdge('e3', 'lb-ish-thing', 'c')
    ]
    const nodes = [makeNode('lb-ish-thing', 'microservice')]

    const routing = new RoutingTable(edges, createRandom('not-rr'), nodes)
    const picks = Array.from(
      { length: 6 },
      () => routing.resolveTarget('lb-ish-thing', makeRequest())[0]
    )

    expect(picks.map((r) => r.targetNodeId)).not.toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })

  it('conditional routing includes only edges whose condition matches request context', () => {
    const edges = [
      makeEdge('e1', 'node-a', 'post-target', { condition: 'request.type === "POST"' }),
      makeEdge('e2', 'node-a', 'get-target', { condition: 'request.type === "GET"' }),
      makeEdge('e3', 'node-a', 'always-target')
    ]
    const routing = new RoutingTable(edges, createRandom('conditional'))

    for (let i = 0; i < 200; i++) {
      const postPick = routing.resolveTarget('node-a', makeRequest('POST'))[0].targetNodeId
      expect(['post-target', 'always-target']).toContain(postPick)
      expect(postPick).not.toBe('get-target')

      const getPick = routing.resolveTarget('node-a', makeRequest('GET'))[0].targetNodeId
      expect(['get-target', 'always-target']).toContain(getPick)
      expect(getPick).not.toBe('post-target')
    }
  })

  it('mixed async and sync edges fan-out to all async and pick one sync', () => {
    const edges = [
      makeEdge('e1', 'node-a', 'queue-1', { mode: 'asynchronous' }),
      makeEdge('e2', 'node-a', 'queue-2', { mode: 'asynchronous' }),
      makeEdge('e3', 'node-a', 'service-1'),
      makeEdge('e4', 'node-a', 'service-2')
    ]

    const routing = new RoutingTable(edges, createRandom('mixed'))
    const results = routing.resolveTarget('node-a', makeRequest())

    const asyncTargets = results
      .filter((r) => r.edge.mode === 'asynchronous')
      .map((r) => r.targetNodeId)
    const syncTargets = results
      .filter((r) => r.edge.mode !== 'asynchronous')
      .map((r) => r.targetNodeId)

    expect(asyncTargets.sort()).toEqual(['queue-1', 'queue-2'])
    expect(syncTargets).toHaveLength(1)
    expect(['service-1', 'service-2']).toContain(syncTargets[0])
  })

  it('conditional-mode edge with no condition string is never eligible', () => {
    const edges = [
      makeEdge('e1', 'node-a', 'guarded', { mode: 'conditional' }),
      makeEdge('e2', 'node-a', 'always')
    ]

    const routing = new RoutingTable(edges, createRandom('cond-mode'))

    for (let i = 0; i < 50; i++) {
      const resolved = routing.resolveTarget('node-a', makeRequest())
      expect(resolved).toHaveLength(1)
      expect(resolved[0].targetNodeId).toBe('always')
    }
  })

  it('returns empty array for sink nodes', () => {
    const edges = [makeEdge('e1', 'a', 'b')]
    const routing = new RoutingTable(edges, createRandom('sink'))
    expect(routing.resolveTarget('no-outgoing', makeRequest())).toEqual([])
  })

  it('applies trait-provided route filters before selecting a sync target', () => {
    const edges = [
      makeEdge('e1', 'router', 'a'),
      makeEdge('e2', 'router', 'b'),
      makeEdge('e3', 'router', 'c')
    ]
    const filterTrait: NodeBehaviourTrait = {
      name: 'test.only-b',
      filterRoutes: ({ candidates }) => ({
        routes: candidates.filter((candidate) => candidate.targetNodeId === 'b'),
        decision: 'filtered-to-b'
      })
    }
    const traitResolver: TraitResolver = (node) => (node.id === 'router' ? [filterTrait] : [])

    const routing = new RoutingTable(
      edges,
      createRandom('trait-filter'),
      [makeNode('router')],
      traitResolver
    )

    const resolved = routing.resolveTarget('router', makeRequest())
    expect(resolved).toHaveLength(1)
    expect(resolved[0].targetNodeId).toBe('b')
  })

  it('an L7 LB with a content routing rule sends writes to the rule target and round-robins reads', () => {
    const edges = [
      makeEdge('e1', 'gw', 'db-primary'),
      makeEdge('e2', 'gw', 'db-replica-a'),
      makeEdge('e3', 'gw', 'db-replica-b')
    ]
    const gateway: ComponentNode = {
      id: 'gw',
      type: 'load-balancer-l7',
      category: 'network-and-edge',
      role: 'router',
      label: 'L7 LB',
      position: { x: 0, y: 0 },
      config: {
        routingRules: [{ matchField: 'type', matchValue: 'write', targetNodeId: 'db-primary' }]
      }
    }

    const routing = new RoutingTable(
      edges,
      createRandom('content-routing'),
      [gateway],
      resolveTraits
    )

    for (let i = 0; i < 5; i++) {
      const writeResult = routing.resolveTarget('gw', makeRequest('write'))
      expect(writeResult).toHaveLength(1)
      expect(writeResult[0].targetNodeId).toBe('db-primary')
    }

    const seenTargets = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const readResult = routing.resolveTarget('gw', makeRequest('read'))
      expect(readResult).toHaveLength(1)
      seenTargets.add(readResult[0].targetNodeId)
    }
    expect(seenTargets).toEqual(new Set(['db-primary', 'db-replica-a', 'db-replica-b']))
  })

  it('forces edges into observability nodes to async even when misconfigured as synchronous', () => {
    const edges = [
      makeEdge('svc-api', 'svc', 'api', { mode: 'synchronous' }),
      makeEdge('svc-metrics', 'svc', 'metrics', { mode: 'synchronous' })
    ]
    const nodes = [makeNode('svc'), makeNode('api'), makeNode('metrics', 'metrics-store')]

    const routing = new RoutingTable(edges, createRandom('async-only'), nodes)

    for (let i = 0; i < 10; i++) {
      const resolved = routing.resolveTarget('svc', makeRequest())
      const targets = resolved.map((route) => route.targetNodeId)
      // Every request reaches BOTH the real business target and the
      // observability node — the metrics edge never competes for the single
      // sync selection slot and steals traffic from the real target.
      expect(targets).toContain('api')
      expect(targets).toContain('metrics')
      expect(resolved.find((route) => route.targetNodeId === 'metrics')?.edge.mode).toBe(
        'asynchronous'
      )
    }
  })

  it('gives the original request id to the sync continuation, not an async observability branch', () => {
    const edges = [
      makeEdge('svc-api', 'svc', 'api'),
      makeEdge('svc-metrics', 'svc', 'metrics', { mode: 'asynchronous' })
    ]
    const nodes = [makeNode('svc'), makeNode('api'), makeNode('metrics', 'metrics-store')]

    const routing = new RoutingTable(edges, createRandom('branch-order'), nodes)
    const resolved = routing.resolveTarget('svc', makeRequest())

    expect(resolved[0].targetNodeId).toBe('api')
    expect(resolved[1]?.targetNodeId).toBe('metrics')
  })
})
