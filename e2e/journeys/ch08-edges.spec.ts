/**
 * Chapter 08: edges, protocols and network physics (docs/reference/08-edges-protocols-and-network-physics.md).
 * Expected values come from the chapter: transmission = size / bandwidth, round trips to set up a connection,
 * per-protocol overhead, the connection-pool throughput cap, loss and error probabilities, batching arithmetic.
 * Never from engine output. Edge physics only apply in the network environment, so the browser flows switch to it.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait, useNetworkEdges } from '../support/app'
import { runEngine } from '../support/engine'
import {
  bdpBytes,
  batchMeanWaitMs,
  connectionsNeeded,
  mathisBps,
  relErr,
  requestHitByLoss,
  roundTripsToFirstByte,
  transmissionMs
} from '../support/oracles'
import { chain, computeNode, type RunSpec } from '../support/topology'
import { getPathTypeLatencyProfile } from '../../src/engine/defaults/edgeDefaults'
import type { WorkloadProfile } from '../../src/engine/core/types'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 20,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

/** Completions per second over the 1 s termination windows between `fromSec` and `toSec` (a steady-state rate that
 *  is not skewed by requests still queued at the end of the run). */
function steadyRate(out: ReturnType<typeof runEngine>, fromSec: number, toSec: number): number {
  const windows = out.summary.latencyWindows.filter(
    (w) => w.windowStartMs >= fromSec * 1000 && w.windowEndMs <= toSec * 1000
  )
  return windows.reduce((a, w) => a + w.successCount, 0) / windows.length
}

const constantLatency = (ms: number) => ({
  distribution: { type: 'constant', value: ms },
  pathType: 'same-dc'
})

/** source -> srv over one edge with the given fields. */
function oneHop(
  seed: string,
  edge: Record<string, unknown>,
  over: Partial<RunSpec> = {},
  serviceMs = 1
) {
  return chain({
    run: run(seed, over),
    nodes: [computeNode('srv', { serviceMs, instanceType: 'm5.xlarge' })],
    edges: [['source', 'srv', edge]]
  })
}

/** The same chain with every request from one client, so connection reuse and resumption can apply. */
function oneClient(t: ReturnType<typeof oneHop>) {
  t.workload = { ...t.workload!, sessions: { count: 1 } } as WorkloadProfile
  return t
}

test.describe('E-01 each protocol adds its fixed overhead per request (ch08 section 11)', () => {
  const overheadMs = { https: 0.5, grpc: 0.2, tcp: 0, udp: 0, websocket: 0.1, amqp: 1, kafka: 2 }
  for (const [protocol, overhead] of Object.entries(overheadMs)) {
    test(`${protocol}: +${overhead} ms`, () => {
      const out = runEngine(oneHop(`e01-${protocol}`, { protocol }))
      // Service time 1 ms and a 100-byte payload on a 1,000 Mbps link (0.0008 ms of transmission).
      expect(Math.abs(out.summary.latency.mean - (1 + overhead))).toBeLessThan(0.02)
    })
  }
})

test('E-02 one hop costs edge latency + service time + protocol overhead (ch08 section 1)', () => {
  for (const latency of [5, 50]) {
    const out = runEngine(
      oneHop(`e02-${latency}`, { protocol: 'https', latency: constantLatency(latency) })
    )
    expect(Math.abs(out.summary.latency.mean - (latency + 1 + 0.5))).toBeLessThan(0.05)
  }
})

test.describe('E-03 transmission time = size / bandwidth (ch08 section 3)', () => {
  const cases: [string, number, number][] = [
    ['1 MB over 100 Mbps', 1_000_000, 100],
    ['1 MB over 1,000 Mbps', 1_000_000, 1000],
    ['100 KB over 10 Mbps', 100_000, 10],
    ['1 KB over 1 Mbps', 1000, 1]
  ]
  for (const [name, bytes, mbps] of cases) {
    test(name, () => {
      // 2 req/s keeps the link far below saturation (80 ms x 2 per second = 16% busy), so only transmission is measured.
      const t = oneHop(`e03-${bytes}-${mbps}`, { protocol: 'grpc', bandwidth: mbps }, { rps: 2 })
      t.workload = {
        ...t.workload!,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: bytes }]
      } as WorkloadProfile
      const out = runEngine(t)
      const added = out.summary.latency.mean - (1 + 0.2)
      expect(Math.abs(added - transmissionMs(bytes, mbps))).toBeLessThan(
        0.02 * transmissionMs(bytes, mbps) + 0.02
      )
    })
  }

  test('1 Gbps moves 1 KB in 8 us (the reference list says 10 us)', () => {
    expect(transmissionMs(1000, 1000) * 1000).toBeCloseTo(8, 6)
  })
})

test('E-04 a link is a FIFO server: offered traffic above the bandwidth is delivered at the bandwidth and the rest waits (ch08 section 3)', () => {
  // 1 MB requests, 100 req/s offered, 100 Mbps: the link carries 12.5 requests per second.
  const t = oneHop(
    'e04',
    { protocol: 'grpc', bandwidth: 100 },
    { rps: 100, durationMs: 20_000, timeoutMs: 20_000 }
  )
  t.workload = {
    ...t.workload!,
    requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1_000_000 }]
  } as WorkloadProfile
  const out = runEngine(t)
  expect(relErr(out.summary.throughput, 100 / ((1_000_000 * 8) / 1e6))).toBeLessThan(0.03)
  expect(out.summary.latency.p50).toBeGreaterThan(500)
})

test.describe('E-05 path-type latency: the defaults, in order and as documented (ch08 section 2.1)', () => {
  const median = (p: Parameters<typeof getPathTypeLatencyProfile>[0]) =>
    Math.exp(getPathTypeLatencyProfile(p).mu)
  test('medians are 0.10, 0.25, 0.50, 60 and 99 ms (one-way) and strictly increase with distance', () => {
    const order = ['same-rack', 'same-dc', 'cross-zone', 'cross-region', 'internet'] as const
    for (const [p, expected] of [
      ['same-rack', 0.1],
      ['same-dc', 0.25],
      ['cross-zone', 0.5],
      ['cross-region', 60.34],
      ['internet', 99.48]
    ] as const) {
      expect(relErr(median(p), expected), p).toBeLessThan(0.01)
    }
    for (let i = 1; i < order.length; i += 1)
      expect(median(order[i])).toBeGreaterThan(median(order[i - 1]))
  })

  // Decided (decision C1): the table is one-way, calibrated to half the measured round trips: 0.5 ms inside a
  // datacenter, so 0.25 ms one way, and 0.6 to 1.1 ms between availability zones, so about 0.5 ms one way.
  test('E-05b cross-zone latency is calibrated to measured availability-zone latency (0.6 to 1.1 ms round trip)', () => {
    expect(median('cross-zone') * 2).toBeGreaterThan(0.6)
    expect(median('cross-zone') * 2).toBeLessThan(1.2)
    expect(median('same-dc') * 2).toBeLessThan(0.6)
  })
})

test.describe('E-06 a new connection costs round trips: TCP 1, TLS 1.2 +2, TLS 1.3 +1, 0-RTT resumption +0 (ch08 section 4)', () => {
  const L = 20
  const S = 1
  const OVERHEAD = 0.5 // https
  const edge = (connection: Record<string, unknown>) => ({
    protocol: 'https',
    latency: constantLatency(L),
    connection
  })
  const cases: [string, Record<string, unknown>, 'none' | '1.2' | '1.3', boolean][] = [
    ['per-request, no TLS', { reuse: 'per-request', tls: 'none' }, 'none', false],
    ['per-request, TLS 1.2', { reuse: 'per-request', tls: '1.2' }, '1.2', false],
    ['per-request, TLS 1.3', { reuse: 'per-request', tls: '1.3' }, '1.3', false],
    [
      'per-request, TLS 1.3 with resumption',
      { reuse: 'per-request', tls: '1.3', tlsSessionResumption: true },
      '1.3',
      true
    ],
    [
      'per-request, TLS 1.2 with resumption',
      { reuse: 'per-request', tls: '1.2', tlsSessionResumption: true },
      '1.2',
      true
    ]
  ]
  for (const [name, conn, tls, resumed] of cases) {
    test(name, () => {
      const out = runEngine(oneClient(oneHop(`e06-${name}`, edge(conn), { rps: 5 }, S)))
      const expected = roundTripsToFirstByte(tls, resumed) * L + S + OVERHEAD
      // Resumption applies after the first full handshake with that client, so the typical (median) request is resumed.
      expect(
        relErr(out.summary.latency.p50, expected),
        `${name}: ${out.summary.latency.p50} vs ${expected}`
      ).toBeLessThan(0.015)
    })
  }

  test('keep-alive: only the first request pays the handshake (TLS 1.2: 4 round trips); the rest pay 1', () => {
    const out = runEngine(
      oneClient(oneHop('e06-keep', edge({ reuse: 'keep-alive', tls: '1.2' }), { rps: 5 }, S))
    )
    expect(relErr(out.summary.latency.p50, 1 * L + S + OVERHEAD)).toBeLessThan(0.015)
    expect(relErr(out.summary.latency.max, 4 * L + S + OVERHEAD)).toBeLessThan(0.015)
  })

  test('persistent: the same, with TLS 1.3 the first request costs 3 round trips', () => {
    const out = runEngine(
      oneClient(oneHop('e06-persist', edge({ reuse: 'persistent', tls: '1.3' }), { rps: 5 }, S))
    )
    expect(relErr(out.summary.latency.p50, 1 * L + S + OVERHEAD)).toBeLessThan(0.015)
    expect(relErr(out.summary.latency.max, 3 * L + S + OVERHEAD)).toBeLessThan(0.015)
  })

  test('connections belong to a client: with no client identity every request is a new client and pays the full setup', () => {
    const out = runEngine(
      oneHop('e06-anon', edge({ reuse: 'keep-alive', tls: '1.2' }), { rps: 5 }, S)
    )
    expect(relErr(out.summary.latency.p50, 4 * L + S + OVERHEAD)).toBeLessThan(0.015)
  })

  test('round trips table: 1, 2, 3, 4 (reused, 0-RTT, TLS 1.3, TLS 1.2) = 60, 120, 180, 240 ms at 60 ms RTT', () => {
    expect([
      roundTripsToFirstByte('none') - 1,
      roundTripsToFirstByte('1.3', true),
      roundTripsToFirstByte('1.3'),
      roundTripsToFirstByte('1.2')
    ]).toEqual([1, 2, 3, 4])
  })
})

test.describe('E-07 a pool of m connections caps throughput at m / W for one-request-per-connection protocols (ch08 section 6.1)', () => {
  const pooled = (seed: string, protocol: string, maxConnections: number | undefined) =>
    steadyRate(
      runEngine(
        oneClient(
          chain({
            run: run(seed, { rps: 400, durationMs: 20_000, warmupMs: 5000, timeoutMs: 20_000 }),
            nodes: [
              computeNode('srv', { serviceMs: 50, instanceType: 'm5.4xlarge', timeoutMs: 20_000 })
            ],
            edges: [
              [
                'source',
                'srv',
                {
                  protocol,
                  connection: {
                    reuse: 'keep-alive',
                    tls: 'none',
                    ...(maxConnections ? { maxConnections } : {})
                  }
                }
              ]
            ]
          })
        )
      ),
      8,
      19
    )

  // The server itself can do 16 workers / 0.05 s = 320 req/s.
  for (const m of [5, 10]) {
    test(`https, ${m} connections, 50 ms each: ${m / 0.05} req/s`, () => {
      expect(relErr(pooled(`e07-${m}`, 'https', m), m / 0.05)).toBeLessThan(0.04)
    })
  }

  test('HTTP/2 (grpc) multiplexes about 100 requests per connection, so 10 connections do not cap it; the server does (320 req/s)', () => {
    expect(relErr(pooled('e07-h2', 'grpc', 10), 320)).toBeLessThan(0.05)
  })

  test('connections needed = rate x latency / streams: 2,000 req/s at 50 ms is 100 over HTTP/1.1 and 1 over HTTP/2', () => {
    expect(connectionsNeeded(2000, 0.05, 1)).toBe(100)
    expect(connectionsNeeded(2000, 0.05, 100)).toBe(1)
  })
})

test.describe('E-08 a lost packet costs one extra round trip; it does not fail the request (ch08 section 5)', () => {
  const L = 20
  for (const p of [0.1, 0.3]) {
    test(`loss ${p}: a fraction p of requests take one extra edge latency, none fail`, () => {
      const out = runEngine(
        oneHop(
          `e08-${p}`,
          { packetLossRate: p, latency: constantLatency(L) },
          { rps: 50, durationMs: 200_000 }
        )
      )
      const rows = out.requestOutcomes.filter((r) => r.latencyMs !== null)
      const delayed = rows.filter((r) => (r.latencyMs as number) > L * 1.5).length / rows.length
      const n = rows.length
      // One packet per request: P(hit) = 1 - (1 - p)^1 = p.
      expect(Math.abs(delayed - requestHitByLoss(p, 1))).toBeLessThan(
        3 * Math.sqrt((p * (1 - p)) / n) + 0.02
      )
      expect(out.summary.errorRate).toBe(0)
      // A hit request is delayed by about one more edge latency.
      const hit = rows.map((r) => r.latencyMs as number).filter((l) => l > L * 1.5)
      expect(Math.abs(hit.reduce((a, b) => a + b, 0) / hit.length - (2 * L + 1.2))).toBeLessThan(
        0.1 * L
      )
    })
  }

  test('a request of k packets is hit with probability 1 - (1 - p)^k: 9.6% for k = 10 at p = 1%', () => {
    expect(requestHitByLoss(0.01, 10)).toBeCloseTo(0.0956, 4)
  })

  // Tracked gap. The Mathis bound caps a TCP connection at (MSS / RTT) x 1.22 / sqrt(p): 2.86 Mbit/s at 1% loss and
  // 50 ms RTT whatever the link size. The simulator's loss only adds a retransmission delay and has no throughput
  // model, so loss never lowers delivered bandwidth.
  test.fixme('E-08b loss caps TCP throughput at (MSS / RTT) x 1.22 / sqrt(p) regardless of link capacity', () => {
    expect(mathisBps(1460, 0.05, 0.01) / 1e6).toBeCloseTo(2.86, 2)
  })

  test('the Mathis numbers the chapter quotes: 28.6, 9.05 and 2.86 Mbit/s at 0.01%, 0.1% and 1% loss (50 ms RTT)', () => {
    expect(mathisBps(1460, 0.05, 1e-4) / 1e6).toBeCloseTo(28.61, 2)
    expect(mathisBps(1460, 0.05, 1e-3) / 1e6).toBeCloseTo(9.05, 2)
    expect(mathisBps(1460, 0.05, 1e-2) / 1e6).toBeCloseTo(2.86, 2)
  })
})

test.describe('E-09 errors fail requests; a path succeeds only if every hop does (ch08 section 10)', () => {
  test('one edge at 20% errors fails 20% of requests', () => {
    const out = runEngine(oneHop('e09a', { errorRate: 0.2 }, { rps: 50, durationMs: 200_000 }))
    const n = out.summary.totalRequests
    expect(Math.abs(out.summary.errorRate - 0.2)).toBeLessThan(3 * Math.sqrt((0.2 * 0.8) / n))
  })

  test('five hops at 1% each succeed with probability 0.99^5 = 95.1%', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const out = runEngine(
      chain({
        run: run('e09b', { rps: 50, durationMs: 200_000 }),
        nodes: ids.map((id) => computeNode(id, { serviceMs: 1 })),
        edges: [
          ['source', 'a', { errorRate: 0.01 }],
          ...ids
            .slice(0, -1)
            .map(
              (id, i) =>
                [id, ids[i + 1], { errorRate: 0.01 }] as [string, string, Record<string, unknown>]
            )
        ]
      })
    )
    const n = out.summary.totalRequests
    expect(Math.abs(out.summary.errorRate - (1 - 0.99 ** 5))).toBeLessThan(
      3 * Math.sqrt((0.049 * 0.951) / n)
    )
  })
})

test('E-10 fan-out factor f multiplies the load the target receives by f (ch08 section 9)', () => {
  for (const f of [1, 5]) {
    const out = runEngine(oneHop(`e10-${f}`, { fanoutFactor: f }, { rps: 50 }))
    expect(out.perNode.srv.totalArrived).toBe(1500 * f)
  }
})

test.describe('E-11 an asynchronous edge forks a side branch; it does not remove the load (ch08 section 7)', () => {
  // a -> c (synchronous, 3 ms) and a -> b (asynchronous, 200 ms).
  const forked = () =>
    runEngine(
      chain({
        run: run('e11', { rps: 50 }),
        nodes: [
          computeNode('a', { serviceMs: 2 }),
          computeNode('c', { serviceMs: 3 }),
          {
            ...computeNode('b', { serviceMs: 200 }),
            resources: { instanceType: 'm5.4xlarge', instanceCount: 1, workloadKind: 'cpu-bound' }
          }
        ],
        edges: [
          ['source', 'a'],
          ['a', 'c'],
          ['a', 'b', { mode: 'asynchronous' }]
        ]
      })
    )

  test('the async target still receives every request, and the synchronous path is unaffected by its slowness', () => {
    const out = forked()
    expect(out.perNode.b.totalArrived).toBe(1500)
    expect(out.perNode.c.totalArrived).toBe(1500)
    const latencyAt = (node: string) => {
      const rows = out.requestOutcomes
        .filter((r) => r.nodeId === node && r.latencyMs !== null)
        .map((r) => r.latencyMs as number)
      return rows.reduce((a, b) => a + b, 0) / rows.length
    }
    expect(Math.abs(latencyAt('c') - (2 + 3 + 2 * 0.2))).toBeLessThan(0.5)
    expect(latencyAt('b')).toBeGreaterThan(195)
  })

  test('the branch is reported as its own request, so the blended percentiles show the background work', () => {
    const out = forked()
    // Two reported requests per generated one, less the few background branches still running at the cutoff.
    expect(out.summary.totalRequests).toBeGreaterThan(2 * 1500 - 30)
    expect(out.summary.totalRequests).toBeLessThanOrEqual(2 * 1500)
    expect(out.summary.latency.p99).toBeGreaterThan(195) // the user-facing path is about 5 ms
  })

  test('two synchronous targets are a split, not a fork: each request goes to one of them', () => {
    const out = runEngine(
      chain({
        run: run('e11s', { rps: 50 }),
        nodes: [
          computeNode('a', { serviceMs: 2 }),
          computeNode('c', { serviceMs: 3 }),
          computeNode('b', { serviceMs: 3 })
        ],
        edges: [
          ['source', 'a'],
          ['a', 'c'],
          ['a', 'b']
        ]
      })
    )
    expect(out.perNode.b.totalArrived + out.perNode.c.totalArrived).toBe(1500)
  })

  test('a queue-type target is asynchronous by its type: the caller returns after the ack and the consumer still gets every message', () => {
    const out = runEngine(
      chain({
        run: run('e11q', { rps: 50 }),
        nodes: [
          computeNode('a', { serviceMs: 2 }),
          computeNode('q', { serviceMs: 5, type: 'queue' }),
          {
            ...computeNode('c', { serviceMs: 200 }),
            resources: { instanceType: 'm5.4xlarge', instanceCount: 1, workloadKind: 'cpu-bound' }
          }
        ],
        edges: [
          ['source', 'a'],
          ['a', 'q'],
          ['q', 'c']
        ]
      })
    )
    expect(out.summary.latency.p50).toBeLessThan(10)
    expect(out.perNode.c.totalArrived).toBe(1500)
  })
})

test.describe('E-12 batching: a batch is sent at linger.ms or when it is full, whichever comes first (ch08 section 8)', () => {
  const kafka = (
    seed: string,
    rps: number,
    batching?: { lingerMs: number; maxBatchBytes?: number }
  ) =>
    runEngine(
      chain({
        run: run(seed, { rps, pattern: 'poisson', durationMs: 30_000 }),
        nodes: [computeNode('srv', { serviceMs: 1, instanceType: 'm5.xlarge' })],
        edges: [['source', 'srv', { protocol: 'kafka', ...(batching ? { batching } : {}) }]]
      })
    ).summary.latency.mean

  test('a record that arrives alone waits the whole linger: at 10 req/s, linger 10 ms adds about 10 ms', () => {
    const added = kafka('e12a', 10, { lingerMs: 10 }) - kafka('e12a-base', 10)
    expect(added).toBeGreaterThan(9)
    expect(added).toBeLessThan(10.6)
  })

  test('a batch that fills sends early: 5 records of 100 B fill at 1,000 req/s in 5 ms, so records wait 2 ms on average', () => {
    const added =
      kafka('e12b', 1000, { lingerMs: 10, maxBatchBytes: 500 }) - kafka('e12b-base', 1000)
    expect(batchMeanWaitMs(5, 1)).toBe(2)
    expect(Math.abs(added - batchMeanWaitMs(5, 1))).toBeLessThan(0.7)
  })
})

test('E-13 reference arithmetic the chapter quotes (ch08 sections 2 and 3)', () => {
  // Fibre is about 4.9 us per km one way: 1,000 km is 9.8 ms round trip; New York to London about 55 ms.
  expect(2 * 1000 * 4.9e-3).toBeCloseTo(9.8, 6)
  expect(2 * 5570 * 4.9e-3).toBeCloseTo(54.6, 1)
  // Bandwidth-delay product: 1 Gbps x 70 ms = 8.75 MB; 100 Mbps x 100 ms = 1.25 MB; 2 Mbps x 50 ms = 12.5 kB.
  expect(bdpBytes(1000, 70)).toBeCloseTo(8.75e6, 0)
  expect(bdpBytes(100, 100)).toBeCloseTo(1.25e6, 0)
  expect(bdpBytes(2, 50)).toBeCloseTo(12_500, 0)
  // Five hops at 99% each.
  expect(0.99 ** 5).toBeCloseTo(0.951, 3)
})

test.describe('what the user sees in the network environment (ch08 sections 3 and 4)', () => {
  test('E-14 a 1 MB request over a 100 Mbps edge shows the same latency in the UI as in the engine', async ({
    page
  }) => {
    const topology = oneHop(
      'e14',
      { protocol: 'grpc', bandwidth: 100 },
      { rps: 2, durationMs: 20_000 }
    )
    topology.workload = {
      ...topology.workload!,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1_000_000 }]
    } as WorkloadProfile
    const out = runEngine(topology)
    expect(out.summary.latency.p50).toBeGreaterThan(75)
    await openApp(page)
    await importTopology(page, topology)
    await useNetworkEdges(page)
    await runAndWait(page)
    const ui = await readUiRun(page, 'srv')
    expect(relErr(ui.p50, out.summary.latency.p50)).toBeLessThan(0.06)
  })

  test('E-15 a new TLS 1.2 connection per request costs 4 round trips in the UI too', async ({
    page
  }) => {
    const topology = oneHop(
      'e15',
      {
        protocol: 'https',
        latency: constantLatency(20),
        connection: { reuse: 'per-request', tls: '1.2' }
      },
      { rps: 5, durationMs: 20_000 }
    )
    const out = runEngine(topology)
    expect(relErr(out.summary.latency.p50, 4 * 20 + 1 + 0.5)).toBeLessThan(0.02)
    await openApp(page)
    await importTopology(page, topology)
    await useNetworkEdges(page)
    await runAndWait(page)
    const ui = await readUiRun(page, 'srv')
    expect(relErr(ui.p50, out.summary.latency.p50)).toBeLessThan(0.06)
  })
})
