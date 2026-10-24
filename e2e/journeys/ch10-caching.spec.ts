/**
 * Chapter 10: caching (docs/reference/10-caching.md).
 * Expected values come from the chapter: backing load = (1 - h) x requests, mean latency = h x t_hit + (1 - h) x
 * (t_lookup + t_backing), the LRU hit ratio of the Che approximation under Zipf popularity (always below the
 * ideal top-C share), single-flight request collapsing, expiry, and what a flushed or failed cache does.
 * Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { bodyText, importTopology, openApp, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { cheHitRatio, relErr, zipfTopShare } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 400,
    pattern: 'constant',
    durationMs: 60_000,
    warmupMs: 0,
    seed,
    timeoutMs: 30_000,
    ...over
  }
}

const TCP_EDGES: ['source' | 'cache', string, Record<string, unknown>][] = [
  ['source', 'cache', { protocol: 'tcp' }],
  ['cache', 'db', { protocol: 'tcp' }]
]

function cacheChain(
  seed: string,
  cacheConfig: Record<string, unknown>,
  over: Partial<RunSpec> = {},
  opts: {
    keyspace?: { size: number; skew: number }
    dbMs?: number
    lookupMs?: number
    faults?: Record<string, unknown>[]
  } = {}
) {
  return chain({
    run: run(seed, over),
    nodes: [
      queueNode('cache', 'in-memory-cache', { serviceMs: opts.lookupMs ?? 1, config: cacheConfig }),
      queueNode('db', 'relational-db', { config: { storageReadMs: opts.dbMs ?? 10 } })
    ],
    edges: TCP_EDGES,
    faults: opts.faults,
    requestDistribution: [
      {
        type: 'read',
        weight: 1,
        sizeBytes: 500,
        ...(opts.keyspace ? { keyspace: { field: 'itemId', ...opts.keyspace } } : {})
      }
    ]
  })
}

/** Hit ratio of the lookups created between `fromMs` and `toMs`. */
function hitRatio(out: ReturnType<typeof runEngine>, fromMs = 0, toMs = Infinity): number {
  let hits = 0
  let total = 0
  for (const o of out.requestOutcomes) {
    if (o.createdAtMs < fromMs || o.createdAtMs >= toMs) continue
    if (o.cacheOutcome === 'hit') hits += 1
    if (o.cacheOutcome === 'hit' || o.cacheOutcome === 'miss') total += 1
  }
  return hits / total
}

// ───────────────────────── 1. Declared hit rate ─────────────────────────

test.describe('C-01 a declared hit rate sends (1 - h) of the traffic to the backing store (ch10 section 1)', () => {
  for (const h of [0.2, 0.5, 0.8, 0.95]) {
    test(`h = ${h}: hit ratio within 5 standard errors and backing arrivals equal the misses`, () => {
      const out = runEngine(
        cacheChain(`c01-${h}`, {
          cacheModel: 'declared-rate',
          cacheHitRate: h,
          cacheHitLatencyMs: 1
        })
      )
      const n = out.perNode.cache.totalArrived
      const se = Math.sqrt((h * (1 - h)) / n)
      expect(Math.abs(out.perNode.cache.cacheHitRatio - h)).toBeLessThan(5 * se)
      // Conservation: every miss, and only a miss, reaches the database.
      expect(out.perNode.db.totalArrived).toBe(out.perNode.cache.cacheMisses)
      expect(out.perNode.cache.cacheHits + out.perNode.cache.cacheMisses).toBe(n)
    })
  }

  test('h = 0 sends everything through and h = 1 sends nothing', () => {
    const none = runEngine(
      cacheChain('c01-0', { cacheModel: 'declared-rate', cacheHitRate: 0 }, { durationMs: 10_000 })
    )
    expect(none.perNode.db.totalArrived).toBe(none.perNode.cache.totalArrived)
    const all = runEngine(
      cacheChain('c01-1', { cacheModel: 'declared-rate', cacheHitRate: 1 }, { durationMs: 10_000 })
    )
    expect(all.perNode.db.totalArrived).toBe(0)
  })
})

test.describe('C-02 mean latency = h x t_hit + (1 - h) x (t_lookup + t_backing) (ch10 section 1)', () => {
  test('h 0.8, hit 1 ms, lookup 1 ms, store 10 ms: 3.0 ms', () => {
    const out = runEngine(
      cacheChain('c02', { cacheModel: 'declared-rate', cacheHitRate: 0.8, cacheHitLatencyMs: 1 })
    )
    const expected = 0.8 * 1 + 0.2 * (1 + 10)
    expect(Math.abs(out.summary.latency.mean - expected)).toBeLessThan(0.12)
  })

  test('the speed-up grows with the hit ratio', () => {
    const mean = (h: number) =>
      runEngine(
        cacheChain(
          `c02-${h}`,
          { cacheModel: 'declared-rate', cacheHitRate: h, cacheHitLatencyMs: 1 },
          { durationMs: 20_000 }
        )
      ).summary.latency.mean
    expect(mean(0.9)).toBeLessThan(mean(0.5))
    expect(mean(0.5)).toBeLessThan(mean(0.1))
  })
})

// ───────────────────────── 2. Derived LRU ─────────────────────────

const DERIVED = (capacity: number) => ({
  cacheModel: 'derived-lru',
  cacheRamMb: (capacity * 1000) / 1_000_000,
  valueSizeBytes: 1000,
  cacheHitLatencyMs: 1
})

test.describe('C-03 derived-LRU hit ratio under Zipf tracks the Che approximation (ch10 section 2.3)', () => {
  const N = 1000
  const cases: [number, number][] = [
    [1, 10],
    [1, 100],
    [1, 300],
    [0.8, 10],
    [0.8, 100],
    [0.8, 300]
  ]
  for (const [s, C] of cases) {
    test(`N ${N}, s ${s}, C ${C}: within 3 points of Che and below the ideal top-C share`, () => {
      const out = runEngine(
        cacheChain(
          `c03-${s}-${C}`,
          DERIVED(C),
          { rps: 1000, durationMs: 40_000 },
          {
            keyspace: { size: N, skew: s },
            dbMs: 1,
            lookupMs: 0.1
          }
        )
      )
      const measured = hitRatio(out, 10_000)
      const che = cheHitRatio(N, s, C)
      expect(Math.abs(measured - che)).toBeLessThan(0.03)
      expect(measured).toBeLessThan(zipfTopShare(N, s, C))
    })
  }
})

test.describe('C-04 the hit ratio rises with cache size and with skew (ch10 section 2)', () => {
  const measure = (seed: string, C: number, s: number) =>
    hitRatio(
      runEngine(
        cacheChain(
          seed,
          DERIVED(C),
          { rps: 1000, durationMs: 25_000 },
          {
            keyspace: { size: 1000, skew: s },
            dbMs: 1,
            lookupMs: 0.1
          }
        )
      ),
      5_000
    )

  test('C = 10, 100, 300 at s = 1 gives increasing hit ratios', () => {
    const ratios = [10, 100, 300].map((C) => measure(`c04-c${C}`, C, 1))
    expect(ratios[0]).toBeLessThan(ratios[1])
    expect(ratios[1]).toBeLessThan(ratios[2])
  })

  test('s = 0.5, 0.8, 1.2 at C = 100 gives increasing hit ratios', () => {
    const ratios = [0.5, 0.8, 1.2].map((s) => measure(`c04-s${s}`, 100, s))
    expect(ratios[0]).toBeLessThan(ratios[1])
    expect(ratios[1]).toBeLessThan(ratios[2])
  })

  test('a uniform workload (s = 0) hits about C / N of the time', () => {
    const ratio = measure('c04-uniform', 100, 0)
    expect(Math.abs(ratio - 100 / 1000)).toBeLessThan(0.02)
  })
})

// ───────────────────────── 3. Flush and warm-up ─────────────────────────

test.describe('C-05 a flush empties the cache and traffic re-warms it (ch10 section 4)', () => {
  const FLUSH_AT = 20_000
  const flush = (durationMs?: number) => ({
    targetId: 'cache',
    faultType: 'cache-flush',
    timing: 'deterministic',
    duration: 'fixed',
    params: { atMs: FLUSH_AT, ...(durationMs ? { durationMs } : {}) }
  })

  test('derived LRU: hit ratio collapses at the flush, then recovers to the steady state', () => {
    const out = runEngine(
      cacheChain(
        'c05',
        DERIVED(300),
        { rps: 1000, durationMs: 45_000 },
        {
          keyspace: { size: 1000, skew: 1 },
          dbMs: 1,
          lookupMs: 0.1,
          faults: [flush()]
        }
      )
    )
    const steady = hitRatio(out, 10_000, FLUSH_AT)
    const justAfter = hitRatio(out, FLUSH_AT, FLUSH_AT + 200)
    const recovered = hitRatio(out, 40_000, 45_000)
    expect(Math.abs(steady - cheHitRatio(1000, 1, 300))).toBeLessThan(0.03)
    expect(justAfter).toBeLessThan(steady * 0.7)
    expect(Math.abs(recovered - steady)).toBeLessThan(0.03)
  })

  test('declared rate: no hits for the re-warm duration, then the declared rate returns at once', () => {
    const out = runEngine(
      cacheChain(
        'c05b',
        { cacheModel: 'declared-rate', cacheHitRate: 0.8, cacheHitLatencyMs: 1 },
        { durationMs: 40_000 },
        {
          faults: [flush(5_000)]
        }
      )
    )
    expect(hitRatio(out, FLUSH_AT, FLUSH_AT + 5_000)).toBe(0)
    expect(Math.abs(hitRatio(out, 0, FLUSH_AT) - 0.8)).toBeLessThan(0.02)
    expect(Math.abs(hitRatio(out, FLUSH_AT + 5_000) - 0.8)).toBeLessThan(0.02)
  })
})

// ───────────────────────── 4. Stampede and request collapsing ─────────────────────────

test.describe('C-06 request collapsing: one backing request per key, not one per waiting caller (ch10 section 5)', () => {
  // One hot key, a cold cache and a slow store: until the first fetch lands, every caller misses.
  const stampede = (collapse: boolean) =>
    runEngine(
      cacheChain(
        `c06-${collapse}`,
        { ...DERIVED(100), requestCollapsing: collapse },
        { rps: 1000, durationMs: 5_000 },
        { keyspace: { size: 1, skew: 0 }, dbMs: 50, lookupMs: 0.1 }
      )
    )

  test('without collapsing the stampede is rate x fetch time (about 50 backing calls); with it, exactly one', () => {
    const without = stampede(false)
    const withCollapse = stampede(true)
    expect(relErr(without.perNode.db.totalArrived, 1000 * 0.05)).toBeLessThan(0.25)
    expect(withCollapse.perNode.db.totalArrived).toBe(1)
  })

  test('everything the collapsed callers wait for is served: no request fails', () => {
    expect(stampede(true).summary.failedRequests).toBe(0)
  })
})

// ───────────────────────── 5. Expiry (tracked gap) ─────────────────────────

test.describe('C-07 entries expire after their TTL (ch10 section 3)', () => {
  // Tracked gap (finding 17): ttlSeconds is topology intent only. With 100 uniform keys at 1 request/s each and a
  // TTL of 0.1 s an entry is almost never still alive at the next request (about 10%); the simulator keeps it forever.
  test.fail(
    'a TTL much shorter than the gap between requests to a key keeps the hit ratio low',
    () => {
      const out = runEngine(
        cacheChain(
          'c07',
          { ...DERIVED(1000), ttlSeconds: 0.1 },
          { rps: 100, durationMs: 40_000 },
          { keyspace: { size: 100, skew: 0 }, dbMs: 1 }
        )
      )
      expect(hitRatio(out, 10_000)).toBeLessThan(0.3)
    }
  )
})

// ───────────────────────── 6. A failed cache ─────────────────────────

test.describe('C-08 a failed cache answers nothing (ch10 section 6)', () => {
  const FAIL_AT = 20_000
  const down = chain({
    run: run('c08', { rps: 200, durationMs: 40_000 }),
    nodes: [
      queueNode('cache', 'in-memory-cache', {
        config: { cacheModel: 'declared-rate', cacheHitRate: 0.9, cacheHitLatencyMs: 1 }
      }),
      queueNode('db', 'relational-db', { config: { storageReadMs: 10 } })
    ],
    edges: TCP_EDGES,
    faults: [
      {
        targetId: 'cache',
        faultType: 'node-failure',
        timing: 'deterministic',
        duration: 'permanent',
        params: { atMs: FAIL_AT, mode: 'reject' }
      }
    ]
  })

  test('no hit is counted after the failure', () => {
    const out = runEngine(down)
    const lateHits = out.requestOutcomes.filter(
      (o) => o.cacheOutcome === 'hit' && o.createdAtMs >= FAIL_AT
    )
    expect(lateHits.length).toBe(0)
    expect(
      out.requestOutcomes.some((o) => o.cacheOutcome === 'hit' && o.createdAtMs < FAIL_AT)
    ).toBe(true)
  })

  // Decision needed (open item in chapter 10, docs/cache-fallback-proposal.md): a cache-aside client whose cache is
  // down calls the database, so the database sees the full request rate. The simulator fails the request instead.
  test.fixme('the database sees the full request rate after the cache fails', () => {
    const out = runEngine(down)
    const lateToDb = out.requestOutcomes.filter(
      (o) => o.createdAtMs >= FAIL_AT && o.status === 'success'
    ).length
    expect(lateToDb).toBeGreaterThan(0.9 * 200 * 20)
  })
})

// ───────────────────────── 7. The browser agrees ─────────────────────────

test.describe('C-09 the browser shows the hit ratio the engine measured', () => {
  test('a derived-LRU cache at N 1000, s 1, C 100 shows its hit ratio in the results', async ({
    page
  }) => {
    const topology = cacheChain(
      'c09',
      DERIVED(100),
      { rps: 500, durationMs: 20_000 },
      {
        keyspace: { size: 1000, skew: 1 },
        dbMs: 1,
        lookupMs: 0.1
      }
    )
    const out = runEngine(topology)
    const engineRatio = out.perOrigin[0].cacheHitRate!
    await openApp(page)
    await importTopology(page, topology)
    await runAndWait(page)
    const text = await bodyText(page)
    // "Traffic by origin" row: requests, p50, p95, errors %, cache hit %.
    const row = text.match(/\n\t([\d,]+)\t[\d.]+ms\t[\d.]+ms\t[\d.]+%\t([\d.]+)%/)
    expect(row, 'the traffic-by-origin row with a CACHE HIT column').not.toBeNull()
    const shown = Number(row![2])
    expect(Math.abs(shown - engineRatio * 100)).toBeLessThan(0.5)
    // And it is the theory number, not just the engine's own: Che at N 1000, s 1, C 100 is 57.7%.
    expect(Math.abs(shown - cheHitRatio(1000, 1, 100) * 100)).toBeLessThan(3)
  })
})
