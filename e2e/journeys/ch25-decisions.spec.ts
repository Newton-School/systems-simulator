/**
 * Chapter 25: architecture decisions (docs/reference/25-architecture-decisions.md).
 * A decision is justified by a number. Each flow takes a requirement, simulates the design the trade-off table recommends
 * and a plainly worse alternative against the same target, and checks that the recommended one meets it and the other
 * does not. Expected figures come from the chapter's tables and formulas, never from engine output.
 */
import { expect, test } from '@playwright/test'
import { runEngine } from '../support/engine'
import { pollRate, relErr } from '../support/oracles'
import { chain, computeNode, passNode, queueNode, type RunSpec } from '../support/topology'
import { topologyCost } from '../../src/engine/analysis/cost'
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
    timeoutMs: 2000,
    ...over
  }
}

const tcp = (a: string, b: string, extra: Record<string, unknown> = {}) =>
  [a, b, { protocol: 'tcp', ...extra }] as [string, string, Record<string, unknown>]

const errorRate = (out: Out) => out.summary.errorRate

// ───────────────────────── 1. Where to cache ─────────────────────────

test.describe('DEC-01 requirement: 500 read req/s, error rate under 1%, p99 under 100 ms (ch25 section 3, cache placement)', () => {
  // The database does 2 workers / 20 ms = 100 req/s: a fifth of the load.
  const design = (withCache: boolean) =>
    runEngine(
      chain({
        run: run(withCache ? 'dec01-cache' : 'dec01-nocache', { rps: 500, timeoutMs: 1000 }),
        nodes: [
          ...(withCache
            ? [
                queueNode('cache', 'in-memory-cache', {
                  serviceMs: 0.1,
                  config: { cacheModel: 'declared-rate', cacheHitRate: 0.9, cacheHitLatencyMs: 1 }
                })
              ]
            : []),
          queueNode('db', 'relational-db', {
            workers: 2,
            capacity: 50,
            config: { storageReadMs: 20 }
          })
        ],
        edges: withCache ? [tcp('source', 'cache'), tcp('cache', 'db')] : [tcp('source', 'db')]
      })
    )

  test('without a cache the database is offered 5x its capacity and fails the target', () => {
    const out = design(false)
    expect(errorRate(out)).toBeGreaterThan(0.5)
  })

  test('a 90% cache cuts the database load to 50 req/s (half its capacity) and meets the target', () => {
    const out = design(true)
    expect(errorRate(out)).toBeLessThan(0.01)
    expect(out.summary.latency.p99).toBeLessThan(100)
    expect(out.perNode.db.utilization).toBeLessThan(0.7)
  })
})

// ───────────────────────── 2. Synchronous or asynchronous ─────────────────────────

test.describe('DEC-02 requirement: the user must not wait for the 200 ms confirmation e-mail (ch25 section 3, sync or async)', () => {
  const design = (viaQueue: boolean) =>
    runEngine(
      chain({
        run: run(`dec02-${viaQueue}`, { rps: 50, durationMs: 30_000 }),
        nodes: [
          queueNode('api', 'microservice', { category: 'compute', workers: 64, serviceMs: 5 }),
          queueNode('db', 'relational-db', { workers: 64, config: { storageReadMs: 5 } }),
          viaQueue
            ? queueNode('mail', 'queue', {
                category: 'messaging-and-streaming',
                workers: 64,
                serviceMs: 200
              })
            : queueNode('mail', 'microservice', {
                category: 'compute',
                workers: 64,
                serviceMs: 200
              })
        ],
        edges: [tcp('source', 'api'), tcp('api', 'db'), tcp('api', 'mail')]
      })
    )
  /** What the caller experiences: requests that are not the queue's background deliveries. */
  const callerFacing = (out: Out) =>
    out.requestOutcomes.filter((o) => !o.requestId.includes('::') && o.status === 'success')
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

  test('a queue: every caller-facing response is the 10 ms of api + database or the append, never the mail time', () => {
    const lat = callerFacing(design(true)).map((o) => o.latencyMs)
    expect(lat.length).toBeGreaterThan(1000)
    expect(Math.max(...lat)).toBeLessThan(15)
  })

  test('a direct call to the mail service: the request that includes it takes the 200 ms on top', () => {
    const lat = callerFacing(design(false))
      .filter((o) => o.nodeId === 'mail')
      .map((o) => o.latencyMs)
    // the api sends each request to one of its two targets, so about half of the 1,500 end at the mail service
    expect(lat.length).toBeGreaterThan(500)
    expect(Math.abs(mean(lat) - 205)).toBeLessThan(5)
  })
})

// ───────────────────────── 3. Redundancy ─────────────────────────

test.describe('DEC-03 requirement: survive the loss of a server with under 2% errors (ch25 section 4, availability)', () => {
  const outage = [
    {
      targetId: 'a',
      faultType: 'node-failure',
      timing: 'deterministic',
      duration: 'fixed',
      params: { atMs: 10_000, durationMs: 10_000, mode: 'reject' }
    }
  ]
  const server = (id: string) =>
    queueNode(id, 'microservice', { category: 'compute', workers: 8, capacity: 100, serviceMs: 10 })

  test('one server: a 10 s outage in 100 s is 10% errors, so the target fails', () => {
    const out = runEngine(
      chain({
        run: run('dec03a', { durationMs: 100_000 }),
        nodes: [server('a')],
        edges: [tcp('source', 'a')],
        faults: outage
      })
    )
    expect(Math.abs(errorRate(out) - 0.1)).toBeLessThan(0.01)
  })

  test('two servers behind a balancer: the survivor carries the load and the target holds', () => {
    const out = runEngine(
      chain({
        run: run('dec03b', { durationMs: 100_000 }),
        nodes: [
          passNode('lb', 'load-balancer', { routingStrategy: 'round-robin' }),
          server('a'),
          server('b')
        ],
        edges: [tcp('source', 'lb'), tcp('lb', 'a'), tcp('lb', 'b')],
        faults: outage
      })
    )
    expect(errorRate(out)).toBeLessThan(0.02)
  })
})

// ───────────────────────── 4. Vertical or horizontal ─────────────────────────

test.describe('DEC-04 same capacity and cost, different blast radius: 1 x m5.2xlarge or 4 x m5.large (ch25 section 3, scaling)', () => {
  const big = (faults: Record<string, unknown>[] = []) =>
    chain({
      run: run('dec04-big', { rps: 400 }),
      nodes: [computeNode('big', { serviceMs: 10, instanceType: 'm5.2xlarge' })],
      edges: [tcp('source', 'big')],
      faults
    })
  const small = (faults: Record<string, unknown>[] = []) => {
    const ids = ['s0', 's1', 's2', 's3']
    return chain({
      run: run('dec04-small', { rps: 400 }),
      nodes: [
        passNode('lb', 'load-balancer', { routingStrategy: 'round-robin' }),
        ...ids.map((id) => computeNode(id, { serviceMs: 10, instanceType: 'm5.large' }))
      ],
      edges: [tcp('source', 'lb'), ...ids.map((id) => tcp('lb', id))],
      faults
    })
  }
  const lose = (id: string) => [
    {
      targetId: id,
      faultType: 'node-failure',
      timing: 'deterministic',
      duration: 'permanent',
      params: { atMs: 0, mode: 'reject' }
    }
  ]

  test('the two fleets cost the same per hour (price is linear in size within the family)', () => {
    const lb = small().nodes.find((n) => n.id === 'lb') as unknown
    expect(lb).toBeTruthy()
    const bigCost = topologyCost(big() as TopologyJSON).totalPerHour
    const smallCost = topologyCost(small() as TopologyJSON).totalPerHour
    expect(relErr(smallCost, bigCost)).toBeLessThan(0.001)
    expect(bigCost).toBeCloseTo(0.384, 9)
  })

  test('and serve the same load (8 servers of 10 ms is 800 req/s either way): both run at 50% at 400 req/s', () => {
    expect(Math.abs(runEngine(big()).perNode.big.utilization - 0.5)).toBeLessThan(0.03)
    const out = runEngine(small())
    const mean = ['s0', 's1', 's2', 's3'].reduce((a, id) => a + out.perNode[id].utilization, 0) / 4
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.03)
  })

  test('losing the one big server loses everything; losing one of four small leaves 75% and no errors', () => {
    expect(errorRate(runEngine(big(lose('big'))))).toBeGreaterThan(0.99)
    const out = runEngine(small(lose('s0')))
    expect(errorRate(out)).toBeLessThan(0.02)
    // the survivors run at rho x N / (N - 1) = 0.5 x 4 / 3
    const survivors = ['s1', 's2', 's3'].reduce((a, id) => a + out.perNode[id].utilization, 0) / 3
    expect(Math.abs(survivors - 0.5 * (4 / 3))).toBeLessThan(0.04)
  })
})

// ───────────────────────── 5. Push or pull ─────────────────────────

test.describe('DEC-05 push or pull: polling costs requests whether or not anything changed (ch25 section 3)', () => {
  test('1,000 clients polling every 5 s are 200 req/s of load even with no events; the chapter scales to 200,000 req/s at 1 M clients', () => {
    expect(pollRate(1_000_000, 5)).toBe(200_000)
    const out = runEngine(
      chain({
        run: run('dec05', { rps: pollRate(1000, 5) }),
        nodes: [
          queueNode('api', 'microservice', { category: 'compute', workers: 64, serviceMs: 2 })
        ],
        edges: [tcp('source', 'api')]
      })
    )
    expect(relErr(out.perNode.api.totalArrived / 30, 200)).toBeLessThan(0.02)
  })
})
