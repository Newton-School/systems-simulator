/**
 * Chapter 17: DevOps and delivery (docs/reference/17-devops-and-delivery.md).
 * Expected values come from the chapter: a canary gets its weight of the traffic, a bad release hurts weight x rate
 * x time until rollback (20x less than an all-at-once release at 5%), how long a canary needs to collect enough requests, a
 * remote flag lookup costs its latency on every request. Delivery is expressed with routing weights and scheduled faults,
 * since a deployment controller node has no behaviour of its own. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { canarySamples, relErr } from '../support/oracles'
import { chain, passNode, queueNode, type RunSpec } from '../support/topology'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 1000,
    pattern: 'constant',
    durationMs: 120_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

const version = (id: string) =>
  queueNode(id, 'microservice', { category: 'compute', serviceMs: 1, workers: 256 })

/** source -> lb -> stable | canary, weighted `100 - w : w`, health ejection off so exposure is exactly the weight. */
function release(
  seed: string,
  canaryPct: number,
  over: Partial<RunSpec> = {},
  faults: Record<string, unknown>[] = []
) {
  return chain({
    run: run(seed, over),
    nodes: [
      passNode('lb', 'load-balancer', { routingStrategy: 'weighted', healthCheckEnabled: false }),
      version('stable'),
      version('canary')
    ],
    edges: [
      tcp('source', 'lb'),
      tcp('lb', 'stable', { weight: 100 - canaryPct }),
      tcp('lb', 'canary', { weight: canaryPct })
    ],
    faults
  })
}

const badFor = (seconds: number) => [
  {
    targetId: 'canary',
    faultType: 'node-failure',
    timing: 'deterministic',
    duration: 'fixed',
    params: { atMs: 0, durationMs: seconds * 1000, mode: 'reject' }
  }
]

// ───────────────────────── 1. Canary exposure ─────────────────────────

test.describe('D-01 a canary receives its weight of the traffic (ch17 section 3)', () => {
  for (const pct of [1, 5, 25]) {
    test(`${pct}% canary: share within 4 standard errors`, () => {
      const out = runEngine(release(`d01-${pct}`, pct, { durationMs: 60_000 }))
      const total = out.perNode.stable.totalArrived + out.perNode.canary.totalArrived
      const p = pct / 100
      const se = Math.sqrt((p * (1 - p)) / total)
      expect(Math.abs(out.perNode.canary.totalArrived / total - p)).toBeLessThan(
        Math.max(4 * se, 0.002)
      )
    })
  }

  test('5% of 1,000 req/s is 50 req/s, so the 2,364 requests a 1% vs 2% comparison needs take about 47 s', () => {
    const out = runEngine(release('d01-time', 5, { durationMs: 120_000 }))
    const canaryRps = out.perNode.canary.totalArrived / 120
    expect(relErr(canaryRps, 50)).toBeLessThan(0.05)
    const secondsNeeded = canarySamples(0.01, 0.02) / canaryRps
    expect(Math.abs(secondsNeeded - 47)).toBeLessThan(4)
  })
})

test.describe('D-02 a bad release hurts weight x rate x time until rollback (ch17 section 3)', () => {
  const SECONDS = 60
  // failedRequests already includes the rejected ones
  const failed = (out: ReturnType<typeof runEngine>) => out.summary.failedRequests

  test('a canary that fails everything for 60 s at 5% and 1,000 req/s fails about 3,000 requests', () => {
    const out = runEngine(release('d02', 5, {}, badFor(SECONDS)))
    const expected = 0.05 * 1000 * SECONDS
    const se = Math.sqrt(expected)
    expect(Math.abs(failed(out) - expected)).toBeLessThan(4 * se)
  })

  test('the same bad release sent to everyone at once fails about 60,000: twenty times the harm', () => {
    const everyone = chain({
      run: run('d02b'),
      nodes: [version('canary')],
      edges: [tcp('source', 'canary')],
      faults: badFor(SECONDS)
    })
    const small = failed(runEngine(release('d02c', 5, {}, badFor(SECONDS))))
    const all = failed(runEngine(everyone))
    expect(relErr(all, 1000 * SECONDS)).toBeLessThan(0.02)
    expect(Math.abs(all / small - 20)).toBeLessThan(2)
  })

  test('after the rollback the canary is clean again: no failures in the last minute', () => {
    const out = runEngine(release('d02d', 5, {}, badFor(SECONDS)))
    const late = out.requestOutcomes.filter(
      (o) => o.createdAtMs >= (SECONDS + 5) * 1000 && o.status !== 'success'
    )
    expect(late.length).toBe(0)
  })
})

// ───────────────────────── 2. Flags and the controller ─────────────────────────

test.describe('D-03 a remote flag lookup costs its latency on every request (ch17 section 4)', () => {
  const withFlag = (flagMs: number | null) =>
    runEngine(
      chain({
        run: run('d03', { rps: 100, durationMs: 20_000 }),
        nodes: [
          ...(flagMs === null
            ? []
            : [
                queueNode('flags', 'feature-flag-service', {
                  category: 'devops-and-delivery',
                  serviceMs: flagMs,
                  workers: 64
                })
              ]),
          version('app')
        ],
        edges:
          flagMs === null ? [tcp('source', 'app')] : [tcp('source', 'flags'), tcp('flags', 'app')]
      })
    )

  test('a 2 ms flag service in front of a 1 ms app makes 3 ms; evaluating locally leaves 1 ms', () => {
    expect(Math.abs(withFlag(2).summary.latency.mean - 3)).toBeLessThan(0.1)
    expect(Math.abs(withFlag(null).summary.latency.mean - 1)).toBeLessThan(0.05)
  })
})

test.describe('D-04 a deployment controller should simulate a rollout by itself (ch17 section 8)', () => {
  // Decision needed: the deployment-controller node has no behaviour, so a rolling update, a blue-green cut-over or a
  // staged canary promotion cannot be described on one node. The expectation below is the chapter's rolling-update floor.
  test.fixme('a rolling update never drops below replicas - maxUnavailable ready replicas', () => {
    const controller = queueNode('deploy', 'deployment-controller', {
      category: 'devops-and-delivery',
      config: { strategy: 'rolling', replicas: 10, maxSurge: '25%', maxUnavailable: '25%' }
    })
    const out = runEngine(
      chain({ run: run('d04'), nodes: [controller], edges: [tcp('source', 'deploy')] })
    )
    const ready = out.timeSeries.map((s) => s.node.deploy.workers)
    expect(Math.min(...ready)).toBeGreaterThanOrEqual(8)
  })
})

// ───────────────────────── 3. The browser agrees ─────────────────────────

test.describe('D-05 the browser shows the harm the engine computed for a bad canary', () => {
  test('5% canary failing for the whole 20 s run shows about 5% errors', async ({ page }) => {
    const t = release('d05', 5, { rps: 200, durationMs: 20_000 }, badFor(20))
    const out = runEngine(t)
    expect(Math.abs(out.summary.errorRate - 0.05)).toBeLessThan(0.01)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'lb')
    expect(Math.abs(ui.errorRatePct - 5)).toBeLessThan(1.5)
  })
})
