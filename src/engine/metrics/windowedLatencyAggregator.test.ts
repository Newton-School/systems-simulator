import { describe, it, expect } from 'vitest'
import { WindowedLatencyAggregator } from './windowedLatencyAggregator'

const ms = (n: number): bigint => BigInt(n) * 1000n

describe('WindowedLatencyAggregator', () => {
  it('drops terminals before warmup (single warmup gate)', () => {
    const agg = new WindowedLatencyAggregator(ms(1000)) // 1s warmup
    // Terminates at 500ms — before warmup → ignored.
    agg.onTerminal('completed', ms(10), ms(500))
    expect(agg.mergedSuccessHist().count()).toBe(0)
    expect(agg.successSummary().count).toBe(0)

    // Terminates at 1500ms — after warmup → counted.
    agg.onTerminal('completed', ms(10), ms(1500))
    expect(agg.mergedSuccessHist().count()).toBe(1)
  })

  it('assigns terminals to 1s tumbling windows by termination time', () => {
    const agg = new WindowedLatencyAggregator(0n)
    agg.onTerminal('completed', ms(5), ms(200)) // window [0,1s)
    agg.onTerminal('completed', ms(5), ms(900)) // window [0,1s)
    agg.onTerminal('completed', ms(5), ms(1200)) // window [1s,2s)
    agg.onTerminal('timeout', ms(250), ms(2500)) // window [2s,3s)

    const windows = agg.orderedWindows()
    expect(windows.map((w) => w.windowStart)).toEqual([0, 1_000_000, 2_000_000])
    expect(windows[0].counts.completed).toBe(2)
    expect(windows[1].counts.completed).toBe(1)
    expect(windows[2].counts.timeout).toBe(1)
  })

  it('keeps success latency and per-cause time-to-error strictly separate', () => {
    const agg = new WindowedLatencyAggregator(0n)
    agg.onTerminal('completed', ms(20), ms(100))
    agg.onTerminal('rejected', ms(9), ms(150))
    agg.onTerminal('timeout', ms(250), ms(200))
    agg.onTerminal('connection_reset', ms(700), ms(250))

    // Success histogram is completed-only.
    expect(agg.mergedSuccessHist().count()).toBe(1)

    const errors = agg.mergedErrorHistByCause()
    expect(errors.rejected.count()).toBe(1)
    expect(errors.timeout.count()).toBe(1)
    expect(errors.connection_reset.count()).toBe(1)

    // Each cause reports its own distinct time-to-error, never blended
    // (histogram bucket error is ≤1%).
    const within1pct = (actual: number, expected: number): void =>
      expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.01)
    within1pct(errors.rejected.quantile(0.5)! / 1000, 9)
    within1pct(errors.timeout.quantile(0.5)! / 1000, 250)
    within1pct(errors.connection_reset.quantile(0.5)! / 1000, 700)
  })

  it('merged success quantiles approximate the true distribution within 1%', () => {
    const agg = new WindowedLatencyAggregator(0n)
    // Spread completed latencies across several windows.
    const values: number[] = []
    for (let i = 0; i < 500; i++) {
      const latencyMs = 10 + (i % 200)
      values.push(latencyMs)
      // Termination time marches forward so samples land in many windows.
      agg.onTerminal('completed', ms(latencyMs), ms(1000 + i * 7))
    }
    const sorted = [...values].sort((a, b) => a - b)
    const exactP50 = sorted[Math.floor(0.5 * (sorted.length - 1))]
    const p50 = agg.mergedSuccessHist().quantile(0.5)! / 1000
    expect(Math.abs(p50 - exactP50) / exactP50).toBeLessThanOrEqual(0.01)
  })

  it('empty aggregator yields null quantiles, never 0', () => {
    const agg = new WindowedLatencyAggregator(0n)
    expect(agg.mergedSuccessHist().quantile(0.5)).toBeNull()
    expect(agg.mergedErrorHistByCause().timeout.quantile(0.99)).toBeNull()
    expect(agg.successSummary()).toEqual({ sumUs: 0n, count: 0 })
  })

  it('produces an exact integer-µs success sum for the mean', () => {
    const agg = new WindowedLatencyAggregator(0n)
    agg.onTerminal('completed', ms(100), ms(100))
    agg.onTerminal('completed', ms(300), ms(400))
    const { sumUs, count } = agg.successSummary()
    expect(sumUs).toBe(ms(400)) // 100ms + 300ms, exact
    expect(count).toBe(2)
  })
})
