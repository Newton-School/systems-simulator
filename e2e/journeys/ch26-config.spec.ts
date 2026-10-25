/**
 * Chapter 26: configuration, JSON and types (docs/reference/26-configuration-json-and-types.md).
 * Expected behaviour comes from the chapter's field table: every range in it is enforced and names the field, a document and
 * seed give one run, defaults are the documented ones, deprecated aliases mean what they say, and a field the chapter
 * says declares an intent does what it declares. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { bodyText, importTopology, openApp } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr } from '../support/oracles'
import { chain, computeNode, queueNode, type RunSpec } from '../support/topology'
import { topologyCost } from '../../src/engine/analysis/cost'
import { validateTopology } from '../../src/engine/validation/validator'
import type { TopologyJSON } from '../../src/engine/core/types'

type Loose = Record<string, any>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 10,
    pattern: 'constant',
    durationMs: 5000,
    warmupMs: 0,
    seed,
    timeoutMs: 1000,
    ...over
  }
}

const tcp = (a: string, b: string) =>
  [a, b, { protocol: 'tcp' }] as [string, string, Record<string, unknown>]

/** source -> a, a valid document to mutate. */
const base = (): Loose =>
  chain({
    run: run('cfg'),
    nodes: [computeNode('a', { serviceMs: 5 })],
    edges: [tcp('source', 'a')]
  }) as Loose

// ───────────────────────── 1. Ranges are enforced and name the field ─────────────────────────

test.describe('CFG-01 every range in the field table is enforced, naming the field (ch26 sections 2 to 6)', () => {
  const cases: [string, (t: Loose) => void, string][] = [
    ['run duration 0', (t) => (t.global.simulationDuration = 0), 'global.simulationDuration'],
    ['negative warmup', (t) => (t.global.warmupDuration = -1), 'global.warmupDuration'],
    ['default timeout 0', (t) => (t.global.defaultTimeout = 0), 'global.defaultTimeout'],
    [
      'trace sample rate above 1',
      (t) => (t.global.traceSampleRate = 1.5),
      'global.traceSampleRate'
    ],
    ['unknown component type', (t) => (t.nodes[1].type = 'quantum-db'), 'nodes.1.type'],
    ['unknown category value', (t) => (t.nodes[1].category = 'not-a-category'), 'nodes.1.category'],
    [
      'log-normal sigma 0',
      (t) => (t.nodes[1].processing.distribution = { type: 'log-normal', mu: 1, sigma: 0 }),
      'processing.distribution.sigma'
    ],
    [
      'breaker threshold above 1',
      (t) =>
        (t.nodes[1].resilience = {
          circuitBreaker: {
            failureThreshold: 1.5,
            failureCount: 10,
            recoveryTimeout: 1000,
            halfOpenRequests: 1
          }
        }),
      'circuitBreaker.failureThreshold'
    ],
    [
      'retry with 0 attempts',
      (t) =>
        (t.nodes[1].resilience = {
          retry: { maxAttempts: 0, baseDelay: 1, maxDelay: 2, multiplier: 1, jitter: false }
        }),
      'retry.maxAttempts'
    ],
    ['edge error rate above 1', (t) => (t.edges[0].errorRate = 2), 'edges.0.errorRate'],
    ['negative packet loss', (t) => (t.edges[0].packetLossRate = -0.1), 'edges.0.packetLossRate'],
    ['edge to a node that does not exist', (t) => (t.edges[0].target = 'ghost'), 'edges[0].target'],
    ['base rps 0', (t) => (t.workload.baseRps = 0), 'workload.baseRps'],
    [
      'negative request weight',
      (t) => (t.workload.requestDistribution[0].weight = -1),
      'requestDistribution.0.weight'
    ],
    ['zero instances', (t) => (t.nodes[1].resources.instanceCount = 0), 'resources.instanceCount'],
    [
      'availability target above 1',
      (t) => (t.nodes[1].slo = { availabilityTarget: 2 }),
      'slo.availabilityTarget'
    ],
    [
      'bulkhead compartment cap 0',
      (t) => (t.nodes[1].resilience = { bulkhead: { partitions: { x: 0 } } }),
      'bulkhead.partitions'
    ]
  ]
  for (const [name, mutate, path] of cases) {
    test(`${name} is rejected at ${path}`, () => {
      const doc = base()
      mutate(doc)
      const result = validateTopology(doc)
      expect(result.valid).toBe(false)
      expect(result.errors!.some((e) => e.path.includes(path))).toBe(true)
    })
  }

  test('the unmodified document is valid', () => {
    expect(validateTopology(base()).valid).toBe(true)
  })

  test('request weights that do not add up to 100% are rejected', () => {
    const doc = base()
    doc.workload.requestDistribution = [
      { type: 'GET', weight: 0.5, sizeBytes: 100 },
      { type: 'POST', weight: 0.2, sizeBytes: 100 }
    ]
    expect(validateTopology(doc).valid).toBe(false)
  })
})

// ───────────────────────── 2. Defaults and aliases ─────────────────────────

test.describe('CFG-02 defaults and deprecated aliases mean what the chapter says (ch26 sections 2 and 3)', () => {
  test('with no traceSampleRate about 1% of requests are traced', () => {
    const doc = chain({
      run: run('cfg02', { rps: 1000, durationMs: 20_000 }),
      nodes: [queueNode('a', 'microservice', { category: 'compute', serviceMs: 1, workers: 64 })],
      edges: [tcp('source', 'a')]
    }) as Loose
    delete doc.global.traceSampleRate
    const out = runEngine(doc as TopologyJSON)
    expect(Math.abs(out.traces.length / out.summary.totalRequests - 0.01)).toBeLessThan(0.006)
  })

  test('the deprecated `replicas` is read as `instanceCount`: same capacity and the same cost', () => {
    const make = (field: 'replicas' | 'instanceCount') => {
      const node = computeNode('a', { serviceMs: 10 })
      delete (node.resources as Loose).instanceCount
      ;(node.resources as Loose)[field] = 3
      return chain({
        run: run(`cfg02-${field}`, { rps: 400 }),
        nodes: [node],
        edges: [tcp('source', 'a')]
      }) as TopologyJSON
    }
    const a = make('replicas')
    const b = make('instanceCount')
    expect(topologyCost(a).totalPerHour).toBeCloseTo(topologyCost(b).totalPerHour, 12)
    expect(runEngine(a).perNode.a.utilization).toBeCloseTo(runEngine(b).perNode.a.utilization, 6)
  })

  test('workersPerInstance and queueSlots are accepted but ignored, and the validator says so', () => {
    const doc = base()
    doc.nodes[1].resources.workersPerInstance = 64
    doc.nodes[1].resources.queueSlots = 9999
    const result = validateTopology(doc)
    expect(result.valid).toBe(true)
    expect(result.warnings!.some((w) => /ignored/i.test(w))).toBe(true)
    const plain = runEngine(base() as TopologyJSON)
    const withFields = runEngine(doc as TopologyJSON)
    expect(withFields.perNode.a.utilization).toBeCloseTo(plain.perNode.a.utilization, 9)
  })

  test('the pricing model changes only the cost: reserved is 0.6x, the run is identical', () => {
    const doc = base()
    doc.nodes[1].resources.pricingModel = 'reserved'
    expect(topologyCost(doc as TopologyJSON).totalPerHour).toBeCloseTo(
      0.6 * topologyCost(base() as TopologyJSON).totalPerHour,
      12
    )
    expect(runEngine(doc as TopologyJSON).summary.successfulRequests).toBe(
      runEngine(base() as TopologyJSON).summary.successfulRequests
    )
  })
})

// ───────────────────────── 3. Reproducibility ─────────────────────────

test.describe('CFG-03 a document and a seed give one run (ch26 section 2, chapter 04)', () => {
  const noisy = (seed: string) => {
    const node = computeNode('a', { serviceMs: 5 })
    ;(node.processing as Loose).distribution = { type: 'exponential', lambda: 1 / 5 }
    return chain({
      run: run(seed, { rps: 100, pattern: 'poisson', durationMs: 20_000 }),
      nodes: [node],
      edges: [tcp('source', 'a')]
    })
  }

  test('the same seed twice gives identical output', () => {
    const a = runEngine(noisy('same'))
    const b = runEngine(noisy('same'))
    expect(a.summary).toEqual(b.summary)
    expect(a.reproducible).toBe(true)
  })

  test('a different seed gives a different run of the same statistics', () => {
    const a = runEngine(noisy('seed-one')).summary
    const b = runEngine(noisy('seed-two')).summary
    expect(a.latency.mean).not.toBe(b.latency.mean)
    expect(relErr(a.latency.mean, b.latency.mean)).toBeLessThan(0.1)
  })
})

// ───────────────────────── 4. Declared fields that must do something ─────────────────────────

test.describe('CFG-04 fields the chapter lists as declared but not read (ch26 section 9)', () => {
  // Tracked gaps (finding 37): each field is validated and documented as an intent, but nothing in the engine reads it.

  test.fail(
    'failureModes: a node with an MTBF of 5 s and an MTTR of 1 s is down about 1/6 of the time',
    () => {
      const doc = chain({
        run: run('cfg04a', { rps: 100, durationMs: 120_000 }),
        nodes: [computeNode('a', { serviceMs: 5 })],
        edges: [tcp('source', 'a')]
      }) as Loose
      doc.nodes[1].failureModes = [{ mode: 'crash', severity: 'critical', mtbf: 5000, mttr: 1000 }]
      const out = runEngine(doc as TopologyJSON)
      expect(Math.abs(out.summary.errorRate - 1 / 6)).toBeLessThan(0.05)
    }
  )

  test.fail('scaling: a horizontal scaling block on an overloaded node adds capacity', () => {
    const doc = chain({
      run: run('cfg04b', { rps: 300, durationMs: 60_000 }),
      nodes: [computeNode('a', { serviceMs: 100 })],
      edges: [tcp('source', 'a')]
    }) as Loose
    doc.nodes[1].scaling = {
      type: 'horizontal',
      metric: 'utilization',
      scaleUpThreshold: 0.7,
      scaleDownThreshold: 0.3,
      cooldown: 5000
    }
    const out = runEngine(doc as TopologyJSON)
    expect(out.timeSeries.at(-1)!.node.a.workers).toBeGreaterThan(2)
  })

  test.fail(
    'slo.errorBudget: a node with 5% errors against an error budget of 0.1% is reported as breaching it',
    () => {
      const doc = chain({
        run: run('cfg04c', { rps: 500, durationMs: 20_000 }),
        nodes: [computeNode('a', { serviceMs: 5 })],
        edges: [['source', 'a', { protocol: 'tcp', errorRate: 0.05 }]]
      }) as Loose
      doc.nodes[1].slo = { errorBudget: 0.001 }
      const out = runEngine(doc as TopologyJSON)
      expect(out.sloBreaches.length).toBeGreaterThan(0)
    }
  )

  test('slo.availabilityTarget and slo.latencyP99 are read: a 50% failing node breaches a 99.9% target', () => {
    const doc = chain({
      run: run('cfg04d', { rps: 500, durationMs: 20_000 }),
      nodes: [computeNode('a', { serviceMs: 5 })],
      edges: [tcp('source', 'a')],
      faults: [
        {
          targetId: 'a',
          faultType: 'node-failure',
          timing: 'deterministic',
          duration: 'fixed',
          params: { atMs: 0, durationMs: 10_000, mode: 'reject' }
        }
      ]
    }) as Loose
    doc.nodes[1].slo = { availabilityTarget: 0.999 }
    const out = runEngine(doc as TopologyJSON)
    expect(out.sloBreaches.some((b) => b.metric === 'availability')).toBe(true)
  })
})

// ───────────────────────── 5. The browser agrees ─────────────────────────

test.describe('CFG-05 the browser rejects an invalid document and names the field (ch26 section 10)', () => {
  test('a run duration of 0 is refused with the reason, and nothing is imported', async ({
    page
  }) => {
    const doc = base()
    doc.global.simulationDuration = 0
    await openApp(page)
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('button', { name: /^(JSON|TopologyJSON: import.*)$/ }).click()
    await page.getByRole('menuitem', { name: /Import JSON/ }).click()
    await page.getByRole('textbox').fill(JSON.stringify(doc))
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect.poll(async () => bodyText(page)).toContain('Nothing was imported')
    expect(await bodyText(page)).toMatch(/Run duration must be greater than 0/)
  })

  test('the valid document imports cleanly', async ({ page }) => {
    await openApp(page)
    const dialog = await importTopology(page, base() as TopologyJSON)
    expect(dialog).not.toContain('Nothing was imported')
  })
})
