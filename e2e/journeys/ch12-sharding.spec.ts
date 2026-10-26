/**
 * Chapter 12: sharding and partitioning (docs/reference/12-sharding-and-partitioning.md).
 * Expected values come from the chapter: hash routing over many keys gives shares within sampling error of 1/n,
 * Zipf keys make the busiest shard at least the hottest key's share, system throughput is bounded by the hottest
 * shard's capacity divided by its share, adding a shard moves about 1/(N+1) of the keys on a consistent-hash ring,
 * and a scatter-gather query over n shards costs mu x H_n on average. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { harmonic, maxExpQuantile, modHashMoved, relErr, zipfTopShare } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'
import { HASH_RING_VNODES, hashString, pickOnHashRing } from '../../src/engine/core/hashRing'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 400,
    pattern: 'constant',
    durationMs: 100_000,
    warmupMs: 0,
    seed,
    timeoutMs: 30_000,
    ...over
  }
}

const tcp = { protocol: 'tcp' }

interface ShardedOpts {
  shards: number
  keys: { size: number; skew: number }
  routerConfig?: Record<string, unknown>
  shardWorkers?: number
  shardCapacity?: number
  shardMs?: number
  over?: Partial<RunSpec>
  /** Leave the key off the requests entirely. */
  keyless?: boolean
}

function sharded(seed: string, o: ShardedOpts) {
  const ids = Array.from({ length: o.shards }, (_, i) => `s${i}`)
  return chain({
    run: run(seed, o.over),
    nodes: [
      queueNode('router', 'sharding', {
        category: 'auxiliary',
        serviceMs: 0.01,
        config: { routingKeyField: 'k', ...o.routerConfig }
      }),
      ...ids.map((id) =>
        queueNode(id, 'shard-node', {
          workers: o.shardWorkers ?? 64,
          capacity: o.shardCapacity,
          config: { storageReadMs: o.shardMs ?? 1 }
        })
      )
    ],
    edges: [
      ['source', 'router', tcp],
      ...ids.map((id) => ['router', id, tcp] as [string, string, Record<string, unknown>])
    ],
    requestDistribution: [
      {
        type: 'read',
        weight: 1,
        sizeBytes: 200,
        ...(o.keyless ? {} : { keyspace: { field: 'k', ...o.keys } })
      }
    ]
  })
}

const shares = (out: ReturnType<typeof runEngine>, n: number) => {
  const counts = Array.from({ length: n }, (_, i) => out.perNode[`s${i}`].totalArrived)
  const total = counts.reduce((a, b) => a + b, 0)
  return counts.map((c) => c / total)
}

// ───────────────────────── 1. Where keys land ─────────────────────────

test.describe('SH-01 hashing many even keys spreads the load evenly (ch12 sections 4 and 6)', () => {
  for (const n of [2, 4, 8]) {
    test(`${n} shards, 20,000 uniform keys: every share is 1/${n} within the ring's virtual-node spread`, () => {
      const out = runEngine(
        sharded(`sh01-${n}`, {
          shards: n,
          keys: { size: 20_000, skew: 0 },
          over: { durationMs: 100_000 }
        })
      )
      const requests = out.perNode.router.totalArrived
      const sampling = Math.sqrt(((1 / n) * (1 - 1 / n)) / requests)
      // A consistent-hash ring with V virtual nodes per shard gives each shard an arc whose relative standard
      // deviation is about 1 / sqrt(V) (Karger et al.; Dynamo). Allow three of them, plus the sampling error.
      const ring = (3 / Math.sqrt(HASH_RING_VNODES)) * (1 / n)
      for (const share of shares(out, n)) {
        expect(Math.abs(share - 1 / n)).toBeLessThan(ring + 3 * sampling)
      }
    })
  }

  test('more virtual nodes tighten the spread (the reason real rings use 128 to 256)', () => {
    const keys = Array.from({ length: 20_000 }, (_, i) => `user-${i}`)
    const spread = (v: number) => {
      // Rebuild the same ring the engine uses, with v points per shard.
      const ids = ['a', 'b', 'c', 'd']
      const points = ids
        .flatMap((id) => Array.from({ length: v }, (_, k) => ({ id, h: hashString(`${id}#${k}`) })))
        .sort((x, y) => x.h - y.h)
      const counts = new Map(ids.map((id) => [id, 0]))
      for (const key of keys) {
        const h = hashString(key)
        const p = points.find((q) => q.h >= h) ?? points[0]
        counts.set(p.id, counts.get(p.id)! + 1)
      }
      return Math.max(...counts.values()) / (keys.length / ids.length)
    }
    expect(spread(512)).toBeLessThan(spread(4))
    expect(spread(512)).toBeLessThan(1.1)
  })
})

test.describe('SH-02 under Zipf keys the busiest shard carries at least the hottest key (ch12 section 4)', () => {
  for (const s of [0.8, 1.0, 1.2]) {
    test(`s = ${s}, 1,000 keys, 8 shards`, () => {
      const out = runEngine(
        sharded(`sh02-${s}`, {
          shards: 8,
          keys: { size: 1000, skew: s },
          over: { durationMs: 60_000 }
        })
      )
      const hottestKey = zipfTopShare(1000, s, 1)
      expect(Math.max(...shares(out, 8))).toBeGreaterThanOrEqual(hottestKey - 0.01)
      // And it is a lot more than the fair 1/8 once one key is as heavy as the chapter says.
      if (s >= 1) expect(Math.max(...shares(out, 8))).toBeGreaterThan(1.5 / 8)
    })
  }
})

test.describe('SH-03 the busiest shard saturates first: throughput <= capacity / its share (ch12 section 4)', () => {
  // Each shard: 1 worker at 10 ms = 100 req/s, short waiting room so overload shows as rejections.
  const CAP = 100
  const hotShare = (s: number) => {
    // The measured busiest share at light load (shares do not depend on the rate).
    const light = runEngine(
      sharded('sh03-share', {
        shards: 4,
        keys: { size: 1000, skew: s },
        over: { rps: 100, durationMs: 40_000 }
      })
    )
    return Math.max(...shares(light, 4))
  }
  const overloaded = (seed: string, rps: number, s: number) =>
    runEngine(
      sharded(seed, {
        shards: 4,
        keys: { size: 1000, skew: s },
        shardWorkers: 1,
        shardCapacity: 11,
        shardMs: 10,
        over: { rps, durationMs: 30_000 }
      })
    )

  test('below capacity / share no shard rejects; 20% above it the hot shard rejects about 1/6 of its traffic', () => {
    const share = hotShare(1.2)
    const limit = CAP / share
    const below = overloaded('sh03-below', Math.floor(limit * 0.85), 1.2)
    expect(below.summary.rejectedRequests).toBe(0)

    const above = overloaded('sh03-above', Math.ceil(limit * 1.2), 1.2)
    const ids = ['s0', 's1', 's2', 's3']
    const hottest = ids.reduce((a, b) =>
      above.perNode[a].totalArrived >= above.perNode[b].totalArrived ? a : b
    )
    const rejectedAtHot = above.perNode[hottest].totalRejected / above.perNode[hottest].totalArrived
    expect(Math.abs(rejectedAtHot - (1 - 1 / 1.2))).toBeLessThan(0.03)
    // The other shards still have room: skew, not total capacity, is what failed.
    for (const id of ids.filter((x) => x !== hottest)) {
      expect(above.perNode[id].utilization).toBeLessThan(1)
    }
  })

  test('uniform keys raise the limit to the sum of the shards (4 x 100)', () => {
    const out = overloaded('sh03-uniform', 380, 0)
    expect(out.summary.rejectedRequests / out.summary.totalRequests).toBeLessThan(0.02)
  })
})

// ───────────────────────── 2. Rebalancing and routing policy ─────────────────────────

test.describe('SH-04 adding a shard moves about 1/(N + 1) of the keys on a consistent-hash ring (ch12 section 6)', () => {
  const keys = Array.from({ length: 20_000 }, (_, i) => `user-${i}`)
  const route = (n: number) => Array.from({ length: n }, (_, i) => ({ targetNodeId: `s${i}` }))

  for (const n of [3, 4, 7]) {
    test(`${n} to ${n + 1} shards: about 1/${n + 1} move and every mover goes to the new shard`, () => {
      const before = route(n)
      const after = route(n + 1)
      let moved = 0
      let movedElsewhere = 0
      for (const key of keys) {
        const a = pickOnHashRing(before, key).targetNodeId
        const b = pickOnHashRing(after, key).targetNodeId
        if (a !== b) {
          moved += 1
          if (b !== `s${n}`) movedElsewhere += 1
        }
      }
      expect(Math.abs(moved / keys.length - 1 / (n + 1))).toBeLessThan(0.03)
      expect(movedElsewhere).toBe(0)
    })
  }

  test('hash(key) mod N would have moved N/(N+1): the reason the ring exists', () => {
    expect(modHashMoved(4)).toBeCloseTo(4 / 5, 9)
    expect(modHashMoved(4)).toBeGreaterThan(3 * (1 / 5))
  })
})

test.describe('SH-05 a request with no key (ch12 section 3)', () => {
  test('by default it is spread by request id, so no shard is hot', () => {
    const out = runEngine(
      sharded('sh05a', {
        shards: 4,
        keys: { size: 1, skew: 0 },
        keyless: true,
        over: { durationMs: 40_000 }
      })
    )
    for (const share of shares(out, 4)) expect(Math.abs(share - 0.25)).toBeLessThan(0.03)
  })

  test("with the 'reject' policy it is refused with a missing-key reason", () => {
    const out = runEngine(
      sharded('sh05b', {
        shards: 4,
        keys: { size: 1, skew: 0 },
        keyless: true,
        routerConfig: { missingRoutingKeyPolicy: 'reject' },
        over: { durationMs: 5_000 }
      })
    )
    expect(out.summary.successfulRequests).toBe(0)
    expect(out.requestOutcomes[0].reasonCode).toBe('missing_shard_key')
  })
})

test.describe('SH-06 splitting a hot shard lowers its share (ch12 section 4)', () => {
  const hottest = (routerConfig?: Record<string, unknown>) => {
    const out = runEngine(
      sharded(`sh06-${routerConfig ? 'on' : 'off'}`, {
        shards: 4,
        keys: { size: 1000, skew: 1.2 },
        routerConfig,
        over: { durationMs: 60_000 }
      })
    )
    return Math.max(...shares(out, 4))
  }

  test('automatic rebalancing spreads the hottest key over a second shard', () => {
    const without = hottest()
    const withSplit = hottest({
      autoShardRebalance: true,
      hotShardThresholdRatio: 1.3,
      hotShardMinSamples: 100
    })
    expect(withSplit).toBeLessThan(without)
  })
})

// ───────────────────────── 3. Scatter-gather ─────────────────────────

test.describe('SH-07 a scatter-gather over n shards costs mu x H_n on average and the max-quantile at the tail (ch12 section 5)', () => {
  const MU = 10
  const BASE = 5
  const query = (n: number) =>
    runEngine(
      chain({
        run: run(`sh07-${n}`, { rps: 100, pattern: 'constant', durationMs: 60_000 }),
        nodes: [
          queueNode('srch', 'search-service', {
            category: 'compute',
            serviceMs: BASE,
            config: { shardCount: n, perShardLatencyMs: MU }
          })
        ],
        edges: [['source', 'srch', tcp]],
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      })
    )

  for (const n of [2, 4, 8, 16, 64]) {
    test(`n = ${n}: mean tail ${(MU * harmonic(n)).toFixed(1)} ms, p99 tail ${maxExpQuantile(MU, n, 0.99).toFixed(1)} ms`, () => {
      const out = query(n)
      const meanTail = out.summary.latency.mean - BASE
      expect(relErr(meanTail, MU * harmonic(n))).toBeLessThan(0.05)
      const p99Tail = out.summary.latency.p99 - BASE
      expect(relErr(p99Tail, maxExpQuantile(MU, n, 0.99))).toBeLessThan(0.12)
    })
  }

  test('the tail grows about logarithmically: doubling the shards adds about mu x ln 2', () => {
    const t8 = query(8).summary.latency.mean
    const t64 = query(64).summary.latency.mean
    // H_64 - H_8 = ln 8 + small terms
    expect(relErr(t64 - t8, MU * (harmonic(64) - harmonic(8)))).toBeLessThan(0.1)
  })

  // Decision needed (ch12 section 7): a query over one shard still waits for that shard, H_1 = 1, but the model adds
  // no tail for shardCount = 1 (the unit test treats it as "not sharded").
  test.fixme('one shard adds one shard latency (H_1 = 1)', () => {
    const out = query(1)
    expect(relErr(out.summary.latency.mean - BASE, MU * harmonic(1))).toBeLessThan(0.05)
  })
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('SH-08 the browser shows the hot-shard overload the engine computed', () => {
  test('a Zipf-skewed 4-shard topology at 1.2x its limit shows the engine error rate', async ({
    page
  }) => {
    const t = sharded('sh08', {
      shards: 4,
      keys: { size: 1000, skew: 1.2 },
      shardWorkers: 1,
      shardCapacity: 11,
      shardMs: 10,
      over: { rps: 330, durationMs: 20_000 }
    })
    const out = runEngine(t)
    expect(out.summary.rejectedRequests).toBeGreaterThan(0)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'router')
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(1)
  })
})
