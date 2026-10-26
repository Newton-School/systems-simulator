import { describe, it, expect } from 'vitest'
import { Hist } from './hist'

/** Deterministic mulberry32 PRNG so these tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Exact nearest-rank quantile from a sorted ascending array, matching Hist. */
function exactQuantile(sortedAsc: number[], q: number): number {
  const idx = Math.floor(q * (sortedAsc.length - 1))
  return sortedAsc[idx]
}

describe('Hist', () => {
  it('returns null quantiles for an empty histogram (never 0)', () => {
    const h = new Hist()
    expect(h.count()).toBe(0)
    expect(h.quantile(0.5)).toBeNull()
    expect(h.quantile(0.99)).toBeNull()
    expect(h.quantile(0)).toBeNull()
    expect(h.quantile(1)).toBeNull()
  })

  it('has ~1280 buckets (64 sub-buckets x 20 bands, ~5KB)', () => {
    expect(Hist.bucketCount).toBe(1280)
  })

  it('approximates exact quantiles within 1% relative error over random inputs', () => {
    const rand = mulberry32(0xc0ffee)
    // Sweep several magnitudes so we exercise low, mid, and high bands.
    for (const maxVal of [50, 1_000, 50_000, 1_000_000]) {
      const values: number[] = []
      const h = new Hist()
      for (let i = 0; i < 5000; i++) {
        // Bias toward a spread of magnitudes within [1, maxVal].
        const v = 1 + Math.floor(rand() * maxVal)
        values.push(v)
        h.record(v)
      }
      const sorted = [...values].sort((a, b) => a - b)
      for (const q of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 0.999]) {
        const exact = exactQuantile(sorted, q)
        const approx = h.quantile(q)
        expect(approx).not.toBeNull()
        const relError = Math.abs((approx as number) - exact) / exact
        expect(relError).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('clamps values into [1, 2^30 - 1]', () => {
    const h = new Hist()
    h.record(0)
    h.record(-5)
    h.record(5_000_000_000)
    expect(h.count()).toBe(3)
    // The two floor values land at ~1µs, the overflow lands at the top of the range (~1.07e9 µs).
    const p0 = h.quantile(0) as number
    const pMax = h.quantile(1) as number
    expect(p0).toBeGreaterThanOrEqual(1)
    expect(p0).toBeLessThan(2)
    expect(pMax).toBeGreaterThan(1_000_000_000)
    expect(pMax).toBeLessThanOrEqual((2 ** 30 - 1) * 1.01)
  })

  it('keeps the 1% accuracy for latencies above one second (timeouts are configurable to minutes)', () => {
    for (const seconds of [1.2, 2, 5, 20, 120, 600]) {
      const h = new Hist()
      const us = Math.round(seconds * 1_000_000)
      for (let i = 0; i < 100; i++) h.record(us)
      for (const q of [0, 0.5, 0.99, 1]) {
        expect(Math.abs((h.quantile(q) as number) - us) / us).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('does not allocate the long-latency bands until a value needs them', () => {
    const h = new Hist()
    h.record(900_000)
    expect((h as unknown as { overflow: unknown }).overflow).toBeNull()
    h.record(1_500_000)
    expect((h as unknown as { overflow: unknown }).overflow).not.toBeNull()
  })

  it('merges long-latency buckets exactly, including into a histogram that never saw one', () => {
    const a = new Hist()
    const b = new Hist()
    const union = new Hist()
    for (const v of [100, 5_000, 2_500_000, 40_000_000]) {
      a.record(v)
      union.record(v)
    }
    for (const v of [300, 9_000_000]) {
      b.record(v)
      union.record(v)
    }
    b.merge(a)
    a.merge(new Hist())
    for (const q of [0, 0.25, 0.5, 0.75, 0.99, 1]) {
      expect(b.quantile(q)).toBe(union.quantile(q))
    }
  })

  it('merge(A, B) equals a histogram fed A ∪ B exactly at the bucket level', () => {
    const rand = mulberry32(42)
    const a: number[] = []
    const b: number[] = []
    const hA = new Hist()
    const hB = new Hist()
    const hUnion = new Hist()
    for (let i = 0; i < 3000; i++) {
      const va = 1 + Math.floor(rand() * 200_000)
      const vb = 1 + Math.floor(rand() * 800_000)
      a.push(va)
      b.push(vb)
      hA.record(va)
      hB.record(vb)
      hUnion.record(va)
      hUnion.record(vb)
    }
    hA.merge(hB)
    expect(hA.count()).toBe(hUnion.count())
    // Bucket-level equality is verified through identical quantiles at every q.
    for (let q = 0; q <= 1.0001; q += 0.01) {
      expect(hA.quantile(q)).toBe(hUnion.quantile(q))
    }
  })

  it('merge is order-independent (associative / commutative bucket addition)', () => {
    const hA = new Hist()
    const hB = new Hist()
    const hC = new Hist()
    for (const v of [10, 100, 1000]) hA.record(v)
    for (const v of [20, 200, 2000]) hB.record(v)
    for (const v of [30, 300, 3000]) hC.record(v)

    const left = new Hist()
    left.merge(hA)
    left.merge(hB)
    left.merge(hC)

    const right = new Hist()
    right.merge(hC)
    right.merge(hB)
    right.merge(hA)

    for (let q = 0; q <= 1.0001; q += 0.05) {
      expect(left.quantile(q)).toBe(right.quantile(q))
    }
  })

  it('single-value histogram reports that value within tolerance', () => {
    const h = new Hist()
    for (let i = 0; i < 100; i++) h.record(56_000)
    const p50 = h.quantile(0.5) as number
    expect(Math.abs(p50 - 56_000) / 56_000).toBeLessThanOrEqual(0.01)
  })
})
