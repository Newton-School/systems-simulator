/**
 * Chapter 05: traffic and workload patterns (docs/reference/05-traffic-and-workload.md).
 * Expected arrival counts and shapes come from the chapter's formulas (totals, means, Zipf shares,
 * backlog arithmetic), never from engine output. Per-second counts are read from the 1 s result windows.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, bodyText, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr, zipfTopShare } from '../support/oracles'
import { indexOfDispersion, mean } from '../support/stats'
import { createRandom } from '../../src/engine/stochastic/random'
import { WorkloadGenerator } from '../../src/engine/workload'
import type { TopologyJSON, WorkloadProfile } from '../../src/engine/core/types'
import { instanceServer } from '../support/topology'

type Out = ReturnType<typeof runEngine>

/** A fast 2-worker server (m5.large, 1 ms) so the source pattern, not the server, is what is measured. */
function pattern(
  seed: string,
  workload: Partial<WorkloadProfile>,
  over: {
    durationMs?: number
    service?: number
    instanceType?: string
    perRequestMemMb?: number
  } = {}
): TopologyJSON {
  const t = instanceServer(
    {
      name: seed,
      rps: 100,
      pattern: 'constant',
      durationMs: over.durationMs ?? 60_000,
      warmupMs: 0,
      seed
    },
    {
      service: { type: 'constant', value: over.service ?? 1 },
      instanceType: over.instanceType,
      perRequestMemMb: over.perRequestMemMb
    }
  )
  t.workload = { ...t.workload!, ...workload } as WorkloadProfile
  return t
}

/** Arrivals per 1 s window, from the result windows (successes plus errors that ended in the window). */
function perSecond(out: Out): number[] {
  return out.summary.latencyWindows.map((w) => w.successCount + w.errorCount)
}

test('W-01 constant: exactly rps x T requests, evenly spaced, inter-arrival CV 0 (ch05 section 2.1)', () => {
  const out = runEngine(pattern('w01', { pattern: 'constant', baseRps: 100 }))
  expect(out.summary.totalRequests).toBe(6000)
  expect(out.summary.offeredArrivalCV).toBeCloseTo(0, 6)
  expect(perSecond(out).every((c) => c === 100)).toBe(true)
})

test.describe('W-02 Poisson: counts are Poisson, gaps are exponential (ch05 section 2.2)', () => {
  const out = runEngine(
    pattern('w02', { pattern: 'poisson', baseRps: 100 }, { durationMs: 300_000 })
  )

  test('total within 3 standard deviations of rps x T', () => {
    const expected = 100 * 300
    expect(Math.abs(out.summary.totalRequests - expected)).toBeLessThan(3 * Math.sqrt(expected))
  })

  test('per-second counts have variance about equal to the mean (index of dispersion near 1)', () => {
    const counts = perSecond(out).slice(0, 300)
    expect(relErr(mean(counts), 100)).toBeLessThan(0.02)
    const idc = indexOfDispersion(counts)
    expect(idc).toBeGreaterThan(0.75)
    expect(idc).toBeLessThan(1.3)
  })

  test('inter-arrival CV is about 1', () => {
    expect(out.summary.offeredArrivalCV).toBeGreaterThan(0.95)
    expect(out.summary.offeredArrivalCV).toBeLessThan(1.05)
  })
})

test.describe('W-03 bursty: 400 rps for 1 s, then 50 rps for 3 s (ch05 section 2.3)', () => {
  const out = runEngine(
    pattern('w03', {
      pattern: 'bursty',
      baseRps: 50,
      bursty: { burstRps: 400, burstDuration: 1000, normalDuration: 3000 }
    })
  )

  test('mean rate = (400 x 1 + 50 x 3) / 4 = 137.5 req/s, so 8,250 requests in 60 s', () => {
    expect(relErr(out.summary.totalRequests, 137.5 * 60)).toBeLessThan(0.01)
  })

  test('per-second counts alternate between the burst and the normal level', () => {
    const counts = perSecond(out).slice(0, 40)
    for (let i = 0; i < counts.length; i += 1) {
      const expected = i % 4 === 0 ? 400 : 50
      expect(relErr(counts[i], expected), `second ${i}`).toBeLessThan(0.1)
    }
  })

  test('index of dispersion is far above Poisson (chapter computes about 168)', () => {
    expect(indexOfDispersion(perSecond(out))).toBeGreaterThan(50)
    expect(out.summary.offeredArrivalCV).toBeGreaterThan(1)
  })
})

test.describe('W-04 spike: 100 rps with 500 rps for 5 s from t = 20 s (ch05 section 2.5)', () => {
  const out = runEngine(
    pattern('w04', {
      pattern: 'spike',
      baseRps: 100,
      spike: { spikeTime: 20_000, spikeRps: 500, spikeDuration: 5000 }
    })
  )

  test('total = 100 x 60 + (500 - 100) x 5 = 8,000', () => {
    expect(out.summary.totalRequests).toBe(8000)
  })

  test('the rate is 5x base inside the spike window and base outside it', () => {
    const counts = perSecond(out)
    expect(counts.slice(0, 20).every((c) => c === 100)).toBe(true)
    expect(counts.slice(20, 25).every((c) => c === 500)).toBe(true)
    expect(counts.slice(25, 60).every((c) => c === 100)).toBe(true)
  })
})

test.describe('W-05 sawtooth: ramps from the base rate to the peak, then resets (ch05 section 2.6)', () => {
  // Base 10, peak 200, 10 s ramp. The ramp is linear from base to peak, so each ramp averages (10 + 200) / 2 = 105.
  const out = runEngine(
    pattern('w05', {
      pattern: 'sawtooth',
      baseRps: 10,
      sawtooth: { peakRps: 200, rampDuration: 10_000 }
    })
  )

  test('mean over whole ramps is (base + peak) / 2: 6,300 requests in 60 s', () => {
    expect(relErr(out.summary.totalRequests, 105 * 60)).toBeLessThan(0.02)
  })

  test('the rate rises linearly: about 105 at the middle of a ramp and near the peak at its end', () => {
    const counts = perSecond(out)
    expect(relErr(counts[4], 10 + (190 * 4.5) / 10)).toBeLessThan(0.1) // t = 4.5 s centre of window 4
    expect(counts[9]).toBeGreaterThan(180)
    for (let i = 1; i < 10; i += 1) expect(counts[i]).toBeGreaterThan(counts[i - 1])
  })

  test('it resets to the base at the start of each ramp', () => {
    const counts = perSecond(out)
    for (const start of [10, 20, 30, 40, 50]) {
      expect(counts[start]).toBeLessThan(counts[start - 1] / 3)
    }
  })
})

test('W-06 diurnal: the 24 hourly multipliers are stretched across the run, so a 60 s run covers one whole day (ch05 section 2.4)', () => {
  const multipliers = Array.from(
    { length: 24 },
    (_, h) => 1 + 0.5 * Math.sin((2 * Math.PI * (h - 9)) / 24)
  )
  const out = runEngine(
    pattern('w06', {
      pattern: 'diurnal',
      baseRps: 100,
      diurnal: {
        peakMultiplier: 1.5,
        hourlyMultipliers: multipliers as WorkloadProfile['diurnal'] extends infer D
          ? D extends { hourlyMultipliers: infer H }
            ? H
            : never
          : never
      }
    })
  )
  const meanMultiplier = mean(multipliers)
  expect(relErr(out.summary.totalRequests, 100 * 60 * meanMultiplier)).toBeLessThan(0.02)
  const counts = perSecond(out)
  for (let t = 0; t < 60; t += 1) {
    const hour = Math.min(23, Math.floor(((t + 0.5) / 60) * 24))
    expect(relErr(counts[t], 100 * multipliers[hour]), `second ${t}, hour ${hour}`).toBeLessThan(
      0.1
    )
  }
})

test('W-07 request mix: each type gets its weight, within sampling error (ch05 section 4)', () => {
  const out = runEngine(
    pattern('w07', {
      pattern: 'poisson',
      baseRps: 200,
      requestDistribution: [
        { type: 'read', weight: 0.7, sizeBytes: 100 },
        { type: 'write', weight: 0.2, sizeBytes: 100 },
        { type: 'admin', weight: 0.1, sizeBytes: 100 }
      ]
    })
  )
  const n = out.requestOutcomes.length
  expect(n).toBeGreaterThan(10_000)
  for (const [type, w] of [
    ['read', 0.7],
    ['write', 0.2],
    ['admin', 0.1]
  ] as const) {
    const share = out.requestOutcomes.filter((r) => r.requestType === type).length / n
    expect(Math.abs(share - w), type).toBeLessThan(3 * Math.sqrt((w * (1 - w)) / n))
  }
})

test.describe('W-08 Zipf popularity: the hottest keys carry most of the traffic (ch05 section 4)', () => {
  /** Draw keys through the workload generator's own key logic. */
  function topShares(size: number, skew: number, draws: number, seed: string) {
    const type = { type: 'GET', weight: 1, sizeBytes: 1, keyspace: { field: 'k', size, skew } }
    const generator = new WorkloadGenerator(
      { sourceNodeId: 's', pattern: 'constant', baseRps: 1, requestDistribution: [type] },
      createRandom(seed),
      { schedule: () => undefined }
    ) as unknown as { buildRequestMetadata(t: typeof type): Record<string, unknown> }
    const counts = new Map<number, number>()
    for (let i = 0; i < draws; i += 1) {
      const key = String(generator.buildRequestMetadata(type)['k'])
      const rank = Number(key.split('-').pop())
      counts.set(rank, (counts.get(rank) ?? 0) + 1)
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([, c]) => c / draws)
    const top = (n: number) => sorted.slice(0, n).reduce((a, b) => a + b, 0)
    return { top1: top(1), top10: top(10), top100: top(100) }
  }

  for (const [skew, label] of [
    [1.0, 's = 1.0 (classic web)'],
    [0.8, 's = 0.8']
  ] as const) {
    test(`${label}: top 1, 10 and 100 of 1,000 keys carry 1/H, H(10)/H and H(100)/H of the requests`, () => {
      const got = topShares(1000, skew, 300_000, `w08-${skew}`)
      expect(Math.abs(got.top1 - zipfTopShare(1000, skew, 1))).toBeLessThan(0.006)
      expect(Math.abs(got.top10 - zipfTopShare(1000, skew, 10))).toBeLessThan(0.01)
      expect(Math.abs(got.top100 - zipfTopShare(1000, skew, 100))).toBeLessThan(0.01)
    })
  }

  test('s = 1.0 gives 13.4%, 39.1% and 69.3% (the chapter numbers)', () => {
    expect(zipfTopShare(1000, 1, 1)).toBeCloseTo(0.1336, 3)
    expect(zipfTopShare(1000, 1, 10)).toBeCloseTo(0.3913, 3)
    expect(zipfTopShare(1000, 1, 100)).toBeCloseTo(0.693, 3)
  })

  test('skew 0 is uniform: the top 10 of 1,000 keys carry about 1%', () => {
    const got = topShares(1000, 0, 300_000, 'w08-uniform')
    expect(got.top10).toBeLessThan(0.02)
  })
})

test('W-09 open source: the offered rate does not depend on how slow the server is (ch05 section 3)', () => {
  // Same arrivals into a fast server and into one that is overloaded: 2 workers x 30 ms is 66 req/s against 150 offered.
  // An open source keeps sending. `totalRequests` counts requests that reached an outcome, so the number generated is
  // that plus whatever was still in flight at the cutoff.
  const generated = (out: Out) =>
    out.summary.totalRequests + out.conservationCheck.reduce((a, c) => a + c.inFlight, 0)
  const fast = runEngine(pattern('w09a', { pattern: 'constant', baseRps: 150 }, { service: 1 }))
  const slow = runEngine(
    pattern('w09b', { pattern: 'constant', baseRps: 150 }, { service: 30, perRequestMemMb: 8 })
  )
  expect(generated(fast)).toBe(9000)
  expect(generated(slow)).toBe(9000)
  // The surplus is not unsent: it is queued (still in flight), timed out or dropped.
  expect(slow.conservationCheck.reduce((a, c) => a + c.inFlight, 0)).toBeGreaterThan(500)
  expect(slow.summary.throughput).toBeLessThan(0.6 * fast.summary.throughput)
})

test('W-10 arrival variability drives waiting at the same mean rate: constant < Poisson < bursty (ch05 section 5, ch01 4.3)', () => {
  // 2 workers x 10 ms = 200 req/s capacity. Bursty: 400 req/s for 0.5 s then 20 req/s for 2.5 s, a mean of
  // (400 x 0.5 + 20 x 2.5) / 3 = 83.3 req/s. The burst exceeds capacity, so a backlog forms; compare with constant
  // and Poisson traffic at the same 83.3 req/s mean.
  const mean = (400 * 0.5 + 20 * 2.5) / 3
  const wait = (workload: Partial<WorkloadProfile>, seed: string) =>
    runEngine(pattern(seed, workload, { service: 10, durationMs: 300_000 })).perNode.srv
      .avgQueueWait
  const constant = wait({ pattern: 'constant', baseRps: mean }, 'w10c')
  const poisson = wait({ pattern: 'poisson', baseRps: mean }, 'w10p')
  const bursty = wait(
    {
      pattern: 'bursty',
      baseRps: 20,
      bursty: { burstRps: 400, burstDuration: 500, normalDuration: 2500 }
    },
    'w10b'
  )
  expect(constant).toBeLessThan(poisson)
  expect(poisson).toBeLessThan(bursty)
  expect(bursty / poisson).toBeGreaterThan(3)
})

test('W-10b a burst below capacity never queues: bursts only hurt when the burst rate exceeds what the node can serve (ch05 section 2.3)', () => {
  // Bursts of 160 req/s against 200 req/s of capacity, evenly spaced inside each phase: no waiting at all.
  const out = runEngine(
    pattern(
      'w10d',
      {
        pattern: 'bursty',
        baseRps: 40,
        bursty: { burstRps: 160, burstDuration: 1000, normalDuration: 1000 }
      },
      { service: 10 }
    )
  )
  expect(out.perNode.srv.avgQueueWait).toBe(0)
  expect(out.perNode.srv.peakQueueLength).toBe(0)
})

test('W-11 a spike builds a backlog of (spike - capacity) x duration and drains at (capacity - base) (ch05 section 2.5)', () => {
  // 2 workers x 10 ms = 200 req/s capacity. Base 100, spike 500 for 5 s from t = 20 s.
  // Backlog = (500 - 200) x 5 = 1,500. Drain rate = 200 - 100 = 100 per second, so it empties 15 s after the spike: t = 40 s.
  const out = runEngine(
    pattern(
      'w11',
      {
        pattern: 'spike',
        baseRps: 100,
        spike: { spikeTime: 20_000, spikeRps: 500, spikeDuration: 5000 }
      },
      { service: 10, durationMs: 80_000, perRequestMemMb: 4 }
    )
  )
  expect(relErr(out.perNode.srv.peakQueueLength, 1500)).toBeLessThan(0.1)
  // First window after the spike where the 95th percentile is back near the unloaded 10 ms service time.
  const recovered = out.summary.latencyWindows.find(
    (w) => w.windowStartMs >= 26_000 && (w.p95 ?? Infinity) < 30
  )
  expect(recovered).toBeDefined()
  expect(Math.abs(recovered!.windowStartMs / 1000 - 40)).toBeLessThan(3)
})

test.describe('what the user sees (ch05 sections 2 and 6)', () => {
  test('W-12 the results show the pattern, and the arrival CV matches the pattern', async ({
    page
  }) => {
    for (const [name, workload, cvCheck] of [
      [
        'constant',
        { pattern: 'constant', baseRps: 100 },
        (cv: number) => expect(cv).toBeLessThan(0.01)
      ],
      [
        'poisson',
        { pattern: 'poisson', baseRps: 100 },
        (cv: number) => expect(Math.abs(cv - 1)).toBeLessThan(0.06)
      ],
      [
        'bursty',
        {
          pattern: 'bursty',
          baseRps: 50,
          bursty: { burstRps: 400, burstDuration: 1000, normalDuration: 3000 }
        },
        (cv: number) => expect(cv).toBeGreaterThan(1)
      ]
    ] as const) {
      await openApp(page)
      await importTopology(page, pattern(`w12-${name}`, workload as Partial<WorkloadProfile>))
      await runAndWait(page)
      const text = await bodyText(page)
      expect(text, name).toMatch(new RegExp(`Pattern\\s*\\n${name}`))
      const cv = Number(text.match(/Offered Arrival CV\s*\n([\d.]+)/)![1])
      cvCheck(cv)
    }
  })

  test('W-13 a spike run reports the right number of requests', async ({ page }) => {
    await openApp(page)
    await importTopology(
      page,
      pattern('w13', {
        pattern: 'spike',
        baseRps: 100,
        spike: { spikeTime: 20_000, spikeRps: 500, spikeDuration: 5000 }
      })
    )
    await runAndWait(page)
    const text = await bodyText(page)
    const m = text.match(/Requests \(post-warmup\)\s*\n([\d,]+)/)
    expect(Number(m![1].replace(/,/g, ''))).toBeGreaterThan(7900)
    expect(Number(m![1].replace(/,/g, ''))).toBeLessThanOrEqual(8000)
  })
})

// Tracked gap from chapter 05 section 8 (decision B4, in progress): `fixme` documents it without running.
test.fixme('W-14 closed population: N users with think time Z; R = N / X - Z holds (ch05 section 3)', () => {
  // The simulator has only open sources. A closed source needs a user count and a think time.
})

// Decision B5 (added): `trace` carries the recorded arrivals of a `replay` workload.
test('W-15 replay: a recorded trace is re-issued at exactly its recorded times (ch05 section 2.7)', () => {
  const out = runEngine(
    pattern('w15', {
      pattern: 'replay',
      baseRps: 1,
      trace: [{ atMs: 1000 }, { atMs: 1500 }, { atMs: 1501 }, { atMs: 9000 }, { atMs: 30_000 }]
    })
  )
  expect(out.summary.totalRequests).toBe(5)
  // Windows with no arrivals are not reported, so read each window's start (ms) and its count.
  const windows = out.summary.latencyWindows.map(
    (w) => [w.windowStartMs, w.successCount + w.errorCount] as const
  )
  expect(windows).toEqual([
    [1000, 3], // 1000, 1500 and 1501 ms
    [9000, 1],
    [30_000, 1]
  ])
})
