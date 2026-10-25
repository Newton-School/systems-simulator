/**
 * Chapter 02: reliability and resilience patterns (docs/reference/02-reliability-patterns.md).
 * Expected values come from the chapter's formulas (e2e/support/oracles.ts), never from engine output.
 *
 * Simulator facts these flows rely on (read from the engine, listed so a reader can check them):
 *   - retry and circuit-breaker config live on a CALLER service node (one that calls a downstream);
 *     the traffic source itself does not apply them
 *   - the breaker only gates on sidecar, service-mesh and circuit-breaker-controller nodes
 *   - maxAttempts counts the first try (total attempts)
 *   - m5.large cpu-bound = 2 workers, service time unchanged
 */
import { expect, test } from '../support/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { expectedAttempts, relErr } from '../support/oracles'
import { chain, computeNode, passNode, type RunSpec } from '../support/topology'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from '../../src/engine/traits/serviceTimeOverride'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: `ch02-${seed}`,
    rps: 50,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 0,
    seed,
    timeoutMs: 1000,
    ...over
  }
}

function fault(
  targetId: string,
  params: Record<string, unknown>,
  duration: 'permanent' | 'fixed' = 'permanent'
) {
  return { targetId, faultType: 'node-failure', timing: 'deterministic', duration, params }
}

// ───────────────────────── 1. Timeouts and failure shape ─────────────────────────

test.describe('R-01 failure shape: reject is fast, blackhole walls at the timeout (ch02 1)', () => {
  const T = 30_000
  const TF = 10_000
  const TIMEOUT = 1000
  const topo = (mode: 'reject' | 'blackhole') =>
    chain({
      run: run(`r01-${mode}`, { durationMs: T }),
      nodes: [computeNode('srv', { serviceMs: 10, timeoutMs: TIMEOUT })],
      faults: [fault('srv', { atMs: TF, mode })]
    })

  test('THEORY reject: error share is (T - tf) / T and failures return within a network hop', () => {
    const out = runEngine(topo('reject'))
    const expected = (T - TF) / T
    expect(Math.abs(out.summary.errorRate - expected)).toBeLessThan(0.03)
    const fast = out.summary.timeToErrorByCause.node_failed
    expect(fast.count).toBeGreaterThan(0)
    expect(fast.p50 as number).toBeLessThan(50)
    // Nothing fails before the fault: every 1 s window before tf has zero errors.
    const early = out.summary.latencyWindows.filter((w) => w.windowEndMs <= TF)
    expect(early.length).toBeGreaterThan(0)
    expect(early.every((w) => w.errorCount === 0)).toBe(true)
  })

  test('THEORY blackhole: new requests wait out the whole timeout; error share is (T - timeout - tf) / (T - timeout)', () => {
    const out = runEngine(topo('blackhole'))
    const expected = (T - TIMEOUT - TF) / (T - TIMEOUT)
    expect(Math.abs(out.summary.errorRate - expected)).toBeLessThan(0.04)
    const wall = out.summary.timeToErrorByCause.timeout
    expect(wall.count).toBeGreaterThan(0)
    expect(relErr(wall.p50 as number, TIMEOUT)).toBeLessThan(0.05)
    expect(relErr(wall.p99 as number, TIMEOUT)).toBeLessThan(0.1)
  })

  test('UI shows the outage in the results (regression: node down was not visible)', async ({
    page
  }) => {
    const topology = topo('reject')
    const out = runEngine(topology)
    await openApp(page)
    await importTopology(page, topology)
    await runAndWait(page)
    const ui = await readUiRun(page)
    expect(ui.errorRatePct).toBeGreaterThan(50)
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(2)
  })
})

// ───────────────────────── 2. Retries ─────────────────────────

test.describe('R-02 retry amplification: attempts per call = (1 - p^n) / (1 - p) (ch02 2)', () => {
  const p = 0.5
  const attempts = 4 // maxAttempts counts the first try, so 3 retries
  const retry = { maxAttempts: attempts, baseDelay: 5, maxDelay: 20, multiplier: 2, jitter: true }
  const build = (withRetry: boolean, seed: string) =>
    chain({
      run: run(seed, { rps: 50, durationMs: 120_000, timeoutMs: 5000 }),
      nodes: [
        computeNode('gw', {
          serviceMs: 1,
          timeoutMs: 5000,
          resilience: withRetry ? { retry } : undefined
        }),
        computeNode('srv', { serviceMs: 5, timeoutMs: 5000, config: { nodeErrorRate: p } })
      ]
    })

  test('THEORY without retry: one attempt per call and a failure rate of p', () => {
    const out = runEngine(build(false, 'r02-off'))
    expect(relErr(out.perNode.srv.totalArrived, out.summary.totalRequests)).toBeLessThan(0.01)
    expect(Math.abs(out.summary.errorRate - p)).toBeLessThan(0.03)
  })

  test('THEORY with retry: srv load multiplies by 1.875 and residual failures fall to p^4', () => {
    const out = runEngine(build(true, 'r02-on'))
    const amplification = out.perNode.srv.totalArrived / out.summary.totalRequests
    // 2%: an off-by-one in the retry count moves the expected value by 3 to 7%, so it must fail.
    expect(relErr(amplification, expectedAttempts(p, attempts - 1))).toBeLessThan(0.02)
    expect(Math.abs(out.summary.errorRate - p ** attempts)).toBeLessThan(0.02)
    // Chapter bound: never more than (1 + r) attempts per call.
    expect(amplification).toBeLessThanOrEqual(attempts)
  })

  // Decision D1 (done): a node's own timeout firing before the request's deadline is a retryable failure, so a caller
  // that retries rides over a blackhole. Outage 10 s to 12 s; the server's timeout is 100 ms and the caller makes up to
  // five attempts 500 ms apart, so a request arriving during the outage makes its last attempt at arrival + 4 x 600 ms
  // >= 12 s and succeeds. Without retries the error share is the outage fraction, 2 / 30.
  test('R-02c a retry rides over a timeout (blackhole) failure', () => {
    const build = (seed: string, retries: boolean) =>
      chain({
        run: run(seed, { rps: 100, durationMs: 30_000, timeoutMs: 5000 }),
        nodes: [
          computeNode('gw', {
            serviceMs: 1,
            timeoutMs: 5000,
            resilience: retries
              ? {
                  retry: {
                    maxAttempts: 5,
                    baseDelay: 500,
                    maxDelay: 500,
                    multiplier: 1,
                    jitter: false
                  }
                }
              : undefined
          }),
          computeNode('srv', { serviceMs: 5, timeoutMs: 100 })
        ],
        edges: [
          ['source', 'gw'],
          ['gw', 'srv']
        ],
        faults: [fault('srv', { atMs: 10_000, durationMs: 2000, mode: 'blackhole' }, 'fixed')]
      })
    const without = runEngine(build('r02c-off', false))
    const withRetries = runEngine(build('r02c-on', true))
    expect(Math.abs(without.summary.errorRate - 2 / 30)).toBeLessThan(0.02)
    expect(withRetries.summary.errorRate).toBeLessThan(0.01)
  })
})

// ───────────────────────── 3. Circuit breaker ─────────────────────────

test.describe('R-03 circuit breaker: opens, fails fast, probes, closes (ch02 3)', () => {
  const breaker = {
    failureThreshold: 0.5,
    failureCount: 10,
    recoveryTimeout: 5000,
    halfOpenRequests: 1
  }
  const RPS = 100
  const T = 30_000
  const build = (withBreaker: boolean, seed: string, recoverAfterMs?: number) =>
    chain({
      run: run(seed, { rps: RPS, durationMs: T, timeoutMs: 1000 }),
      nodes: [
        computeNode('gw', {
          type: 'sidecar',
          serviceMs: 1,
          timeoutMs: 1000,
          resilience: withBreaker ? { circuitBreaker: breaker } : undefined
        }),
        computeNode('srv', { serviceMs: 5, timeoutMs: 1000 })
      ],
      faults: [
        recoverAfterMs
          ? fault('srv', { atMs: 5000, mode: 'reject', durationMs: recoverAfterMs }, 'fixed')
          : fault('srv', { atMs: 5000, mode: 'reject' })
      ]
    })

  test('THEORY backend permanently down: the breaker keeps load off it (about threshold + one probe per recovery interval)', () => {
    const noBreaker = runEngine(build(false, 'r03-off'))
    const withBreaker = runEngine(build(true, 'r03-on'))
    const outageSec = (T - 5000) / 1000
    // Without a breaker the dead node is hit by every request of the outage.
    expect(noBreaker.perNode.srv.totalArrived).toBeGreaterThan(RPS * outageSec * 0.9)
    // With one: minimum calls before it can trip (10), plus one probe per 5 s recovery timeout.
    const probes = Math.ceil((T - 5000) / breaker.recoveryTimeout)
    const budget = breaker.failureCount + probes * breaker.halfOpenRequests + RPS * 5 // + the 5 s of healthy traffic
    expect(withBreaker.perNode.srv.totalArrived).toBeLessThan(budget * 1.15)
    expect(withBreaker.eventCountsByType['circuit-breaker-open']).toBeGreaterThanOrEqual(1)
    // The same requests still fail for the caller, but quickly (no waiting on the dead node).
    expect(Math.abs(withBreaker.summary.errorRate - noBreaker.summary.errorRate)).toBeLessThan(0.05)
  })

  test('THEORY backend recovers: a successful probe closes the breaker and traffic resumes', () => {
    const out = runEngine(build(true, 'r03-recover', 10_000)) // down 5 s to 15 s
    expect(out.eventCountsByType['circuit-breaker-open']).toBeGreaterThanOrEqual(1)
    expect(out.eventCountsByType['circuit-breaker-close']).toBeGreaterThanOrEqual(1)
    const lateWindows = out.summary.latencyWindows.filter((w) => w.windowStartMs >= 22_000)
    expect(lateWindows.length).toBeGreaterThan(5)
    expect(lateWindows.every((w) => w.errorRate < 0.01)).toBe(true)
  })

  test('R-03d a breaker configured on a plain microservice is flagged as inert at import', async ({
    page
  }) => {
    // Found while building these flows: on a microservice the setting records state and emits
    // circuit-breaker-open events (250 in 30 s) but never rejects a call, so the dead backend still
    // gets every request. Whether it should gate is a product decision; until then the validator says so.
    const inert = chain({
      run: run('r03d', { rps: RPS, durationMs: T }),
      nodes: [
        computeNode('gw', { serviceMs: 1, resilience: { circuitBreaker: breaker } }),
        computeNode('srv', { serviceMs: 5 })
      ]
    })
    await openApp(page)
    const dialog = await importTopology(page, inert)
    expect(dialog).toMatch(
      /circuit breaker is configured but this component type does not apply one/i
    )

    await page.reload()
    await openApp(page)
    const honoured = chain({
      run: run('r03d-ok', { rps: RPS, durationMs: T }),
      nodes: [
        computeNode('gw', {
          type: 'sidecar',
          serviceMs: 1,
          resilience: { circuitBreaker: breaker }
        }),
        computeNode('srv', { serviceMs: 5 })
      ]
    })
    expect(await importTopology(page, honoured)).not.toMatch(/does not apply one/i)
  })

  test('THEORY errors below the threshold never open it (steady 5% vs 50% threshold)', () => {
    const out = runEngine(
      chain({
        run: run('r03-low', { rps: RPS, durationMs: T }),
        nodes: [
          computeNode('gw', {
            type: 'sidecar',
            serviceMs: 1,
            resilience: { circuitBreaker: breaker }
          }),
          computeNode('srv', { serviceMs: 5, config: { nodeErrorRate: 0.05 } })
        ]
      })
    )
    expect(out.eventCountsByType['circuit-breaker-open']).toBe(0)
    expect(Math.abs(out.summary.errorRate - 0.05)).toBeLessThan(0.02)
  })
})

// ───────────────────────── 4. Rate limiting ─────────────────────────

test.describe('R-04 token bucket: admitted = capacity + refill x time (ch02 4)', () => {
  const C = 20
  const R = 50
  const T = 30
  const build = (rps: number, seed: string) =>
    chain({
      run: run(seed, { rps, durationMs: T * 1000, timeoutMs: 5000 }),
      nodes: [
        passNode('rl', 'rate-limiter', {
          algorithm: 'token-bucket',
          maxTokens: C,
          refillRatePerSecond: R
        }),
        computeNode('srv', { serviceMs: 2, timeoutMs: 5000 })
      ]
    })

  test('THEORY offered far above the refill rate: admitted is capacity + R x T, the rest is rejected', () => {
    const out = runEngine(build(200, 'r04-over'))
    const admitted = out.perNode.srv.totalArrived
    const expectedAdmitted = C + R * T
    expect(relErr(admitted, expectedAdmitted)).toBeLessThan(0.03)
    expect(out.perNode.rl.totalRejected + admitted).toBe(out.summary.totalRequests)
  })

  test('THEORY offered below the refill rate: nothing is rejected', () => {
    const out = runEngine(build(30, 'r04-under'))
    expect(out.perNode.rl.totalRejected).toBe(0)
    expect(out.summary.errorRate).toBe(0)
  })
})

// ───────────────────────── 5. Bulkhead ─────────────────────────

test.describe('R-05 bulkhead: a slow class cannot starve a fast one; its admitted rate is slots / service time (ch02 5)', () => {
  // 8 workers (m5.2xlarge cpu-bound). reads: 160/s x 10 ms = 1.6 workers of demand.
  // reports: 40/s x 200 ms = 8 workers of demand, so together 9.6 > 8: overloaded without isolation.
  const dist = [
    { type: 'read', weight: 0.8, sizeBytes: 128 },
    {
      type: 'report',
      weight: 0.2,
      sizeBytes: 128,
      metadata: { [SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]: { type: 'constant', value: 200 } }
    }
  ]
  const build = (partitions: Record<string, number> | null, seed: string) =>
    chain({
      run: run(seed, {
        rps: 200,
        pattern: 'poisson',
        durationMs: 60_000,
        warmupMs: 5000,
        timeoutMs: 20_000
      }),
      requestDistribution: dist,
      nodes: [
        computeNode('srv', {
          serviceMs: 10,
          instanceType: 'm5.2xlarge',
          timeoutMs: 20_000,
          resilience: partitions ? { bulkhead: { partitions } } : undefined
        })
      ]
    })

  const p99 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.99)]
  const latencies = (out: ReturnType<typeof runEngine>, type: string) =>
    out.requestOutcomes
      .filter((r) => r.status === 'success' && r.latencyMs !== null && r.requestType === type)
      .map((r) => r.latencyMs as number)

  test('THEORY isolation: reads stay fast with a 4-slot report cap; without it they queue behind reports', () => {
    const without = runEngine(build(null, 'r05-off'))
    const withB = runEngine(build({ report: 4 }, 'r05-on'))
    expect(p99(latencies(without, 'read'))).toBeGreaterThan(100)
    expect(p99(latencies(withB, 'read'))).toBeLessThan(30)
  })

  // Poisson arrivals at 40 reports/s, each holding one of 4 slots for 0.2 s with no waiting room: a loss system with
  // offered load A = 40 x 0.2 = 8 Erlangs. Erlang B (insensitive to the service-time distribution) gives the
  // blocked share B(4, 8) = 0.575, so 40 x (1 - B) = 17 reports/s are served, below the naive 4 / 0.2 = 20 that a
  // perfectly regular arrival stream would get.
  test('THEORY capped class: Erlang B(4, 8) = 57.5% of reports are rejected, the rest served at 40 x (1 - B) per second', () => {
    const out = runEngine(build({ report: 4 }, 'r05-rate'))
    const windowSec = 55
    const served = latencies(out, 'report').length / windowSec
    let b = 1
    for (let n = 1; n <= 4; n += 1) b = (8 * b) / (n + 8 * b)
    expect(Math.abs(b - 0.575)).toBeLessThan(0.001)
    expect(out.perNode.srv.rejectionsByReason['bulkhead_full']).toBeGreaterThan(0)
    const reportRows = out.requestOutcomes.filter((r) => r.requestType === 'report')
    const rejected = reportRows.filter((r) => r.reasonCode === 'bulkhead_full').length
    const share = rejected / reportRows.length
    expect(Math.abs(share - b)).toBeLessThan(4 * Math.sqrt((b * (1 - b)) / reportRows.length))
    expect(relErr(served, 40 * (1 - b))).toBeLessThan(0.1)
  })
})

// ───────────────────────── 6. Load shedding ─────────────────────────

test.describe('R-06 load shedding: accepted work stays fast, goodput holds at capacity (ch02 6)', () => {
  // m5.large cpu-bound, 20 ms constant: capacity c / S = 2 / 0.02 = 100 per second. Offered 300.
  const CAP = 100
  const S_MS = 20
  const DEPTH = 10
  const build = (shed: boolean, seed: string) =>
    chain({
      run: run(seed, {
        rps: 300,
        pattern: 'poisson',
        durationMs: 60_000,
        warmupMs: 5000,
        timeoutMs: 500
      }),
      nodes: [
        computeNode('srv', {
          serviceMs: S_MS,
          timeoutMs: 500,
          config: shed ? { loadShedQueueDepth: DEPTH } : undefined
        })
      ]
    })

  test('THEORY with shedding: p99 <= (depth / c + 1) x S, goodput is about capacity, the surplus is shed', () => {
    const out = runEngine(build(true, 'r06-on'))
    const bound = (DEPTH / 2 + 1) * S_MS // 120 ms
    expect(out.summary.latency.p99).toBeLessThan(bound * 1.3)
    expect(relErr(out.summary.throughput, CAP)).toBeLessThan(0.05)
    expect(out.perNode.srv.rejectionsByReason['load_shed']).toBeGreaterThan(0)
  })

  test('THEORY without shedding: the same overload drives accepted-request p99 toward the timeout', () => {
    const shed = runEngine(build(true, 'r06-a'))
    const noShed = runEngine(build(false, 'r06-b'))
    expect(noShed.summary.latency.p99).toBeGreaterThan(shed.summary.latency.p99 * 3)
  })
})

// ───────────────────────── 7. Health-aware routing ─────────────────────────

test.describe('R-07 health-aware load balancing: survivors carry n/(n-1) of the load (ch02 7, ch01 8)', () => {
  const RPS = 100
  const T = 30
  const TF = 10
  const build = (healthCheck: boolean, seed: string) =>
    chain({
      run: run(seed, { rps: RPS, durationMs: T * 1000, timeoutMs: 1000 }),
      nodes: [
        passNode('lb', 'load-balancer-l7', { healthCheckEnabled: healthCheck }),
        computeNode('a', { serviceMs: 5, timeoutMs: 1000 }),
        computeNode('b', { serviceMs: 5, timeoutMs: 1000 })
      ],
      edges: [
        ['source', 'lb'],
        ['lb', 'a'],
        ['lb', 'b']
      ],
      faults: [fault('a', { atMs: TF * 1000, mode: 'reject' })]
    })

  test('THEORY health checks on: after a fails, b takes everything; no errors, b arrivals = rps x (tf/2 + (T - tf))', () => {
    const out = runEngine(build(true, 'r07-on'))
    expect(out.summary.errorRate).toBeLessThan(0.01)
    expect(relErr(out.perNode.b.totalArrived, RPS * (TF / 2 + (T - TF)))).toBeLessThan(0.05)
    expect(relErr(out.perNode.a.totalArrived, (RPS * TF) / 2)).toBeLessThan(0.1)
  })

  test('THEORY health checks off: half of every post-fault request still hits the dead node', () => {
    const out = runEngine(build(false, 'r07-off'))
    const expectedErrors = (RPS * (T - TF)) / 2
    const expectedRate = expectedErrors / (RPS * T)
    expect(Math.abs(out.summary.errorRate - expectedRate)).toBeLessThan(0.03)
    expect(relErr(out.perNode.a.totalArrived, (RPS * T) / 2)).toBeLessThan(0.05)
  })
})

test.describe('R-07c health detection delay (ch02 7)', () => {
  // A real balancer keeps sending traffic to a dead backend until probes notice: detection delay is
  // roughly probe interval x consecutive failures. A balancer takes `healthCheckIntervalMs` and
  // `healthCheckFailureThreshold` (decision C5; unset keeps the instant removal), and a Health Check Manager that
  // monitors the backends models the delay too; the flows below check both.
  const RPS = 100
  const INTERVAL_MS = 1000
  const THRESHOLD = 3
  const TF = 10

  test('a Health Check Manager keeps a failed backend in rotation for about interval x threshold', () => {
    const out = runEngine(
      chain({
        run: run('r07d', { rps: RPS, durationMs: 30_000, timeoutMs: 1000 }),
        nodes: [
          passNode('lb', 'load-balancer-l7', { healthCheckEnabled: true }),
          computeNode('a', { serviceMs: 5, timeoutMs: 1000 }),
          computeNode('b', { serviceMs: 5, timeoutMs: 1000 }),
          passNode('hcm', 'health-check-manager', {
            monitoredNodes: ['a', 'b'],
            checkIntervalMs: INTERVAL_MS,
            unhealthyThreshold: THRESHOLD
          })
        ],
        edges: [
          ['source', 'lb'],
          ['lb', 'a'],
          ['lb', 'b']
        ],
        faults: [fault('a', { atMs: TF * 1000, mode: 'reject' })]
      })
    )
    // The failure is noticed by the third failing probe, between (threshold - 1) and threshold intervals later;
    // half the traffic goes to the dead node meanwhile.
    const failures = out.summary.errorRate * out.summary.totalRequests
    const low = (RPS / 2) * (((THRESHOLD - 1) * INTERVAL_MS) / 1000)
    const high = (RPS / 2) * ((THRESHOLD * INTERVAL_MS) / 1000)
    expect(failures).toBeGreaterThan(low * 0.9)
    expect(failures).toBeLessThan(high * 1.1)
  })

  test('THEORY a failed backend keeps receiving its share for interval x threshold before it is removed', () => {
    const out = runEngine(
      chain({
        run: run('r07c', { rps: RPS, durationMs: 30_000, timeoutMs: 1000 }),
        nodes: [
          passNode('lb', 'load-balancer-l7', {
            healthCheckEnabled: true,
            healthCheckIntervalMs: INTERVAL_MS,
            healthCheckFailureThreshold: THRESHOLD
          }),
          computeNode('a', { serviceMs: 5, timeoutMs: 1000 }),
          computeNode('b', { serviceMs: 5, timeoutMs: 1000 })
        ],
        edges: [
          ['source', 'lb'],
          ['lb', 'a'],
          ['lb', 'b']
        ],
        faults: [fault('a', { atMs: TF * 1000, mode: 'reject' })]
      })
    )
    // Half the traffic hits the dead node for the whole detection window.
    const expectedFailures = (RPS / 2) * ((INTERVAL_MS * THRESHOLD) / 1000)
    const failures = out.summary.errorRate * out.summary.totalRequests
    expect(relErr(failures, expectedFailures)).toBeLessThan(0.2)
  })
})
