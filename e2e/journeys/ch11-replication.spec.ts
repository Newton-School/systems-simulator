/**
 * Chapter 11: replication, consistency and consensus (docs/reference/11-replication-consistency-consensus.md).
 * Expected values come from the chapter: a follower read is stale when a write to the same key committed less than
 * the replication lag ago, a strong read waits for the replica to catch up, a majority quorum survives a minority
 * failure and refuses writes without one, followers are read-only, a failover window is unavailability.
 * Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { quorumAvailability, relErr, staleReadProbability } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

type Model = 'eventual' | 'monotonic-reads' | 'read-your-writes' | 'strong'

const READ_MS = 1
const WRITE_MS = 1
const KEYS = 10
const RPS = 400
const WRITE_SHARE = 0.25
/** Writes per second to one key: 400 x 0.25 / 10. */
const PER_KEY_WRITES = (RPS * WRITE_SHARE) / KEYS

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: RPS,
    pattern: 'poisson',
    durationMs: 20_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (extra: Record<string, unknown> = {}) => ({ protocol: 'tcp', ...extra })

function datastore(id: string, role: 'leader' | 'follower', config: Record<string, unknown> = {}) {
  return queueNode(id, 'relational-db', {
    workers: 64,
    config: {
      storageReadMs: READ_MS,
      storageWriteMs: WRITE_MS,
      replicationEnabled: true,
      replicationRole: role,
      ...config
    }
  })
}

/** api sends writes to the leader and reads to the followers (alternating by chance), one session pool. */
function replicated(
  seed: string,
  opts: {
    lagMs: number
    model?: Model
    followers?: number
    leaderConfig?: Record<string, unknown>
    readsToLeader?: boolean
    over?: Partial<RunSpec>
  }
) {
  const followerIds = Array.from({ length: opts.followers ?? 1 }, (_, i) => `r${i + 1}`)
  const members = ['p', ...followerIds].join(',')
  const model = opts.model ? { consistencyModel: opts.model } : {}
  const readTargets = opts.readsToLeader ? ['p'] : followerIds
  const t = chain({
    run: run(seed, opts.over),
    nodes: [
      queueNode('api', 'microservice', { category: 'compute', workers: 64 }),
      datastore('p', 'leader', { ...model, replicaMembers: members, ...opts.leaderConfig }),
      ...followerIds.map((id) =>
        datastore(id, 'follower', {
          ...model,
          replicaMembers: members,
          replicationLagMs: opts.lagMs
        })
      )
    ],
    edges: [
      ['source', 'api', tcp()],
      ['api', 'p', tcp({ mode: 'conditional', condition: 'request.type === "write"' })],
      ...readTargets.map(
        (id) =>
          ['api', id, tcp({ mode: 'conditional', condition: 'request.type === "read"' })] as [
            string,
            string,
            Record<string, unknown>
          ]
      )
    ],
    requestDistribution: [
      {
        type: 'read',
        weight: 1 - WRITE_SHARE,
        sizeBytes: 256,
        keyspace: { field: 'itemId', size: KEYS }
      },
      {
        type: 'write',
        weight: WRITE_SHARE,
        sizeBytes: 256,
        keyspace: { field: 'itemId', size: KEYS }
      }
    ]
  })
  t.workload = { ...t.workload!, sessions: { count: 20 } } as typeof t.workload
  return t
}

const consistency = (out: ReturnType<typeof runEngine>) => out.consistency!

// ───────────────────────── 1. Staleness of follower reads ─────────────────────────

test.describe('R-01 an eventual follower read is stale when a write landed less than the lag ago (ch11 section 3)', () => {
  for (const lagMs of [20, 80, 200]) {
    test(`lag ${lagMs} ms, ${PER_KEY_WRITES} writes/s per key`, () => {
      const c = consistency(runEngine(replicated(`r01-${lagMs}`, { lagMs, model: 'eventual' })))
      const observed = c.staleReads / c.followerReads
      // The follower answers a read of ~1 ms of execution: the window in which a write is still invisible is lag - read time.
      const expected = staleReadProbability(PER_KEY_WRITES, lagMs, READ_MS)
      expect(Math.abs(observed - expected)).toBeLessThan(0.03)
    })
  }

  test('with no lag a follower is never stale', () => {
    const c = consistency(runEngine(replicated('r01-0', { lagMs: 0, model: 'eventual' })))
    expect(c.staleReads).toBe(0)
  })

  test('staleness never exceeds the replication lag', () => {
    const c = consistency(runEngine(replicated('r01-max', { lagMs: 80, model: 'eventual' })))
    expect(c.maxStalenessMs).toBeGreaterThan(0)
    expect(c.maxStalenessMs).toBeLessThanOrEqual(80 + 0.5)
  })

  test('reads served by the leader are never stale, whatever the model', () => {
    const c = consistency(
      runEngine(replicated('r01-leader', { lagMs: 80, model: 'eventual', readsToLeader: true }))
    )
    expect(c.leaderReads).toBeGreaterThan(1000)
    expect(c.staleReads).toBe(0)
  })

  test('a longer lag means more stale reads', () => {
    const stale = (lagMs: number) => {
      const c = consistency(runEngine(replicated(`r01-m${lagMs}`, { lagMs, model: 'eventual' })))
      return c.staleReads / c.followerReads
    }
    expect(stale(20)).toBeLessThan(stale(80))
    expect(stale(80)).toBeLessThan(stale(200))
  })
})

// ───────────────────────── 2. Consistency models ─────────────────────────

test.describe('R-02 a stronger model trades read latency for freshness (ch11 section 3)', () => {
  const L = 80
  const eventual = runEngine(replicated('r02-e', { lagMs: L, model: 'eventual' }))
  const strong = runEngine(replicated('r02-s', { lagMs: L, model: 'strong' }))

  test('strong: no stale reads, no linearizability violations', () => {
    expect(consistency(strong).staleReads).toBe(0)
    expect(consistency(strong).linearizability.keysViolating).toBe(0)
    expect(consistency(strong).linearizability.keysChecked).toBeGreaterThan(0)
  })

  test('eventual: stale reads and a history that is not linearizable', () => {
    expect(consistency(eventual).staleReads).toBeGreaterThan(0)
    expect(consistency(eventual).linearizability.keysViolating).toBeGreaterThan(0)
  })

  test('the strong read waits the expected L - (1 - e^(-wL)) / w for the replica to catch up', () => {
    const w = PER_KEY_WRITES / 1000
    const expectedWaitMs = L - (1 - Math.exp(-w * L)) / w
    const c = consistency(strong)
    const meanWait = c.catchUpWaitMs / c.followerReads
    expect(relErr(meanWait, expectedWaitMs)).toBeLessThan(0.12)
  })

  test('so the mean strong read costs about that much more than the mean eventual read', () => {
    const w = PER_KEY_WRITES / 1000
    const expectedWaitMs = L - (1 - Math.exp(-w * L)) / w
    const mean = (out: ReturnType<typeof runEngine>) => {
      const reads = out.requestOutcomes.filter(
        (o) => o.requestType === 'read' && o.status === 'success'
      )
      return reads.reduce((a, o) => a + o.latencyMs, 0) / reads.length
    }
    expect(Math.abs(mean(strong) - mean(eventual) - expectedWaitMs)).toBeLessThan(
      0.15 * expectedWaitMs
    )
  })

  test('read-your-writes removes the session violations that eventual allows', () => {
    const ryw = runEngine(replicated('r02-ryw', { lagMs: L, model: 'read-your-writes' }))
    expect(consistency(eventual).readYourWritesViolations).toBeGreaterThan(0)
    expect(consistency(ryw).readYourWritesViolations).toBe(0)
    // It is weaker than strong: other sessions' writes can still be invisible.
    expect(consistency(ryw).staleReads).toBeGreaterThan(0)
  })
})

// ───────────────────────── 3. Writes, followers and quorum ─────────────────────────

test.describe('R-03 followers are read-only (ch11 section 1)', () => {
  test('a write sent to a follower is refused', () => {
    const t = chain({
      run: run('r03', { rps: 100, pattern: 'constant', durationMs: 5000 }),
      nodes: [datastore('r1', 'follower', { replicationLagMs: 10 })],
      edges: [['source', 'r1', tcp()]],
      requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 100 }]
    })
    const out = runEngine(t)
    expect(out.summary.successfulRequests).toBe(0)
    expect(out.requestOutcomes[0].reasonCode).toBe('read_only_node')
  })
})

test.describe('R-04 a majority quorum survives a minority failure and refuses writes without one (ch11 section 5)', () => {
  const FAIL_AT = 5000
  const down = (id: string) => ({
    targetId: id,
    faultType: 'node-failure',
    timing: 'deterministic',
    duration: 'permanent',
    params: { atMs: FAIL_AT, mode: 'reject' }
  })
  const cluster = (seed: string, policy: 'primary' | 'quorum', failed: string[]) => {
    const members = 'p,r1,r2'
    return runEngine(
      chain({
        run: run(seed, { rps: 100, pattern: 'constant', durationMs: 20_000 }),
        nodes: [
          datastore('p', 'leader', { writeAckPolicy: policy, replicaMembers: members }),
          datastore('r1', 'follower', { replicaMembers: members }),
          datastore('r2', 'follower', { replicaMembers: members })
        ],
        edges: [['source', 'p', tcp()]],
        faults: failed.map(down),
        requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 100 }]
      })
    )
  }
  const lateSuccess = (out: ReturnType<typeof runEngine>) => {
    const late = out.requestOutcomes.filter(
      (o) => o.createdAtMs >= FAIL_AT + 1000 && o.createdAtMs < 19_000
    )
    return late.filter((o) => o.status === 'success').length / late.length
  }

  test('3 members, quorum writes, 1 down: 2 of 3 is a majority, writes continue', () => {
    expect(lateSuccess(cluster('r04a', 'quorum', ['r1']))).toBe(1)
  })

  test('3 members, quorum writes, 2 down: no majority, every write is refused', () => {
    const out = cluster('r04b', 'quorum', ['r1', 'r2'])
    expect(lateSuccess(out)).toBe(0)
    expect(out.requestOutcomes.some((o) => o.reasonCode === 'quorum_unavailable')).toBe(true)
  })

  test('the same two failures leave leader-only acknowledgement writing (asynchronous replication)', () => {
    expect(lateSuccess(cluster('r04c', 'primary', ['r1', 'r2']))).toBe(1)
  })

  test('the availability the chapter derives: 3 of 5 at p 0.99 is 0.99999015, 3 nodes 0.999702', () => {
    expect(quorumAvailability(3, 2, 0.99)).toBeCloseTo(0.999702, 6)
    expect(quorumAvailability(5, 3, 0.99)).toBeCloseTo(0.99999015, 8)
  })
})

test.describe('R-05 a failover window is unavailability of rps x window requests (ch11 section 6)', () => {
  test('a 2 s promotion at 100 rps loses 200 requests, all with the failover reason', () => {
    const out = runEngine(
      chain({
        run: run('r05', { rps: 100, pattern: 'constant', durationMs: 10_000 }),
        nodes: [datastore('p', 'leader', { failoverUntilMs: 2000 })],
        edges: [['source', 'p', tcp()]],
        requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 100 }]
      })
    )
    const failed = out.requestOutcomes.filter((o) => o.status !== 'success' && o.reasonCode)
    expect(failed.length).toBe(200)
    expect(failed.every((o) => o.reasonCode === 'replica_failover_in_progress')).toBe(true)
    expect(Math.max(...failed.map((o) => o.createdAtMs))).toBeLessThan(2000)
  })
})

// ───────────────────────── 4. Tracked gaps ─────────────────────────

test.describe('R-06 a quorum write waits for the replicas (ch11 sections 3 and 5)', () => {
  // Tracked gap (finding 18): on a relational or NoSQL store the storage profile sets the write time after
  // replication does, so a quorum acknowledgement adds no latency whatever the lag.
  test.fail('with a 40 ms replication lag a quorum write takes at least 40 ms', () => {
    const out = runEngine(
      chain({
        run: run('r06', { rps: 50, pattern: 'constant', durationMs: 5000 }),
        nodes: [
          datastore('p', 'leader', {
            writeAckPolicy: 'quorum',
            replicationLagMs: 40,
            replicaMembers: 'p,r1,r2'
          })
        ],
        edges: [['source', 'p', tcp()]],
        requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 100 }]
      })
    )
    expect(out.summary.latency.mean).toBeGreaterThanOrEqual(40)
  })
})

test.describe('R-07 R + W <= N can read stale data even with a quorum write (ch11 section 5)', () => {
  // Tracked gap (finding 19): a quorum acknowledgement makes every follower current at commit, which is W = N.
  // With 3 replicas, W = 2 and reads from one replica (R = 1), R + W = 3 is not greater than N: the replica that did
  // not acknowledge can still be behind.
  test.fail('3 replicas, quorum write, read from one replica: some reads are stale', () => {
    const t = replicated('r07', {
      lagMs: 80,
      model: 'eventual',
      followers: 2,
      leaderConfig: { writeAckPolicy: 'quorum', replicationLagMs: 80 }
    })
    expect(consistency(runEngine(t)).staleReads).toBeGreaterThan(0)
  })

  test('with leader-only acknowledgement the same cluster is stale (R + W = 2 <= 3)', () => {
    const t = replicated('r07b', { lagMs: 80, model: 'eventual', followers: 2 })
    expect(consistency(runEngine(t)).staleReads).toBeGreaterThan(0)
  })
})

// ───────────────────────── 5. The browser agrees ─────────────────────────

test.describe('R-08 the browser shows the failover outage the engine computed', () => {
  test('a 2 s failover window at 100 rps shows an error rate of 20% over 10 s', async ({
    page
  }) => {
    const t = chain({
      run: run('r08', { rps: 100, pattern: 'constant', durationMs: 10_000 }),
      nodes: [datastore('srv', 'leader', { failoverUntilMs: 2000 })],
      edges: [['source', 'srv', tcp()]],
      requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 100 }]
    })
    const out = runEngine(t)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'srv')
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(1)
    expect(Math.abs(ui.errorRatePct - 20)).toBeLessThan(1.5)
  })
})
