/**
 * Chapter 06: compute nodes (docs/reference/06-compute-nodes.md).
 * Expected values come from the chapter: vCPU counts from the EC2 docs, workers per vCPU, the concurrency
 * formula, Amdahl and scalability maths, and per-hour prices, never from engine output.
 */
import { expect, test } from '@playwright/test'
import { runEngine } from '../support/engine'
import {
  amdahl,
  concurrency,
  effectiveServiceMs,
  goetzThreads,
  mmcK,
  relErr,
  usl,
  uslPeak,
  VCPU,
  WORKERS_PER_VCPU
} from '../support/oracles'
import { chain, computeNode, passNode, type RunSpec } from '../support/topology'
import { deriveNodeConcurrency } from '../../src/engine/nodes/resourceDerivation'
import { nodeCostPerHour } from '../../src/engine/analysis/cost'
import type { ComponentNode } from '../../src/engine/core/types'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

/** RAM-derived admission K = RAM / memory per request. A small K keeps queue waits far below the timeout, so a
 *  throughput measurement is the node's capacity and not a pile of requests that expired in a deep queue. */
function shortQueueMemMb(type: string, count: number, headroom = 10): number {
  const ramMb = { 'm5.large': 8192, 'm5.xlarge': 16384, 'm5.2xlarge': 32768 }[type] ?? 8192
  // Half a slot of slack so that K slots fit in RAM without rounding into an out-of-memory rejection.
  return (ramMb * count) / (VCPU[type] * count + headroom + 0.5)
}

function sized(
  instanceType: string,
  kind: 'cpu-bound' | 'io-bound',
  instanceCount = 1,
  mem?: number
): ComponentNode {
  return {
    id: 'n',
    type: 'microservice',
    resources: {
      instanceType,
      instanceCount,
      workloadKind: kind,
      ...(mem ? { perRequestMemMb: mem } : {})
    }
  } as unknown as ComponentNode
}

test.describe('workers are vCPU x (1 for cpu-bound, 32 for io-bound) x instances (ch06 section 3.1)', () => {
  const cases: [string, 'cpu-bound' | 'io-bound', number][] = [
    ['m5.large', 'cpu-bound', 1],
    ['m5.large', 'io-bound', 1],
    ['m5.large', 'cpu-bound', 3],
    ['m5.xlarge', 'cpu-bound', 1],
    ['m5.2xlarge', 'io-bound', 2],
    ['t3.medium', 'io-bound', 1],
    ['c5.2xlarge', 'io-bound', 1]
  ]
  for (const [type, kind, count] of cases) {
    test(`C-01 ${count} x ${type} ${kind}`, () => {
      const expected = VCPU[type] * WORKERS_PER_VCPU[kind] * count
      expect(deriveNodeConcurrency(sized(type, kind, count)).effectiveC).toBe(expected)
    })
  }
})

test.describe('capacity is workers / service time, so it scales with the fleet (ch06 section 3)', () => {
  // Offer far more than capacity with a short timeout; successes per second equal the capacity.
  const capacity = (type: string, count: number, serviceMs: number) => {
    const out = runEngine(
      chain({
        run: run(`c02-${type}-${count}`, {
          rps: 2000,
          durationMs: 20_000,
          warmupMs: 5000,
          timeoutMs: 500
        }),
        nodes: [
          {
            ...computeNode('srv', {
              serviceMs,
              instanceType: type,
              timeoutMs: 500,
              config: undefined
            }),
            resources: {
              instanceType: type,
              instanceCount: count,
              workloadKind: 'cpu-bound',
              perRequestMemMb: shortQueueMemMb(type, count)
            }
          }
        ]
      })
    )
    return out.summary.throughput
  }

  test('C-02 cpu-bound 10 ms: m5.large 200 req/s, two instances 400, m5.xlarge 400', () => {
    expect(relErr(capacity('m5.large', 1, 10), 200)).toBeLessThan(0.04)
    expect(relErr(capacity('m5.large', 2, 10), 400)).toBeLessThan(0.04)
    expect(relErr(capacity('m5.xlarge', 1, 10), 400)).toBeLessThan(0.04)
  })
})

test('C-03 a faster core shortens service time; io-bound work gets only a quarter of the advantage (ch06 section 4)', () => {
  const measured = (type: string, kind: 'cpu-bound' | 'io-bound') =>
    runEngine(
      chain({
        run: run(`c03-${type}-${kind}`, { rps: 10, durationMs: 20_000 }),
        nodes: [
          {
            ...computeNode('srv', { serviceMs: 10, timeoutMs: 5000 }),
            resources: { instanceType: type, instanceCount: 1, workloadKind: kind }
          }
        ]
      })
    ).perNode.srv.avgServiceTime
  const cases: [string, number, 'cpu-bound' | 'io-bound'][] = [
    ['m5.large', 1.0, 'cpu-bound'],
    ['c5.large', 1.3, 'cpu-bound'],
    ['t3.medium', 0.8, 'cpu-bound'],
    ['c5.large', 1.3, 'io-bound'],
    ['m5.large', 1.0, 'io-bound']
  ]
  for (const [type, perf, kind] of cases) {
    expect(
      relErr(measured(type, kind), effectiveServiceMs(10, perf, kind)),
      `${type} ${kind}`
    ).toBeLessThan(0.01)
  }
  expect(effectiveServiceMs(10, 1.3, 'io-bound')).toBeCloseTo(9.302, 3)
})

test('C-04 memory admission: in-flight requests never exceed RAM / per-request memory (ch06 section 3.2)', () => {
  const peak = (perRequestMemMb: number, count: number) =>
    runEngine(
      chain({
        run: run(`c04-${perRequestMemMb}-${count}`, {
          rps: 2000,
          durationMs: 5000,
          timeoutMs: 20_000
        }),
        nodes: [
          {
            ...computeNode('srv', { serviceMs: 100, timeoutMs: 20_000 }),
            resources: {
              instanceType: 'm5.large',
              instanceCount: count,
              workloadKind: 'cpu-bound',
              perRequestMemMb
            }
          }
        ]
      })
    ).perNode.srv.peakInSystem
  // m5.large has 8 GiB = 8,192 MB.
  expect(peak(2048, 1)).toBe(4)
  expect(peak(2048, 2)).toBe(8)
  expect(peak(16, 1)).toBe(512)
})

test('C-05 concurrency = rate x duration: 200 req/s at 50 ms holds 10 requests in flight on average (ch06 section 3)', () => {
  expect(concurrency(5000, 0.2)).toBe(1000) // AWS Lambda's worked example
  expect(concurrency(30_000, 0.02)).toBe(600)
  const out = runEngine(
    chain({
      run: run('c05', { rps: 200, pattern: 'poisson', durationMs: 120_000, warmupMs: 10_000 }),
      nodes: [
        {
          ...computeNode('srv', { serviceMs: 50, timeoutMs: 5000 }),
          resources: { instanceType: 'm5.2xlarge', instanceCount: 1, workloadKind: 'io-bound' }
        }
      ]
    })
  )
  expect(relErr(out.perNode.srv.postWarmupAvgInSystem, concurrency(200, 0.05))).toBeLessThan(0.05)
})

test('C-06 sizing formulas and scalability laws (ch06 sections 3.1 and 5)', () => {
  expect(goetzThreads(4, 90, 10)).toBe(40)
  expect(goetzThreads(4, 90, 10, 0.8)).toBe(32)
  // 32 workers per vCPU means wait / CPU = 31.
  expect(goetzThreads(1, 31, 1)).toBe(WORKERS_PER_VCPU['io-bound'])
  expect(goetzThreads(1, 0, 1)).toBe(WORKERS_PER_VCPU['cpu-bound'])
  for (const [n, expected] of [
    [8, 5.93],
    [32, 12.55],
    [96, 16.7],
    [1e9, 20]
  ] as const) {
    expect(amdahl(0.95, n)).toBeCloseTo(expected, 1)
  }
  expect(uslPeak(0.05, 0.0005)).toBeCloseTo(43.6, 1)
  const cap = (n: number) => usl(0.05, 0.0005, n)
  for (const [n, expected] of [
    [8, 5.81],
    [32, 10.51],
    [96, 9.31],
    [200, 6.48]
  ] as const) {
    expect(cap(n)).toBeCloseTo(expected, 1)
  }
  // Past the peak, more machines is worse.
  expect(cap(200)).toBeLessThan(cap(44))
})

test.describe('C-07 a fleet scales until a shared bottleneck caps it: throughput = min(100 N, database 200 req/s) (ch06 section 5)', () => {
  // Each server: 2 workers x 20 ms = 100 req/s. The shared database: 2 workers x 10 ms = 200 req/s.
  // Queues are kept short (shortQueueMemMb) so waits stay below the timeout and successes measure capacity.
  const throughput = (servers: number) => {
    const ids = Array.from({ length: servers }, (_, i) => `s${i}`)
    const out = runEngine(
      chain({
        run: run(`c07-${servers}`, {
          rps: 900,
          pattern: 'constant',
          durationMs: 30_000,
          warmupMs: 10_000,
          timeoutMs: 5000
        }),
        nodes: [
          // Health ejection is off: this flow measures capacity, not what a balancer does to a saturated fleet.
          passNode('lb', 'load-balancer', { healthCheckEnabled: false }),
          ...ids.map((id) => ({
            ...computeNode(id, { serviceMs: 20, timeoutMs: 5000 }),
            resources: {
              instanceType: 'm5.large',
              instanceCount: 1,
              workloadKind: 'cpu-bound',
              perRequestMemMb: shortQueueMemMb('m5.large', 1)
            }
          })),
          {
            ...computeNode('db', { serviceMs: 10, timeoutMs: 5000 }),
            resources: {
              instanceType: 'm5.large',
              instanceCount: 1,
              workloadKind: 'cpu-bound',
              perRequestMemMb: shortQueueMemMb('m5.large', 1)
            }
          }
        ],
        edges: [
          ['source', 'lb'],
          ...ids.map((id) => ['lb', id] as [string, string]),
          ...ids.map((id) => [id, 'db'] as [string, string])
        ]
      })
    )
    return out.summary.throughput
  }
  for (const [n, expected] of [
    [1, 100],
    [2, 200],
    [3, 200],
    [6, 200]
  ] as const) {
    test(`${n} server${n > 1 ? 's' : ''} -> about ${expected} req/s`, () => {
      expect(relErr(throughput(n), expected)).toBeLessThan(0.06)
    })
  }
})

test('C-08 N + 1: after one of four servers fails each survivor carries 4/3 of its load (ch06 section 5.3)', () => {
  // 240 req/s over 4 servers of 100 req/s: 60 each (utilisation 0.6) before, 80 each (0.8) after.
  const T = 60
  const TF = 20
  const ids = ['s0', 's1', 's2', 's3']
  const out = runEngine(
    chain({
      run: run('c08', { rps: 240, pattern: 'constant', durationMs: T * 1000 }),
      nodes: [
        passNode('lb', 'load-balancer', { healthCheckEnabled: true }),
        ...ids.map((id) => computeNode(id, { serviceMs: 20 }))
      ],
      edges: [['source', 'lb'], ...ids.map((id) => ['lb', id] as [string, string])],
      faults: [
        {
          targetId: 's0',
          faultType: 'node-failure',
          timing: 'deterministic',
          duration: 'permanent',
          params: { atMs: TF * 1000, mode: 'reject' }
        }
      ]
    })
  )
  const perSurvivorArrivals = 240 * (TF / 4 + (T - TF) / 3)
  for (const id of ['s1', 's2', 's3']) {
    expect(relErr(out.perNode[id].totalArrived, perSurvivorArrivals), id).toBeLessThan(0.03)
    expect(
      relErr(out.perNode[id].utilization, 0.6 * (TF / T) + 0.8 * ((T - TF) / T)),
      `${id} utilisation`
    ).toBeLessThan(0.05)
  }
  expect(out.summary.errorRate).toBeLessThan(0.01)
})

test.describe('serverless (ch06 section 6)', () => {
  const fn = (seed: string, config: Record<string, unknown>, over: Partial<RunSpec> = {}) =>
    runEngine(
      chain({
        run: run(seed, { rps: 20, ...over }),
        nodes: [computeNode('fn', { type: 'serverless-function', serviceMs: 50, config })]
      })
    )

  test('C-09 the first request pays the cold start; later requests do not', () => {
    const out = fn(
      'c09',
      { coldStartLatency: { type: 'constant', value: 800 }, idleTimeoutMs: 60_000 },
      { durationMs: 20_000 }
    )
    expect(out.perNode.fn.traitCounters['coldStarts']).toBe(1)
    expect(relErr(out.summary.latency.max, 800 + 50)).toBeLessThan(0.03)
    expect(relErr(out.summary.latency.p50, 50)).toBeLessThan(0.05)
  })

  test('C-10 after idling longer than the timeout the next burst is cold again', () => {
    // 20 req/s for 1 s, then near silence for 9 s, repeated: each burst follows an idle gap above the 5 s timeout.
    const t = chain({
      run: run('c10', { rps: 0.1, pattern: 'bursty', durationMs: 30_000 }),
      nodes: [
        computeNode('fn', {
          type: 'serverless-function',
          serviceMs: 50,
          config: { coldStartLatency: { type: 'constant', value: 800 }, idleTimeoutMs: 5000 }
        })
      ]
    })
    t.workload = {
      ...t.workload!,
      pattern: 'bursty',
      baseRps: 0.1,
      bursty: { burstRps: 20, burstDuration: 1000, normalDuration: 9000 }
    }
    expect(runEngine(t).perNode.fn.traitCounters['coldStarts']).toBeGreaterThanOrEqual(3)
  })

  test('C-11 a concurrency cap rejects the surplus: with random arrivals the blocking is Erlang B (ch06 section 6, ch01 5.2)', () => {
    // Cap 2, 500 ms per request, 20 req/s offered: 10 Erlangs on 2 slots. Erlang B = 50 / 61 = 0.82 rejected, so
    // about 3.6 req/s are served, a little under the 4 req/s upper bound (cap / duration).
    const slow = runEngine(
      chain({
        run: run('c11b', { rps: 20, pattern: 'poisson', durationMs: 120_000, warmupMs: 5000 }),
        nodes: [
          computeNode('fn', {
            type: 'serverless-function',
            serviceMs: 500,
            config: { maxConcurrency: 2, coldStartLatency: { type: 'constant', value: 1 } },
            timeoutMs: 5000
          })
        ]
      })
    )
    const theory = mmcK(20, 2, 2, 2)
    expect(theory.blocking).toBeCloseTo(50 / 61, 9)
    expect(Math.abs(slow.summary.errorRate - theory.blocking)).toBeLessThan(0.02)
    expect(relErr(slow.summary.throughput, theory.lambdaEff)).toBeLessThan(0.05)
    expect(slow.summary.throughput).toBeLessThanOrEqual(4)
    expect(slow.perNode.fn.rejectionsByReason['max_concurrency_exceeded']).toBeGreaterThan(0)
  })

  // Tracked gap. Real Lambda creates one execution environment per concurrent request, so a burst of 16
  // simultaneous requests during init pays 16 cold starts. The simulator treats the whole node as warm or cold,
  // so the same burst records a single cold start and the rest queue behind it.
  test.fail(
    'C-12 a burst of concurrent requests during init cold-starts one environment each',
    () => {
      const out = fn(
        'c12',
        { coldStartLatency: { type: 'constant', value: 800 }, maxConcurrency: 100 },
        { rps: 20, durationMs: 2000 }
      )
      // 20 req/s over the 800 ms init window puts about 16 requests in flight, each needing its own environment.
      expect(out.perNode.fn.traitCounters['coldStarts']).toBeGreaterThanOrEqual(10)
    }
  )
})

test('C-13 each hop adds its service time and its protocol overhead: end-to-end mean = sum of services + sum of overheads (ch06 section 7, ch08 section 1)', () => {
  const out = runEngine(
    chain({
      run: run('c13', { rps: 20, durationMs: 30_000 }),
      nodes: [
        computeNode('a', { serviceMs: 5 }),
        computeNode('b', { serviceMs: 7 }),
        computeNode('c', { serviceMs: 3 })
      ],
      edges: [
        ['source', 'a', { protocol: 'grpc' }],
        ['a', 'b', { protocol: 'grpc' }],
        ['b', 'c', { protocol: 'grpc' }]
      ]
    })
  )
  // 5 + 7 + 3 = 15 ms of service, three grpc edges at 0.2 ms each.
  expect(Math.abs(out.summary.latency.mean - (15 + 3 * 0.2))).toBeLessThan(0.1)
})

test.describe('cost per hour = instances x price x purchase multiplier (ch06 section 2)', () => {
  const node = (type: string, count: number, pricingModel?: string) =>
    ({
      id: 'n',
      type: 'microservice',
      resources: {
        instanceType: type,
        instanceCount: count,
        ...(pricingModel ? { pricingModel } : {})
      }
    }) as unknown as ComponentNode

  test('C-14 three m5.large on demand cost 3 x 0.096 = 0.288 per hour', () => {
    expect(nodeCostPerHour(node('m5.large', 3))).toBeCloseTo(0.288, 6)
  })

  test('C-15 price is linear in vCPU within a family: m5.xlarge is twice m5.large', () => {
    expect(nodeCostPerHour(node('m5.xlarge', 1))).toBeCloseTo(
      2 * nodeCostPerHour(node('m5.large', 1)),
      6
    )
    expect(nodeCostPerHour(node('m5.2xlarge', 1))).toBeCloseTo(
      4 * nodeCostPerHour(node('m5.large', 1)),
      6
    )
  })

  test('C-16 reserved is 40% off and spot 70% off (the simulator purchase multipliers), changing price only', () => {
    const onDemand = nodeCostPerHour(node('m5.large', 3))
    expect(nodeCostPerHour(node('m5.large', 3, 'reserved'))).toBeCloseTo(onDemand * 0.6, 6)
    expect(nodeCostPerHour(node('m5.large', 3, 'spot'))).toBeCloseTo(onDemand * 0.3, 6)
    // Capacity does not change with the purchase model.
    expect(deriveNodeConcurrency({ ...node('m5.large', 3, 'spot') }).effectiveC).toBe(
      deriveNodeConcurrency({ ...node('m5.large', 3) }).effectiveC
    )
  })
})
