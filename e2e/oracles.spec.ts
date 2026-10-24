/**
 * The oracles are code, so they get tested against the numbers hand-computed in the reference
 * chapters. If one of these fails the formula or the chapter is wrong, never the simulator.
 */
import { expect, test } from '@playwright/test'
import {
  cheHitRatio,
  erlangC,
  expectedAttempts,
  harmonic,
  maxExpQuantile,
  quorumAvailability,
  writesBeforeFull,
  kingmanWqSec,
  layeredAmplification,
  md1WqSec,
  mm1WSec,
  mmc,
  mmcK,
  serversNeeded,
  survivorLoadFactor,
  tokenBucketBurstSec
} from './support/oracles'

test.describe('oracle self-check against the reference chapters', () => {
  test('ORC-01 M/D/1 at rho 0.8, 10 ms service: Wq = 20 ms (ch01 4.2)', () => {
    expect(md1WqSec(80, 0.01) * 1000).toBeCloseTo(20, 6)
  })

  test('ORC-02 M/M/1: W = 1/(mu - lambda); hockey stick 2x, 5x, 10x, 20x service at rho .5,.8,.9,.95 (ch01 4.1)', () => {
    const mu = 100
    const s = 1 / mu
    for (const [rho, factor] of [
      [0.5, 2],
      [0.8, 5],
      [0.9, 10],
      [0.95, 20]
    ] as const) {
      expect(mm1WSec(rho * mu, mu) / s).toBeCloseTo(factor, 6)
    }
  })

  test('ORC-03 Erlang C c=2 A=1.2 gives 0.45; Wq 11.25 ms; W 31.25 ms; L 1.875 (ch01 5.1)', () => {
    expect(erlangC(2, 1.2)).toBeCloseTo(0.45, 9)
    const r = mmc(60, 50, 2)
    expect(r.wqSec * 1000).toBeCloseTo(11.25, 6)
    expect(r.wSec * 1000).toBeCloseTo(31.25, 6)
    expect(r.l).toBeCloseTo(1.875, 9)
    expect(r.lq).toBeCloseTo(0.675, 9)
  })

  test('ORC-04 M/M/1/K rho 3, K 5: blocking 0.668, admitted 99.7/s, L 4.51, W 45 ms (ch01 5.3)', () => {
    const r = mmcK(300, 100, 1, 5)
    expect(r.blocking).toBeCloseTo(243 / 364, 9)
    expect(r.lambdaEff).toBeCloseTo(99.7, 1)
    expect(r.l).toBeCloseTo(1641 / 364, 9)
    expect(r.wSec * 1000).toBeCloseTo(45.2, 0)
  })

  test('ORC-05 Erlang B limit: c = K reduces to M/M/c/c loss (ch01 5.2/5.3)', () => {
    // A=1, c=K=1: B = A/(1+A) = 0.5
    expect(mmcK(1, 1, 1, 1).blocking).toBeCloseTo(0.5, 9)
  })

  test('ORC-06 Kingman reduces to P-K when ca2 = 1 (ch01 4.3)', () => {
    const rho = 0.8
    const s = 0.01
    const pk = (rho / (1 - rho)) * ((1 + 0) / 2) * s // M/D/1
    expect(kingmanWqSec(rho, 1, 0, s)).toBeCloseTo(pk, 12)
  })

  test('ORC-07 QuickCart sizing: 13 servers; 12 gives 83.3%, 13 gives 76.9% (ch01 8)', () => {
    const per = 128 / 0.00128
    expect(per).toBeCloseTo(100_000, 6)
    expect(serversNeeded(1_000_000, per, 0.8)).toBe(13)
    expect(1_000_000 / (12 * per)).toBeCloseTo(0.8333, 4)
    expect(1_000_000 / (13 * per)).toBeCloseTo(0.7692, 4)
    expect(1_000_000 / (8 * per)).toBeCloseTo(1.25, 6)
    expect(survivorLoadFactor(4, 1) * 0.75).toBeCloseTo(1.0, 9)
  })

  test('ORC-08 retry arithmetic: 1.875x at p .5 r 3; 243x across 5 layers (ch02 2)', () => {
    expect(expectedAttempts(0.5, 3)).toBeCloseTo(1.875, 9)
    expect(expectedAttempts(1, 3)).toBe(4)
    expect(layeredAmplification(3, 5)).toBe(243)
  })

  test('ORC-09 token bucket worked example: C=1, R=10, M=20 gives 0.1 s (ch02 4)', () => {
    expect(tokenBucketBurstSec(1, 20, 10)).toBeCloseTo(0.1, 9)
  })

  test('ORC-10 Che approximation: N=1000, s=1 gives 21.0%, 57.7%, 77.1% at C=10,100,300 (ch10 2.3)', () => {
    expect(cheHitRatio(1000, 1, 10)).toBeCloseTo(0.21, 2)
    expect(cheHitRatio(1000, 1, 100)).toBeCloseTo(0.577, 2)
    expect(cheHitRatio(1000, 1, 300)).toBeCloseTo(0.771, 2)
    expect(cheHitRatio(1000, 0.8, 100)).toBeCloseTo(0.378, 2)
  })

  test('ORC-11 quorum availability: 3 of 5 at p .99 is 0.99999015; 2 of 3 is 0.999702 (ch11 5)', () => {
    expect(quorumAvailability(3, 2, 0.99)).toBeCloseTo(0.999702, 6)
    expect(quorumAvailability(5, 3, 0.99)).toBeCloseTo(0.99999015, 8)
    expect(quorumAvailability(1, 1, 0.99)).toBeCloseTo(0.99, 12)
  })

  test('ORC-12 scatter-gather: H10 = 2.93, H100 = 5.19, H1000 = 7.49; p99 of max at n=100 is 9.2 mu (ch12 7)', () => {
    expect(harmonic(10)).toBeCloseTo(2.93, 2)
    expect(harmonic(100)).toBeCloseTo(5.19, 2)
    expect(harmonic(1000)).toBeCloseTo(7.49, 2)
    expect(maxExpQuantile(1, 100, 0.99)).toBeCloseTo(9.2, 1)
    expect(maxExpQuantile(1, 1, 0.99)).toBeCloseTo(4.6, 1)
  })

  test('ORC-13 a 100 KB store with 1 KB records at write amplification 2 takes 50 writes (ch09 9)', () => {
    expect(writesBeforeFull(0.0001, 0, 1000, 2)).toBe(50)
    expect(writesBeforeFull(0.0001, 0.00005, 1000, 2)).toBe(25)
  })
})
