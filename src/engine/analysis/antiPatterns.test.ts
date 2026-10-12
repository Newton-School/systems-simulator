import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ComponentCategory,
  ComponentNode,
  ComponentType,
  EdgeDefinition,
  TopologyJSON
} from '../core/types'
import {
  detectAntiPatterns,
  distributionMedian,
  type AntiPatternRuleId,
  type AntiPatternWarning
} from './antiPatterns'

type NodeOpts = Partial<Omit<ComponentNode, 'id' | 'type' | 'category'>> & {
  instances?: number
  serviceMs?: number
}

function node(
  id: string,
  type: ComponentType,
  category: ComponentCategory,
  opts: NodeOpts = {}
): ComponentNode {
  const { instances = 2, serviceMs = 2, ...rest } = opts
  return {
    id,
    type,
    category,
    label: id,
    position: { x: 0, y: 0 },
    resources: { instanceCount: instances },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 30_000 },
    ...rest
  }
}

const client = (): ComponentNode =>
  node('client', 'api-endpoint', 'compute', { role: 'source', instances: 1 })
const lb = (id = 'lb'): ComponentNode => node(id, 'load-balancer', 'network-and-edge')
const svc = (id: string, opts: NodeOpts = {}): ComponentNode =>
  node(id, 'microservice', 'compute', opts)
const db = (id = 'db', opts: NodeOpts = {}): ComponentNode =>
  node(id, 'relational-db', 'storage-and-data', opts)

function edge(
  source: string,
  target: string,
  mode: EdgeDefinition['mode'] = 'synchronous'
): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode,
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(nodes: ComponentNode[], edges: EdgeDefinition[]): TopologyJSON {
  return {
    id: 't',
    name: 'T',
    version: '2.0.0',
    global: {
      simulationDuration: 1000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1000
    },
    nodes,
    edges,
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 10,
      requestDistribution: [{ type: 'read', weight: 1, sizeBytes: 128 }]
    }
  }
}

const rules = (t: TopologyJSON): AntiPatternRuleId[] => detectAntiPatterns(t).map((w) => w.rule)
const byRule = (t: TopologyJSON, rule: AntiPatternRuleId): AntiPatternWarning[] =>
  detectAntiPatterns(t).filter((w) => w.rule === rule)

/** client -> lb -> svc (2 instances each) -> db (2 instances): redundant and clean. */
function wellArchitected(): TopologyJSON {
  return topology(
    [client(), lb(), svc('api'), db()],
    [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'db')]
  )
}

describe('detectAntiPatterns', () => {
  it('returns an empty array for a well-architected topology', () => {
    expect(detectAntiPatterns(wellArchitected())).toEqual([])
  })

  it('every warning carries a title, message, recommendation and the involved node ids', () => {
    const t = topology(
      [client(), svc('api', { instances: 1 }), db('db', { instances: 1 })],
      [edge('client', 'api'), edge('api', 'db')]
    )
    const warnings = detectAntiPatterns(t)
    expect(warnings.length).toBeGreaterThan(0)
    for (const w of warnings) {
      expect(w.id).toContain(w.rule)
      expect(w.title.length).toBeGreaterThan(0)
      expect(w.message.length).toBeGreaterThan(0)
      expect(w.recommendation.length).toBeGreaterThan(0)
      expect(w.nodeIds.length).toBeGreaterThan(0)
      expect(w.message).not.toMatch(/—/)
      expect(w.recommendation).not.toMatch(/—/)
    }
  })

  describe('single-point-of-failure', () => {
    it('fires (reusing the SPOF detector) for single-instance critical components', () => {
      const t = topology(
        [client(), lb('lb'), svc('api'), db('db', { instances: 1 })],
        [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'db')]
      )
      const [w] = byRule(t, 'single-point-of-failure')
      expect(w.nodeIds).toEqual(['db'])
      expect(w.severity).toBe('warning')
    })

    it('aggregates several SPOFs into one warning, worst first', () => {
      const t = topology(
        [client(), lb('lb'), svc('api', { instances: 1 }), db('db', { instances: 1 })],
        [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'db')]
      )
      const warnings = byRule(t, 'single-point-of-failure')
      expect(warnings).toHaveLength(1)
      expect(warnings[0].nodeIds).toEqual(['api', 'db'])
      expect(warnings[0].message).toContain('only path to db')
    })

    it('is critical when a SPOF has more than 3 direct upstream dependents', () => {
      const services = ['a', 'b', 'c', 'd'].map((id) => svc(id))
      const t = topology(
        [client(), lb(), ...services, db('db', { instances: 1 })],
        [
          edge('client', 'lb'),
          ...services.map((s) => edge('lb', s.id)),
          ...services.map((s) => edge(s.id, 'db'))
        ]
      )
      const [w] = byRule(t, 'single-point-of-failure')
      expect(w.severity).toBe('critical')
      expect(w.nodeIds).toEqual(['db'])
    })

    it('does not fire when every component runs 2+ instances', () => {
      expect(rules(wellArchitected())).not.toContain('single-point-of-failure')
    })
  })

  describe('sync-call-to-slow-dependency', () => {
    it('fires for a synchronous request-path call to a 10-second operation', () => {
      const t = topology(
        [client(), lb(), svc('api'), svc('report', { serviceMs: 10_000 })],
        [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'report')]
      )
      const [w] = byRule(t, 'sync-call-to-slow-dependency')
      expect(w.severity).toBe('critical')
      expect(w.nodeIds).toEqual(['report', 'api'])
      expect(w.edgeIds).toEqual(['api->report'])
      expect(w.message).toContain('10s')
    })

    it('counts an external provider latency penalty toward the typical time', () => {
      const gateway = node('pay', 'payment-gateway', 'external-and-integration', {
        serviceMs: 100,
        config: { externalLatencyMs: 6000 }
      })
      const t = topology(
        [client(), lb(), svc('api'), gateway],
        [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'pay')]
      )
      expect(byRule(t, 'sync-call-to-slow-dependency')).toHaveLength(1)
    })

    it('does not fire when the slow call happens behind an async hop (queue + worker)', () => {
      const t = topology(
        [
          client(),
          lb(),
          svc('api'),
          node('q', 'queue', 'messaging-and-streaming'),
          node('worker', 'batch-worker', 'compute'),
          svc('report', { serviceMs: 10_000 })
        ],
        [
          edge('client', 'lb'),
          edge('lb', 'api'),
          edge('api', 'q'),
          edge('q', 'worker', 'asynchronous'),
          edge('worker', 'report')
        ]
      )
      expect(rules(t)).not.toContain('sync-call-to-slow-dependency')
    })

    it('does not fire for an asynchronous edge or a fast dependency', () => {
      const t = topology(
        [client(), lb(), svc('api'), svc('report', { serviceMs: 10_000 }), svc('fast')],
        [
          edge('client', 'lb'),
          edge('lb', 'api'),
          edge('api', 'report', 'asynchronous'),
          edge('api', 'fast')
        ]
      )
      expect(rules(t)).not.toContain('sync-call-to-slow-dependency')
    })

    it('does not guess a median for distributions without a closed form', () => {
      const t = topology(
        [
          client(),
          lb(),
          svc('api'),
          svc('report', {
            processing: { distribution: { type: 'gamma', shape: 2, scale: 10_000 }, timeout: 1 }
          })
        ],
        [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'report')]
      )
      expect(rules(t)).not.toContain('sync-call-to-slow-dependency')
    })
  })

  describe('shared-database', () => {
    const fourServices = (): TopologyJSON => {
      const services = ['orders', 'users', 'billing', 'search'].map((id) => svc(id))
      return topology(
        [client(), lb(), ...services, db()],
        [
          edge('client', 'lb'),
          ...services.map((s) => edge('lb', s.id)),
          ...services.map((s) => edge(s.id, 'db'))
        ]
      )
    }

    it('fires when 4 services connect to one database', () => {
      const [w] = byRule(fourServices(), 'shared-database')
      expect(w.severity).toBe('warning')
      expect(w.nodeIds[0]).toBe('db')
      expect(w.nodeIds.slice(1)).toEqual(['billing', 'orders', 'search', 'users'])
      expect(w.edgeIds).toHaveLength(4)
    })

    it('does not fire for 3 services, and counts a service once even with several edges', () => {
      const services = ['orders', 'users', 'billing'].map((id) => svc(id))
      const t = topology(
        [client(), lb(), ...services, db()],
        [
          edge('client', 'lb'),
          ...services.map((s) => edge('lb', s.id)),
          ...services.map((s) => edge(s.id, 'db')),
          { ...edge('orders', 'db'), id: 'orders->db#2' }
        ]
      )
      expect(rules(t)).not.toContain('shared-database')
    })

    it('does not count caches or routers in front of the database as services', () => {
      const t = topology(
        [
          client(),
          lb(),
          svc('a'),
          svc('b'),
          svc('c'),
          node('cache', 'in-memory-cache', 'storage-and-data'),
          db()
        ],
        [
          edge('client', 'lb'),
          edge('lb', 'a'),
          edge('lb', 'b'),
          edge('lb', 'c'),
          edge('a', 'db'),
          edge('b', 'db'),
          edge('c', 'db'),
          edge('a', 'cache', 'conditional'),
          edge('cache', 'db')
        ]
      )
      expect(rules(t)).not.toContain('shared-database')
    })
  })

  describe('missing-load-balancer', () => {
    it('fires when a caller spreads traffic over replica services with no load balancer', () => {
      const t = topology(
        [client(), svc('api-1'), svc('api-2'), db()],
        [edge('client', 'api-1'), edge('client', 'api-2'), edge('api-1', 'db'), edge('api-2', 'db')]
      )
      const [w] = byRule(t, 'missing-load-balancer')
      expect(w.nodeIds).toEqual(['client', 'api-1', 'api-2'])
      expect(w.edgeIds).toEqual(['client->api-1', 'client->api-2'])
    })

    it('does not fire behind a load balancer', () => {
      const t = topology(
        [client(), lb(), svc('api-1'), svc('api-2'), db()],
        [
          edge('client', 'lb'),
          edge('lb', 'api-1'),
          edge('lb', 'api-2'),
          edge('api-1', 'db'),
          edge('api-2', 'db')
        ]
      )
      expect(rules(t)).not.toContain('missing-load-balancer')
    })

    it('does not fire for a single node scaled to several instances', () => {
      expect(rules(wellArchitected())).not.toContain('missing-load-balancer')
    })

    it('does not fire for calls to different kinds of services, storage peers, or async fan-out', () => {
      const t = topology(
        [
          client(),
          lb(),
          svc('api'),
          node('auth', 'auth-service', 'security'),
          node('worker', 'batch-worker', 'compute'),
          node('res-a', 'reservation-store', 'auxiliary'),
          node('res-b', 'reservation-store', 'auxiliary'),
          svc('notify-1'),
          svc('notify-2')
        ],
        [
          edge('client', 'lb'),
          edge('lb', 'api'),
          edge('api', 'auth'),
          edge('api', 'worker'),
          edge('api', 'res-a'),
          edge('api', 'res-b'),
          edge('api', 'notify-1', 'asynchronous'),
          edge('api', 'notify-2', 'asynchronous')
        ]
      )
      expect(rules(t)).not.toContain('missing-load-balancer')
    })
  })

  describe('cache-in-front-of-load-balancer', () => {
    it('fires when an application cache forwards to the load balancer', () => {
      const t = topology(
        [client(), node('cache', 'in-memory-cache', 'storage-and-data'), lb(), svc('api'), db()],
        [edge('client', 'cache'), edge('cache', 'lb'), edge('lb', 'api'), edge('api', 'db')]
      )
      const [w] = byRule(t, 'cache-in-front-of-load-balancer')
      expect(w.nodeIds).toEqual(['cache', 'lb'])
      expect(w.edgeIds).toEqual(['cache->lb'])
    })

    it('does not fire for a CDN at the edge or a cache-aside cache behind the service', () => {
      const t = topology(
        [
          client(),
          node('cdn', 'cdn', 'network-and-edge'),
          lb(),
          svc('api'),
          node('cache', 'in-memory-cache', 'storage-and-data'),
          db()
        ],
        [
          edge('client', 'cdn'),
          edge('cdn', 'lb'),
          edge('lb', 'api'),
          edge('api', 'cache', 'conditional'),
          edge('api', 'db', 'conditional'),
          edge('cache', 'db')
        ]
      )
      expect(rules(t)).not.toContain('cache-in-front-of-load-balancer')
    })
  })

  describe('queue-without-consumer', () => {
    it('fires when producers publish to a broker that nothing consumes', () => {
      const t = topology(
        [client(), lb(), svc('api'), node('broker', 'message-broker', 'messaging-and-streaming')],
        [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'broker')]
      )
      const [w] = byRule(t, 'queue-without-consumer')
      expect(w.nodeIds).toEqual(['broker'])
      expect(w.edgeIds).toEqual(['api->broker'])
    })

    it('does not fire when the queue has a consumer, or when nothing produces to it', () => {
      const consumed = topology(
        [
          client(),
          lb(),
          svc('api'),
          node('q', 'queue', 'messaging-and-streaming'),
          node('worker', 'batch-worker', 'compute')
        ],
        [
          edge('client', 'lb'),
          edge('lb', 'api'),
          edge('api', 'q'),
          edge('q', 'worker', 'asynchronous')
        ]
      )
      expect(rules(consumed)).not.toContain('queue-without-consumer')

      const unwired = topology(
        [...wellArchitected().nodes, node('q', 'queue', 'messaging-and-streaming')],
        wellArchitected().edges
      )
      expect(rules(unwired)).not.toContain('queue-without-consumer')
    })
  })

  describe('excessive-retries', () => {
    const withRetries = (maxAttempts: number, type: ComponentType = 'microservice'): TopologyJSON =>
      topology(
        [
          client(),
          lb(),
          node('api', type, 'compute', {
            resilience: {
              retry: { maxAttempts, baseDelay: 100, maxDelay: 5000, multiplier: 2, jitter: true }
            }
          }),
          db()
        ],
        [edge('client', 'lb'), edge('lb', 'api'), edge('api', 'db')]
      )

    it('fires above 10 attempts', () => {
      const [w] = byRule(withRetries(25), 'excessive-retries')
      expect(w.nodeIds).toEqual(['api'])
      expect(w.message).toContain('25')
    })

    it('does not fire at 10 attempts or on a node type that never retries', () => {
      expect(rules(withRetries(10))).not.toContain('excessive-retries')
      expect(rules(withRetries(25, 'api-gateway'))).not.toContain('excessive-retries')
    })
  })

  it('orders critical warnings before plain warnings', () => {
    const t = topology(
      [
        client(),
        svc('api-1'),
        svc('api-2'),
        svc('report', { serviceMs: 10_000 }),
        node('broker', 'message-broker', 'messaging-and-streaming')
      ],
      [
        edge('client', 'api-1'),
        edge('client', 'api-2'),
        edge('api-1', 'report'),
        edge('api-2', 'broker')
      ]
    )
    const warnings = detectAntiPatterns(t)
    expect(warnings[0].severity).toBe('critical')
    expect(warnings.map((w) => w.rule)).toEqual([
      'sync-call-to-slow-dependency',
      'missing-load-balancer',
      'queue-without-consumer'
    ])
  })
})

describe('distributionMedian', () => {
  it('uses closed-form medians and declines when there is none', () => {
    expect(distributionMedian({ type: 'constant', value: 7 })).toBe(7)
    expect(distributionMedian({ type: 'uniform', min: 2, max: 4 })).toBe(3)
    expect(distributionMedian({ type: 'log-normal', mu: Math.log(50), sigma: 1 })).toBeCloseTo(50)
    expect(distributionMedian({ type: 'exponential', lambda: 1 })).toBeCloseTo(Math.LN2)
    expect(
      distributionMedian({ type: 'empirical', samples: [5, 1, 3, 9], interpolation: 'step' })
    ).toBe(4)
    expect(distributionMedian({ type: 'gamma', shape: 2, scale: 3 })).toBeNull()
    expect(distributionMedian(undefined)).toBeNull()
  })
})

describe('question bank sanity check', () => {
  const root = join(__dirname, '../../../ns-simulator-docs/examples/question-bank')
  const available = existsSync(root)

  it.skipIf(!available)('reference topologies raise at most the single-instance SPOF note', () => {
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, 'reference-topology.json')
      if (!existsSync(file)) continue
      const warnings = detectAntiPatterns(JSON.parse(readFileSync(file, 'utf8')) as TopologyJSON)
      expect(
        warnings.filter((w) => w.rule !== 'single-point-of-failure'),
        dir
      ).toEqual([])
      expect(
        warnings.every((w) => w.severity === 'warning'),
        dir
      ).toBe(true)
    }
  })

  it.skipIf(!available)('flags the broker with no consumers in the gamed messaging fan-out', () => {
    const file = join(root, 'messaging-fanout', 'gamed-topology.json')
    const warnings = detectAntiPatterns(JSON.parse(readFileSync(file, 'utf8')) as TopologyJSON)
    expect(warnings.find((w) => w.rule === 'queue-without-consumer')?.nodeIds).toEqual(['broker'])
  })
})
