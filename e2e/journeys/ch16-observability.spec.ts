/**
 * Chapter 16: observability (docs/reference/16-observability.md).
 * Expected values come from the chapter: fire-and-forget telemetry never touches the user path, head sampling keeps
 * p of the events, an ingest ceiling bounds what is exported, a trace sampler keeps the configured share, the error
 * rate is a faithful SLI whose burn rate is error rate / (1 - SLO), and a reported percentile is the exact percentile
 * of the underlying latencies. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { quantile } from '../support/stats'
import { burnRate, relErr } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

type Out = ReturnType<typeof runEngine>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 200,
    pattern: 'constant',
    durationMs: 10_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

/**
 * source -> svc (5 ms) -> db (5 ms) on the user path, with an optional asynchronous branch from svc to a log
 * collector whose single worker takes 20 ms (50 events/s) and holds at most 4: a collector that cannot keep up
 * with 200 events/s. With `leafOnly` there is no database, so the collector is the only thing after svc.
 */
function withLogs(
  seed: string,
  logConfig: Record<string, unknown> | null,
  over: Partial<RunSpec> = {},
  leafOnly = false
) {
  return chain({
    run: run(seed, over),
    nodes: [
      queueNode('svc', 'microservice', { category: 'compute', serviceMs: 5, workers: 64 }),
      ...(leafOnly ? [] : [queueNode('db', 'relational-db', { config: { storageReadMs: 5 } })]),
      ...(logConfig
        ? [
            queueNode('logs', 'centralized-logging', {
              category: 'observability',
              serviceMs: 20,
              workers: 1,
              capacity: 4,
              config: logConfig
            })
          ]
        : [])
    ],
    edges: [
      tcp('source', 'svc'),
      ...(leafOnly ? [] : [tcp('svc', 'db')]),
      ...(logConfig ? [tcp('svc', 'logs', { mode: 'asynchronous' })] : [])
    ]
  })
}

/** Outcomes of the user-facing requests: those that end at the database, not at the telemetry collector. */
const userPath = (out: Out) => out.requestOutcomes.filter((o) => o.nodeId !== 'logs')
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

// ───────────────────────── 1. Fire-and-forget telemetry ─────────────────────────

test.describe('O-01 telemetry that cannot keep up never touches the user path (ch16 section 5)', () => {
  const baseline = runEngine(withLogs('o01-base', null))
  const overloaded = runEngine(withLogs('o01', { telemetryAsyncIngest: true }))

  test('the collector drops events: 200/s offered to a 50/s collector', () => {
    const c = overloaded.perNode.logs.traitCounters
    expect(c.telemetryOffered).toBeGreaterThan(1900)
    expect(c.telemetryDropped).toBeGreaterThan(1000)
  })

  test('users see the same latency and no errors as with no telemetry at all', () => {
    expect(overloaded.summary.errorRate).toBe(0)
    expect(overloaded.summary.failedRequests).toBe(0)
    const a = mean(
      userPath(overloaded)
        .filter((o) => o.status === 'success')
        .map((o) => o.latencyMs)
    )
    const b = mean(
      userPath(baseline)
        .filter((o) => o.status === 'success')
        .map((o) => o.latencyMs)
    )
    expect(Math.abs(a - b)).toBeLessThan(0.05)
  })

  test('every event is accounted for: offered = ingested + dropped', () => {
    const c = overloaded.perNode.logs.traitCounters
    expect(c.telemetryOffered).toBe(c.telemetryIngested + c.telemetryDropped)
  })

  test('without the fire-and-forget setting the same overload fails user requests', () => {
    // A synchronous-style exporter shares the fate of the collector: the observer slows or breaks the system.
    const plain = runEngine(withLogs('o01b', {}))
    expect(plain.requestOutcomes.some((o) => o.status !== 'success')).toBe(true)
  })
})

test.describe('O-01b a collector at the end of the only path must not become the user latency (ch16 section 5)', () => {
  // Tracked gap (finding 27): when the only edge out of a service is asynchronous, the request is reported as ending at
  // the collector. The user's own 5 ms response disappears from the results and the export (25 ms, or 80 ms when the
  // collector queues) becomes the reported latency.
  test.fail(
    'svc -> logs (async) and nothing else: the user-facing latency is still the 5 ms of svc',
    () => {
      const out = runEngine(withLogs('o01c', { telemetryAsyncIngest: true }, {}, true))
      expect(out.summary.latency.mean).toBeLessThan(6)
    }
  )
})

test.describe('O-02 head sampling exports p of the events (ch16 section 5)', () => {
  for (const p of [0.1, 0.25, 0.5]) {
    test(`sample rate ${p}: exported share within 4 standard errors, the rest counted as sampled out`, () => {
      const out = runEngine(
        withLogs(
          `o02-${p}`,
          { telemetryAsyncIngest: true, telemetrySampleRate: p },
          { durationMs: 30_000 }
        )
      )
      const c = out.perNode.logs.traitCounters
      const events = c.telemetryOffered + c.telemetrySampledOut
      const se = Math.sqrt((p * (1 - p)) / events)
      expect(Math.abs(c.telemetryOffered / events - p)).toBeLessThan(4 * se)
    })
  }
})

test.describe('O-03 an ingest ceiling bounds what is exported (ch16 section 5)', () => {
  test('30 events/s of ceiling over 10 s lets through about 300 of 2,000', () => {
    const out = runEngine(withLogs('o03', { telemetryAsyncIngest: true, telemetryIngestRps: 30 }))
    const c = out.perNode.logs.traitCounters
    expect(relErr(c.telemetryOffered - c.telemetryDroppedOverIngest, 30 * 10)).toBeLessThan(0.05)
  })
})

// ───────────────────────── 2. Traces ─────────────────────────

test.describe('O-04 a trace sampler keeps the configured share, decided by trace id (ch16 section 5)', () => {
  const sampled = (seed: string, rate: number) => {
    const t = chain({
      run: run(seed, { rps: 1000, durationMs: 20_000 }),
      nodes: [queueNode('svc', 'microservice', { category: 'compute', serviceMs: 1, workers: 64 })],
      edges: [tcp('source', 'svc')]
    })
    t.global.traceSampleRate = rate
    return runEngine(t)
  }

  for (const rate of [0.01, 0.1, 0.5]) {
    test(`rate ${rate} keeps ${rate * 100}% of 20,000 traces within one point`, () => {
      const out = sampled(`o04-${rate}`, rate)
      expect(Math.abs(out.traces.length / out.summary.totalRequests - rate)).toBeLessThan(0.01)
    })
  }

  test('the decision depends only on the id, so a rerun keeps exactly the same traces', () => {
    const a = sampled('o04-same', 0.1).traces.map((t) => t.requestId)
    const b = sampled('o04-same', 0.1).traces.map((t) => t.requestId)
    expect(a).toEqual(b)
  })

  test('rate 0 keeps none and rate 1 keeps every request', () => {
    expect(sampled('o04-0', 0).traces.length).toBe(0)
    const all = sampled('o04-1', 1)
    expect(all.traces.length).toBe(all.summary.totalRequests)
  })
})

// ───────────────────────── 3. SLIs and percentiles ─────────────────────────

test.describe('O-05 the error rate is a faithful SLI and burn rate follows (ch16 section 4)', () => {
  test('an edge failing 1.44% of calls measures 1.44% and burns a 99.9% SLO at 14.4x', () => {
    const out = runEngine(
      chain({
        run: run('o05', { rps: 2000, durationMs: 50_000 }),
        nodes: [
          queueNode('svc', 'microservice', { category: 'compute', serviceMs: 1, workers: 64 })
        ],
        edges: [tcp('source', 'svc', { errorRate: 0.0144 })]
      })
    )
    const n = out.summary.totalRequests
    const se = Math.sqrt((0.0144 * (1 - 0.0144)) / n)
    expect(Math.abs(out.summary.errorRate - 0.0144)).toBeLessThan(4 * se)
    expect(Math.abs(burnRate(out.summary.errorRate, 0.999) - 14.4)).toBeLessThan(14.4 * 0.08)
  })
})

test.describe('O-06 a reported percentile is the percentile of the latencies (ch16 section 3)', () => {
  const out = (() => {
    const svc = queueNode('svc', 'microservice', { category: 'compute', workers: 64 })
    ;(svc.processing as Record<string, unknown>).distribution = {
      type: 'exponential',
      lambda: 1 / 20
    }
    return runEngine(
      chain({
        run: run('o06', { rps: 200, pattern: 'poisson', durationMs: 60_000 }),
        nodes: [svc],
        edges: [tcp('source', 'svc')]
      })
    )
  })()
  const successes = out.requestOutcomes
    .filter((o) => o.status === 'success')
    .map((o) => o.latencyMs)

  for (const [name, p] of [
    ['p50', 0.5],
    ['p95', 0.95],
    ['p99', 0.99]
  ] as const) {
    test(`${name} equals the ${p} quantile of the successful latencies within 1%`, () => {
      expect(relErr(out.summary.latency[name], quantile(successes, p))).toBeLessThan(0.01)
    })
  }

  test('the mean sits well below the tail (exponential: p99 is 4.6 x the mean)', () => {
    expect(relErr(out.summary.latency.p99 / out.summary.latency.mean, Math.log(100))).toBeLessThan(
      0.1
    )
  })
})

test.describe('O-06b percentiles of slow requests (ch16 section 3)', () => {
  // Tracked gap (finding 29): the latency histogram tops out at 1 s ("the global timeout is a hard ceiling"), but
  // timeouts are configurable to minutes. Every percentile and the max of a service slower than 1 s read 1,003.5 ms
  // while the mean is right: a 5 s service has a p99 of 1 s.
  for (const serviceMs of [2000, 5000]) {
    test.fail(
      `a constant ${serviceMs} ms service reports p50, p99 and max of ${serviceMs} ms`,
      () => {
        const out = runEngine(
          chain({
            run: run(`o06b-${serviceMs}`, { rps: 5, durationMs: 60_000, timeoutMs: 120_000 }),
            nodes: [
              queueNode('svc', 'microservice', {
                category: 'compute',
                serviceMs,
                workers: 1000,
                timeoutMs: 120_000
              })
            ],
            edges: [tcp('source', 'svc')]
          })
        )
        expect(relErr(out.summary.latency.mean, serviceMs)).toBeLessThan(0.01)
        for (const q of [
          out.summary.latency.p50,
          out.summary.latency.p99,
          out.summary.latency.max
        ]) {
          expect(relErr(q, serviceMs)).toBeLessThan(0.02)
        }
      }
    )
  }

  test('below 1 s the histogram is within its stated 1% (200 ms reads 199.7 ms)', () => {
    const out = runEngine(
      chain({
        run: run('o06c', { rps: 5, durationMs: 30_000 }),
        nodes: [
          queueNode('svc', 'microservice', { category: 'compute', serviceMs: 200, workers: 100 })
        ],
        edges: [tcp('source', 'svc')]
      })
    )
    expect(relErr(out.summary.latency.p99, 200)).toBeLessThan(0.01)
  })
})

test.describe('O-07 failed requests are kept out of the latency (ch16 section 2)', () => {
  test('with 20% failing fast, the reported mean latency is the mean of the successes', () => {
    const out = runEngine(
      chain({
        run: run('o07', { rps: 200, durationMs: 30_000 }),
        nodes: [
          queueNode('svc', 'microservice', { category: 'compute', serviceMs: 10, workers: 64 })
        ],
        edges: [tcp('source', 'svc', { errorRate: 0.2 })]
      })
    )
    const ok = out.requestOutcomes.filter((o) => o.status === 'success').map((o) => o.latencyMs)
    expect(out.summary.errorRate).toBeGreaterThan(0.15)
    expect(relErr(out.summary.latency.mean, mean(ok))).toBeLessThan(0.01)
  })
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('O-08 the browser shows healthy users while the collector drops events', () => {
  test('0% errors in the page, matching the engine, with the collector overloaded', async ({
    page
  }) => {
    const t = withLogs('o08', { telemetryAsyncIngest: true })
    const out = runEngine(t)
    expect(out.perNode.logs.traitCounters.telemetryDropped).toBeGreaterThan(1000)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'svc')
    expect(ui.errorRatePct).toBe(0)
  })
})
