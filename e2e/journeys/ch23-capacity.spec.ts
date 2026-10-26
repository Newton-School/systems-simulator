/**
 * Chapter 23: capacity planning and cost (docs/reference/23-capacity-planning-and-cost.md).
 * Expected values come from the chapter: cost = price x count x pricing multiplier (with the catalogue prices the
 * chapter quotes), servers needed = ceil(peak / (capacity x target)), survivors run at rho x N / (N - k), cost per request =
 * price / requests per hour, an unpriced node costs nothing. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp } from '../support/app'
import { runEngine } from '../support/engine'
import { normalUtilizationForNPlusK, relErr, serversNeeded } from '../support/oracles'
import { chain, computeNode, passNode, queueNode, type RunSpec } from '../support/topology'
import { topologyCost } from '../../src/engine/analysis/cost'
import type { TopologyJSON } from '../../src/engine/core/types'

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

const tcp = (a: string, b: string) =>
  [a, b, { protocol: 'tcp' }] as [string, string, Record<string, unknown>]

/** Prices per hour the chapter quotes for the catalogue (m5 family). */
const PRICE = { 'm5.large': 0.096, 'm5.xlarge': 0.192, 'm5.2xlarge': 0.384 }

function fleet(
  nodes: {
    id: string
    type: keyof typeof PRICE
    count: number
    pricing?: 'on-demand' | 'reserved' | 'spot'
  }[]
) {
  const built = nodes.map((n) => {
    const node = computeNode(n.id, { serviceMs: 10, instanceType: n.type })
    const resources = node.resources as Record<string, unknown>
    resources.instanceCount = n.count
    if (n.pricing) resources.pricingModel = n.pricing
    return node
  })
  return chain({
    run: run('cost'),
    nodes: built,
    edges: built.map((n, i) =>
      tcp(i === 0 ? 'source' : (built[i - 1].id as string), n.id as string)
    )
  }) as TopologyJSON
}

// ───────────────────────── 1. Cost ─────────────────────────

test.describe('CAP-01 cost is price x count x pricing multiplier (ch23 sections 3 and 4)', () => {
  const total = (nodes: Parameters<typeof fleet>[0]) => topologyCost(fleet(nodes)).totalPerHour

  test('3 x m5.large on-demand is 3 x $0.096 = $0.288 per hour', () => {
    expect(total([{ id: 'a', type: 'm5.large', count: 3 }])).toBeCloseTo(3 * PRICE['m5.large'], 9)
  })

  test('doubling the instance count doubles the cost', () => {
    const one = total([{ id: 'a', type: 'm5.xlarge', count: 4 }])
    const two = total([{ id: 'a', type: 'm5.xlarge', count: 8 }])
    expect(two).toBeCloseTo(2 * one, 9)
  })

  test('within the m5 family price is linear in size: an xlarge costs two larges, a 2xlarge four', () => {
    expect(PRICE['m5.xlarge']).toBeCloseTo(2 * PRICE['m5.large'], 9)
    expect(total([{ id: 'a', type: 'm5.2xlarge', count: 1 }])).toBeCloseTo(4 * PRICE['m5.large'], 9)
  })

  test('reserved costs 0.6 x on-demand and spot 0.3 x on-demand (the simulator multipliers)', () => {
    const base = total([{ id: 'a', type: 'm5.xlarge', count: 5 }])
    expect(total([{ id: 'a', type: 'm5.xlarge', count: 5, pricing: 'reserved' }])).toBeCloseTo(
      0.6 * base,
      9
    )
    expect(total([{ id: 'a', type: 'm5.xlarge', count: 5, pricing: 'spot' }])).toBeCloseTo(
      0.3 * base,
      9
    )
  })

  test('a mixed fleet is the sum of its lines: 3 x m5.large + 2 x reserved m5.xlarge = $0.5184', () => {
    const cost = topologyCost(
      fleet([
        { id: 'a', type: 'm5.large', count: 3 },
        { id: 'b', type: 'm5.xlarge', count: 2, pricing: 'reserved' }
      ])
    )
    expect(cost.totalPerHour).toBeCloseTo(3 * 0.096 + 2 * 0.192 * 0.6, 9)
    expect(cost.items.reduce((a, i) => a + i.costPerHour, 0)).toBeCloseTo(cost.totalPerHour, 9)
  })

  test('the traffic source and a node with no instance model are not billed', () => {
    const t = chain({
      run: run('cost-free'),
      nodes: [
        queueNode('plain', 'microservice', { category: 'compute', serviceMs: 1, workers: 4 })
      ],
      edges: [tcp('source', 'plain')]
    }) as TopologyJSON
    const cost = topologyCost(t)
    expect(cost.totalPerHour).toBe(0)
    expect(cost.hasUnpricedNodes).toBe(true)
  })
})

test.describe('CAP-02 cost per request is price / requests per hour (ch23 section 3)', () => {
  test('an m5.large running 100 ms requests at 70% serves 14 req/s for $1.9 per million', () => {
    // m5.large cpu-bound = 2 servers; 100 ms each = 20 req/s at 100%, 14 req/s at 70%.
    const node = computeNode('svc', { serviceMs: 100, instanceType: 'm5.large' })
    const t = chain({
      run: run('cap02', { rps: 14, pattern: 'poisson', durationMs: 120_000 }),
      nodes: [node],
      edges: [tcp('source', 'svc')]
    })
    const out = runEngine(t)
    expect(Math.abs(out.perNode.svc.utilization - 0.7)).toBeLessThan(0.03)
    const perHour = out.summary.throughput * 3600
    const costPerMillion = (topologyCost(t as TopologyJSON).totalPerHour / perHour) * 1e6
    expect(relErr(costPerMillion, 1.905)).toBeLessThan(0.05)
  })

  test('the same instance at a lower utilization costs more per request (idle capacity is paid for)', () => {
    const perMillion = (rps: number) => {
      const node = computeNode('svc', { serviceMs: 100, instanceType: 'm5.large' })
      const t = chain({
        run: run(`cap02-${rps}`, { rps, durationMs: 60_000 }),
        nodes: [node],
        edges: [tcp('source', 'svc')]
      })
      const out = runEngine(t)
      return (topologyCost(t as TopologyJSON).totalPerHour / (out.summary.throughput * 3600)) * 1e6
    }
    expect(perMillion(7)).toBeGreaterThan(1.8 * perMillion(14))
  })
})

// ───────────────────────── 2. Sizing and headroom ─────────────────────────

test.describe('CAP-03 servers needed = ceil(peak / (capacity x target)) (ch23 section 1)', () => {
  // 100 req/s per server (1 worker, 10 ms); a peak of 1,000 req/s and an 80% target need 13 servers.
  const pool = (seed: string, servers: number) => {
    const ids = Array.from({ length: servers }, (_, i) => `s${i}`)
    return runEngine(
      chain({
        run: run(seed, { rps: 1000, pattern: 'poisson', durationMs: 30_000 }),
        nodes: [
          passNode('lb', 'load-balancer', { routingStrategy: 'round-robin' }),
          ...ids.map((id) =>
            queueNode(id, 'microservice', {
              category: 'compute',
              workers: 1,
              capacity: 200,
              serviceMs: 10,
              timeoutMs: 5000
            })
          )
        ],
        edges: [tcp('source', 'lb'), ...ids.map((id) => tcp('lb', id))]
      })
    )
  }
  const meanUtil = (out: ReturnType<typeof runEngine>, n: number) =>
    Array.from({ length: n }, (_, i) => out.perNode[`s${i}`].utilization).reduce(
      (a, b) => a + b,
      0
    ) / n

  test('the formula gives 13 servers', () => {
    expect(serversNeeded(1000, 100, 0.8)).toBe(13)
  })

  test('12 servers run at 83.3% (over the target), 13 at 76.9% (under it)', () => {
    expect(Math.abs(meanUtil(pool('cap03a', 12), 12) - 1000 / (12 * 100))).toBeLessThan(0.02)
    expect(Math.abs(meanUtil(pool('cap03b', 13), 13) - 1000 / (13 * 100))).toBeLessThan(0.02)
  })
})

test.describe('CAP-04 N+1 headroom: losing a server must not push the survivors over the target (ch23 section 2)', () => {
  const lose1of = (seed: string, n: number, rps: number) => {
    const ids = Array.from({ length: n }, (_, i) => `s${i}`)
    return runEngine(
      chain({
        run: run(seed, { rps, pattern: 'constant', durationMs: 30_000 }),
        nodes: [
          passNode('lb', 'load-balancer', { routingStrategy: 'round-robin' }),
          ...ids.map((id) =>
            queueNode(id, 'microservice', {
              category: 'compute',
              workers: 1,
              capacity: 200,
              serviceMs: 10,
              timeoutMs: 5000
            })
          )
        ],
        edges: [tcp('source', 'lb'), ...ids.map((id) => tcp('lb', id))],
        faults: [
          {
            targetId: 's0',
            faultType: 'node-failure',
            timing: 'deterministic',
            duration: 'permanent',
            params: { atMs: 0, mode: 'reject' }
          }
        ]
      })
    )
  }
  const survivorUtil = (out: ReturnType<typeof lose1of>, n: number) =>
    Array.from({ length: n - 1 }, (_, i) => out.perNode[`s${i + 1}`].utilization).reduce(
      (a, b) => a + b,
      0
    ) /
    (n - 1)

  test('12 servers sized to 73.3% normal run at the 80% target after one failure', () => {
    const normal = normalUtilizationForNPlusK(0.8, 12, 1)
    expect(normal).toBeCloseTo(0.7333, 4)
    const rps = normal * 12 * 100
    expect(Math.abs(survivorUtil(lose1of('cap04a', 12, rps), 12) - 0.8)).toBeLessThan(0.03)
  })

  test('12 servers run at the 80% target in normal times run at 87% after one failure: over the target', () => {
    const out = lose1of('cap04b', 12, 0.8 * 12 * 100)
    expect(Math.abs(survivorUtil(out, 12) - 0.8 * (12 / 11))).toBeLessThan(0.03)
    expect(survivorUtil(out, 12)).toBeGreaterThan(0.8)
  })
})

// ───────────────────────── 3. Not modelled (decisions) ─────────────────────────

test.describe('CAP-05 pricing beyond instance hours (ch23 section 6)', () => {
  // Decision needed (ch23 open items): the simulator's reserved and spot multipliers (0.6, 0.3) are more conservative
  // than the real maximum discounts, and a spot instance is never reclaimed. Real spot capacity is interrupted with
  // about two minutes of warning, so an unprotected spot fleet loses capacity.
  test.fixme('a spot fleet loses instances to interruption during a long run', () => {
    const node = computeNode('svc', { serviceMs: 100, instanceType: 'm5.large' })
    ;(node.resources as Record<string, unknown>).instanceCount = 10
    ;(node.resources as Record<string, unknown>).pricingModel = 'spot'
    const out = runEngine(
      chain({
        run: run('cap05', { rps: 50, durationMs: 600_000 }),
        nodes: [node],
        edges: [tcp('source', 'svc')]
      })
    )
    const workers = out.timeSeries.map((s) => s.node.svc.workers)
    expect(Math.min(...workers)).toBeLessThan(20)
  })
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('CAP-06 the browser shows the hourly cost the chapter computes', () => {
  test('3 x m5.large + 2 x reserved m5.xlarge shows about $0.52 per hour', async ({ page }) => {
    const t = fleet([
      { id: 'a', type: 'm5.large', count: 3 },
      { id: 'b', type: 'm5.xlarge', count: 2, pricing: 'reserved' }
    ])
    await openApp(page)
    await importTopology(page, t)
    // The always-on cost chip: in the header on a wide window, in More actions > Status on a narrower one.
    await page.getByRole('button', { name: 'More actions' }).click()
    const chip = page.getByTitle('Provisioned infrastructure cost (per hour)').first()
    await expect(chip).toBeVisible()
    const shown = Number(((await chip.innerText()).match(/(\d+(?:\.\d+)?)/) ?? [])[1])
    expect(Math.abs(shown - 0.5184)).toBeLessThan(0.01)
    expect(Math.abs(shown - topologyCost(t).totalPerHour)).toBeLessThan(0.01)
  })
})
