/**
 * Chapter 07: network nodes and routing (docs/reference/07-network-nodes-and-routing.md).
 * Expected values come from the chapter: round-robin and weighted shares, the load-balancing behaviour of
 * least-loaded and power-of-two choices, consistent-hashing key movement, CDN hit-ratio arithmetic, and the
 * availability product. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { runEngine } from '../support/engine'
import { cdnMeanMs, modHashMoved, originShare, relErr, zipfTopShare } from '../support/oracles'
import { chain, computeNode, passNode, type RunSpec } from '../support/topology'
import { hashString, pickOnHashRing } from '../../src/engine/core/hashRing'
import type { WorkloadProfile } from '../../src/engine/core/types'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const backend = (id: string, serviceMs: number) => computeNode(id, { serviceMs, timeoutMs: 5000 })

/** One load balancer in front of n backends. `weights` become edge weights. */
function balanced(
  seed: string,
  strategy: string,
  serviceMs: number[],
  r: Partial<RunSpec> = {},
  extra: {
    weights?: number[]
    lbConfig?: Record<string, unknown>
    sessions?: number
    keyspace?: object
    /** Replaces the request mix, e.g. to stamp a clientIp. */
    distribution?: Record<string, unknown>[]
  } = {}
) {
  const ids = serviceMs.map((_, i) => `b${i}`)
  const lbEdges = ids.map(
    (id, i) =>
      (extra.weights ? ['lb', id, { weight: extra.weights[i] }] : ['lb', id]) as
        | [string, string]
        | [string, string, Record<string, unknown>]
  )
  const distribution =
    extra.distribution ??
    (extra.keyspace
      ? [{ type: 'GET', weight: 1, sizeBytes: 100, keyspace: extra.keyspace }]
      : undefined)
  const t = chain({
    run: run(seed, r),
    nodes: [
      passNode('lb', 'load-balancer', { routingStrategy: strategy, ...extra.lbConfig }),
      ...ids.map((id, i) => backend(id, serviceMs[i]))
    ],
    edges: [['source', 'lb'], ...lbEdges],
    ...(distribution ? { requestDistribution: distribution } : {})
  })
  if (extra.sessions)
    t.workload = { ...t.workload!, sessions: { count: extra.sessions } } as WorkloadProfile
  const out = runEngine(t)
  const arrivals = ids.map((id) => out.perNode[id].totalArrived)
  return { out, ids, arrivals, total: arrivals.reduce((a, b) => a + b, 0) }
}

test.describe('who gets how many requests (ch07 section 3)', () => {
  test('N-01 round robin gives every server an equal share of even arrivals (differing by at most one request)', () => {
    const { arrivals } = balanced('n01', 'round-robin', [10, 10, 10, 10])
    expect(Math.max(...arrivals) - Math.min(...arrivals)).toBeLessThanOrEqual(1)
  })

  test('N-02 weighted 3:1:1 sends 60%, 20%, 20%', () => {
    const { arrivals, total } = balanced(
      'n02',
      'weighted',
      [10, 10, 10],
      {},
      { weights: [3, 1, 1] }
    )
    const shares = arrivals.map((a) => a / total)
    expect(Math.abs(shares[0] - 0.6)).toBeLessThan(0.01)
    expect(Math.abs(shares[1] - 0.2)).toBeLessThan(0.01)
    expect(Math.abs(shares[2] - 0.2)).toBeLessThan(0.01)
  })

  test('N-03 random sends each server about 1/n, within 3 standard errors', () => {
    const { arrivals, total } = balanced('n03', 'random', [10, 10, 10, 10], { durationMs: 120_000 })
    const p = 0.25
    for (const a of arrivals)
      expect(Math.abs(a / total - p)).toBeLessThan(3 * Math.sqrt((p * (1 - p)) / total))
  })
})

test.describe('N-04 least-loaded beats random on uneven servers; two samples capture most of the gain (ch07 section 3.1)', () => {
  // One server is twice as slow (20 ms against 10 ms). 260 req/s into four servers is 65 per server on average.
  const heterogeneous = (strategy: string) =>
    balanced(`n04-${strategy}`, strategy, [20, 10, 10, 10], {
      rps: 260,
      pattern: 'poisson',
      durationMs: 60_000
    })
  const results = {
    'round-robin': heterogeneous('round-robin'),
    random: heterogeneous('random'),
    'least-conn': heterogeneous('least-conn'),
    p2c: heterogeneous('p2c')
  }
  const p99 = (k: keyof typeof results) => results[k].out.summary.latency.p99
  const worstQueue = (k: keyof typeof results) =>
    Math.max(...results[k].ids.map((id) => results[k].out.perNode[id].peakQueueLength))

  test('random leaves the worst tail; two choices and least-connections are far better', () => {
    expect(p99('random')).toBeGreaterThan(1.5 * p99('p2c'))
    expect(p99('random')).toBeGreaterThan(1.5 * p99('least-conn'))
    expect(worstQueue('random')).toBeGreaterThan(worstQueue('p2c'))
  })

  test('two samples are close to full knowledge', () => {
    expect(p99('p2c')).toBeLessThan(1.4 * p99('least-conn'))
  })

  test('least-loaded policies send the slow server fewer requests; round robin ignores speed', () => {
    const slowShare = (k: keyof typeof results) => results[k].arrivals[0] / (results[k].total / 4)
    expect(slowShare('round-robin')).toBeCloseTo(1, 1)
    expect(slowShare('least-conn')).toBeLessThan(0.8)
    expect(slowShare('p2c')).toBeLessThan(0.85)
  })
})

test.describe('affinity: the same client reaches the same server (ch07 section 3)', () => {
  // `sticky` pins by session id (or the canonical key); `ip-hash` pins by `clientIp` only. Same chapter idea, different key.
  const spread = (r: ReturnType<typeof balanced>) => {
    for (const a of r.arrivals) {
      expect(a / r.total).toBeGreaterThan(0.12)
      expect(a / r.total).toBeLessThan(0.4)
    }
  }

  test('N-05a sticky: one session goes to one server; many sessions spread over all servers', () => {
    const one = balanced('n05-sticky-1', 'sticky', [10, 10, 10, 10], {}, { sessions: 1 })
    expect(Math.max(...one.arrivals)).toBe(one.total)
    spread(
      balanced(
        'n05-sticky-n',
        'sticky',
        [10, 10, 10, 10],
        { durationMs: 60_000 },
        { sessions: 1000 }
      )
    )
  })

  test('N-05b ip-hash: one client address goes to one server; many addresses spread over all servers', () => {
    const one = balanced(
      'n05-ip-1',
      'ip-hash',
      [10, 10, 10, 10],
      {},
      {
        distribution: [
          { type: 'GET', weight: 1, sizeBytes: 100, metadata: { clientIp: '10.0.0.1' } }
        ]
      }
    )
    expect(Math.max(...one.arrivals)).toBe(one.total)
    spread(
      balanced(
        'n05-ip-n',
        'ip-hash',
        [10, 10, 10, 10],
        { durationMs: 60_000 },
        { keyspace: { field: 'clientIp', size: 1000, skew: 0 } }
      )
    )
  })

  test('N-05c ip-hash ignores the session id: sessions alone do not pin a client', () => {
    const r = balanced('n05-ip-sess', 'ip-hash', [10, 10, 10, 10], {}, { sessions: 1 })
    expect(Math.max(...r.arrivals)).toBeLessThan(r.total)
  })
})

test.describe('N-06 consistent hashing moves about 1 / (N + 1) of the keys; hash mod n moves about N / (N + 1) (ch07 section 3.2)', () => {
  const keys = Array.from({ length: 50_000 }, (_, i) => `key-${i}`)
  const pool = (n: number) => Array.from({ length: n }, (_, i) => ({ targetNodeId: `s${i}` }))
  const owner = (n: number, k: string) => pickOnHashRing(pool(n), k).targetNodeId

  for (const n of [4, 9, 19]) {
    test(`growing ${n} -> ${n + 1} servers`, () => {
      const moved = keys.filter((k) => owner(n, k) !== owner(n + 1, k)).length / keys.length
      expect(Math.abs(moved - 1 / (n + 1))).toBeLessThan(0.04)
      const modMoved =
        keys.filter((k) => hashString(k) % n !== hashString(k) % (n + 1)).length / keys.length
      expect(Math.abs(modMoved - modHashMoved(n))).toBeLessThan(0.02)
      // The two are in the ratio N : 1, so consistent hashing moves N times fewer keys (allow vnode noise).
      expect(modMoved / moved).toBeGreaterThan(0.7 * n)
    })
  }

  test('removing a server moves only the keys it owned; every other key stays put', () => {
    const before = new Map(keys.map((k) => [k, owner(10, k)]))
    const gone = 's3'
    const survivors = pool(10).filter((p) => p.targetNodeId !== gone)
    for (const k of keys) {
      const was = before.get(k)!
      if (was !== gone) expect(pickOnHashRing(survivors, k).targetNodeId).toBe(was)
    }
  })

  test('virtual nodes even out the load: with 9 servers each holds 11% give or take a third', () => {
    const counts = new Map<string, number>()
    for (const k of keys) counts.set(owner(9, k), (counts.get(owner(9, k)) ?? 0) + 1)
    for (const c of counts.values()) expect(Math.abs(c / keys.length - 1 / 9)).toBeLessThan(0.04)
  })
})

test('N-07 hot keys: key-hash routing cannot balance a Zipf workload; the hottest server carries at least the hottest key (ch07 section 3.3, ch05 section 4)', () => {
  const keyspace = { field: 'k', size: 1000, skew: 1.0 }
  const hot = balanced(
    'n07-hot',
    'sticky',
    Array(20).fill(5),
    { rps: 200, pattern: 'poisson', durationMs: 60_000 },
    { lbConfig: { stickyKeyField: 'k' }, keyspace }
  )
  const hottest = Math.max(...hot.arrivals) / hot.total
  // One key alone is 13.4% of traffic, against an even share of 5% for 20 servers.
  expect(hottest).toBeGreaterThanOrEqual(zipfTopShare(1000, 1, 1) - 0.01)
  const uniform = balanced(
    'n07-uniform',
    'sticky',
    Array(20).fill(5),
    { rps: 200, pattern: 'poisson', durationMs: 60_000 },
    { lbConfig: { stickyKeyField: 'k' }, keyspace: { ...keyspace, skew: 0 } }
  )
  expect(Math.max(...uniform.arrivals) / uniform.total).toBeLessThan(0.09)
})

test('N-08 layer 7 costs more per request than layer 4 at default settings (ch07 section 2)', () => {
  // No queue, instance or service time authored: each node gets its type's default profile.
  const through = (type: string) => {
    const t = chain({
      run: run(`n08-${type}`, { rps: 20, durationMs: 20_000 }),
      nodes: [
        { id: 'lb', type, category: 'network', label: 'lb', position: { x: 150, y: 0 } },
        computeNode('srv', { serviceMs: 5 })
      ]
    })
    return runEngine(t).perNode.lb.avgServiceTime
  }
  const l4 = through('load-balancer-l4')
  const l7 = through('load-balancer-l7')
  // Defaults are 0.15 ms and 0.4 ms on the same instance, a ratio of 2.67.
  expect(l7).toBeGreaterThan(l4)
  expect(l7 / l4).toBeGreaterThan(2)
  expect(l7 / l4).toBeLessThan(3.4)
})

test.describe('CDN: origin load = (1 - hit ratio) x traffic; mean latency = hit x edge + miss x (edge + origin) (ch07 section 6)', () => {
  const cdn = (seed: string, h: number, extraTier?: number) => {
    const edgeNode = (id: string, hit: number) => ({
      ...passNode(id, 'cdn', { cacheHitRate: hit, cacheHitLatencyMs: 10 }),
      processing: { distribution: { type: 'constant', value: 10 }, timeout: 5000 }
    })
    const origin = {
      ...computeNode('origin', { serviceMs: 120 }),
      resources: { instanceType: 'm5.4xlarge', instanceCount: 1, workloadKind: 'io-bound' }
    }
    const nodes =
      extraTier === undefined
        ? [edgeNode('edge', h), origin]
        : [edgeNode('edge', h), edgeNode('shield', extraTier), origin]
    return runEngine(
      chain({ run: run(seed, { rps: 200, pattern: 'poisson', durationMs: 100_000 }), nodes })
    )
  }

  for (const h of [0.5, 0.95]) {
    test(`N-09 hit ratio ${h}: the origin sees ${((1 - h) * 100).toFixed(0)}% of traffic and the mean is ${cdnMeanMs(h, 10, 120).toFixed(1)} ms`, () => {
      const out = cdn(`n09-${h}`, h)
      const share = out.perNode.origin.totalArrived / out.perNode.edge.totalArrived
      const n = out.perNode.edge.totalArrived
      expect(Math.abs(share - originShare(h))).toBeLessThan(3 * Math.sqrt((h * (1 - h)) / n))
      expect(relErr(out.summary.latency.mean, cdnMeanMs(h, 10, 120))).toBeLessThan(0.04)
    })
  }

  test('N-10 a shield behind the edge: origin share = (1 - h_edge) x (1 - h_shield) = 0.2 x 0.25 = 5%', () => {
    const out = cdn('n10', 0.8, 0.75)
    const share = out.perNode.origin.totalArrived / out.perNode.edge.totalArrived
    expect(originShare(0.8, 0.75)).toBeCloseTo(0.05, 9)
    expect(Math.abs(share - 0.05)).toBeLessThan(0.006)
  })

  test('N-11 a drop in hit ratio from 99% to 95% quintuples origin load', () => {
    expect(originShare(0.95) / originShare(0.99)).toBeCloseTo(5, 9)
  })
})

test.describe('availability of a path is the product of its hops (ch07 section 5)', () => {
  test('N-12 three hops at 1% failure give 1 - 0.99^3 = 2.97% failures', () => {
    const out = runEngine(
      chain({
        run: run('n12', { rps: 50, durationMs: 200_000 }),
        nodes: ['a', 'b', 'c'].map((id) =>
          computeNode(id, { serviceMs: 1, config: { nodeErrorRate: 0.01 } })
        )
      })
    )
    const n = out.summary.totalRequests
    expect(Math.abs(out.summary.errorRate - (1 - 0.99 ** 3))).toBeLessThan(
      3 * Math.sqrt((0.03 * 0.97) / n)
    )
  })

  test('N-13 a single load balancer is a single point of failure: when it fails every request after the fault fails', () => {
    const T = 30_000
    const TF = 10_000
    const out = runEngine(
      chain({
        run: run('n13', { durationMs: T }),
        nodes: [passNode('lb', 'load-balancer'), backend('b0', 10), backend('b1', 10)],
        edges: [
          ['source', 'lb'],
          ['lb', 'b0'],
          ['lb', 'b1']
        ],
        faults: [
          {
            targetId: 'lb',
            faultType: 'node-failure',
            timing: 'deterministic',
            duration: 'permanent',
            params: { atMs: TF, mode: 'reject' }
          }
        ]
      })
    )
    expect(Math.abs(out.summary.errorRate - (T - TF) / T)).toBeLessThan(0.02)
  })
})

test.describe('health checks and overload (ch07 section 4, ch02 section 7)', () => {
  const fleet = (seed: string, rps: number, healthCheckEnabled: boolean) => {
    // Two servers of 100 req/s each (200 total) with short queues; health ejection on or off.
    const mem = 8192 / 12.5
    const node = (id: string) => ({
      ...computeNode(id, { serviceMs: 20, timeoutMs: 5000 }),
      resources: {
        instanceType: 'm5.large',
        instanceCount: 1,
        workloadKind: 'cpu-bound',
        perRequestMemMb: mem
      }
    })
    return runEngine(
      chain({
        run: run(seed, { rps, durationMs: 30_000, warmupMs: 10_000 }),
        nodes: [passNode('lb', 'load-balancer', { healthCheckEnabled }), node('s0'), node('s1')],
        edges: [
          ['source', 'lb'],
          ['lb', 's0'],
          ['lb', 's1']
        ]
      })
    )
  }

  test('N-14 with health ejection off, an overloaded fleet still serves at its capacity (200 req/s)', () => {
    expect(relErr(fleet('n14', 600, false).summary.throughput, 200)).toBeLessThan(0.05)
  })

  test('N-15 when every server has failed the balancer rejects with no_healthy_targets (current behaviour; ch07 section 4 asks for an explicit choice)', () => {
    const out = runEngine(
      chain({
        run: run('n15', { durationMs: 20_000 }),
        nodes: [passNode('lb', 'load-balancer'), backend('b0', 10), backend('b1', 10)],
        edges: [
          ['source', 'lb'],
          ['lb', 'b0'],
          ['lb', 'b1']
        ],
        faults: ['b0', 'b1'].map((id) => ({
          targetId: id,
          faultType: 'node-failure',
          timing: 'deterministic',
          duration: 'permanent',
          params: { atMs: 5000, mode: 'reject' }
        }))
      })
    )
    expect(out.perNode.lb.rejectionsByReason['no_healthy_targets']).toBeGreaterThan(0)
    expect(out.summary.errorRate).toBeGreaterThan(0.7)
  })

  // Tracked gap. With health ejection on, a 10% overload (220 req/s against 200) makes a few rejections at each
  // server, a server is ejected for a window after one failure, and soon both are out: goodput falls to about
  // 33 req/s, 15% of capacity, with 85% of requests rejected as no_healthy_targets. Real balancers soften this
  // (Envoy's panic threshold serves anyway when too many hosts are ejected). `test.fail` passes while it is true and
  // fails once ejection stops amplifying a mild overload, which is the cue to remove the annotation.
  test.fail(
    'N-16 a mildly overloaded fleet should keep serving near capacity, not be ejected into an outage',
    () => {
      expect(fleet('n16', 220, true).summary.throughput).toBeGreaterThan(0.8 * 200)
    }
  )
})
