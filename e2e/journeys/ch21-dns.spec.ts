/**
 * Chapter 21: DNS and certificates (docs/reference/21-dns-and-certificates.md).
 * Expected values come from the chapter: weighted answers follow weight / sum of weights, a failover policy serves the primary
 * while it is healthy, latency routing picks the closest answer, an answer is cached for its TTL (one lookup per TTL, miss
 * ratio 1 / (1 + lambda x TTL)), and a client keeps using a cached answer after the endpoint dies, so DNS failover is
 * detection + TTL. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { dnsFailoverSeconds, dnsMissRatio, relErr } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

type Out = ReturnType<typeof runEngine>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'poisson',
    durationMs: 60_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

const target = (id: string) =>
  queueNode(id, 'microservice', { category: 'compute', serviceMs: 1, workers: 64 })

/** source -> dns -> a, b. */
function resolver(
  seed: string,
  config: Record<string, unknown>,
  edges: { a?: Record<string, unknown>; b?: Record<string, unknown> } = {},
  over: Partial<RunSpec> = {},
  extra: {
    faults?: Record<string, unknown>[]
    requestDistribution?: Record<string, unknown>[]
  } = {}
) {
  const dns = queueNode('dns', 'internal-dns', {
    category: 'dns-and-certs',
    serviceMs: 0.1,
    workers: 64,
    config
  })
  return chain({
    run: run(seed, over),
    nodes: [dns, target('a'), target('b')],
    edges: [tcp('source', 'dns'), tcp('dns', 'a', edges.a), tcp('dns', 'b', edges.b)],
    faults: extra.faults,
    requestDistribution: extra.requestDistribution
  })
}

const arrivals = (out: Out) => [out.perNode.a.totalArrived, out.perNode.b.totalArrived]

// ───────────────────────── 1. Routing policies ─────────────────────────

test.describe('DNS-01 weighted answers follow weight / sum of weights (ch21 section 3)', () => {
  for (const [wa, wb] of [
    [3, 1],
    [1, 1],
    [9, 1]
  ] as const) {
    test(`${wa}:${wb} gives ${((wa / (wa + wb)) * 100).toFixed(0)}% to the first within 4 standard errors`, () => {
      const out = runEngine(
        resolver(
          `dns01-${wa}-${wb}`,
          { dnsRoutingPolicy: 'weighted' },
          { a: { weight: wa }, b: { weight: wb } }
        )
      )
      const [a, b] = arrivals(out)
      const p = wa / (wa + wb)
      const se = Math.sqrt((p * (1 - p)) / (a + b))
      expect(Math.abs(a / (a + b) - p)).toBeLessThan(4 * se)
    })
  }

  test('records with no weight count as weight 1', () => {
    const out = runEngine(resolver('dns01b', { dnsRoutingPolicy: 'weighted' }))
    const [a, b] = arrivals(out)
    expect(Math.abs(a / (a + b) - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / (a + b)))
  })
})

test.describe('DNS-02 failover serves the primary while it is healthy and the secondary when it is not (ch21 section 3)', () => {
  const down = (id: string, atMs: number) => [
    {
      targetId: id,
      faultType: 'node-failure',
      timing: 'deterministic',
      duration: 'permanent',
      params: { atMs, mode: 'reject' }
    }
  ]

  test('healthy primary: all traffic to it', () => {
    const out = runEngine(
      resolver('dns02', { dnsRoutingPolicy: 'failover' }, { a: { weight: 10 }, b: { weight: 1 } })
    )
    expect(arrivals(out)[1]).toBe(0)
  })

  test('after the primary dies, traffic goes to the secondary', () => {
    const out = runEngine(
      resolver(
        'dns02b',
        { dnsRoutingPolicy: 'failover' },
        { a: { weight: 10 }, b: { weight: 1 } },
        {},
        { faults: down('a', 20_000) }
      )
    )
    const late = out.requestOutcomes.filter((o) => o.createdAtMs >= 25_000)
    expect(late.length).toBeGreaterThan(1000)
    expect(late.filter((o) => o.status === 'success').length / late.length).toBeGreaterThan(0.99)
    expect(arrivals(out)[1]).toBeGreaterThan(2000)
  })
})

test.describe('DNS-03 latency routing picks the closest answer (ch21 section 3)', () => {
  test('the answer 20 ms away never beats the answer 1 ms away', () => {
    const slow = { latency: { distribution: { type: 'constant', value: 20 }, pathType: 'same-dc' } }
    const out = runEngine(resolver('dns03', { dnsRoutingPolicy: 'latency-based' }, { b: slow }))
    expect(arrivals(out)[1]).toBe(0)
  })
})

test.describe('DNS-04 geolocation sends each origin to its mapped target (ch21 section 3)', () => {
  const mix = [
    { type: 'GET', weight: 0.5, sizeBytes: 100, metadata: { origin: 'eu' } },
    { type: 'POST', weight: 0.5, sizeBytes: 100, metadata: { origin: 'us' } }
  ]
  const geo = (targets: { origin: string; targetNodeId: string }[]) =>
    runEngine(
      resolver(
        'dns04',
        { dnsRoutingPolicy: 'geolocation', dnsGeoTargets: targets },
        {},
        {},
        { requestDistribution: mix }
      )
    )

  test('eu to a, us to b: each gets its half and nothing crosses', () => {
    const out = geo([
      { origin: 'eu', targetNodeId: 'a' },
      { origin: 'us', targetNodeId: 'b' }
    ])
    const [a, b] = arrivals(out)
    expect(Math.abs(a / (a + b) - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / (a + b)))
    const euToA = out.requestOutcomes.filter((o) => o.requestType === 'GET' && o.nodeId === 'b')
    expect(euToA.length).toBe(0)
  })

  test('an origin with no mapping is still answered (the fallback record) rather than failing', () => {
    const out = geo([{ origin: 'eu', targetNodeId: 'a' }])
    expect(out.summary.failedRequests).toBe(0)
  })
})

// ───────────────────────── 2. Caching and TTL ─────────────────────────

test.describe('DNS-05 an answer is cached for its TTL (ch21 section 1)', () => {
  for (const ttl of [10, 30]) {
    test(`TTL ${ttl} s over a 60 s run: one lookup per TTL, the rest are cache hits`, () => {
      const out = runEngine(
        resolver(
          `dns05-${ttl}`,
          { dnsRoutingPolicy: 'simple', dnsCacheTtlSeconds: ttl },
          {},
          { pattern: 'constant' }
        )
      )
      const c = out.perNode.dns.traitCounters
      expect(Math.abs(c.dnsCacheMisses - Math.ceil(60 / ttl))).toBeLessThanOrEqual(1)
      expect(c.dnsCacheHits + c.dnsCacheMisses).toBe(out.perNode.dns.totalArrived)
    })
  }

  test('miss ratio for Poisson requests is 1 / (1 + lambda x TTL): 2 req/s and a 5 s TTL miss 9.1%', () => {
    const out = runEngine(
      resolver(
        'dns05c',
        { dnsRoutingPolicy: 'simple', dnsCacheTtlSeconds: 5 },
        {},
        { rps: 2, durationMs: 3_000_000 }
      )
    )
    const c = out.perNode.dns.traitCounters
    const ratio = c.dnsCacheMisses / (c.dnsCacheMisses + c.dnsCacheHits)
    expect(relErr(ratio, dnsMissRatio(2, 5))).toBeLessThan(0.1)
  })
})

test.describe('DNS-06 a cached answer outlives the endpoint, so failover is detection + TTL (ch21 section 2)', () => {
  // Tracked gap (finding 32): the cache only counts hits and misses; the routing choice is made again for every request,
  // so the moment the primary is marked unhealthy traffic moves, whatever the TTL. With a 30 s TTL a client that has
  // cached the primary keeps sending to it for up to 30 s.
  test.fail(
    'with a 30 s TTL, requests still go to the dead primary for a while after it fails',
    () => {
      const out = runEngine(
        resolver(
          'dns06',
          { dnsRoutingPolicy: 'failover', dnsCacheTtlSeconds: 30 },
          { a: { weight: 10 }, b: { weight: 1 } },
          {},
          {
            faults: [
              {
                targetId: 'a',
                faultType: 'node-failure',
                timing: 'deterministic',
                duration: 'permanent',
                params: { atMs: 20_000, mode: 'reject' }
              }
            ]
          }
        )
      )
      const justAfter = out.requestOutcomes.filter(
        (o) => o.createdAtMs >= 20_500 && o.createdAtMs < 25_000
      )
      const failedShare = justAfter.filter((o) => o.status !== 'success').length / justAfter.length
      expect(failedShare).toBeGreaterThan(0.5)
    }
  )

  test('the arithmetic the chapter gives: 10 s checks x 3 failures + 60 s TTL is 90 s worst case, 60 s on average', () => {
    expect(dnsFailoverSeconds(10, 3, 60, true)).toBe(90)
    expect(dnsFailoverSeconds(10, 3, 60)).toBe(60)
  })
})

// ───────────────────────── 3. Geo latency and certificates ─────────────────────────

test.describe('DNS-07 a traffic manager, CDN or edge router adds its distance latency (ch21 section 3)', () => {
  // Finding 31 (fixed): the geo-latency module is registered with the capability modules, so `regionLatencyMs`
  // takes effect on these three node types.
  for (const [type, label] of [
    ['global-traffic-manager', 'traffic manager'],
    ['edge-router', 'edge router'],
    ['cdn', 'CDN']
  ] as const) {
    test(`a ${label} with 40 ms of region latency adds 40 ms`, () => {
      const node = queueNode('geo', type, {
        category: 'network-and-edge',
        serviceMs: 0.1,
        workers: 64,
        config: { regionLatencyMs: 40 }
      })
      const out = runEngine(
        chain({
          run: run(`dns07-${type}`, { pattern: 'constant' }),
          nodes: [node],
          edges: [tcp('source', 'geo')]
        })
      )
      expect(Math.abs(out.summary.latency.mean - 40.1)).toBeLessThan(0.5)
    })
  }
})

test.describe('DNS-08 certificates expire and renew (ch21 section 4)', () => {
  // Decision needed (ch21 open items): `certificate-distro` carries no behaviour; an expired certificate would fail
  // every new connection at one instant, and the margin between renewal and expiry (30 days for a 90-day certificate
  // renewed at 60) is what automation has to recover in.
  test.fixme('new connections through a node whose certificate has expired fail', () => {
    const cert = queueNode('cert', 'certificate-distro', {
      category: 'dns-and-certs',
      serviceMs: 1,
      workers: 64,
      config: { certificateValidUntilMs: 10_000 }
    })
    const out = runEngine(
      chain({
        run: run('dns08', { pattern: 'constant' }),
        nodes: [cert],
        edges: [tcp('source', 'cert')]
      })
    )
    const late = out.requestOutcomes.filter((o) => o.createdAtMs >= 12_000)
    expect(late.every((o) => o.status !== 'success')).toBe(true)
  })
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('DNS-09 the browser shows a clean failover when the secondary is healthy', () => {
  test('a failover policy with a healthy primary shows 0% errors', async ({ page }) => {
    const t = resolver(
      'dns09',
      { dnsRoutingPolicy: 'failover' },
      { a: { weight: 10 }, b: { weight: 1 } },
      { pattern: 'constant', durationMs: 10_000 }
    )
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'dns')
    expect(ui.errorRatePct).toBe(0)
  })
})
