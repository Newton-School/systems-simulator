/**
 * Chapter 27: metrics and output glossary (docs/reference/27-metrics-and-output-glossary.md).
 * Expected behaviour comes from the chapter's definitions: the outcome counts add up, throughput and error rate are the
 * stated ratios, percentiles are ordered and equal the percentile of the underlying latencies, shares sum to 1, the
 * conservation identity holds, and the page shows what the engine reports. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr } from '../support/oracles'
import { quantile } from '../support/stats'
import { chain, passNode, queueNode, type RunSpec } from '../support/topology'

type Out = ReturnType<typeof runEngine>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 150,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 5000,
    seed,
    timeoutMs: 100,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

/**
 * A mixed run with every outcome: two backends behind a balancer, one of them too small (it rejects when its
 * queue fills and times requests out), plus an edge that fails 3% of calls. Deterministic arrivals and service.
 */
function mixed(seed: string, over: Partial<RunSpec> = {}) {
  return chain({
    run: run(seed, over),
    nodes: [
      passNode('lb', 'load-balancer', {
        routingStrategy: 'round-robin',
        healthCheckEnabled: false
      }),
      queueNode('big', 'microservice', {
        category: 'compute',
        workers: 8,
        capacity: 100,
        serviceMs: 20,
        timeoutMs: 100
      }),
      queueNode('small', 'microservice', {
        category: 'compute',
        workers: 1,
        capacity: 6,
        serviceMs: 20,
        timeoutMs: 100
      })
    ],
    edges: [tcp('source', 'lb'), tcp('lb', 'big', { errorRate: 0.03 }), tcp('lb', 'small')]
  })
}

const out: Out = runEngine(mixed('met'))
const s = out.summary

// ───────────────────────── 1. The run summary ─────────────────────────

test.describe('MET-01 the summary counts and ratios are the ones the chapter defines (ch27 section 2)', () => {
  test('the run has all three failure kinds, so the checks below are not vacuous', () => {
    expect(s.rejectedRequests).toBeGreaterThan(0)
    expect(s.successfulRequests).toBeGreaterThan(0)
    expect(s.failedRequests).toBeGreaterThan(0)
  })

  test('successful + failed = total requests', () => {
    expect(s.successfulRequests + s.failedRequests).toBe(s.totalRequests)
  })

  test('failed = rejected + timed out + connection reset (the causes partition the failures)', () => {
    expect(s.rejectedRequests + s.timedOutRequests + s.connectionResetRequests).toBe(
      s.failedRequests
    )
  })

  test('error rate = post-warmup failed / post-warmup total', () => {
    expect(s.errorRate).toBeCloseTo(s.postWarmupFailedRequests / s.postWarmupTotalRequests, 12)
  })

  test('throughput is goodput: post-warmup successes per post-warmup second', () => {
    expect(s.postWarmupDurationSec).toBeCloseTo((30_000 - 5000) / 1000, 9)
    expect(
      relErr(s.throughput, s.postWarmupSuccessfulRequests / s.postWarmupDurationSec)
    ).toBeLessThan(0.001)
    // and below the offered load because failures are excluded
    expect(s.throughput).toBeLessThan(150)
  })

  test('warmup is excluded: post-warmup counts are smaller than the totals', () => {
    expect(s.postWarmupTotalRequests).toBeLessThan(s.totalRequests)
    expect(Math.abs(s.postWarmupTotalRequests / s.totalRequests - 25 / 30)).toBeLessThan(0.02)
  })
})

test.describe('MET-02 percentiles are ordered and equal the percentile of the latencies (ch27 section 2)', () => {
  const lat = s.latency
  const ok = out.requestOutcomes.filter((o) => o.status === 'success').map((o) => o.latencyMs)

  test('min <= p50 <= p90 <= p95 <= p99 <= max, and min <= mean <= max', () => {
    expect(lat.min!).toBeLessThanOrEqual(lat.p50!)
    expect(lat.p50!).toBeLessThanOrEqual(lat.p90!)
    expect(lat.p90!).toBeLessThanOrEqual(lat.p95!)
    expect(lat.p95!).toBeLessThanOrEqual(lat.p99!)
    expect(lat.p99!).toBeLessThanOrEqual(lat.max!)
    expect(lat.min!).toBeLessThanOrEqual(lat.mean!)
    expect(lat.mean!).toBeLessThanOrEqual(lat.max!)
  })

  test('latency is measured over successful requests only', () => {
    expect(ok.length).toBeGreaterThan(0)
    expect(Math.max(...ok)).toBeGreaterThanOrEqual(lat.p99! * 0.99)
  })

  for (const [name, p] of [
    ['p50', 0.5],
    ['p95', 0.95],
    ['p99', 0.99]
  ] as const) {
    test(`${name} equals the ${p} quantile of the successful latencies within the histogram resolution`, () => {
      // Outcomes include the 5 s warmup; compare on the post-warmup ones the percentile is computed from.
      const post = out.requestOutcomes
        .filter((o) => o.status === 'success' && o.createdAtMs >= 5000)
        .map((o) => o.latencyMs)
      expect(relErr(lat[name]!, quantile(post, p))).toBeLessThan(0.02)
    })
  }
})

test.describe('MET-03 the bottleneck tables are shares that sum to 1 (ch27 section 2)', () => {
  test('failuresByLocus: each entry splits by cause and the shares sum to 1', () => {
    const shares = s.failuresByLocus.reduce((a, e) => a + e.shareOfFailures, 0)
    expect(shares).toBeCloseTo(1, 9)
    for (const entry of s.failuresByLocus) {
      expect(Object.values(entry.byCause).reduce((a, b) => a + b!, 0)).toBe(entry.total)
    }
    // the table counts failures by when they ended, the summary by when the request began: a few at the warmup edge differ
    expect(
      Math.abs(s.failuresByLocus.reduce((a, e) => a + e.total, 0) - s.postWarmupFailedRequests)
    ).toBeLessThanOrEqual(5)
  })

  test('failuresByLocus is sorted with the largest first and names where the requests died', () => {
    const totals = s.failuresByLocus.map((e) => e.total)
    expect(totals).toEqual([...totals].sort((a, b) => b - a))
    expect(s.failuresByLocus.some((e) => e.locus === 'small')).toBe(true)
  })

  test('latencyDecomposition: the per-component means add up to the end-to-end mean', () => {
    const sum = s.latencyDecomposition.reduce((a, e) => a + e.shareOfEndToEnd, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.02)
    const ms = s.latencyDecomposition.reduce((a, e) => a + e.meanMs, 0)
    expect(relErr(ms, s.latency.mean!)).toBeLessThan(0.03)
  })
})

// ───────────────────────── 2. Per node and per edge ─────────────────────────

test.describe('MET-04 per-node figures obey the identities the chapter states (ch27 section 3)', () => {
  const nodes = Object.entries(out.perNode).filter(([id]) => id !== 'source')

  test('utilization is a fraction and availability = 1 - error rate', () => {
    for (const [id, m] of nodes) {
      expect(m.utilization, id).toBeGreaterThanOrEqual(0)
      expect(m.utilization, id).toBeLessThanOrEqual(1)
      expect(m.availability + m.errorRate, id).toBeCloseTo(1, 9)
    }
  })

  test('time in system = queue wait + service time', () => {
    for (const [id, m] of nodes) {
      if (m.totalProcessed === 0) continue
      expect(m.avgTimeInSystem, id).toBeCloseTo(m.avgQueueWait + m.avgServiceTime, 6)
    }
  })

  test('arrivals = processed + rejected + timed out + reset + in flight (post-warmup conservation)', () => {
    for (const c of out.conservationCheck) {
      expect(c.postWarmupArrived, c.nodeId).toBeGreaterThanOrEqual(
        c.postWarmupProcessed +
          c.postWarmupRejected +
          c.postWarmupTimedOut +
          c.postWarmupConnectionReset
      )
      expect(c.inFlight, c.nodeId).toBe(
        Math.max(
          0,
          c.postWarmupArrived -
            c.postWarmupProcessed -
            c.postWarmupRejected -
            c.postWarmupTimedOut -
            c.postWarmupConnectionReset
        )
      )
    }
  })

  test('the big, unsaturated backend passes the Little and conservation checks', () => {
    const little = out.littlesLawCheck.find((c) => c.nodeId === 'big')!
    expect(little.withinTolerance).toBe(true)
    expect(out.conservationCheck.find((c) => c.nodeId === 'big')!.balanced).toBe(true)
  })

  test('the saturated small backend reports its rejections by reason', () => {
    const small = out.perNode.small
    expect(small.totalRejected).toBeGreaterThan(0)
    expect(
      Object.values(small.rejectionsByReason).reduce((a, b) => a + b, 0)
    ).toBeGreaterThanOrEqual(small.totalRejected - 1)
    expect(small.utilization).toBeGreaterThan(0.95)
  })

  test('nodes that took no part have no figures to mislead: the source arrives nothing', () => {
    expect(out.perNode.source.totalProcessed).toBe(0)
  })
})

test.describe('MET-05 per-edge figures match the node behind them (ch27 section 4)', () => {
  test("an edge to a healthy node: successful transits equal that node's arrivals", () => {
    const edge = out.perEdge['lb->small']
    expect(edge.totalSuccessfulTransits).toBeGreaterThan(0)
    expect(
      Math.abs(edge.totalSuccessfulTransits - out.perNode.small.postWarmupArrived)
    ).toBeLessThan(out.perNode.small.postWarmupArrived * 0.02 + 3)
  })

  test('the 3% failing edge fails about 3% of the calls it carries', () => {
    const e = out.perEdge['lb->big']
    const rate = e.totalFailedTerminals / (e.totalFailedTerminals + e.totalSuccessfulTransits)
    expect(Math.abs(rate - 0.03)).toBeLessThan(0.015)
  })
})

// ───────────────────────── 3. Windows, outcomes, series ─────────────────────────

test.describe('MET-06 per-request records, windows and the time series are consistent with the summary (ch27 sections 2 and 6)', () => {
  test('requestOutcomes has one record per request generated; the terminated ones reproduce the summary, the rest are in flight', () => {
    expect(out.requestOutcomesSampled).toBe(false)
    const inFlight = out.requestOutcomes.filter((o) => o.status === 'in-flight').length
    expect(out.requestOutcomes.length - inFlight).toBe(s.totalRequests)
    expect(out.requestOutcomes.length).toBe(150 * 30)
    expect(out.requestOutcomes.filter((o) => o.status === 'success').length).toBe(
      s.successfulRequests
    )
  })

  test('every failed record carries a reason code', () => {
    const failed = out.requestOutcomes.filter(
      (o) => o.status !== 'success' && o.status !== 'in-flight'
    )
    expect(failed.length).toBe(s.failedRequests)
    // a refusal names its reason; a timeout is its own status
    expect(failed.filter((o) => o.status === 'rejected').every((o) => o.reasonCode)).toBe(true)
    expect(
      failed.every(
        (o) => o.status === 'rejected' || o.status === 'timeout' || o.status === 'connection_reset'
      )
    ).toBe(true)
  })

  test('latency windows are one second long and their counts add up to the samples', () => {
    for (const w of s.latencyWindows) expect(w.windowEndMs - w.windowStartMs).toBe(1000)
    const ok = s.latencyWindows.reduce((a, w) => a + w.successCount, 0)
    const bad = s.latencyWindows.reduce((a, w) => a + w.errorCount, 0)
    expect(ok).toBe(s.successLatencySamples)
    expect(bad).toBe(s.timeToErrorSamples)
  })

  test('the time series has about one sample per second, with utilization in range', () => {
    expect(Math.abs(out.timeSeries.length - 30)).toBeLessThanOrEqual(1)
    for (const sample of out.timeSeries) {
      for (const n of Object.values(sample.node)) {
        expect(n.utilization).toBeGreaterThanOrEqual(0)
        expect(n.utilization).toBeLessThanOrEqual(1)
      }
    }
  })

  test('requests by origin add up to the post-warmup requests generated (rate x 25 s)', () => {
    expect(out.perOrigin.reduce((a, o) => a + o.requests, 0)).toBe(150 * 25)
  })
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('MET-07 the page shows the figures the engine reports (ch27 section 2)', () => {
  test('throughput, error rate and the latency percentiles match to within rounding', async ({
    page
  }) => {
    const t = mixed('met-ui', { durationMs: 20_000 })
    const engine = runEngine(t)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'lb')
    // the 3% failing edge draws random numbers, which differ between the page and the engine
    expect(relErr(ui.throughput, engine.summary.throughput)).toBeLessThan(0.04)
    expect(Math.abs(ui.errorRatePct - engine.summary.errorRate * 100)).toBeLessThan(2.5)
    expect(relErr(ui.p50, engine.summary.latency.p50!)).toBeLessThan(0.05)
    expect(relErr(ui.p99, engine.summary.latency.p99!)).toBeLessThan(0.06)
  })
})
