/**
 * Chapter 24: architecture and system-design patterns (docs/reference/24-architecture-and-system-design-patterns.md).
 * Expected values come from the chapter: a synchronous chain adds its hops and multiplies their availabilities, a cell design
 * confines a fault to 1/k of the traffic, fan-out on write multiplies downstream load by the follower count, a queue in
 * front of a slow consumer protects the producer, a single point of failure is found. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait, useNetworkEdges } from '../support/app'
import { runEngine } from '../support/engine'
import { fanoutWritesPerSec, relErr, serialAvailability } from '../support/oracles'
import { chain, passNode, queueNode, type RunSpec } from '../support/topology'

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

const service = (id: string, serviceMs = 5, extra: Record<string, unknown> = {}) =>
  queueNode(id, 'microservice', { category: 'compute', workers: 64, serviceMs, ...extra })

// ───────────────────────── 1. Chains ─────────────────────────

test.describe('PT-01 a synchronous chain adds its latencies and multiplies its availabilities (ch24 section 1)', () => {
  const hops = (k: number, errorRate = 0) => {
    const ids = Array.from({ length: k }, (_, i) => `svc${i}`)
    return runEngine(
      chain({
        run: run(`pt01-${k}`, { rps: 200, durationMs: 40_000 }),
        nodes: ids.map((id) => service(id, 5)),
        edges: [
          tcp('source', ids[0], { errorRate }),
          ...ids.slice(1).map((id, i) => tcp(ids[i], id, { errorRate }))
        ]
      })
    )
  }

  for (const k of [1, 3, 6]) {
    test(`${k} services of 5 ms: end-to-end latency is ${5 * k} ms`, () => {
      expect(Math.abs(hops(k).summary.latency.mean - 5 * k)).toBeLessThan(0.2)
    })
  }

  test('6 hops each failing 2% succeed 0.98^6 = 88.6% of the time (the cost of splitting a monolith)', () => {
    const out = hops(6, 0.02)
    const n = out.summary.totalRequests
    const p = serialAvailability(0.98, 6)
    expect(Math.abs(out.summary.successfulRequests / n - p)).toBeLessThan(
      4 * Math.sqrt((p * (1 - p)) / n)
    )
  })
})

// ───────────────────────── 2. Cells ─────────────────────────

test.describe('PT-02 a cell design confines a fault to its share of the traffic (ch24 section 1)', () => {
  const cells = (seed: string, k: number) => {
    const ids = Array.from({ length: k }, (_, i) => `cell${i}`)
    return runEngine(
      chain({
        run: run(seed, { rps: 500, timeoutMs: 1000 }),
        nodes: [
          passNode('router', 'load-balancer', {
            routingStrategy: 'round-robin',
            healthCheckEnabled: false
          }),
          ...ids.map((id) => service(id))
        ],
        edges: [tcp('source', 'router'), ...ids.map((id) => tcp('router', id))],
        faults: [
          {
            targetId: 'cell0',
            faultType: 'node-failure',
            timing: 'deterministic',
            duration: 'permanent',
            params: { atMs: 0, mode: 'reject' }
          }
        ]
      })
    )
  }

  for (const k of [1, 4, 10]) {
    test(`${k} cell${k === 1 ? '' : 's'}: a bad cell fails ${(100 / k).toFixed(0)}% of requests and the rest are untouched`, () => {
      const out = cells(`pt02-${k}`, k)
      expect(Math.abs(out.summary.errorRate - 1 / k)).toBeLessThan(0.02)
      for (let i = 1; i < k; i += 1) expect(out.perNode[`cell${i}`].totalRejected).toBe(0)
    })
  }
})

// ───────────────────────── 3. Fan-out ─────────────────────────

test.describe('PT-03 fan-out on write multiplies the downstream load by the follower count (ch24 section 3)', () => {
  const fan = (seed: string, followers: number, feedCapacityRps: number) => {
    const feed = queueNode('feed', 'microservice', {
      category: 'compute',
      workers: Math.round(feedCapacityRps / 100),
      capacity: 200,
      serviceMs: 10,
      timeoutMs: 1000
    })
    return runEngine(
      chain({
        run: run(seed, { rps: 10 }),
        nodes: [service('post', 1), feed],
        edges: [tcp('source', 'post'), tcp('post', 'feed', { fanoutFactor: followers })]
      })
    )
  }

  test('10 posts/s to 100 followers is 1,000 feed writes/s', () => {
    const out = fan('pt03', 100, 5000)
    expect(fanoutWritesPerSec(10, 100)).toBe(1000)
    expect(relErr(out.perNode.feed.totalArrived / 30, 1000)).toBeLessThan(0.02)
    expect(out.perNode.feed.totalArrived).toBe(100 * out.perNode.post.totalArrived)
  })

  test('the write path saturates first: a feed writer able to do 500/s rejects about half of 1,000/s', () => {
    const out = fan('pt03b', 100, 500)
    const lost = out.perNode.feed.totalRejected / out.perNode.feed.totalArrived
    expect(Math.abs(lost - 0.5)).toBeLessThan(0.08)
    expect(out.perNode.feed.utilization).toBeGreaterThan(0.95)
  })

  test('with no fan-out the same posts arrive one for one', () => {
    const out = fan('pt03c', 1, 5000)
    expect(out.perNode.feed.totalArrived).toBe(out.perNode.post.totalArrived)
  })
})

// ───────────────────────── 4. Queue-based load leveling ─────────────────────────

test.describe('PT-04 a queue in front of a slow consumer protects the producer (ch24 section 3)', () => {
  // 50 req/s base, 500 req/s for 3 s from t = 10 s, against a consumer that does 100 req/s.
  const spiky = (viaQueue: boolean) => {
    const consumer = queueNode('worker', 'microservice', {
      category: 'compute',
      workers: 1,
      capacity: 20,
      serviceMs: 10,
      timeoutMs: 1000
    })
    const nodes = viaQueue
      ? [
          queueNode('q', 'queue', {
            category: 'messaging-and-streaming',
            workers: 1,
            capacity: 100_000,
            serviceMs: 10
          })
        ]
      : [consumer]
    const t = chain({
      run: run('pt04', { rps: 50, durationMs: 90_000, timeoutMs: 120_000 }),
      nodes,
      edges: [tcp('source', nodes[0].id as string)]
    })
    ;(t.workload as unknown as Record<string, unknown>).pattern = 'spike'
    ;(t.workload as unknown as Record<string, unknown>).spike = {
      spikeTime: 10_000,
      spikeRps: 500,
      spikeDuration: 3000
    }
    return runEngine(t)
  }
  const userFacing = (out: Out) => out.requestOutcomes.filter((o) => !o.requestId.includes('::'))

  test('direct to the consumer the spike overflows it and requests are lost', () => {
    const out = spiky(false)
    expect(out.summary.rejectedRequests).toBeGreaterThan(500)
  })

  test('behind a queue no producer request fails and its latency stays at the append', () => {
    const out = spiky(true)
    const producers = userFacing(out)
    expect(producers.every((o) => o.status === 'success')).toBe(true)
    expect(Math.max(...producers.map((o) => o.latencyMs))).toBeLessThan(5)
  })

  test('the backlog the spike left drains at (capacity - base): (500 - 100) x 3 s = 1,200 clears in 24 s, nothing is lost', () => {
    const out = spiky(true)
    expect(out.acceptedWorkConservation.lost).toBe(0)
    expect(
      out.acceptedWorkConservation.accepted - out.acceptedWorkConservation.delivered
    ).toBeLessThan(10)
  })
})

// ───────────────────────── 5. Single points of failure ─────────────────────────

test.describe('PT-05 a single point of failure is found (ch24 section 5)', () => {
  const spofs = (types: [string, string]) =>
    runEngine(
      chain({
        run: run('pt05', { durationMs: 5000 }),
        nodes: [
          queueNode('a', types[0], { category: 'compute', workers: 8, serviceMs: 5 }),
          queueNode('b', types[1], {
            category: types[1] === 'relational-db' ? 'storage-and-data' : 'compute',
            workers: 8,
            serviceMs: 5
          })
        ],
        edges: [tcp('source', 'a'), tcp('a', 'b')]
      })
    ).singlePointsOfFailure.map((s) => s.nodeId)

  test('a service in front of the only database: both are single points of failure', () => {
    const ids = spofs(['microservice', 'relational-db'])
    expect(ids).toContain('a')
    expect(ids).toContain('b')
  })

  // Tracked gap (finding 36): the detector treats any other node of the same type as a fall-back peer, but two
  // different services in series are not redundant with each other. The last `microservice` is not reported, though
  // losing it ends every request.
  test.fail('two services in series: both are single points of failure', () => {
    const ids = spofs(['microservice', 'microservice'])
    expect(ids).toContain('a')
    expect(ids).toContain('b')
  })

  test('two replicas behind a balancer are not, but the balancer is', () => {
    const out = runEngine(
      chain({
        run: run('pt05b', { durationMs: 5000 }),
        nodes: [
          passNode('lb', 'load-balancer', { routingStrategy: 'round-robin' }),
          service('a'),
          service('b')
        ],
        edges: [tcp('source', 'lb'), tcp('lb', 'a'), tcp('lb', 'b')]
      })
    )
    const ids = out.singlePointsOfFailure.map((s) => s.nodeId)
    expect(ids).toContain('lb')
    expect(ids).not.toContain('a')
    expect(ids).not.toContain('b')
  })
})

// ───────────────────────── 6. Not modelled (decisions) ─────────────────────────

test.describe('PT-06 saga, outbox and CQRS are compositions, not components (ch24 section 2)', () => {
  // Decision needed (ch24 open items): there is no saga orchestrator or outbox relay; a saga's compensation (undo of
  // earlier steps when a later step fails) cannot be expressed on one node.
  test.fixme('a saga whose last step fails compensates the earlier steps', () => {
    const orchestrator = queueNode('saga', 'orchestrator-scheduler', {
      category: 'orchestration-and-infra',
      config: { steps: ['reserve', 'charge', 'ship'], compensate: true }
    })
    const out = runEngine(
      chain({ run: run('pt06'), nodes: [orchestrator], edges: [tcp('source', 'saga')] })
    )
    expect(out.perNode.saga.traitCounters.compensations).toBeGreaterThan(0)
  })
})

// ───────────────────────── 7. The browser agrees ─────────────────────────

test.describe('PT-07 the browser shows the fan-out saturation the engine computed', () => {
  test('1,000 feed writes/s into a 500/s writer shows the engine error rate', async ({ page }) => {
    const feed = queueNode('feed', 'microservice', {
      category: 'compute',
      workers: 5,
      capacity: 200,
      serviceMs: 10,
      timeoutMs: 1000
    })
    const t = chain({
      run: run('pt07', { rps: 10, durationMs: 20_000 }),
      nodes: [service('post', 1), feed],
      edges: [tcp('source', 'post'), tcp('post', 'feed', { fanoutFactor: 100 })]
    })
    const out = runEngine(t)
    expect(out.summary.errorRate).toBeGreaterThan(0.2)
    await openApp(page)
    await importTopology(page, t)
    // Connector mode (the default) neutralises fan-out on purpose and the importer says so; the network edge model keeps it.
    await useNetworkEdges(page)
    await runAndWait(page)
    const ui = await readUiRun(page, 'post')
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(3)
  })
})
