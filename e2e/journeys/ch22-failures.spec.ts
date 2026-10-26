/**
 * Chapter 22: failure semantics and chaos (docs/reference/22-failure-semantics-and-chaos.md).
 * Expected values come from the chapter: a hung or silent node walls at the client timeout, a degraded node is slower for
 * its fraction and loses nothing, survivors run at rho x N / (N - 1), a zone outage fails exactly what is placed in it,
 * retries at k layers multiply load by the product of attempts, and a restarted node comes back cold. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr, survivorLoadFactor } from '../support/oracles'
import { chain, computeNode, passNode, queueNode, type RunSpec } from '../support/topology'
import type { TopologyJSON } from '../../src/engine/core/types'

type Out = ReturnType<typeof runEngine>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 0,
    seed,
    timeoutMs: 1000,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

const server = (id: string, serviceMs = 10) =>
  queueNode(id, 'microservice', { category: 'compute', workers: 64, serviceMs, timeoutMs: 1000 })

const fault = (
  targetId: string,
  params: Record<string, unknown>,
  duration: 'fixed' | 'permanent' = 'fixed'
) => ({
  targetId,
  faultType: 'node-failure',
  timing: 'deterministic',
  duration,
  params
})

const share = (
  out: Out,
  from: number,
  to: number,
  pick: (o: Out['requestOutcomes'][number]) => boolean
) => {
  const rows = out.requestOutcomes.filter((o) => o.createdAtMs >= from && o.createdAtMs < to)
  return rows.filter(pick).length / rows.length
}

// ───────────────────────── 1. Failure shapes ─────────────────────────

test.describe('F-01 how a node fails decides what its callers see (ch22 section 1)', () => {
  const mode = (m: string, extra: Record<string, unknown> = {}) =>
    runEngine(
      chain({
        run: run(`f01-${m}`),
        nodes: [server('srv')],
        edges: [tcp('source', 'srv')],
        faults: [fault('srv', { atMs: 10_000, durationMs: 10_000, mode: m, ...extra })]
      })
    )

  test('reject returns fast: failed requests take about one hop, not the timeout', () => {
    const out = mode('reject')
    const failed = out.requestOutcomes.filter(
      (o) => o.createdAtMs >= 11_000 && o.createdAtMs < 19_000 && o.status !== 'success'
    )
    expect(failed.length).toBeGreaterThan(500)
    expect(Math.max(...failed.map((o) => o.latencyMs))).toBeLessThan(50)
  })

  for (const m of ['blackhole', 'hang']) {
    test(`${m}: failed requests wait the full 1 s timeout`, () => {
      const out = mode(m)
      const failed = out.requestOutcomes.filter(
        (o) => o.createdAtMs >= 11_000 && o.createdAtMs < 18_000 && o.status !== 'success'
      )
      expect(failed.length).toBeGreaterThan(500)
      const mean = failed.reduce((a, o) => a + o.latencyMs, 0) / failed.length
      expect(relErr(mean, 1000)).toBeLessThan(0.05)
    })
  }

  test('the outage window is exactly the fault window: no failures before it, none after the next timeout', () => {
    const out = mode('blackhole')
    expect(share(out, 0, 9_900, (o) => o.status !== 'success')).toBe(0)
    // stop 100 ms short of the end, where the last requests are still in flight
    expect(share(out, 21_500, 29_900, (o) => o.status !== 'success')).toBe(0)
  })
})

test.describe('F-02 a degraded node is slower for its fraction and loses nothing (ch22 section 1)', () => {
  for (const [fraction, multiplier] of [
    [0.5, 4],
    [1, 3],
    [0.2, 10]
  ] as const) {
    test(`${fraction * 100}% of requests ${multiplier}x slower: mean = base x (1 - f + f x m)`, () => {
      const out = runEngine(
        chain({
          run: run(`f02-${fraction}-${multiplier}`, { rps: 50 }),
          nodes: [server('srv')],
          edges: [tcp('source', 'srv')],
          faults: [
            fault(
              'srv',
              {
                atMs: 0,
                mode: 'degraded',
                degradation: { fraction, serviceTimeMultiplier: multiplier }
              },
              'permanent'
            )
          ]
        })
      )
      expect(out.summary.errorRate).toBe(0)
      // Each request is slow with probability f, so its time is base x (1 + (m - 1) B): the mean of n of them has
      // a relative standard error of (m - 1) sqrt(f (1 - f)) / ((1 - f + f m) sqrt(n)). Allow 4 of them.
      const mean = 1 - fraction + fraction * multiplier
      const se =
        ((multiplier - 1) * Math.sqrt(fraction * (1 - fraction))) /
        (mean * Math.sqrt(out.summary.successfulRequests))
      expect(relErr(out.summary.latency.mean, 10 * mean)).toBeLessThan(Math.max(0.01, 4 * se))
    })
  }
})

test.describe('F-03 what happens to held requests at recovery (ch22 section 1)', () => {
  const hang = (recoveryPolicy: 'resume' | 'reset') => {
    const out = runEngine(
      chain({
        run: run(`f03-${recoveryPolicy}`, { rps: 90, pattern: 'poisson' }),
        nodes: [
          queueNode('srv', 'microservice', {
            category: 'compute',
            workers: 1,
            capacity: 1000,
            serviceMs: 10,
            timeoutMs: 1000
          })
        ],
        edges: [tcp('source', 'srv')],
        faults: [
          fault('srv', {
            atMs: 10_000,
            durationMs: 3000,
            mode: 'hang',
            inFlightPolicy: 'hang',
            recoveryPolicy
          })
        ]
      })
    )
    return share(out, 10_000, 13_000, (o) => o.status === 'success')
  }

  test('resume: requests held within a timeout of recovery complete, about a third of a 3 s hang', () => {
    expect(Math.abs(hang('resume') - 1 / 3)).toBeLessThan(0.1)
  })

  test('reset: every held request is dropped, none of the window succeeds', () => {
    expect(hang('reset')).toBe(0)
  })
})

// ───────────────────────── 2. Spread and load ─────────────────────────

test.describe('F-04 losing one of N equal servers raises the survivors to rho x N / (N - 1) (ch22 section 2)', () => {
  test('3 servers at 50% each lose one: the two survivors run at 75%', () => {
    const ids = ['s0', 's1', 's2']
    const out = runEngine(
      chain({
        run: run('f04', { rps: 150, timeoutMs: 5000 }),
        nodes: [
          passNode('lb', 'load-balancer', { routingStrategy: 'round-robin' }),
          ...ids.map((id) =>
            queueNode(id, 'microservice', {
              category: 'compute',
              workers: 1,
              capacity: 50,
              serviceMs: 10
            })
          )
        ],
        edges: [tcp('source', 'lb'), ...ids.map((id) => tcp('lb', id))],
        faults: [fault('s2', { atMs: 0, mode: 'reject' }, 'permanent')]
      })
    )
    const rho = 150 / 3 / 100
    expect(survivorLoadFactor(3, 1)).toBe(1.5)
    for (const id of ['s0', 's1'])
      expect(Math.abs(out.perNode[id].utilization - rho * 1.5)).toBeLessThan(0.04)
  })
})

test.describe('F-05 retries multiply the load on the failing dependency (ch22 section 2)', () => {
  const retry = { maxAttempts: 4, baseDelay: 1, maxDelay: 2, multiplier: 1, jitter: false }
  // The failing dependency is the last node; each node before it calls the next, so a, b and c are three layers.
  const layered = (seed: string, withRetry: string[]) =>
    runEngine(
      chain({
        run: run(seed, { rps: 2, durationMs: 20_000, timeoutMs: 5000 }),
        nodes: ['a', 'b', 'c', 'd'].map((id) =>
          computeNode(id, {
            serviceMs: 1,
            resilience: withRetry.includes(id) ? { retry } : undefined
          })
        ),
        edges: [tcp('source', 'a'), tcp('a', 'b'), tcp('b', 'c'), tcp('c', 'd')],
        faults: [fault('d', { atMs: 0, mode: 'reject' }, 'permanent')]
      })
    )
  const callsToDependency = (out: ReturnType<typeof layered>) =>
    out.perNode.d.totalArrived / out.summary.totalRequests

  test('one layer of 4 attempts sends 4 calls to the failing dependency per request', () => {
    expect(relErr(callsToDependency(layered('f05a', ['c'])), 4)).toBeLessThan(0.05)
  })

  test('with retries off the dependency sees exactly one call per request', () => {
    const out = layered('f05b', [])
    expect(out.perNode.d.totalArrived).toBe(out.perNode.a.totalArrived)
  })

  // Finding 34 (fixed): a caller whose retries are spent passes the failure up, and the caller above it retries the
  // whole downstream call, so attempts multiply: 4^k calls for k layers (the SRE book's example is 4^3 = 64).
  test('two layers of 4 attempts send 16 calls', () => {
    expect(relErr(callsToDependency(layered('f05c2', ['b', 'c'])), 16)).toBeLessThan(0.05)
  })

  test('three layers of 4 attempts send 64 calls to a dependency that always fails', () => {
    expect(relErr(callsToDependency(layered('f05c', ['a', 'b', 'c'])), 64)).toBeLessThan(0.05)
  })
})

// ───────────────────────── 3. Fault domains ─────────────────────────

test.describe('F-06 a zone outage fails exactly what is placed in the zone (ch22 section 3)', () => {
  const zoned = (): TopologyJSON => {
    const base = chain({
      run: run('f06', { timeoutMs: 1000 }),
      nodes: [
        passNode('lb', 'load-balancer', {
          routingStrategy: 'round-robin',
          healthCheckEnabled: false
        }),
        server('api-a'),
        server('api-b')
      ],
      edges: [tcp('source', 'lb'), tcp('lb', 'api-a'), tcp('lb', 'api-b')]
    }) as TopologyJSON & { locations?: unknown; faults?: unknown }
    const place = (id: string, placement: Record<string, string>) => {
      const node = base.nodes.find((n) => n.id === id) as unknown as Record<string, unknown>
      node.placement = placement
    }
    place('lb', { regionId: 'region' })
    place('api-a', { regionId: 'region', availabilityZoneId: 'az-a' })
    place('api-b', { regionId: 'region', availabilityZoneId: 'az-b' })
    base.locations = [
      { id: 'region', kind: 'region', label: 'us-east-1' },
      { id: 'az-a', kind: 'availability-zone', label: 'us-east-1a', parentId: 'region' },
      { id: 'az-b', kind: 'availability-zone', label: 'us-east-1b', parentId: 'region' }
    ]
    base.faults = [
      {
        targetId: 'az-a',
        faultType: 'chaos',
        timing: 'deterministic',
        duration: 'fixed',
        params: {
          atMs: 10_000,
          durationMs: 10_000,
          mode: 'blackhole',
          inFlightPolicy: 'hang',
          recoveryPolicy: 'reset'
        }
      }
    ]
    return base as TopologyJSON
  }

  test('during the outage half the requests (those balanced to the zone) fail and the other zone is untouched', () => {
    const out = runEngine(zoned())
    expect(Math.abs(share(out, 11_500, 19_000, (o) => o.status !== 'success') - 0.5)).toBeLessThan(
      0.05
    )
    expect(out.perNode['api-b'].totalRejected + out.perNode['api-b'].totalTimedOut).toBe(0)
  })

  test('over the whole run the failed share is the zone share x the outage fraction: 50% x 10/30 = 16.7%', () => {
    const out = runEngine(zoned())
    expect(Math.abs(out.summary.errorRate - 0.5 * (10 / 30))).toBeLessThan(0.03)
  })

  test('the browser shows the same zone outage', async ({ page }) => {
    const t = zoned()
    const out = runEngine(t)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'lb')
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(2)
  })
})

// ───────────────────────── 4. Restarts and spreading failure ─────────────────────────

test.describe('F-07 a restarted node comes back cold (ch22 section 1)', () => {
  // Finding 33 (fixed): a cache that crash-restarts (recoveryPolicy reset) comes back empty and re-warms from
  // traffic, like a `cache-flush` fault.
  test('a cache restarted at 20 s misses on most lookups right after it returns', () => {
    const out = runEngine(
      chain({
        run: run('f07', { rps: 500, durationMs: 40_000, timeoutMs: 2000 }),
        nodes: [
          queueNode('cache', 'in-memory-cache', {
            serviceMs: 0.1,
            config: {
              cacheModel: 'derived-lru',
              cacheRamMb: 0.3,
              valueSizeBytes: 1000,
              cacheHitLatencyMs: 1
            }
          }),
          queueNode('db', 'relational-db', { config: { storageReadMs: 1 } })
        ],
        edges: [tcp('source', 'cache'), tcp('cache', 'db')],
        faults: [
          fault('cache', {
            atMs: 20_000,
            durationMs: 3000,
            mode: 'reject',
            recoveryPolicy: 'reset'
          })
        ],
        requestDistribution: [
          { type: 'read', weight: 1, sizeBytes: 100, keyspace: { field: 'k', size: 1000, skew: 1 } }
        ]
      })
    )
    const ratio = (from: number, to: number) => {
      const rows = out.requestOutcomes.filter(
        (o) => o.createdAtMs >= from && o.createdAtMs < to && o.cacheOutcome
      )
      return rows.filter((o) => o.cacheOutcome === 'hit').length / rows.length
    }
    // Cold start over Zipf (s = 1, 1,000 keys): in the first n requests a lookup hits only if its key already
    // appeared, which for n = 150 (0.3 s at 500/s) is 42% on a reference model, against about 77% when warm.
    const cold = ratio(23_000, 23_300)
    expect(Math.abs(cold - 0.424)).toBeLessThan(0.08)
    expect(cold).toBeLessThan(ratio(10_000, 20_000) * 0.7)
  })
})

test.describe('F-09 a gray failure passes the health check but fails real requests (ch22 section 1)', () => {
  // Decision G3 (done): a `gray-failure` fault makes a node fail `errorRate` of its real requests while checks still
  // pass, so the balancer keeps sending it its share. One of two servers fails half its requests for 10 s of 30 s: the
  // error share is 1/2 (its share of traffic) x 1/2 (its failure rate) x 10/30 (the window) = 8.3%.
  const gray = (errorRate: number) =>
    runEngine(
      chain({
        run: run(`f09-${errorRate}`, { rps: 200, durationMs: 30_000, timeoutMs: 1000 }),
        nodes: [
          passNode('lb', 'load-balancer', {
            routingStrategy: 'round-robin',
            healthCheckEnabled: true
          }),
          server('a'),
          server('b')
        ],
        edges: [tcp('source', 'lb'), tcp('lb', 'a'), tcp('lb', 'b')],
        faults: [
          {
            targetId: 'a',
            faultType: 'gray-failure',
            timing: 'deterministic',
            duration: 'fixed',
            params: { atMs: 10_000, durationMs: 10_000, errorRate }
          }
        ]
      })
    )

  test("half of one server's requests fail for a third of the run: 8.3% of all requests", () => {
    const out = gray(0.5)
    expect(Math.abs(out.summary.errorRate - 1 / 12)).toBeLessThan(0.015)
    // The balancer never took it out: it kept receiving its half of the traffic.
    expect(relErr(out.perNode.a.totalArrived, out.perNode.b.totalArrived)).toBeLessThan(0.05)
  })

  test('a gray failure of rate 0 changes nothing', () => {
    expect(gray(0).summary.errorRate).toBe(0)
  })
})

test.describe('F-08 a brief overload can leave a system failed after the trigger ends (ch22 section 2)', () => {
  // Decision G4 (done): the metastable-retry-storm sample. A 1-worker, 10 ms server (capacity 100/s) fed 70/s has a 3 s
  // spike to 200/s at 10 s. Its queue fills, requests hit the 300 ms node timeout, and the gateway retries them four
  // times, so after the spike the offered load is 70 x (1 + retries) > 100: the retries alone sustain the failure.
  const build = (retries: boolean) => {
    const t = chain({
      run: run(`f08-${retries}`, {
        rps: 70,
        durationMs: 90_000,
        pattern: 'spike',
        timeoutMs: 5000
      }),
      nodes: [
        queueNode('gw', 'microservice', {
          category: 'compute',
          workers: 5000,
          capacity: 100_000,
          serviceMs: 0.1,
          timeoutMs: 5000,
          resilience: retries
            ? {
                retry: { maxAttempts: 4, baseDelay: 10, maxDelay: 10, multiplier: 1, jitter: false }
              }
            : undefined
        }),
        queueNode('srv', 'microservice', {
          category: 'compute',
          workers: 1,
          capacity: 2000,
          serviceMs: 10,
          timeoutMs: 300
        })
      ],
      edges: [tcp('source', 'gw'), tcp('gw', 'srv')]
    })
    ;(t.workload as unknown as Record<string, unknown>).spike = {
      spikeTime: 10_000,
      spikeRps: 200,
      spikeDuration: 3000
    }
    return runEngine(t)
  }

  test('with retries, goodput stays near zero for the 60 s after a 3 s spike', () => {
    expect(share(build(true), 30_000, 90_000, (o) => o.status === 'success')).toBeLessThan(0.1)
  })

  test('the same system without retries is back to 100% within seconds of the spike ending', () => {
    expect(share(build(false), 20_000, 90_000, (o) => o.status === 'success')).toBeGreaterThan(0.99)
  })
})
