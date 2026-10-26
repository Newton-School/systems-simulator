/**
 * Chapter 13: messaging and streaming (docs/reference/13-messaging-and-streaming.md).
 * Expected values come from the chapter: the producer is acknowledged at append and never waits for the consumer,
 * backlog grows at arrival - drain, work is conserved, redelivery share = P(processing > limit), a message is dead-lettered
 * after maxReceiveCount failures, consumers beyond the partition count add nothing, a topic delivers to every
 * subscription, replay time = events since the last snapshot x per-event cost. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { redeliveryShare, relErr } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 10_000,
    warmupMs: 0,
    seed,
    timeoutMs: 60_000,
    ...over
  }
}

const tcp = { protocol: 'tcp' }
const edge = (a: string, b: string) => [a, b, tcp] as [string, string, Record<string, unknown>]
const mix = [{ type: 'GET', weight: 1, sizeBytes: 100 }]

const isProducer = (o: { requestId: string }) => !o.requestId.includes('::')
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

const queue = (
  id: string,
  opts: {
    workers?: number
    serviceMs?: number
    timeoutMs?: number
    config?: Record<string, unknown>
  } = {}
) => queueNode(id, 'queue', { category: 'messaging-and-streaming', ...opts })

// ───────────────────────── 1. Queue: ack at append, backlog, conservation ─────────────────────────

test.describe('M-01 the producer never waits for the consumer (ch13 section 2)', () => {
  const slow = runEngine(
    chain({
      run: run('m01'),
      nodes: [queue('q', { workers: 1, serviceMs: 20 })],
      edges: [edge('source', 'q')],
      requestDistribution: mix
    })
  )

  test('producer latency is the append, a tiny fraction of the consumer time, even with a huge backlog', () => {
    const producers = slow.requestOutcomes.filter(isProducer)
    expect(producers.length).toBe(1000)
    expect(Math.max(...producers.map((o) => o.latencyMs))).toBeLessThan(1)
  })

  test('consumer latency carries the queueing: 1 worker at 20 ms against 100/s waits seconds', () => {
    const consumers = slow.requestOutcomes.filter((o) => !isProducer(o) && o.status === 'success')
    expect(mean(consumers.map((o) => o.latencyMs))).toBeGreaterThan(500)
  })
})

test.describe('M-02 backlog grows at (arrival - drain) when the consumer is slower (ch13 section 2)', () => {
  const T = 10
  const build = (seed: string, workers: number, serviceMs: number, rps: number) =>
    runEngine(
      chain({
        run: run(seed, { rps, durationMs: T * 1000 }),
        nodes: [queue('q', { workers, serviceMs })],
        edges: [edge('source', 'q')],
        requestDistribution: mix
      })
    )

  test('100/s in, 1 worker at 20 ms = 50/s out: delivered about 500 of 1,000 and about 500 still waiting, none lost', () => {
    const out = build('m02', 1, 20, 100)
    const w = out.acceptedWorkConservation
    expect(w.accepted).toBe(1000)
    expect(relErr(w.delivered, 50 * T)).toBeLessThan(0.02)
    expect(w.lost).toBe(0)
    expect(relErr(w.accepted - w.delivered, (100 - 50) * T)).toBeLessThan(0.03)
  })

  test('a consumer that keeps up leaves no backlog', () => {
    const out = build('m02b', 4, 20, 100)
    const w = out.acceptedWorkConservation
    expect(w.accepted - w.delivered).toBeLessThan(5)
    expect(out.perNode.q.peakQueueLength).toBeLessThan(3)
  })
})

// ───────────────────────── 2. Delivery: redelivery and dead letters ─────────────────────────

test.describe('M-03 redelivery follows P(processing > limit) (ch13 section 3)', () => {
  const MEAN_MS = 100
  const LIMIT_MS = 200
  const build = (seed: string, config: Record<string, unknown>, nodeTimeoutMs = LIMIT_MS) => {
    const q = queue('q', { workers: 200, serviceMs: 1, timeoutMs: nodeTimeoutMs, config })
    ;(q.processing as Record<string, unknown>).distribution = {
      type: 'exponential',
      lambda: 1 / MEAN_MS
    }
    return runEngine(
      chain({
        run: run(seed, { rps: 100, durationMs: 120_000 }),
        nodes: [q],
        edges: [edge('source', 'q')],
        requestDistribution: mix
      })
    )
  }

  test('at-least-once, limit 200 ms, exponential mean 100 ms: failed attempts are e^-2 = 13.5% of attempts', () => {
    const out = build('m03', {
      deliverySemantics: 'at-least-once',
      visibilityTimeoutMs: 10,
      maxReceiveCount: 5
    })
    const accepted = out.perNode.q.traitCounters.queueAccepted
    const redeliveries = out.perNode.q.traitCounters.queueRedeliveries
    const attempts = accepted + redeliveries
    const failures = out.summary.timedOutRequests
    const share = failures / attempts
    const p = redeliveryShare(MEAN_MS, LIMIT_MS)
    const se = Math.sqrt((p * (1 - p)) / attempts)
    expect(Math.abs(share - p)).toBeLessThan(4 * se)
  })

  test('at-most-once drops a failed attempt: nothing is redelivered', () => {
    const out = build('m03b', { deliverySemantics: 'at-most-once' })
    expect(out.perNode.q.traitCounters.queueRedeliveries).toBe(0)
    expect(out.summary.timedOutRequests).toBeGreaterThan(0)
  })

  // Finding 20 (fixed): the visibility timeout is the time a consumer has to finish. A message still being processed
  // when it expires reappears and is delivered again, so a visibility timeout shorter than the processing time
  // produces duplicates even though no attempt failed (SQS).
  test('a visibility timeout of 200 ms against exponential processing (mean 100 ms) redelivers 13.5% of messages', () => {
    const out = build(
      'm03c',
      {
        deliverySemantics: 'at-least-once',
        visibilityTimeoutMs: LIMIT_MS,
        maxReceiveCount: 5
      },
      // The consumer is given far longer than the visibility timeout to finish.
      5000
    )
    const q =
      (out.perNode.q.traitCounters.queueRedeliveries ?? 0) /
      out.perNode.q.traitCounters.queueAccepted
    // Each delivery outlives the timeout with p = e^-2 = 13.5%; a message is received at most 5 times, so the
    // expected redeliveries per message are p + p^2 + p^3 + p^4 = 0.156.
    const p = redeliveryShare(MEAN_MS, LIMIT_MS)
    expect(Math.abs(q - (p + p ** 2 + p ** 3 + p ** 4))).toBeLessThan(0.015)
  })
})

test.describe('M-04 a message is dead-lettered after maxReceiveCount failures (ch13 section 3)', () => {
  // Processing always takes 50 ms against a 10 ms limit: every attempt fails, so every message makes exactly
  // maxReceiveCount attempts and then goes to the dead-letter queue.
  const poison = runEngine(
    chain({
      run: run('m04', { rps: 10, durationMs: 30_000 }),
      nodes: [
        queue('q', {
          workers: 100,
          serviceMs: 50,
          timeoutMs: 10,
          config: {
            deliverySemantics: 'at-least-once',
            visibilityTimeoutMs: 10,
            maxReceiveCount: 3,
            dlqNodeId: 'dlq'
          }
        }),
        queue('dlq', { workers: 10, serviceMs: 1 })
      ],
      edges: [edge('source', 'q')],
      requestDistribution: mix
    })
  )
  const c = poison.perNode.q.traitCounters
  const accepted = c.queueAccepted

  test('each message is redelivered maxReceiveCount - 1 = 2 times, then moved to the dead-letter queue once', () => {
    // The last few messages are still in flight when the run ends.
    expect(accepted).toBe(300)
    expect(accepted - c.queueDlqMoves).toBeLessThan(5)
    expect(Math.abs(c.queueRedeliveries - 2 * c.queueDlqMoves)).toBeLessThanOrEqual(4)
  })

  test('the dead-letter queue receives what was moved', () => {
    expect(poison.perNode.dlq.totalArrived).toBeGreaterThanOrEqual(c.queueDlqMoves)
  })
})

// ───────────────────────── 3. Streams: partitions and consumer groups ─────────────────────────

test.describe('M-05 consumers beyond the partition count add no throughput (ch13 section 4)', () => {
  const PARTITIONS = 4
  const stream = (seed: string, consumers: number) => {
    const cs = Array.from({ length: consumers }, (_, i) =>
      queueNode(`c${i}`, 'worker', { category: 'compute', workers: 1, serviceMs: 20 })
    )
    const out = runEngine(
      chain({
        run: run(seed, { rps: 400, durationMs: 10_000 }),
        nodes: [
          queueNode('st', 'stream', {
            category: 'messaging-and-streaming',
            serviceMs: 0.1,
            config: {
              streamBrokerEnabled: true,
              partitionCount: PARTITIONS,
              partitionKeyField: 'pk'
            }
          }),
          ...cs
        ],
        edges: [edge('source', 'st'), ...cs.map((c) => edge('st', c.id as string))],
        requestDistribution: [
          { type: 'GET', weight: 1, sizeBytes: 100, keyspace: { field: 'pk', size: 1000, skew: 0 } }
        ]
      })
    )
    const processed = cs.map((c) => out.perNode[c.id as string].totalProcessed)
    return { out, processed, total: processed.reduce((a, b) => a + b, 0) }
  }

  test('throughput scales with consumers up to the partition count, then stops', () => {
    const totals = [1, 2, 4, 8].map((n) => stream(`m05-${n}`, n).total)
    // Each consumer: 1 worker at 20 ms = 50/s for 10 s = 500.
    expect(relErr(totals[0], 500)).toBeLessThan(0.03)
    expect(relErr(totals[1], 1000)).toBeLessThan(0.03)
    expect(relErr(totals[2], 2000)).toBeLessThan(0.03)
    expect(relErr(totals[3], totals[2])).toBeLessThan(0.02)
  })

  test('with 8 consumers and 4 partitions, 4 consumers get nothing', () => {
    const { processed } = stream('m05-idle', 8)
    expect(processed.filter((p) => p === 0).length).toBe(4)
  })

  test('the stream appends every produced message and splits keys evenly over partitions', () => {
    const { out } = stream('m05-split', 4)
    const parts = out.streamProjection[0].partitions
    const total = parts.reduce((a, p) => a + p.nextOffset, 0)
    expect(total).toBe(out.perNode.st.traitCounters.streamAppends)
    for (const p of parts)
      expect(Math.abs(p.nextOffset / total - 1 / PARTITIONS)).toBeLessThan(0.04)
  })
})

test.describe('M-06 every consumer group gets every message; members of a group share them (ch13 section 4)', () => {
  const build = (members: number) => {
    const group = (name: string, ids: string[]) =>
      ids.map((id) =>
        queueNode(id, 'worker', {
          category: 'compute',
          workers: 8,
          serviceMs: 1,
          config: { consumerGroup: name }
        })
      )
    const a = group(
      'A',
      Array.from({ length: members }, (_, i) => `a${i}`)
    )
    const b = group('B', ['b0'])
    const cs = [...a, ...b]
    const out = runEngine(
      chain({
        run: run('m06', { rps: 100, durationMs: 10_000 }),
        nodes: [
          queueNode('st', 'stream', {
            category: 'messaging-and-streaming',
            serviceMs: 0.1,
            config: { streamBrokerEnabled: true, partitionCount: 4, consumerGroupMode: true }
          }),
          ...cs
        ],
        edges: [edge('source', 'st'), ...cs.map((c) => edge('st', c.id as string))],
        requestDistribution: [
          {
            type: 'GET',
            weight: 1,
            sizeBytes: 100,
            keyspace: { field: 'partitionKey', size: 1000, skew: 0 }
          }
        ]
      })
    )
    return { out, a, b }
  }

  test('group B (one member) receives all 1,000; group A splits the same 1,000 between its two members', () => {
    const { out } = build(2)
    const arrived = (id: string) => out.perNode[id].totalArrived
    expect(arrived('b0')).toBe(1000)
    expect(arrived('a0') + arrived('a1')).toBe(1000)
    expect(arrived('a0')).toBeGreaterThan(0)
    expect(arrived('a1')).toBeGreaterThan(0)
  })

  test('committed offsets plus lag account for every appended record in every group', () => {
    const { out } = build(2)
    const proj = out.streamProjection[0]
    const appended = proj.partitions.reduce((a, p) => a + p.nextOffset, 0)
    for (const g of proj.groups) {
      const committed = Object.values(g.committedOffsets).reduce((a, b) => a + b, 0)
      const lag = Object.values(g.lag).reduce((a, b) => a + b, 0)
      expect(committed + lag, `group ${g.group}`).toBe(appended)
    }
  })
})

test.describe('M-07 events of one key stay in order when the consumer is told to keep order (ch13 section 5)', () => {
  const build = (consumerOrdering: string) => {
    const projector = queueNode('projector', 'microservice', {
      category: 'compute',
      workers: 64,
      capacity: 1000
    })
    ;(projector.processing as Record<string, unknown>).distribution = {
      type: 'exponential',
      lambda: 0.1
    }
    return runEngine(
      chain({
        run: run(`m07-${consumerOrdering}`, { rps: 200, durationMs: 20_000 }),
        nodes: [
          queueNode('cdc', 'stream', {
            category: 'messaging-and-streaming',
            serviceMs: 0.5,
            config: {
              streamBrokerEnabled: true,
              partitionCount: 4,
              partitionKeyField: 'orderId',
              changeStreamOrdering: true,
              consumerOrdering
            }
          }),
          projector
        ],
        edges: [edge('source', 'cdc'), edge('cdc', 'projector')],
        requestDistribution: [
          {
            type: 'UPDATE',
            weight: 1,
            sizeBytes: 256,
            keyspace: { field: 'orderId', size: 50, skew: 0 }
          }
        ]
      })
    )
  }

  test('parallel consumers with variable processing time reorder events of the same key', () => {
    expect(build('parallel').perNode.cdc.traitCounters.changeOrderViolations).toBeGreaterThan(0)
  })

  test('per-key ordering has no violations and pays for it by holding events back', () => {
    const out = build('per-key')
    expect(out.perNode.cdc.traitCounters.changeOrderViolations).toBe(0)
    expect(out.perNode.cdc.traitCounters.changeEventsWaitedForOrder).toBeGreaterThan(0)
  })

  test('per-partition ordering also keeps every key in order (a key lives in one partition)', () => {
    expect(build('per-partition').perNode.cdc.traitCounters.changeOrderViolations).toBe(0)
  })
})

// ───────────────────────── 4. Topics ─────────────────────────

test.describe('M-08 a topic delivers to every subscription (ch13 section 6)', () => {
  for (const subscribers of [1, 3, 5]) {
    test(`${subscribers} subscribers: delivered load = ${subscribers} x produced load`, () => {
      const subs = Array.from({ length: subscribers }, (_, i) =>
        queueNode(`s${i}`, 'worker', { category: 'compute', workers: 8, serviceMs: 1 })
      )
      const out = runEngine(
        chain({
          run: run(`m08-${subscribers}`),
          nodes: [
            queueNode('bus', 'pub-sub', { category: 'messaging-and-streaming', serviceMs: 0.1 }),
            ...subs
          ],
          edges: [edge('source', 'bus'), ...subs.map((s) => edge('bus', s.id as string))],
          requestDistribution: mix
        })
      )
      const produced = out.perNode.bus.totalArrived
      expect(produced).toBe(1000)
      for (const s of subs) expect(out.perNode[s.id as string].totalArrived).toBe(produced)
    })
  }
})

// ───────────────────────── 5. Event-sourcing replay ─────────────────────────

test.describe('M-09 replay time = events since the last snapshot x per-event cost (ch13 section 7)', () => {
  const COST = 0.1
  const store = (seed: string, snapshotEvery?: number) =>
    runEngine(
      chain({
        run: run(seed, { rps: 100, durationMs: 20_000 }),
        nodes: [
          queueNode('es', 'event-sourcing-store', {
            workers: 64,
            serviceMs: 1,
            config: { replayCostPerEventMs: COST, ...(snapshotEvery ? { snapshotEvery } : {}) }
          })
        ],
        edges: [edge('source', 'es')],
        requestDistribution: [
          { type: 'write', weight: 0.5, sizeBytes: 100 },
          { type: 'read', weight: 0.5, sizeBytes: 100 }
        ]
      })
    )
  const readLatencies = (out: ReturnType<typeof runEngine>) =>
    out.requestOutcomes
      .filter((o) => o.requestType === 'read' && o.status === 'success')
      .map((o) => o.latencyMs)

  test('without snapshots a read replays the whole log: cost grows as events accumulate', () => {
    const lat = readLatencies(store('m09a'))
    const early = mean(lat.slice(0, 100))
    const late = mean(lat.slice(-100))
    expect(late).toBeGreaterThan(5 * early)
    // 50 writes/s for 20 s = 1,000 events at the end: the last reads replay about that many.
    expect(relErr(late - 1, COST * 1000)).toBeLessThan(0.1)
  })

  test('with a snapshot every 50 events a read replays at most 49: latency is bounded', () => {
    const lat = readLatencies(store('m09b', 50))
    expect(Math.max(...lat)).toBeLessThanOrEqual(1 + COST * 49 + 0.5)
    // Events since the last snapshot cycle evenly through 0..49, so the mean replay is 24.5 events.
    expect(relErr(mean(lat) - 1, COST * 24.5)).toBeLessThan(0.1)
  })
})

// ───────────────────────── 6. The browser agrees ─────────────────────────

test.describe('M-10 the browser shows what the engine computed for failing consumers', () => {
  test('a queue whose consumers always time out shows the engine error rate', async ({ page }) => {
    const t = chain({
      run: run('m10', { rps: 10, durationMs: 30_000 }),
      nodes: [
        queue('q', {
          workers: 100,
          serviceMs: 50,
          timeoutMs: 10,
          config: { deliverySemantics: 'at-most-once' }
        })
      ],
      edges: [edge('source', 'q')],
      requestDistribution: mix
    })
    const out = runEngine(t)
    expect(out.summary.timedOutRequests).toBeGreaterThan(0)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'q')
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(1)
  })
})
