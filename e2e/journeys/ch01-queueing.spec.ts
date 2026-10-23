/**
 * Chapter 01: queueing and performance math (docs/reference/01-queueing-and-performance.md).
 * Expected values come from e2e/support/oracles.ts (the chapter's formulas), never from engine output.
 *
 * Each flow checks up to three things:
 *   THEORY  engine result against the closed form, with a stated tolerance
 *   UI      what the user sees against the same closed form
 *   PARITY  UI against the engine for the identical document
 */
import { expect, test } from '../support/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { erlangC, kingmanWqSec, md1WqSec, mm1WSec, mmc, mmcK, relErr } from '../support/oracles'
import { runSimulation } from '../../src/engine/runSimulation'
import { quickcart } from '../support/quickcart'
import { instanceServer, type RunSpec } from '../support/topology'

// m5.large cpu-bound: c = 2 workers, service time unchanged (perfFactor 1.0).
const C = 2
const MEAN_MS = 20
const MU = 1000 / MEAN_MS // 50 per second per server
const EXP_SERVICE = { type: 'exponential', lambda: 1 / MEAN_MS } as const // lambda is per ms

function run(over: Partial<RunSpec> & { rps: number; seed: string }): RunSpec {
  return {
    name: `ch01-${over.seed}`,
    pattern: 'poisson',
    durationMs: 600_000,
    warmupMs: 30_000,
    ...over
  }
}

test.describe('Q-01 M/M/2 at rho 0.6 matches Erlang C (ch01 5.1)', () => {
  const lambda = 60
  const theory = mmc(lambda, MU, C) // wq 11.25 ms, w 31.25 ms, L 1.875, rho 0.6
  const topology = instanceServer(run({ rps: lambda, seed: 'q01' }), { service: EXP_SERVICE })

  test('THEORY engine agrees with the closed form', () => {
    const out = runEngine(topology)
    const n = out.perNode.srv
    expect(relErr(n.utilization, theory.rho)).toBeLessThan(0.04)
    expect(relErr(n.avgQueueWait, theory.wqSec * 1000)).toBeLessThan(0.15)
    expect(relErr(n.avgTimeInSystem, theory.wSec * 1000)).toBeLessThan(0.08)
    expect(relErr(n.postWarmupAvgInSystem, theory.l)).toBeLessThan(0.1)
    expect(relErr(out.summary.throughput, lambda)).toBeLessThan(0.02)
    expect(out.summary.errorRate).toBe(0)
    expect(out.littlesLawCheck.find((c) => c.nodeId === 'srv')?.withinTolerance).toBe(true)
  })

  test('UI shows the same numbers the engine produces', async ({ page }) => {
    const out = runEngine(topology)
    await openApp(page)
    await importTopology(page, topology)
    await runAndWait(page)
    const ui = await readUiRun(page)
    expect(relErr(ui.throughput, lambda)).toBeLessThan(0.02)
    expect(ui.errorRatePct).toBe(0)
    expect(Math.abs(ui.utilPct / 100 - theory.rho)).toBeLessThan(0.03)
    expect(relErr(ui.p50, out.summary.latency.p50)).toBeLessThan(0.05)
    expect(relErr(ui.p99, out.summary.latency.p99)).toBeLessThan(0.05)
    expect(ui.littlesLaw).toMatch(/Within tolerance/i)
    expect(ui.conservation).toMatch(/Balanced/i)
  })
})

test('Q-02 same seed reproduces exactly; a different seed differs but keeps the same mean (ch01 9)', () => {
  const a = runEngine(
    instanceServer(run({ rps: 60, seed: 'q02a', durationMs: 120_000 }), { service: EXP_SERVICE })
  )
  const a2 = runEngine(
    instanceServer(run({ rps: 60, seed: 'q02a', durationMs: 120_000 }), { service: EXP_SERVICE })
  )
  const b = runEngine(
    instanceServer(run({ rps: 60, seed: 'q02b', durationMs: 120_000 }), { service: EXP_SERVICE })
  )
  expect(a2.summary.latency.mean).toBe(a.summary.latency.mean)
  expect(a2.summary.totalRequests).toBe(a.summary.totalRequests)
  expect(b.summary.latency.mean).not.toBe(a.summary.latency.mean)
  expect(relErr(b.summary.latency.mean, a.summary.latency.mean)).toBeLessThan(0.15)
})

test('Q-03 hockey stick: time in system follows 1/(1 - rho) and Erlang C at rho .3, .6, .85 (ch01 4.1)', () => {
  const measured: number[] = []
  for (const lambda of [30, 60, 85]) {
    const out = runEngine(
      instanceServer(run({ rps: lambda, seed: `q03-${lambda}`, durationMs: 900_000 }), {
        service: EXP_SERVICE
      })
    )
    const expected = mmc(lambda, MU, C).wSec * 1000
    const w = out.perNode.srv.avgTimeInSystem
    expect(relErr(w, expected), `lambda ${lambda}: measured ${w}, theory ${expected}`).toBeLessThan(
      0.15
    )
    measured.push(w)
  }
  expect(measured[0]).toBeLessThan(measured[1])
  expect(measured[1]).toBeLessThan(measured[2])
})

test('Q-04 overload with a deep buffer: throughput is capped at c/S, utilization pins near 1, work times out (ch01 2)', () => {
  const lambda = 150 // offered; capacity is c * mu = 100
  const out = runEngine(
    instanceServer(
      run({ rps: lambda, seed: 'q04', durationMs: 120_000, warmupMs: 10_000, timeoutMs: 1000 }),
      {
        service: EXP_SERVICE,
        timeoutMs: 1000
      }
    )
  )
  expect(out.summary.throughput).toBeLessThanOrEqual(C * MU * 1.03)
  expect(out.perNode.srv.utilization).toBeGreaterThan(0.95)
  expect(out.summary.errorRate).toBeGreaterThan(0.2)
})

test.describe('Q-05 overloaded finite node M/M/2/4: blocking, admitted rate and Little hold (ch01 5.3)', () => {
  // K = floor(8192 MB / 2048 MB) = 4. Offered 150/s against capacity 100/s: A = 3.
  const lambda = 150
  const theory = mmcK(lambda, MU, C, 4)
  const topology = instanceServer(run({ rps: lambda, seed: 'q05', durationMs: 600_000 }), {
    service: EXP_SERVICE,
    perRequestMemMb: 2048
  })

  test('THEORY rejected share, admitted rate, L and utilization match; no false Little warning', () => {
    const out = runEngine(topology)
    const n = out.perNode.srv
    const rejectedShare = n.postWarmupRejected / n.postWarmupArrived
    expect(Math.abs(rejectedShare - theory.blocking)).toBeLessThan(0.03)
    expect(relErr(out.summary.throughput, theory.lambdaEff)).toBeLessThan(0.04)
    expect(relErr(n.postWarmupAvgInSystem, theory.l)).toBeLessThan(0.08)
    expect(Math.abs(n.utilization - theory.utilization)).toBeLessThan(0.03)
    // The consistent-overload regression: lambda in Little's Law is the ADMITTED rate.
    expect(out.littlesLawCheck.find((c) => c.nodeId === 'srv')?.withinTolerance).toBe(true)
    // Conservation: offered = admitted + rejected (nothing lost).
    expect(out.conservationCheck.every((c) => c.balanced ?? true)).toBe(true)
  })

  test('UI shows throughput near the admitted rate and no Little warning', async ({ page }) => {
    await openApp(page)
    await importTopology(page, topology)
    await runAndWait(page)
    const ui = await readUiRun(page)
    expect(relErr(ui.throughput, theory.lambdaEff)).toBeLessThan(0.05)
    expect(ui.littlesLaw).toMatch(/Within tolerance/i)
    expect(ui.conservation).toMatch(/Balanced/i)
  })
})

test('Q-06 utilization law: U = X * S / c (ch01 2)', () => {
  const out = runEngine(instanceServer(run({ rps: 70, seed: 'q06' }), { service: EXP_SERVICE }))
  const expectedU = (out.summary.throughput * (MEAN_MS / 1000)) / C
  expect(relErr(out.perNode.srv.utilization, expectedU)).toBeLessThan(0.03)
})

test('Q-07 variability: constant service waits about half as long as exponential at the same rho (ch01 4.2, 4.3)', () => {
  const lambda = 70
  const exp = runEngine(
    instanceServer(run({ rps: lambda, seed: 'q07e', durationMs: 900_000 }), {
      service: EXP_SERVICE
    })
  )
  const det = runEngine(
    instanceServer(run({ rps: lambda, seed: 'q07d', durationMs: 900_000 }), {
      service: { type: 'constant', value: MEAN_MS }
    })
  )
  const ratio = det.perNode.srv.avgQueueWait / exp.perNode.srv.avgQueueWait
  // Kingman / Pollaczek-Khinchine: factor (ca2 + cs2) / 2 goes from 1 to 0.5. Approximate for c = 2.
  expect(ratio).toBeGreaterThan(0.35)
  expect(ratio).toBeLessThan(0.7)
})

test('Q-08 single-server closed forms used in the chapter: M/D/1 20 ms and M/M/1 hockey stick (ch01 4)', () => {
  // Pure formula check kept next to the flows so a chapter edit and an oracle edit stay in step.
  expect(md1WqSec(80, 0.01) * 1000).toBeCloseTo(20, 6)
  expect(kingmanWqSec(0.8, 1, 0, 0.01) * 1000).toBeCloseTo(20, 6)
  expect(mm1WSec(80, 100) / 0.01).toBeCloseTo(5, 9)
  expect(erlangC(1, 0.8)).toBeCloseTo(0.8, 9) // c = 1: P(wait) = rho
})

test.describe('Q-09 QuickCart sizing: 1M req/s at 100k per server (ch01 8)', () => {
  const PER = 100_000
  const cases = [
    { n: 8, util: 1_000_000 / (8 * PER), loss: 0.2, pass: false },
    { n: 12, util: 1_000_000 / (12 * PER), loss: 0, pass: false },
    { n: 13, util: 1_000_000 / (13 * PER), loss: 0, pass: true },
    { n: 14, util: 1_000_000 / (14 * PER), loss: 0, pass: true }
  ]
  for (const c of cases) {
    test(`${c.n} servers: per-server load ${(c.util * 100).toFixed(1)}%${c.pass ? ' (within 0.8 headroom)' : ' (over headroom or drops)'}`, () => {
      const out = runSimulation(quickcart(c.n))
      const servers = Object.entries(out.perNode).filter(([id]) => id.startsWith('srv-'))
      expect(servers.length).toBe(c.n)
      const maxUtil = Math.max(...servers.map(([, m]) => m.utilization))
      // Over 100% the node saturates; the chapter says 125% for 8 servers. Compare the offered ratio
      // when the engine reports it, otherwise at least the saturated value.
      expect(c.util > 1 ? maxUtil >= 0.99 : relErr(maxUtil, c.util) < 0.02).toBe(true)
      expect(Math.abs(out.summary.errorRate - c.loss)).toBeLessThan(0.02)
      expect(maxUtil <= 0.8).toBe(c.pass)
    })
  }
})
