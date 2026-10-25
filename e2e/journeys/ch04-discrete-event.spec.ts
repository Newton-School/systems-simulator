/**
 * Chapter 04: discrete-event simulation (docs/reference/04-discrete-event-simulation.md).
 * Checks the properties that make one run trustworthy: ordering, determinism, warmup, replication
 * statistics, the discrete and analytic paths agreeing, and the stop conditions. Expected values come
 * from the chapter and chapter 01 formulas, never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, bodyText, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { mm1WSec, mmc, relErr } from '../support/oracles'
import { confidenceInterval95, mean, sd } from '../support/stats'
import { runSimulation } from '../../src/engine/runSimulation'
import { instanceServer, singleServer, type RunSpec } from '../support/topology'

const EXP20 = { type: 'exponential', lambda: 1 / 20 } as const

function spec(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 60,
    pattern: 'poisson',
    durationMs: 20_000,
    warmupMs: 2000,
    seed,
    ...over
  }
}

test('E-01 events run in time order and sequence numbers only grow (ch04 section 1)', () => {
  const out = runEngine(instanceServer(spec('e01'), { service: EXP20 }))
  expect(out.eventsProcessed).toBeGreaterThan(1000)
  // Timestamps arrive as decimal strings (microseconds); compare them as integers, not text.
  let lastTime = -1n
  let lastSeq = -1
  for (const e of out.eventStream) {
    const at = BigInt(e.timestampUs as unknown as string)
    expect(at >= lastTime).toBe(true)
    expect(e.sequence).toBeGreaterThan(lastSeq)
    lastTime = at
    lastSeq = e.sequence
  }
})

test('E-02 events grow with load: roughly proportional to arrivals x hops (ch04 section 1)', () => {
  const run = (rps: number) =>
    runEngine(
      instanceServer(spec(`e02-${rps}`, { rps, pattern: 'constant', warmupMs: 0 }), {
        service: { type: 'constant', value: 5 }
      })
    )
  const low = run(50)
  const high = run(200)
  // 4x the arrivals gives about 4x the events.
  expect(relErr(high.eventsProcessed / low.eventsProcessed, 4)).toBeLessThan(0.1)
})

test.describe('E-03 initialisation bias: a short run from empty reads low; a long run after warmup converges (ch04 section 5)', () => {
  // M/M/1 at rho 0.9: Wq = rho / (mu - lambda) = 0.9 / 10 = 90 ms. Raw one-worker queue.
  const wqTheory = 90
  const topology = (seed: string, durationMs: number, warmupMs: number) =>
    singleServer(
      { name: seed, rps: 90, pattern: 'poisson', durationMs, warmupMs, seed },
      {
        serviceMs: 1,
        extra: {
          processing: { distribution: { type: 'exponential', lambda: 0.1 }, timeout: 600_000 }
        }
      }
    )

  // Independent reference, not engine output: a separate Monte-Carlo of the same M/M/1 (20,000 replications of
  // the first 5 s from empty at lambda 90, mu 100) gives a mean wait of 71.9 ms for requests arriving in that
  // window, against 90 ms in steady state. The bias is real, about 20%, but milder than first intuition says.
  // A single 5 s run is very noisy (sd about 40 ms), so the check uses 300 replications and a standard error.
  const wqFromEmpty5s = 71.9

  test('THEORY the first 5 seconds from empty read about 20% below steady state', () => {
    const waits = Array.from(
      { length: 300 },
      (_, i) => runEngine(topology(`e03s-${i}`, 5000, 0)).perNode.srv.avgQueueWait
    )
    const se = sd(waits) / Math.sqrt(waits.length)
    expect(mean(waits)).toBeLessThan(wqTheory - 5 * se)
    expect(Math.abs(mean(waits) - wqFromEmpty5s)).toBeLessThan(3 * se + 0.5)
  })

  test('THEORY a long run with warmup is close to the closed form', () => {
    const waits = Array.from(
      { length: 4 },
      (_, i) => runEngine(topology(`e03l-${i}`, 1_200_000, 60_000)).perNode.srv.avgQueueWait
    )
    expect(relErr(mean(waits), wqTheory)).toBeLessThan(0.15)
  })
})

test('E-04 thirty replications: the 95% interval contains the Erlang C answer and is narrow enough to use (ch04 section 6)', () => {
  // Thirty replications, not ten: a 95% interval misses the truth one time in twenty, which a fixed-seed
  // test would turn into a coin flip about which seed prefix was picked.
  const theory = mmc(60, 50, 2).wqSec * 1000 // 11.25 ms
  const waits = Array.from(
    { length: 30 },
    (_, i) =>
      runEngine(
        instanceServer(spec(`e04-${i}`, { durationMs: 300_000, warmupMs: 30_000 }), {
          service: EXP20
        })
      ).perNode.srv.avgQueueWait
  )
  const ci = confidenceInterval95(waits)
  expect(Math.abs(ci.mean - theory)).toBeLessThanOrEqual(ci.halfWidth)
  expect(ci.halfWidth / ci.mean).toBeLessThan(0.05)
})

test('E-05 the spread across seeds is real sampling noise: one run is one sample (ch04 section 3)', () => {
  const waits = Array.from(
    { length: 8 },
    (_, i) =>
      runEngine(
        instanceServer(spec(`e05-${i}`, { durationMs: 120_000, warmupMs: 10_000 }), {
          service: EXP20
        })
      ).perNode.srv.avgQueueWait
  )
  expect(new Set(waits).size).toBe(waits.length)
  expect(sd(waits)).toBeGreaterThan(0)
})

test('E-06 discrete and analytic evaluation agree where both apply (ch04 section 8)', () => {
  const topology = instanceServer(spec('e06', { durationMs: 60_000, warmupMs: 5000 }), {
    service: { type: 'constant', value: 20 }
  })
  const discrete = runSimulation(structuredClone(topology), { mode: 'discrete' })
  const analytic = runSimulation(structuredClone(topology), { mode: 'analytic' })
  // Analytic is exact arithmetic: rho = lambda / (c mu) = 60 / (2 x 50) = 0.6.
  expect(analytic.perNode.srv.utilization).toBeCloseTo(0.6, 6)
  expect(analytic.summary.throughput).toBeCloseTo(60, 6)
  expect(Math.abs(discrete.perNode.srv.utilization - 0.6)).toBeLessThan(0.04)
  expect(relErr(discrete.summary.throughput, analytic.summary.throughput)).toBeLessThan(0.05)
})

test('E-07 above the event ceiling the run switches to the analytic model and says so (ch04 section 8)', () => {
  const topology = instanceServer(
    spec('e07', { rps: 1_000_000, pattern: 'constant', durationMs: 5000, warmupMs: 0 }),
    {
      service: { type: 'constant', value: 0.01 },
      instanceType: 'm5.large'
    }
  )
  const started = Date.now()
  const out = runSimulation(topology)
  expect(Date.now() - started).toBeLessThan(3000)
  expect(out.summary.throughput).toBeGreaterThan(0)
  // Offered 1M req/s; capacity is 2 / 0.00001 s = 200,000 req/s, so the node is saturated and sheds the rest.
  expect(out.perNode.srv.utilization).toBeGreaterThanOrEqual(1)
})

test.describe('stop conditions (ch04 section 9)', () => {
  test('E-08 duration: the measured window is duration minus warmup and excludes warmup arrivals', () => {
    const out = runEngine(
      instanceServer(
        spec('e08', { rps: 100, pattern: 'constant', durationMs: 20_000, warmupMs: 2000 }),
        { service: { type: 'constant', value: 5 } }
      )
    )
    expect(out.summary.postWarmupDurationSec).toBe(18)
    expect(out.summary.postWarmupTotalRequests).toBe(1800)
    expect(out.summary.totalRequests).toBe(2000)
    expect(out.stopReason).toBe('duration')
  })

  test('E-09 request budget: exactly N source requests, then the run drains with nothing in flight', () => {
    const t = instanceServer(
      spec('e09', { rps: 100, pattern: 'constant', durationMs: 60_000, warmupMs: 0 }),
      { service: { type: 'constant', value: 5 } }
    )
    t.workload!.stopCondition = { mode: 'requestBudget', maxRequests: 500 }
    const out = runEngine(t)
    expect(out.summary.totalRequests).toBe(500)
    expect(out.stopReason).toBe('request-budget')
    expect(out.conservationCheck.every((c) => c.inFlight === 0 && c.balanced)).toBe(true)
  })

  test('E-10 early halt on saturation: the run ends at the first check that finds the node full, not at the end', () => {
    const t = instanceServer(spec('e10', { rps: 300, durationMs: 60_000, warmupMs: 0 }), {
      service: { type: 'constant', value: 20 }
    })
    t.workload!.stopCondition = { mode: 'duration', haltOnSaturation: { utilization: 0.99 } }
    const out = runEngine(t)
    expect(out.stopReason).toBe('saturation')
    expect(out.stoppedAtMs).toBeLessThan(5000)
    const full = runEngine(
      instanceServer(spec('e10b', { rps: 300, durationMs: 10_000, warmupMs: 0 }), {
        service: { type: 'constant', value: 20 }
      })
    )
    expect(full.stopReason).toBe('duration')
  })

  test('E-11 conservation: arrived = processed + rejected + timed out + in flight, at every node, in a stable and an overloaded run', () => {
    const stable = runEngine(instanceServer(spec('e11a'), { service: EXP20 }))
    const overloaded = runEngine(
      instanceServer(spec('e11b', { rps: 150 }), { service: EXP20, perRequestMemMb: 2048 })
    )
    for (const out of [stable, overloaded]) {
      for (const c of out.conservationCheck) {
        expect(c.balanced, c.nodeId).toBe(true)
        expect(c.postWarmupArrived).toBe(
          c.postWarmupProcessed +
            c.postWarmupRejected +
            c.postWarmupTimedOut +
            c.postWarmupConnectionReset +
            c.inFlight
        )
      }
    }
    expect(overloaded.perNode.srv.postWarmupRejected).toBeGreaterThan(0)
  })

  test('E-12 invariants on every run: utilization in [0, 1], no negative waits, Little holds on admitted traffic (ch04 section 7)', () => {
    const out = runEngine(
      instanceServer(spec('e12', { rps: 150 }), { service: EXP20, perRequestMemMb: 2048 })
    )
    for (const n of Object.values(out.perNode)) {
      expect(n.utilization).toBeGreaterThanOrEqual(0)
      expect(n.utilization).toBeLessThanOrEqual(1.0001)
      expect(n.avgQueueWait).toBeGreaterThanOrEqual(0)
      expect(n.avgInSystem).toBeGreaterThanOrEqual(0)
    }
    expect(out.littlesLawCheck.every((c) => c.withinTolerance)).toBe(true)
  })
})

test.describe('common random numbers (ch04 section 3)', () => {
  // Compare c = 2 against c = 4 at lambda 80/s (rho 0.8 vs 0.4). The true difference is fixed, so the spread of
  // the measured difference across repeats is pure sampling noise. Paired seeds should shrink it.
  const diff = (seedA: string, seedB: string) => {
    const base = { durationMs: 200_000, warmupMs: 20_000, rps: 80 }
    const a = runEngine(instanceServer(spec(seedA, base), { service: EXP20 })).perNode.srv
      .avgQueueWait
    const b = runEngine(
      instanceServer(spec(seedB, base), { service: EXP20, instanceType: 'm5.xlarge' })
    ).perNode.srv.avgQueueWait
    return a - b
  }

  // Finding 6 (fixed, decision A4): service times, edge draws, node errors and trait draws come from independent
  // streams per node or edge, so a design with more workers no longer shifts every later draw onto a different
  // request, and pairing seeds does reduce the noise of a comparison (chapter 04 section 3).
  test('E-13 the same seed for both designs gives a tighter comparison than independent seeds', () => {
    const paired = Array.from({ length: 12 }, (_, i) => diff(`crn-${i}`, `crn-${i}`))
    const independent = Array.from({ length: 12 }, (_, i) => diff(`ind-a-${i}`, `ind-b-${i}`))
    // Both estimate the same difference; pairing should reduce the noise (ch04 section 3 is cautious: no guarantee).
    expect(Math.abs(mean(paired) - mean(independent))).toBeLessThan(3 * sd(independent))
    expect(sd(paired)).toBeLessThan(sd(independent))
  })
})

test.describe('what the user sees (ch04 sections 5 and 9)', () => {
  test('E-14 the results window label and arrival CV match the run', async ({ page }) => {
    const topology = instanceServer(spec('e14', { rps: 80, durationMs: 60_000, warmupMs: 5000 }), {
      service: EXP20
    })
    const out = runEngine(topology)
    await openApp(page)
    await importTopology(page, topology)
    await runAndWait(page)
    const text = await bodyText(page)
    const m = text.match(/Window:\s*t=(\d+)s\s*\S+\s*t=(\d+)s\s*\((\d+)s,\s*([\d,]+)\s*requests\)/)
    expect(m, 'results window label').not.toBeNull()
    expect(Number(m![1])).toBe(5)
    expect(Number(m![2])).toBe(60)
    expect(Number(m![3])).toBe(55)
    expect(
      relErr(Number(m![4].replace(/,/g, '')), out.summary.postWarmupTotalRequests)
    ).toBeLessThan(0.02)
    const cv = text.match(/Offered Arrival CV\s*\n([\d.]+)/)
    expect(Math.abs(Number(cv![1]) - out.summary.offeredArrivalCV)).toBeLessThan(0.03)
    expect(text).toMatch(/Seed\s*\n?e14/)
  })
})

test('E-15 M/M/1 sanity used throughout: W = 1/(mu - lambda) at several rho (ch01 4.1)', () => {
  for (const lambda of [50, 80]) {
    const out = runEngine(
      singleServer(
        {
          name: `e15-${lambda}`,
          rps: lambda,
          pattern: 'poisson',
          durationMs: 900_000,
          warmupMs: 60_000,
          seed: `e15-${lambda}`
        },
        {
          serviceMs: 1,
          extra: {
            processing: { distribution: { type: 'exponential', lambda: 0.1 }, timeout: 600_000 }
          }
        }
      )
    )
    expect(relErr(out.perNode.srv.avgTimeInSystem, mm1WSec(lambda, 100) * 1000)).toBeLessThan(0.12)
  }
})
