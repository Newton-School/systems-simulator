/**
 * Chapter 03: probability and distributions (docs/reference/03-probability-and-distributions.md).
 * Expected moments and percentiles come from the formulas in e2e/support/oracles.ts (the `dist` table),
 * never from engine output. Samples are drawn with a seeded generator, the way a node draws service times.
 *
 * Tolerances: a mean is allowed 4 standard errors (4 sd / sqrt(N)); a standard deviation 3%; a quantile 2%
 * (5% for heavy tails and for p99.9, which rests on about 200 samples).
 */
import { expect, test } from '@playwright/test'
import type { DistributionConfig } from '../../src/engine/core/types'
import { clampedNormalMean, dist, mg1WqSec, relErr, Z, type Moments } from '../support/oracles'
import { sample } from '../support/sampling'
import { mean, quantile, sd } from '../support/stats'
import { runEngine } from '../support/engine'
import { singleServer } from '../support/topology'

const N = 200_000

interface Case {
  id: string
  name: string
  config: DistributionConfig
  theory: Moments
  /** Quantile checks: p and the expected value. */
  quantiles?: [number, number][]
  /** Heavy tail: do not test the sample mean or sd, only the quantiles. */
  heavyTail?: boolean
}

const MU20 = Math.log(20)

const CASES: Case[] = [
  {
    id: 'D-01',
    name: 'uniform 10..30',
    config: { type: 'uniform', min: 10, max: 30 },
    theory: dist.uniform(10, 30),
    quantiles: [[0.99, 29.8]]
  },
  {
    id: 'D-02',
    name: 'exponential, mean 20 ms (lambda 0.05 per ms)',
    config: { type: 'exponential', lambda: 0.05 },
    theory: dist.exponential(20),
    quantiles: [
      [0.5, dist.expQuantile(20, 0.5)],
      [0.95, dist.expQuantile(20, 0.95)],
      [0.99, dist.expQuantile(20, 0.99)],
      [0.999, dist.expQuantile(20, 0.999)]
    ]
  },
  {
    id: 'D-03',
    name: 'normal mean 20 sd 5',
    config: { type: 'normal', mean: 20, stdDev: 5 },
    theory: { mean: 20, sd: 5 },
    quantiles: [
      [0.5, 20],
      [0.99, dist.normalQuantile(20, 5, Z.p99)]
    ]
  },
  {
    id: 'D-04',
    name: 'log-normal median 20 ms, sigma 0.5',
    config: { type: 'log-normal', mu: MU20, sigma: 0.5 },
    theory: dist.logNormal(MU20, 0.5),
    quantiles: [
      [0.5, 20],
      [0.95, dist.logNormalQuantile(MU20, 0.5, Z.p95)],
      [0.99, dist.logNormalQuantile(MU20, 0.5, Z.p99)],
      [0.999, dist.logNormalQuantile(MU20, 0.5, Z.p999)]
    ]
  },
  {
    id: 'D-05',
    name: 'gamma shape 4 scale 5 (Erlang, CV 0.5)',
    config: { type: 'gamma', shape: 4, scale: 5 },
    theory: dist.gamma(4, 5)
  },
  {
    id: 'D-06',
    name: 'Weibull shape 2 scale 20',
    config: { type: 'weibull', shape: 2, scale: 20 },
    theory: dist.weibull(2, 20),
    quantiles: [
      [0.5, dist.weibullQuantile(2, 20, 0.5)],
      [0.99, dist.weibullQuantile(2, 20, 0.99)]
    ]
  },
  {
    id: 'D-07',
    name: 'Pareto alpha 2.5, x_m 10 (fields shape=alpha, scale=x_m)',
    config: { type: 'pareto', shape: 2.5, scale: 10 },
    theory: dist.pareto(2.5, 10),
    heavyTail: true,
    quantiles: [
      [0.5, dist.paretoQuantile(2.5, 10, 0.5)],
      [0.99, dist.paretoQuantile(2.5, 10, 0.99)],
      [0.999, dist.paretoQuantile(2.5, 10, 0.999)]
    ]
  },
  {
    id: 'D-08',
    name: 'Poisson count, mean 10',
    config: { type: 'poisson', lambda: 10 },
    theory: dist.poisson(10)
  },
  {
    id: 'D-09',
    name: 'binomial n 10, p 0.3',
    config: { type: 'binomial', n: 10, p: 0.3 },
    theory: dist.binomial(10, 0.3)
  },
  {
    id: 'D-10',
    name: 'beta(2, 5)',
    config: { type: 'beta', alpha: 2, beta: 5 },
    theory: dist.beta(2, 5)
  },
  {
    id: 'D-11',
    name: 'mixture 90% constant 1 ms, 10% constant 50 ms',
    config: {
      type: 'mixture',
      components: [
        { weight: 0.9, distribution: { type: 'constant', value: 1 } },
        { weight: 0.1, distribution: { type: 'constant', value: 50 } }
      ]
    },
    theory: dist.mixture([
      { w: 0.9, mean: 1, sd: 0 },
      { w: 0.1, mean: 50, sd: 0 }
    ]),
    quantiles: [
      [0.5, 1],
      [0.99, 50]
    ]
  }
]

test.describe('moments and percentiles match the chapter formulas (ch03 section 3)', () => {
  for (const c of CASES) {
    test(`${c.id} ${c.name}`, () => {
      const xs = sample(c.config, N, `ch03-${c.id}`)
      if (!c.heavyTail) {
        const tolMean = (4 * c.theory.sd) / Math.sqrt(N)
        expect(Math.abs(mean(xs) - c.theory.mean)).toBeLessThan(tolMean)
        expect(relErr(sd(xs), c.theory.sd)).toBeLessThan(0.03)
      }
      for (const [p, expected] of c.quantiles ?? []) {
        // p99.9 rests on only N x 0.001 = 200 tail samples, so it carries a wider tolerance.
        const tol = c.heavyTail || p >= 0.999 ? 0.05 : 0.02
        expect(relErr(quantile(xs, p), expected), `p${p * 100}`).toBeLessThan(tol)
      }
    })
  }
})

test.describe('shape facts the chapter states', () => {
  test('D-12 CV: exponential 1, gamma 1/sqrt(k), log-normal sqrt(exp(sigma^2) - 1), constant 0 (ch03 section 1)', () => {
    const cv = (config: DistributionConfig) => {
      const xs = sample(config, N, 'ch03-cv')
      return sd(xs) / mean(xs)
    }
    expect(cv({ type: 'exponential', lambda: 0.05 })).toBeCloseTo(1, 1)
    for (const k of [1, 2, 4, 16]) {
      expect(
        Math.abs(cv({ type: 'gamma', shape: k, scale: 20 / k }) - 1 / Math.sqrt(k))
      ).toBeLessThan(0.02)
    }
    expect(
      Math.abs(cv({ type: 'log-normal', mu: MU20, sigma: 0.5 }) - dist.logNormalCv(0.5))
    ).toBeLessThan(0.02)
    expect(cv({ type: 'constant', value: 7 })).toBe(0)
  })

  test('D-13 Weibull with shape 1 is exponential with rate 1/scale (ch03 section 3.9)', () => {
    const w = sample({ type: 'weibull', shape: 1, scale: 20 }, N, 'ch03-w1')
    expect(relErr(mean(w), 20)).toBeLessThan(0.02)
    expect(relErr(sd(w), 20)).toBeLessThan(0.03)
    expect(relErr(quantile(w, 0.99), dist.expQuantile(20, 0.99))).toBeLessThan(0.03)
  })

  test('D-14 memorylessness: given a draw already exceeds s, the excess has the original distribution (ch03 section 3.3)', () => {
    const xs = sample({ type: 'exponential', lambda: 0.05 }, N, 'ch03-memoryless')
    const s = 30
    const excess = xs.filter((x) => x > s).map((x) => x - s)
    expect(excess.length).toBeGreaterThan(10_000)
    expect(relErr(mean(excess), 20)).toBeLessThan(0.04)
  })

  test('D-15 Pareto never goes below x_m and its tail is a power law: P(X > 2x) / P(X > x) = 2^-alpha (ch03 section 3.10)', () => {
    const xs = sample({ type: 'pareto', shape: 2.5, scale: 10 }, N, 'ch03-pareto')
    expect(xs.reduce((a, b) => Math.min(a, b), Infinity)).toBeGreaterThanOrEqual(10)
    const tail = (x: number) => xs.filter((v) => v > x).length / xs.length
    expect(relErr(tail(40) / tail(20), 2 ** -2.5)).toBeLessThan(0.1)
  })

  test('D-16 draw bounds: uniform inside [min, max], beta inside [0, 1], Poisson and binomial integers (ch03 section 3)', () => {
    const u = sample({ type: 'uniform', min: 10, max: 30 }, 50_000, 'ch03-b1')
    expect(Math.min(...u)).toBeGreaterThanOrEqual(10)
    expect(Math.max(...u)).toBeLessThanOrEqual(30)
    const b = sample({ type: 'beta', alpha: 2, beta: 5 }, 50_000, 'ch03-b2')
    expect(Math.min(...b)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...b)).toBeLessThanOrEqual(1)
    for (const cfg of [
      { type: 'poisson', lambda: 10 },
      { type: 'binomial', n: 10, p: 0.3 }
    ] as const) {
      expect(sample(cfg, 20_000, 'ch03-b3').every(Number.isInteger)).toBe(true)
    }
    expect(
      Math.max(...sample({ type: 'binomial', n: 10, p: 0.3 }, 20_000, 'ch03-b4'))
    ).toBeLessThanOrEqual(10)
  })

  test('D-17 mixture: 90% of draws come from the fast mode, and the mean is not a value anything takes (ch03 section 3.12)', () => {
    const xs = sample(CASES.find((c) => c.id === 'D-11')!.config, N, 'ch03-mix')
    const fast = xs.filter((x) => x === 1).length / N
    expect(Math.abs(fast - 0.9)).toBeLessThan(0.005)
    expect(xs.filter((x) => Math.abs(x - 5.9) < 1).length).toBe(0)
  })

  test('D-18 empirical: step draws only recorded values; linear stays inside their range (ch03 section 3.13)', () => {
    const samples = [10, 20, 30, 40]
    const step = sample({ type: 'empirical', samples, interpolation: 'step' }, 50_000, 'ch03-e1')
    expect(step.every((x) => samples.includes(x))).toBe(true)
    expect(Math.abs(mean(step) - 25)).toBeLessThan(0.3)
    const linear = sample(
      { type: 'empirical', samples, interpolation: 'linear' },
      50_000,
      'ch03-e2'
    )
    expect(Math.min(...linear)).toBeGreaterThanOrEqual(10)
    expect(Math.max(...linear)).toBeLessThanOrEqual(40)
    expect(linear.some((x) => !samples.includes(x))).toBe(true)
  })

  test('D-19 mixture weights that do not sum to 1 are normalised by the total (documents the current rule; ch03 section 3.12 is open)', () => {
    const cfg = (a: number, b: number): DistributionConfig => ({
      type: 'mixture',
      components: [
        { weight: a, distribution: { type: 'constant', value: 1 } },
        { weight: b, distribution: { type: 'constant', value: 50 } }
      ]
    })
    const normalised = sample(cfg(9, 1), N, 'ch03-w')
    expect(Math.abs(normalised.filter((x) => x === 1).length / N - 0.9)).toBeLessThan(0.005)
  })
})

test.describe('seeding (ch03 section 2)', () => {
  test('D-20 same seed gives the identical stream; another seed differs with the same mean', () => {
    const cfg: DistributionConfig = { type: 'log-normal', mu: MU20, sigma: 0.5 }
    const a = sample(cfg, 20_000, 'seed-a')
    expect(sample(cfg, 20_000, 'seed-a')).toEqual(a)
    const b = sample(cfg, 20_000, 'seed-b')
    expect(b).not.toEqual(a)
    expect(relErr(mean(b), mean(a))).toBeLessThan(0.03)
  })
})

test.describe('what a node does with a draw', () => {
  const lowLoad = (service: DistributionConfig, seed: string) =>
    singleServer(
      { name: seed, rps: 20, pattern: 'poisson', durationMs: 600_000, warmupMs: 10_000, seed },
      { serviceMs: 1, extra: { processing: { distribution: service, timeout: 600_000 } } }
    )

  test('D-21 a negative normal draw is clamped to 0, so the realised mean is E[max(X, 0)] (ch03 section 3.4)', () => {
    // mean 20, sd 10: 2.3% of draws are negative. The clamped mean is 20.08, not 20.
    const out = runEngine(lowLoad({ type: 'normal', mean: 20, stdDev: 10 }, 'ch03-clamp'))
    const expected = clampedNormalMean(20, 10)
    expect(expected).toBeGreaterThan(20.05)
    expect(relErr(out.perNode.srv.avgServiceTime, expected)).toBeLessThan(0.01)
  })

  test('D-22 variability drives waiting: M/G/1 wait = rho/(1 - rho) x (1 + c_s^2)/2 x S for four service shapes (ch01 4.2, ch03 section 4)', () => {
    // Same mean service time (10 ms) and Poisson arrivals at 70/s (rho 0.7), different shapes.
    const lambda = 70
    const mix = dist.mixture([
      { w: 0.9, mean: 5.5, sd: 0 },
      { w: 0.1, mean: 50.5, sd: 0 }
    ])
    expect(mix.mean).toBeCloseTo(10, 6)
    const shapes: { name: string; service: DistributionConfig; cs2: number }[] = [
      { name: 'constant', service: { type: 'constant', value: 10 }, cs2: 0 },
      { name: 'gamma k=4', service: { type: 'gamma', shape: 4, scale: 2.5 }, cs2: 0.25 },
      { name: 'exponential', service: { type: 'exponential', lambda: 0.1 }, cs2: 1 },
      {
        name: 'mixture 90/10',
        service: {
          type: 'mixture',
          components: [
            { weight: 0.9, distribution: { type: 'constant', value: 5.5 } },
            { weight: 0.1, distribution: { type: 'constant', value: 50.5 } }
          ]
        },
        cs2: (mix.sd / mix.mean) ** 2
      }
    ]
    const waits: number[] = []
    for (const s of shapes) {
      const out = runEngine(
        singleServer(
          {
            name: s.name,
            rps: lambda,
            pattern: 'poisson',
            durationMs: 1_200_000,
            warmupMs: 30_000,
            seed: `ch03-pk-${s.name}`
          },
          { serviceMs: 1, extra: { processing: { distribution: s.service, timeout: 600_000 } } }
        )
      )
      const wq = out.perNode.srv.avgQueueWait
      const expected = mg1WqSec(lambda, 0.01, s.cs2) * 1000
      expect(
        relErr(wq, expected),
        `${s.name}: ${wq.toFixed(2)} ms vs ${expected.toFixed(2)} ms`
      ).toBeLessThan(0.12)
      waits.push(wq)
    }
    // Strictly ordered by variability.
    for (let i = 1; i < waits.length; i += 1) expect(waits[i]).toBeGreaterThan(waits[i - 1])
  })
})
