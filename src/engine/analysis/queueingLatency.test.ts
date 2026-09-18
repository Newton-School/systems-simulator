import { describe, expect, it } from 'vitest'
import { approxResponsePercentileMs, erlangB, erlangC, mmcLatency } from './queueingLatency'

describe('erlangB', () => {
  it('matches the closed form for a single server', () => {
    // B(1, a) = a / (1 + a).
    expect(erlangB(1, 0.5)).toBeCloseTo(0.5 / 1.5, 6)
    expect(erlangB(1, 2)).toBeCloseTo(2 / 3, 6)
  })

  it('matches a known M/M/c/c textbook value', () => {
    // Erlang-B(2, 1) = (1^2/2!) / (1 + 1 + 1/2) = 0.5 / 2.5 = 0.2.
    expect(erlangB(2, 1)).toBeCloseTo(0.2, 6)
  })
})

describe('erlangC', () => {
  it('is 1 at or above capacity', () => {
    expect(erlangC(2, 2)).toBe(1) // ρ = 1
    expect(erlangC(2, 3)).toBe(1) // ρ > 1
  })

  it('is between 0 and 1 below capacity and rises with load', () => {
    const light = erlangC(4, 1) // ρ = 0.25
    const heavy = erlangC(4, 3) // ρ = 0.75
    expect(light).toBeGreaterThan(0)
    expect(light).toBeLessThan(1)
    expect(heavy).toBeGreaterThan(light)
  })
})

describe('mmcLatency', () => {
  it('an M/M/1 well below capacity has wait ≈ ρ/(μ−λ)', () => {
    // λ=50, μ=100 (1 server): ρ=0.5. Wq = ρ/(μ−λ) = 0.5/50 s = 10ms. service=10ms.
    const l = mmcLatency(50, 1, 100)
    expect(l.stable).toBe(true)
    expect(l.utilization).toBeCloseTo(0.5, 6)
    expect(l.meanWaitMs).toBeCloseTo(10, 4)
    expect(l.meanResponseMs).toBeCloseTo(20, 4)
  })

  it('wait grows without bound as utilization approaches 1', () => {
    const rho90 = mmcLatency(90, 1, 100)
    const rho99 = mmcLatency(99, 1, 100)
    expect(rho99.meanWaitMs).toBeGreaterThan(rho90.meanWaitMs * 5)
  })

  it('is unstable (infinite wait) at or over capacity', () => {
    const l = mmcLatency(100, 1, 100)
    expect(l.stable).toBe(false)
    expect(l.meanWaitMs).toBe(Number.POSITIVE_INFINITY)
    expect(l.waitProbability).toBe(1)
  })

  it('more servers at the same total capacity reduce queueing', () => {
    // Same offered load and total capacity, split across more servers → less wait.
    const one = mmcLatency(160, 1, 200) // ρ=0.8, 1 server
    const four = mmcLatency(160, 4, 50) // ρ=0.8, 4 servers, same cμ=200
    expect(four.meanWaitMs).toBeLessThan(one.meanWaitMs)
  })

  it('handles zero load', () => {
    const l = mmcLatency(0, 2, 100)
    expect(l.meanWaitMs).toBe(0)
    expect(l.meanResponseMs).toBeCloseTo(10, 6) // just the 1/μ service time
  })
})

describe('approxResponsePercentileMs', () => {
  it('orders percentiles and passes through non-finite means', () => {
    const mean = 20
    expect(approxResponsePercentileMs(mean, 0.5)).toBeCloseTo(-20 * Math.log(0.5), 6)
    expect(approxResponsePercentileMs(mean, 0.99)).toBeGreaterThan(
      approxResponsePercentileMs(mean, 0.5)
    )
    expect(approxResponsePercentileMs(Number.POSITIVE_INFINITY, 0.5)).toBe(Number.POSITIVE_INFINITY)
  })
})
