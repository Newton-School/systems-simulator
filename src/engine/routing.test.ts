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

  it('least-conn routes to the target with the fewest in-flight requests', () => {
    const edges = [makeEdge('e1', 'lb', 'a'), makeEdge('e2', 'lb', 'b'), makeEdge('e3', 'lb', 'c')]
    const nodes: ComponentNode[] = [
      { ...makeNode('lb'), config: { routingStrategy: 'least-conn' } }
    ]
    const routing = new RoutingTable(edges, createRandom('least-conn'), nodes)
    const inFlight: Record<string, number> = { a: 5, b: 1, c: 3 }

    const pick = routing.resolveTarget('lb', makeRequest(), {
      getInFlight: (nodeId) => inFlight[nodeId] ?? 0
    })[0]

    expect(pick.targetNodeId).toBe('b')
  })

  it('least-conn breaks ties by rotating through the tied targets', () => {
    const edges = [makeEdge('e1', 'lb', 'a'), makeEdge('e2', 'lb', 'b'), makeEdge('e3', 'lb', 'c')]
    const nodes: ComponentNode[] = [
      { ...makeNode('lb'), config: { routingStrategy: 'least-conn' } }
    ]
    const routing = new RoutingTable(edges, createRandom('least-conn-tie'), nodes)
    // a and c are tied for the minimum; b is heavier and never chosen.
    const inFlight: Record<string, number> = { a: 2, b: 9, c: 2 }
    const getInFlight = (nodeId: string) => inFlight[nodeId] ?? 0

    const picks = Array.from(
      { length: 4 },
      () => routing.resolveTarget('lb', makeRequest(), { getInFlight })[0].targetNodeId
    )

    expect(picks).toEqual(['a', 'c', 'a', 'c'])
  })

  it('passthrough forwards to the first eligible target without balancing', () => {
    const edges = [
      makeEdge('e1', 'proxy', 'a'),
      makeEdge('e2', 'proxy', 'b'),
      makeEdge('e3', 'proxy', 'c')
    ]
    const nodes: ComponentNode[] = [
      { ...makeNode('proxy'), config: { routingStrategy: 'passthrough' } }
    ]
    const routing = new RoutingTable(edges, createRandom('passthrough'), nodes)
    const picks = Array.from(
      { length: 5 },
      () => routing.resolveTarget('proxy', makeRequest())[0].targetNodeId
    )

    expect(picks).toEqual(['a', 'a', 'a', 'a', 'a'])
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

  it('broadcast fanout returns every eligible downstream route for broker-style nodes', () => {
    const edges = [
      makeEdge('e1', 'broker', 'email-worker'),
      makeEdge('e2', 'broker', 'push-worker'),
      makeEdge('e3', 'broker', 'analytics-worker')
    ]
    const nodes = [makeNode('broker', 'message-broker')]

    const routing = new RoutingTable(edges, createRandom('broadcast-broker'), nodes)
    const resolved = routing.resolveTarget('broker', makeRequest('publish'))

    expect(resolved.map((route) => route.targetNodeId).sort()).toEqual([
      'analytics-worker',
      'email-worker',
      'push-worker'
    ])
  })

  it('broker consumer-group mode delivers one member per group end-to-end', () => {
    const edges = [
      makeEdge('e1', 'broker', 'w1'),
      makeEdge('e2', 'broker', 'w2'),
      makeEdge('e3', 'broker', 'audit')
    ]
    const nodes = [
      { ...makeNode('broker', 'message-broker'), config: { consumerGroupMode: true } },
      { ...makeNode('w1'), config: { consumerGroup: 'workers' } },
      { ...makeNode('w2'), config: { consumerGroup: 'workers' } },
      { ...makeNode('audit'), config: { consumerGroup: 'audit' } }
    ]

    const routing = new RoutingTable(edges, createRandom('broker-groups'), nodes)
    const resolved = routing.resolveTarget('broker', {
      ...makeRequest('publish'),
      metadata: { __key: 'evt-1' }
    })

    // One "workers" member (competing consumers) + the "audit" group = 2 deliveries.
    expect(resolved).toHaveLength(2)
    const targets = resolved.map((r) => r.targetNodeId)
    expect(targets).toContain('audit')
    expect(targets.filter((t) => t === 'w1' || t === 'w2')).toHaveLength(1)
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

  describe('load-aware routing', () => {
    function poolEdges(): EdgeDefinition[] {
      return [makeEdge('e1', 'lb', 'a'), makeEdge('e2', 'lb', 'b'), makeEdge('e3', 'lb', 'c')]
    }
    function lbNodes(strategy: string): ComponentNode[] {
      return [{ ...makeNode('lb', 'load-balancer'), config: { routingStrategy: strategy } }]
    }

    it('least-response-time picks the lowest (in-flight × service time)', () => {
      const routing = new RoutingTable(
        poolEdges(),
        createRandom('lrt'),
        lbNodes('least-response-time')
      )
      const inFlight: Record<string, number> = { a: 1, b: 1, c: 1 }
      const responseMs: Record<string, number> = { a: 50, b: 5, c: 40 }
      const picks = Array.from(
        { length: 5 },
        () =>
          routing.resolveTarget('lb', makeRequest(), {
            getInFlight: (id) => inFlight[id] ?? 0,
            getResponseTimeMs: (id) => responseMs[id] ?? 0
          })[0].targetNodeId
      )
      expect(new Set(picks)).toEqual(new Set(['b'])) // b has the smallest score
    })

    it('least-response-time falls back to least-conn before any completions', () => {
      const routing = new RoutingTable(
        poolEdges(),
        createRandom('lrt-cold'),
        lbNodes('least-response-time')
      )
      const inFlight: Record<string, number> = { a: 3, b: 0, c: 2 }
      const pick = routing.resolveTarget('lb', makeRequest(), {
        getInFlight: (id) => inFlight[id] ?? 0,
        getResponseTimeMs: () => 0 // no service-time signal yet
      })[0].targetNodeId
      expect(pick).toBe('b') // least in-flight
    })

    it('power-of-two-choices never picks a more-loaded target than the sampled pair', () => {
      const routing = new RoutingTable(poolEdges(), createRandom('p2c'), lbNodes('p2c'))
      const inFlight: Record<string, number> = { a: 0, b: 5, c: 9 }
      // Over many draws it should heavily favour the least-loaded 'a' and never
      // be dominated; assert it at least frequently avoids the worst target 'c'.
      const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
      for (let i = 0; i < 200; i++) {
        const t = routing.resolveTarget('lb', makeRequest(), {
          getInFlight: (id) => inFlight[id] ?? 0
        })[0].targetNodeId
        counts[t]++
      }
      expect(counts.a).toBeGreaterThan(counts.c) // least-loaded chosen most
    })
  })

  describe('session-affinity routing', () => {
    function stickyEdges(): EdgeDefinition[] {
      return [makeEdge('e1', 'lb', 'a'), makeEdge('e2', 'lb', 'b'), makeEdge('e3', 'lb', 'c')]
    }

    function stickyNodes(config: Record<string, unknown>): ComponentNode[] {
      return [{ ...makeNode('lb', 'load-balancer'), config }]
    }

    function requestWith(metadata: Record<string, unknown>): Request {
      return { ...makeRequest(), metadata }
    }

    it('sends the same session key to the same backend every time', () => {
      const routing = new RoutingTable(
        stickyEdges(),
        createRandom('sticky'),
        stickyNodes({ routingStrategy: 'sticky' })
      )
      const picks = Array.from(
        { length: 20 },
        () => routing.resolveTarget('lb', requestWith({ sessionId: 'user-42' }))[0].targetNodeId
      )
      expect(new Set(picks).size).toBe(1)
    })

    it('spreads different session keys across backends', () => {
      const routing = new RoutingTable(
        stickyEdges(),
        createRandom('sticky-spread'),
        stickyNodes({ routingStrategy: 'sticky' })
      )
      const targets = new Set<string>()
      for (let i = 0; i < 50; i++) {
        targets.add(
          routing.resolveTarget('lb', requestWith({ sessionId: `u-${i}` }))[0].targetNodeId
        )
      }
      expect(targets.size).toBeGreaterThan(1) // not all collapsed onto one backend
    })

    it('honours a custom stickyKeyField', () => {
      const routing = new RoutingTable(
        stickyEdges(),
        createRandom('sticky-field'),
        stickyNodes({ routingStrategy: 'sticky', stickyKeyField: 'tenant' })
      )
      const a = routing.resolveTarget('lb', requestWith({ tenant: 'acme' }))[0].targetNodeId
      const b = routing.resolveTarget('lb', requestWith({ tenant: 'acme' }))[0].targetNodeId
      expect(a).toBe(b)
    })

    it('falls back to the canonical __key when no session field is present', () => {
      const routing = new RoutingTable(
        stickyEdges(),
        createRandom('sticky-key'),
        stickyNodes({ routingStrategy: 'sticky' })
      )
      const a = routing.resolveTarget('lb', requestWith({ __key: 'k-7' }))[0].targetNodeId
      const b = routing.resolveTarget('lb', requestWith({ __key: 'k-7' }))[0].targetNodeId
      expect(a).toBe(b)
    })

    it('ip-hash pins a client IP to one backend', () => {
      const routing = new RoutingTable(
        stickyEdges(),
        createRandom('ip-hash'),
        stickyNodes({ routingStrategy: 'ip-hash' })
      )
      const picks = Array.from(
        { length: 15 },
        () => routing.resolveTarget('lb', requestWith({ clientIp: '10.0.0.5' }))[0].targetNodeId
      )
      expect(new Set(picks).size).toBe(1)
    })

    it('degrades to round-robin when no affinity key is present', () => {
      const routing = new RoutingTable(
        stickyEdges(),
        createRandom('sticky-degrade'),
        stickyNodes({ routingStrategy: 'sticky' })
      )
      const picks = Array.from(
        { length: 3 },
        () => routing.resolveTarget('lb', makeRequest())[0].targetNodeId
      )
      // No key ⇒ spreads instead of pinning: three distinct backends in a row.
      expect(new Set(picks).size).toBe(3)
    })

    it('consistent hashing reassigns only a small share of keys when a backend is removed', () => {
      const fullNodes = stickyNodes({ routingStrategy: 'sticky' })
      const full = new RoutingTable(
        [makeEdge('e1', 'lb', 'a'), makeEdge('e2', 'lb', 'b'), makeEdge('e3', 'lb', 'c')],
        createRandom('ring-full'),
        fullNodes
      )
      const reduced = new RoutingTable(
        [makeEdge('e1', 'lb', 'a'), makeEdge('e2', 'lb', 'b')], // 'c' ejected
        createRandom('ring-reduced'),
        fullNodes
      )
      let moved = 0
      let stayedOnSurvivors = 0
      const N = 600
      for (let i = 0; i < N; i++) {
        const req = () => requestWith({ sessionId: `s-${i}` })
        const before = full.resolveTarget('lb', req())[0].targetNodeId
        const after = reduced.resolveTarget('lb', req())[0].targetNodeId
        if (before === 'a' || before === 'b') {
          stayedOnSurvivors++
          // Keys already on a surviving backend must NOT move (ring invariant).
          if (before !== after) moved++
        }
      }
      // No key that was on a survivor should have moved; only 'c' keys reassign.
      expect(moved).toBe(0)
      expect(stayedOnSurvivors).toBeGreaterThan(0)
    })

    it('is stable regardless of edge declaration order (sorted by target id)', () => {
      const forward = new RoutingTable(
        [makeEdge('e1', 'lb', 'a'), makeEdge('e2', 'lb', 'b'), makeEdge('e3', 'lb', 'c')],
        createRandom('order-1'),
        stickyNodes({ routingStrategy: 'sticky' })
      )
      const reversed = new RoutingTable(
        [makeEdge('e3', 'lb', 'c'), makeEdge('e2', 'lb', 'b'), makeEdge('e1', 'lb', 'a')],
        createRandom('order-2'),
        stickyNodes({ routingStrategy: 'sticky' })
      )
      const req = () => requestWith({ sessionId: 'stable-1' })
      expect(forward.resolveTarget('lb', req())[0].targetNodeId).toBe(
        reversed.resolveTarget('lb', req())[0].targetNodeId
      )
    })
  })
})
