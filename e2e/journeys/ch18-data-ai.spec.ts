/**
 * Chapter 18: data infrastructure and AI (docs/reference/18-data-infrastructure-and-ai.md).
 * Expected values come from the chapter: one aggregate per window holding rate x window events, LLM latency =
 * per-token time x output tokens, concurrency of streams = rate x response time, batch cost amortised over the batch,
 * a batch job slower than its period builds a backlog. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { bodyText, importTopology, openApp, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 0,
    seed,
    timeoutMs: 60_000,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

// ───────────────────────── 1. Windowing ─────────────────────────

test.describe('W-01 a window emits one aggregate per window holding rate x window events (ch18 section 2)', () => {
  const windowed = (seed: string, rps: number, windowMs: number, durationMs = 30_000) =>
    runEngine(
      chain({
        run: run(seed, { rps, durationMs }),
        nodes: [
          queueNode('agg', 'streaming-analytics', {
            category: 'data-infra-and-analytics',
            serviceMs: 1,
            workers: 64,
            config: { windowMs }
          })
        ],
        edges: [tcp('source', 'agg')]
      })
    )

  for (const [rps, windowMs] of [
    [1000, 5000],
    [200, 1000],
    [50, 10_000]
  ] as const) {
    test(`${rps} events/s in ${windowMs} ms windows: ${(rps * windowMs) / 1000} events per window, one window per ${windowMs} ms`, () => {
      const out = windowed(`w01-${rps}-${windowMs}`, rps, windowMs)
      const c = out.perNode.agg.traitCounters
      const expectedWindows = Math.floor(30_000 / windowMs)
      // The final window closes at the end of the run or just after it.
      expect(Math.abs(c.windowsEmitted - expectedWindows)).toBeLessThanOrEqual(1)
      expect(
        Math.abs(c.eventsAggregated / c.windowsEmitted - (rps * windowMs) / 1000)
      ).toBeLessThan(((rps * windowMs) / 1000) * 0.03)
    })
  }

  test('every event lands in exactly one window (tumbling windows do not overlap)', () => {
    const out = windowed('w01b', 200, 2000)
    const c = out.perNode.agg.traitCounters
    expect(c.eventsAggregated).toBeLessThanOrEqual(c.windowedEvents)
    // Only the open window at the end of the run can hold events that were not yet emitted.
    expect(c.windowedEvents - c.eventsAggregated).toBeLessThanOrEqual(200 * 2 + 5)
  })

  test('the result is at least a window old: windows are emitted on a timer, not per event', () => {
    const out = windowed('w01c', 500, 5000)
    expect(out.perNode.agg.traitCounters.windowsEmitted).toBeLessThan(
      out.perNode.agg.totalArrived / 100
    )
  })
})

// ───────────────────────── 2. LLM latency ─────────────────────────

test.describe('T-01 an LLM response takes per-token time x output tokens (ch18 section 5)', () => {
  const llm = (
    seed: string,
    msPerToken: number,
    outputTokens: number,
    over: Partial<RunSpec> = {}
  ) =>
    runEngine(
      chain({
        run: run(seed, { rps: 10, durationMs: 60_000, ...over }),
        nodes: [
          queueNode('llm', 'llm-gateway', {
            category: 'external-and-integration',
            serviceMs: 100,
            workers: 1000,
            capacity: 100_000,
            config: { msPerToken, outputTokens }
          })
        ],
        edges: [tcp('source', 'llm')]
      })
    )

  test('500 output tokens at 20 ms per token: 10 s of generation on top of the 100 ms first-token cost', () => {
    const out = llm('t01', 20, 500)
    expect(relErr(out.summary.latency.mean, 100 + 500 * 20)).toBeLessThan(0.01)
    expect(relErr(out.summary.latency.p50, 100 + 500 * 20)).toBeLessThan(0.02)
  })

  test('doubling the output tokens doubles the generation part', () => {
    const a = llm('t01a', 20, 250).summary.latency.mean - 100
    const b = llm('t01b', 20, 500).summary.latency.mean - 100
    expect(relErr(b / a, 2)).toBeLessThan(0.01)
  })

  test('latency does not depend on request rate (a chatty prompt is slow however little traffic there is)', () => {
    const low = llm('t01c', 20, 100, { rps: 1 }).summary.latency.mean
    const high = llm('t01d', 20, 100, { rps: 50 }).summary.latency.mean
    expect(Math.abs(low - high)).toBeLessThan(5)
  })

  test('10 requests/s x 10 s each keeps 100 streams open (Little)', () => {
    const out = llm('t01e', 20, 500, { durationMs: 120_000 })
    const check = out.littlesLawCheck.find((c) => c.nodeId === 'llm')!
    expect(relErr(check.observedL, 10 * 10.1)).toBeLessThan(0.05)
  })

  test('the token counter equals requests x output tokens', () => {
    const out = llm('t01f', 20, 128, { durationMs: 20_000 })
    const c = out.perNode.llm.traitCounters
    expect(c.tokensGenerated).toBe(c.llmCompletions * 128)
  })
})

test.describe('T-02 sequential model calls add their latencies (ch18 section 5)', () => {
  // Finding 22 (fixed): a latency penalty set by one node was charged again at every node after it. Five
  // sequential 4 s calls (200 tokens at 20 ms) take 5 x (4 s + 100 ms).
  test('an agent making 5 sequential 4 s model calls takes about 20.5 s', () => {
    const ids = ['s1', 's2', 's3', 's4', 's5']
    const out = runEngine(
      chain({
        run: run('t02', { rps: 1, durationMs: 120_000 }),
        nodes: ids.map((id) =>
          queueNode(id, 'llm-gateway', {
            category: 'external-and-integration',
            serviceMs: 100,
            workers: 100,
            config: { msPerToken: 20, outputTokens: 200 }
          })
        ),
        edges: [
          tcp('source', 's1'),
          tcp('s1', 's2'),
          tcp('s2', 's3'),
          tcp('s3', 's4'),
          tcp('s4', 's5')
        ]
      })
    )
    expect(relErr(out.summary.latency.mean, 5 * 4100)).toBeLessThan(0.02)
  })
})

// ───────────────────────── 3. Batching ─────────────────────────

test.describe('B-01 batching amortises the fixed cost and adds the formation wait (ch18 section 4)', () => {
  const batch = (seed: string, batchSize: number, over: Partial<RunSpec> = {}) =>
    runEngine(
      chain({
        run: run(seed, { rps: 20, durationMs: 30_000, ...over }),
        nodes: [
          queueNode('gpu', 'gpu-node', {
            category: 'compute',
            serviceMs: 0.5,
            workers: 1,
            capacity: 100_000,
            config: { batchSize, batchWindowMs: 10, fixedCostMs: 40 }
          })
        ],
        edges: [tcp('source', 'gpu')]
      })
    )

  for (const n of [2, 8, 32]) {
    test(`batch of ${n}: per-item cost is 40 / ${n} = ${40 / n} ms plus a mean formation wait of 5 ms`, () => {
      const out = batch(`b01-${n}`, n)
      expect(Math.abs(out.summary.latency.mean - (0.5 + 40 / n + 5))).toBeLessThan(0.2)
    })
  }

  // Tracked gap (finding 28): batching is charged as extra time on each request, formation wait included, so a worker
  // is held for the wait. At saturation batches fill at once and a batch of 8 at 40 ms serves 200 req/s;
  // the engine serves about 1 / (0.5 + 5 + 5) ms = 95 req/s.
  test.fail(
    'a saturated batch of 8 at 40 ms per batch serves about 200 requests per second',
    () => {
      const out = batch('b01-sat', 8, { rps: 400, durationMs: 30_000 })
      const windows = out.summary.latencyWindows.filter(
        (w) => w.windowStartMs >= 5000 && w.windowEndMs <= 25_000
      )
      const rate = windows.reduce((a, w) => a + w.successCount, 0) / windows.length
      expect(relErr(rate, 200)).toBeLessThan(0.1)
    }
  )
})

// ───────────────────────── 4. Batch jobs ─────────────────────────

test.describe('E-01 a batch job slower than its period builds a backlog (ch18 section 1)', () => {
  test('one job every 10 s taking 12 s: completed jobs follow 1 / 12 s, the rest wait', () => {
    const etl = queueNode('etl', 'etl-pipeline', {
      category: 'data-infra-and-analytics',
      serviceMs: 12_000,
      workers: 1,
      capacity: 1000,
      timeoutMs: 600_000
    })
    const out = runEngine(
      chain({
        run: run('e01', { rps: 0.1, durationMs: 120_000, timeoutMs: 600_000 }),
        nodes: [etl],
        edges: [tcp('source', 'etl')]
      })
    )
    const arrived = out.perNode.etl.totalArrived
    const done = out.perNode.etl.totalProcessed
    expect(arrived).toBeGreaterThanOrEqual(11)
    expect(Math.abs(done - Math.floor(120 / 12))).toBeLessThanOrEqual(1)
    expect(arrived - done).toBeGreaterThanOrEqual(2)
  })

  test('a job faster than its period keeps up: nothing waits', () => {
    const etl = queueNode('etl', 'etl-pipeline', {
      category: 'data-infra-and-analytics',
      serviceMs: 8000,
      workers: 1,
      capacity: 1000,
      timeoutMs: 600_000
    })
    const out = runEngine(
      chain({
        run: run('e01b', { rps: 0.1, durationMs: 120_000, timeoutMs: 600_000 }),
        nodes: [etl],
        edges: [tcp('source', 'etl')]
      })
    )
    expect(out.perNode.etl.peakQueueLength).toBe(0)
  })
})

// ───────────────────────── 5. The browser agrees ─────────────────────────

test.describe('T-03 the browser shows the LLM latency the engine computed', () => {
  test('500 tokens at 20 ms shows the p50 the engine reports and the mean is 10.1 s', async ({
    page
  }) => {
    const t = chain({
      run: run('t03', { rps: 2, durationMs: 40_000 }),
      nodes: [
        queueNode('llm', 'llm-gateway', {
          category: 'external-and-integration',
          serviceMs: 100,
          workers: 100,
          config: { msPerToken: 20, outputTokens: 500 }
        })
      ],
      edges: [tcp('source', 'llm')]
    })
    const out = runEngine(t)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    // The page switches to seconds above 1,000 ms, so read the value and its unit.
    const text = await bodyText(page)
    const m = text.match(/\np50\s*\n([\d.,]+)\s*(ms|s)\b/)
    expect(m, 'a p50 with a unit').not.toBeNull()
    const uiMs = Number(m![1].replace(/,/g, '')) * (m![2] === 's' ? 1000 : 1)
    expect(relErr(uiMs, out.summary.latency.p50)).toBeLessThan(0.02)
    // Theory for the value itself (100 ms + 500 tokens x 20 ms = 10.1 s) is asserted on the mean here; the percentile
    // is checked in ch16 O-06b (finding 29, fixed).
    expect(relErr(out.summary.latency.mean, 100 + 500 * 20)).toBeLessThan(0.01)
  })
})
