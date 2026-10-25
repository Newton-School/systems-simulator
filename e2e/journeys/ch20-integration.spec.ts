/**
 * Chapter 20: integration (docs/reference/20-integration.md).
 * Expected values come from the chapter: a third-party call adds the provider's latency, serial dependencies multiply
 * their availabilities, an idempotency key makes a repeat inside the window a no-op (distinct keys reach the backend, the rest
 * are answered from the store), a key outside the window is a new request. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { bodyText, importTopology, openApp, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { expectedDistinctKeys, relErr } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 20_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

const INT = 'external-and-integration'
const provider = (id: string, type: string, config: Record<string, unknown> = {}, serviceMs = 5) =>
  queueNode(id, type, { category: INT, serviceMs, workers: 64, config })

// ───────────────────────── 1. Provider latency and availability ─────────────────────────

test.describe('INT-01 a provider call adds the provider latency (ch20 section 1)', () => {
  for (const type of [
    'payment-gateway',
    'third-party-api-connector',
    'third-party-auth',
    'webhook-gateway'
  ]) {
    test(`${type}: 5 ms of own service + 120 ms of provider latency`, () => {
      const out = runEngine(
        chain({
          run: run(`int01-${type}`, { rps: 20 }),
          nodes: [provider('ext', type, { externalLatencyMs: 120 })],
          edges: [tcp('source', 'ext')]
        })
      )
      expect(Math.abs(out.summary.latency.mean - 125)).toBeLessThan(0.3)
    })
  }

  test('a slow provider holds workers: concurrency = rate x provider latency (Little)', () => {
    const out = runEngine(
      chain({
        run: run('int01b', { rps: 200, durationMs: 30_000 }),
        nodes: [provider('ext', 'payment-gateway', { externalLatencyMs: 245 })],
        edges: [tcp('source', 'ext')]
      })
    )
    const check = out.littlesLawCheck.find((c) => c.nodeId === 'ext')!
    expect(relErr(check.observedL, 200 * 0.25)).toBeLessThan(0.03)
  })
})

test.describe('INT-02 serial dependencies multiply their availabilities (ch20 section 1)', () => {
  const series = (k: number, failure: number) => {
    const ids = Array.from({ length: k }, (_, i) => `dep${i}`)
    return runEngine(
      chain({
        run: run(`int02-${k}`, { rps: 500, durationMs: 40_000 }),
        nodes: ids.map((id) => provider(id, 'third-party-api-connector', {}, 1)),
        edges: [
          tcp('source', ids[0], { errorRate: failure }),
          ...ids.slice(1).map((id, i) => tcp(ids[i], id, { errorRate: failure }))
        ]
      })
    )
  }

  for (const k of [1, 3, 5]) {
    test(`${k} dependencies each failing 2%: success is 0.98^${k} = ${(0.98 ** k).toFixed(3)}`, () => {
      const out = series(k, 0.02)
      const n = out.summary.totalRequests
      const p = 0.98 ** k
      const se = Math.sqrt((p * (1 - p)) / n)
      expect(Math.abs(out.summary.successfulRequests / n - p)).toBeLessThan(4 * se)
    })
  }
})

// ───────────────────────── 2. Idempotency ─────────────────────────

test.describe('INT-03 an idempotency key makes a repeat inside the window a no-op (ch20 section 2)', () => {
  const KEYS = 1000
  const payments = (seed: string, windowMs: number | null, over: Partial<RunSpec> = {}) =>
    runEngine(
      chain({
        run: run(seed, { pattern: 'poisson', durationMs: 60_000, ...over }),
        nodes: [
          ...(windowMs === null
            ? []
            : [
                queueNode('idem', 'idempotency-manager', {
                  category: 'auxiliary',
                  serviceMs: 1,
                  workers: 64,
                  config: { dedupWindowMs: windowMs, storeLookupMs: 1 }
                })
              ]),
          provider('pay', 'payment-gateway', { externalLatencyMs: 100 })
        ],
        edges:
          windowMs === null ? [tcp('source', 'pay')] : [tcp('source', 'idem'), tcp('idem', 'pay')],
        requestDistribution: [
          {
            type: 'POST',
            weight: 1,
            sizeBytes: 100,
            keyspace: { field: 'idempotencyKey', size: KEYS }
          }
        ]
      })
    )

  test('a window longer than the run lets exactly the distinct keys through to the provider', () => {
    const out = payments('int03', 300_000)
    const n = out.perNode.idem.totalArrived
    const distinct = expectedDistinctKeys(KEYS, n)
    expect(Math.abs(out.perNode.pay.totalArrived - distinct)).toBeLessThan(8)
    const c = out.perNode.idem.traitCounters
    // every request is either a first sighting (executed) or a duplicate (answered from the store)
    expect(Math.abs(c.idempotencyUniqueKeys + c.idempotencyDuplicateHits - n)).toBeLessThanOrEqual(
      2
    )
    expect(c.idempotencyUniqueKeys).toBe(out.perNode.pay.totalArrived)
  })

  test('without the manager every request executes: the provider sees all of them', () => {
    const out = payments('int03b', null)
    expect(out.perNode.pay.totalArrived).toBeGreaterThan(5000)
  })

  test('a 100 ms window catches only repeats within 100 ms: about 1 - e^(-0.1 x 0.1) = 1% of requests', () => {
    // 200 req/s over 1,000 keys is 0.2 per key per second; repeat within 0.1 s: 1 - e^(-0.02) = 1.98%, taken against the key's last recording
    const out = payments('int03c', 100, { rps: 200, durationMs: 120_000 })
    const c = out.perNode.idem.traitCounters
    const n = out.perNode.idem.totalArrived
    const expected = 1 - Math.exp(-(200 / KEYS) * 0.1)
    expect(relErr(c.idempotencyDuplicateHits / n, expected)).toBeLessThan(0.15)
  })

  test('a duplicate is answered from the store in about the lookup time, not the provider time', () => {
    const out = payments('int03d', 300_000)
    const dup = out.requestOutcomes.filter((o) => o.nodeId === 'idem' && o.status === 'success')
    const executed = out.requestOutcomes.filter((o) => o.nodeId === 'pay' && o.status === 'success')
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(dup.map((o) => o.latencyMs))).toBeLessThan(5)
    expect(mean(executed.map((o) => o.latencyMs))).toBeGreaterThan(100)
  })
})

// ───────────────────────── 3. Not modelled (decisions) ─────────────────────────

test.describe('INT-04 provider behaviour beyond latency (ch20 sections 1 and 3)', () => {
  // Decision needed (ch20 open items): a provider's rate limit is not a setting; above it a real provider answers 429.
  test.fixme('a provider limited to 100 req/s answers 429 above it', () => {
    const out = runEngine(
      chain({
        run: run('int04', { rps: 200 }),
        nodes: [
          provider('ext', 'third-party-api-connector', { externalLatencyMs: 20, rateLimitRps: 100 })
        ],
        edges: [tcp('source', 'ext')]
      })
    )
    expect(Math.abs(out.summary.errorRate - 0.5)).toBeLessThan(0.05)
  })

  // Decision needed: a webhook gateway delivers once; a real provider retries a failed delivery with exponential
  // backoff for up to three days, so the receiver sees duplicates.
  test.fixme('a webhook delivery that failed is retried, so the receiver can see the same event twice', () => {
    const out = runEngine(
      chain({
        run: run('int04b', { rps: 10 }),
        nodes: [
          provider('hook', 'webhook-gateway', { externalLatencyMs: 20 }),
          provider('recv', 'microservice', {}, 1)
        ],
        edges: [tcp('source', 'hook'), tcp('hook', 'recv', { errorRate: 0.5 })]
      })
    )
    expect(out.perNode.recv.totalArrived).toBeGreaterThan(out.perNode.hook.totalArrived)
  })
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('INT-05 the browser shows the provider latency the engine computed', () => {
  test('a payment gateway with 120 ms of provider latency shows a p50 of about 125 ms', async ({
    page
  }) => {
    const t = chain({
      run: run('int05', { rps: 20, durationMs: 20_000 }),
      nodes: [provider('pay', 'payment-gateway', { externalLatencyMs: 120 })],
      edges: [tcp('source', 'pay')]
    })
    const out = runEngine(t)
    expect(Math.abs(out.summary.latency.p50 - 125)).toBeLessThan(2)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const text = await bodyText(page)
    const m = text.match(/\np50\s*\n([\d.,]+)\s*(ms|s)\b/)
    expect(m, 'a p50 with a unit').not.toBeNull()
    const uiMs = Number(m![1].replace(/,/g, '')) * (m![2] === 's' ? 1000 : 1)
    expect(relErr(uiMs, out.summary.latency.p50)).toBeLessThan(0.03)
  })
})
