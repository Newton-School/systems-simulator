/**
 * Chapter 09: storage and databases (docs/reference/09-storage-and-databases.md).
 * Expected values come from the chapter: capacity = workers / service time, a store fills at write rate x write
 * amplification x record size, point reads beat scans, reads from memory beat reads from an object store,
 * a volume cannot exceed its IOPS ceiling, connections in use follow Little's law. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr, writesBeforeFull } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 10_000,
    warmupMs: 0,
    seed,
    timeoutMs: 30_000,
    ...over
  }
}

function steadyRate(out: ReturnType<typeof runEngine>, fromSec: number, toSec: number): number {
  const windows = out.summary.latencyWindows.filter(
    (w) => w.windowStartMs >= fromSec * 1000 && w.windowEndMs <= toSec * 1000
  )
  return windows.reduce((a, w) => a + w.successCount, 0) / windows.length
}

/** The default edge is gRPC (0.2 ms of protocol overhead per request); tcp adds none, so latency is the store's own. */
const TCP: ['source', string, Record<string, unknown>][] = [['source', 'db', { protocol: 'tcp' }]]

const dist = (type: string, size = 1000) => [{ type, weight: 1, sizeBytes: size }]

/** Mean latency of the successful outcomes of one request type. */
function meanLatencyOf(out: ReturnType<typeof runEngine>, requestType: string): number {
  const rows = out.requestOutcomes.filter(
    (o) => o.status === 'success' && o.requestType === requestType
  )
  return rows.reduce((a, o) => a + o.latencyMs, 0) / rows.length
}

test.describe('S-01 capacity is workers / service time (ch09 section 2)', () => {
  test('4 workers at 8 ms serve 500 reads per second, however hard they are pushed', () => {
    const t = chain({
      run: run('s01', { rps: 800 }),
      nodes: [
        queueNode('db', 'relational-db', {
          workers: 4,
          capacity: 24,
          config: { storageReadMs: 8 }
        })
      ],
      requestDistribution: dist('read')
    })
    const out = runEngine(t)
    expect(relErr(steadyRate(out, 3, 9), (4 / 8) * 1000)).toBeLessThan(0.02)
    expect(out.summary.rejectedRequests).toBeGreaterThan(0)
  })

  test('below capacity every read is served and the latency is the configured read time', () => {
    const t = chain({
      run: run('s01b', { rps: 100 }),
      nodes: [queueNode('db', 'relational-db', { workers: 4, config: { storageReadMs: 8 } })],
      edges: TCP,
      requestDistribution: dist('read')
    })
    const out = runEngine(t)
    expect(out.summary.failedRequests).toBe(0)
    expect(relErr(out.summary.latency.mean, 8)).toBeLessThan(0.02)
  })
})

test.describe('S-02 a point read is cheaper than a scan by the configured ratio (ch09 sections 3 to 6)', () => {
  test('read 4 ms, scan 40 ms: the scan costs ten times the read', () => {
    const t = chain({
      run: run('s02', { rps: 20 }),
      nodes: [
        queueNode('db', 'relational-db', {
          config: { storageReadMs: 4, storageScanMs: 40 }
        })
      ],
      edges: TCP,
      requestDistribution: [
        { type: 'read', weight: 0.5, sizeBytes: 500 },
        { type: 'scan-export', weight: 0.5, sizeBytes: 500 }
      ]
    })
    const out = runEngine(t)
    const read = meanLatencyOf(out, 'read')
    const scan = meanLatencyOf(out, 'scan-export')
    expect(relErr(read, 4)).toBeLessThan(0.03)
    expect(relErr(scan, 40)).toBeLessThan(0.03)
    expect(relErr(scan / read, 10)).toBeLessThan(0.05)
  })
})

test.describe('S-03 a store fills at write rate x write amplification x record size (ch09 sections 4 and 9)', () => {
  const full = (seed: string, config: Record<string, unknown>, bytes = 1000, rps = 100) =>
    runEngine(
      chain({
        run: run(seed, { rps }),
        nodes: [queueNode('db', 'relational-db', { config })],
        requestDistribution: dist('write', bytes)
      })
    )

  test('100 KB of capacity, 1 KB records, amplification 2: exactly 50 writes commit, the rest are rejected as full', () => {
    const out = full('s03', { storageCapacityGb: 0.0001, storageWriteAmplification: 2 })
    const expected = writesBeforeFull(0.0001, 0, 1000, 2)
    expect(out.perNode.db.traitCounters.storageWritesCommitted).toBe(expected)
    expect(out.summary.successfulRequests).toBe(expected)
    const rejected = out.requestOutcomes.filter((o) => o.reasonCode === 'storage_full').length
    expect(rejected).toBe(out.summary.totalRequests - expected)
  })

  test('doubling the write amplification halves the writes that fit', () => {
    const one = full('s03a', { storageCapacityGb: 0.0001, storageWriteAmplification: 1 })
    const two = full('s03b', { storageCapacityGb: 0.0001, storageWriteAmplification: 2 })
    expect(one.perNode.db.traitCounters.storageWritesCommitted).toBe(
      writesBeforeFull(0.0001, 0, 1000, 1)
    )
    expect(two.perNode.db.traitCounters.storageWritesCommitted).toBe(
      writesBeforeFull(0.0001, 0, 1000, 2)
    )
  })

  test('data already on disk (initialStorageGb) leaves proportionally less room', () => {
    const out = full('s03c', {
      storageCapacityGb: 0.0001,
      initialStorageGb: 0.00005,
      storageWriteAmplification: 2
    })
    expect(out.perNode.db.traitCounters.storageWritesCommitted).toBe(
      writesBeforeFull(0.0001, 0.00005, 1000, 2)
    )
  })

  test('the first full-disk rejection happens when capacity / (rate x amplification x size) has elapsed', () => {
    // 500 KB, 100 writes/s of 1 KB, amplification 1 -> 500 writes -> full at 5 s.
    const out = full('s03d', { storageCapacityGb: 0.0005, storageWriteAmplification: 1 })
    const firstFull = Math.min(
      ...out.requestOutcomes
        .filter((o) => o.reasonCode === 'storage_full')
        .map((o) => o.createdAtMs)
    )
    expect(Math.abs(firstFull - 5000)).toBeLessThan(50)
  })

  test('reads never consume capacity', () => {
    const out = runEngine(
      chain({
        run: run('s03e', { rps: 500 }),
        nodes: [queueNode('db', 'relational-db', { config: { storageCapacityGb: 0.00001 } })],
        requestDistribution: dist('read')
      })
    )
    expect(out.summary.failedRequests).toBe(0)
    expect(out.perNode.db.traitCounters.storageFullRejects ?? 0).toBe(0)
  })
})

test.describe('S-04 store types rank by access cost (ch09 sections 1, 4 and 5)', () => {
  // Point-read cost with nothing configured: memory-class key-value < indexed NoSQL < relational < object storage.
  const ranked = ['kv-store', 'nosql-db', 'relational-db', 'object-storage']
  const meanFor = (type: string, requestType: string) => {
    const out = runEngine(
      chain({
        run: run(`s04-${type}-${requestType}`, { rps: 10 }),
        nodes: [queueNode('db', type)],
        requestDistribution: dist(requestType, 500)
      })
    )
    return out.summary.latency.mean
  }

  test('read latency: key-value < NoSQL < relational < object storage', () => {
    const means = ranked.map((type) => meanFor(type, 'read'))
    for (let i = 1; i < means.length; i += 1) expect(means[i]).toBeGreaterThan(means[i - 1])
  })

  test('on every store a scan costs more than a point read', () => {
    for (const type of ranked) {
      expect(meanFor(type, 'scan-export'), type).toBeGreaterThan(meanFor(type, 'read'))
    }
  })

  test('a relational write (log flush plus data change) costs more than a read', () => {
    expect(meanFor('relational-db', 'write')).toBeGreaterThan(meanFor('relational-db', 'read'))
  })
})

test.describe('S-05 a volume cannot exceed its IOPS ceiling (ch09 section 2)', () => {
  test('block storage capped at 300 ops/s admits about 300 per second under 500 offered', () => {
    const out = runEngine(
      chain({
        run: run('s05', { rps: 500 }),
        nodes: [queueNode('vol', 'block-storage', { config: { maxOpsPerSecond: 300 } })],
        requestDistribution: dist('read')
      })
    )
    expect(relErr(steadyRate(out, 3, 9), 300)).toBeLessThan(0.03)
    expect(out.requestOutcomes.some((o) => o.reasonCode === 'capacity_exceeded')).toBe(true)
  })
})

test.describe('S-06 connections in use = query rate x query time (ch09 section 3, Little)', () => {
  const sixHundred = () =>
    runEngine(
      chain({
        run: run('s06', { rps: 500, durationMs: 20_000 }),
        nodes: [queueNode('db', 'relational-db', { workers: 64, config: { storageReadMs: 20 } })],
        edges: TCP,
        requestDistribution: dist('read')
      })
    )

  test('500 req/s at 20 ms need 10 connections (exact time-average in the Little check)', () => {
    const out = sixHundred()
    const check = out.littlesLawCheck.find((c) => c.nodeId === 'db')!
    expect(relErr(check.observedL, 10)).toBeLessThan(0.01)
  })

  // Finding 16 (fixed): avgInSystem was a 1 Hz sampled gauge whose first sample, at t = 0, is always an empty
  // system, so a steady 10 read 9.5 over 20 s. It is now the time average over the measured window.
  test('the per-node average in system equals the time average (bias of 1 / duration)', () => {
    const out = sixHundred()
    expect(relErr(out.perNode.db.avgInSystem, 10)).toBeLessThan(0.01)
  })
})

test.describe('S-07 decision needed: authored processing time on a data store', () => {
  // A person who types a 100 ms service time on a database expects 100 ms. The storage profile replaces it with
  // the per-operation defaults, so the typed value has no effect unless storageReadMs / storageWriteMs is set.
  test.fixme('an authored processing time on a relational database is the read latency', () => {
    const out = runEngine(
      chain({
        run: run('s07', { rps: 10 }),
        nodes: [queueNode('db', 'relational-db', { serviceMs: 100 })],
        requestDistribution: dist('read')
      })
    )
    expect(relErr(out.summary.latency.mean, 100)).toBeLessThan(0.05)
  })
})

test.describe('S-08 the browser shows what the engine computed for a filling store', () => {
  test('a 100 KB store that fills mid-run shows the engine error rate', async ({ page }) => {
    const t = chain({
      run: run('s08', { rps: 100 }),
      nodes: [
        queueNode('srv', 'relational-db', {
          config: { storageCapacityGb: 0.0001, storageWriteAmplification: 2 }
        })
      ],
      requestDistribution: dist('write')
    })
    const out = runEngine(t)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'srv')
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(1)
    // Theory: 50 of 1,000 writes fit.
    expect(Math.abs(ui.errorRatePct - 95)).toBeLessThan(1)
  })
})
