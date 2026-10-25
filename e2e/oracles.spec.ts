/**
 * The oracles are code, so they get tested against the numbers hand-computed in the reference
 * chapters. If one of these fails the formula or the chapter is wrong, never the simulator.
 */
import { expect, test } from '@playwright/test'
import {
  burnRate,
  fanoutWritesPerSec,
  perSecondFromMonthly,
  pollRate,
  serialAvailability,
  storageBytes,
  dnsFailoverSeconds,
  dnsMissRatio,
  expectedDistinctKeys,
  heartbeatCores,
  heldConnections,
  meshUploadMbps,
  monthsToUtilization,
  normalUtilizationForNPlusK,
  sfuEgressMbps,
  canarySamples,
  captureProbability,
  cheHitRatio,
  errorBudgetMinutes,
  hpaDesired,
  podsPerMachine,
  replicasNeeded,
  rollingBounds,
  windowsPerEvent,
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

  test('ORC-14 HPA: 4 at 90% vs 70% gives 6; 10 at 30% gives 5; 4 at 76% stays (ch14 2)', () => {
    expect(hpaDesired(4, 90, 70)).toBe(6)
    expect(hpaDesired(10, 30, 70)).toBe(5)
    expect(hpaDesired(4, 76, 70)).toBe(4)
    expect(replicasNeeded(10, 0.7, 2)).toBe(8)
  })

  test('ORC-15 bin packing: 2 vCPU / 16 GB pods fit 2 per 8 vCPU / 32 GB machine, not 4 (ch14 4)', () => {
    expect(podsPerMachine(8, 32, 2, 16)).toBe(2)
    expect(podsPerMachine(4, 16, 2, 8)).toBe(2)
    expect(podsPerMachine(8, 32, 8, 16)).toBe(1)
  })

  test('ORC-16 error budgets: 99% is 432 min, 99.9% 43.2, 99.99% 4.32; burn 14.4 at 1.44% (ch16 4)', () => {
    expect(errorBudgetMinutes(0.99)).toBeCloseTo(432, 6)
    expect(errorBudgetMinutes(0.999)).toBeCloseTo(43.2, 6)
    expect(errorBudgetMinutes(0.9999)).toBeCloseTo(4.32, 6)
    expect(burnRate(0.0144, 0.999)).toBeCloseTo(14.4, 9)
  })

  test('ORC-17 head sampling at 1% needs 459 occurrences for a 99% chance; a 1.5% to 2.5% canary needs about 2,400 (ch16 5, ch17 3)', () => {
    expect(captureProbability(0.01, 459)).toBeGreaterThan(0.99)
    expect(captureProbability(0.01, 458)).toBeLessThan(0.99)
    expect(canarySamples(0.01, 0.02)).toBeCloseTo(2364, 0)
    expect(windowsPerEvent(600_000, 300_000)).toBe(2)
  })

  test('ORC-18 rolling update: 3 replicas at 25%/25% surge 1 unavailable 0; 10 replicas surge 3 unavailable 2 (ch17 2)', () => {
    expect(rollingBounds(3, 25, 25)).toEqual({
      surge: 1,
      unavailable: 0,
      minReady: 3,
      maxRunning: 4
    })
    expect(rollingBounds(10, 25, 25)).toEqual({
      surge: 3,
      unavailable: 2,
      minReady: 8,
      maxRunning: 13
    })
  })

  test('ORC-19 connections: 16 GB at 32 KB holds 524,288; 100,000 pings per 30 s at 0.01 ms is 0.033 cores (ch19 2)', () => {
    expect(heldConnections(1e9, null, 1, 16, 32)).toBe(524_288)
    expect(heldConnections(100_000, 40_000, 1, 8, 32)).toBe(40_000)
    expect(heartbeatCores(100_000, 30_000, 0.01)).toBeCloseTo(0.0333, 4)
  })

  test('ORC-20 video topologies: mesh N=5 at 1.5 Mbps uploads 6 Mbps; SFU N=50 sends 3,675 Mbps (ch19 5)', () => {
    expect(meshUploadMbps(5, 1.5)).toBeCloseTo(6, 9)
    expect(sfuEgressMbps(5, 1.5)).toBeCloseTo(30, 9)
    expect(sfuEgressMbps(50, 1.5)).toBeCloseTo(3675, 6)
  })

  test('ORC-21 DNS: 1 request/s at 30 s TTL misses 3.2%; 0.01/s misses 77%; 30 s check + 60 s TTL moves in 90 s worst case (ch21)', () => {
    expect(dnsMissRatio(1, 30)).toBeCloseTo(1 / 31, 9)
    expect(dnsMissRatio(0.01, 30)).toBeCloseTo(0.769, 3)
    expect(dnsFailoverSeconds(10, 3, 60, true)).toBe(90)
    expect(dnsFailoverSeconds(10, 3, 60)).toBe(60)
  })

  test('ORC-22 headroom: 12 servers at an 80% target run at 73.3% (N+1) or 66.7% (N+2); 4.9 months to 80% at 10% growth (ch23)', () => {
    expect(normalUtilizationForNPlusK(0.8, 12, 1)).toBeCloseTo(0.7333, 4)
    expect(normalUtilizationForNPlusK(0.8, 12, 2)).toBeCloseTo(0.6667, 4)
    expect(monthsToUtilization(0.5, 0.8, 0.1)).toBeCloseTo(4.93, 2)
    expect(monthsToUtilization(0.5, 1, 0.1)).toBeCloseTo(7.27, 2)
    expect(expectedDistinctKeys(1000, 6000)).toBeCloseTo(997.5, 1)
  })

  test('ORC-23 sizing: 100 M links a month is 39 writes/s; 6 B records of 500 B is 3 TB; 1 M followers is 1 M writes/s (ch24 3, 4)', () => {
    expect(perSecondFromMonthly(100e6)).toBeCloseTo(38.58, 2)
    expect(storageBytes(6e9, 500)).toBe(3e12)
    expect(storageBytes(6e9, 500, 3)).toBe(9e12)
    expect(fanoutWritesPerSec(1, 1_000_000)).toBe(1_000_000)
  })

  test('ORC-24 polling and microservices: 1 M clients every 5 s is 200,000 req/s; 6 hops at 99.9% is 99.4% (ch24 1, ch25 3)', () => {
    expect(pollRate(1_000_000, 5)).toBe(200_000)
    expect(serialAvailability(0.999, 6)).toBeCloseTo(0.994, 3)
  })
})
