import { describe, expect, it } from 'vitest'
import { SimulationEngine } from './engine'
import { projectToVerdict } from './analysis/verdict'
import type { SimulationOutput } from './analysis/output'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'

const REPLICA_LAG_MS = 80

function edge(source: string, target: string, condition?: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: condition ? 'conditional' : 'synchronous',
    ...(condition ? { condition } : {}),
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 10_000,
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function api(routingStrategy?: string): ComponentNode {
  return {
    id: 'api',
    type: 'microservice',
    category: 'compute',
    label: 'API',
    position: { x: 0, y: 0 },
    queue: { workers: 256, capacity: 10_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 5_000 },
    ...(routingStrategy ? { config: { routingStrategy } } : {})
  }
}

function datastore(
  id: string,
  role: 'leader' | 'follower',
  model: string | undefined,
  extra: Record<string, unknown> = {}
): ComponentNode {
  return {
    id,
    type: 'relational-db',
    category: 'storage-and-data',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 64, capacity: 10_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 2 }, timeout: 5_000 },
    config: {
      replicationEnabled: true,
      replicationRole: role,
      ...(role === 'follower' ? { replicationLagMs: REPLICA_LAG_MS } : {}),
      ...(model ? { consistencyModel: model } : {}),
      ...extra
    }
  }
}

interface TopologyOptions {
  model?: string
  readsToLeader?: boolean
  sessions?: number
  invariants?: TopologyJSON['invariants']
}

/** API routes writes to the leader and reads to one follower (or the leader). */
function primaryReplicaTopology(options: TopologyOptions = {}): TopologyJSON {
  const readTarget = options.readsToLeader ? 'primary' : 'replica'
  const nodes = [
    api(),
    datastore('primary', 'leader', options.model),
    ...(options.readsToLeader ? [] : [datastore('replica', 'follower', options.model)])
  ]
  const edges = options.readsToLeader
    ? [edge('api', 'primary')]
    : [
        edge('api', 'primary', 'request.type === "write"'),
        edge('api', readTarget, 'request.type === "read"')
      ]
  return {
    id: 'consistency',
    name: 'Consistency',
    version: '1.0.0',
    global: {
      simulationDuration: 10_000,
      seed: 'consistency-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 5_000
    },
    nodes,
    edges,
    ...(options.invariants ? { invariants: options.invariants } : {}),
    workload: {
      sourceNodeId: 'api',
      pattern: 'poisson',
      baseRps: 400,
      ...(options.sessions === 0 ? {} : { sessions: { count: options.sessions ?? 20 } }),
      requestDistribution: [
        { type: 'read', weight: 0.75, sizeBytes: 256, keyspace: { field: 'itemId', size: 10 } },
        { type: 'write', weight: 0.25, sizeBytes: 256, keyspace: { field: 'itemId', size: 10 } }
      ]
    }
  }
}

function run(topology: TopologyJSON): SimulationOutput {
  return new SimulationEngine(topology).run()
}

function meanReadLatencyMs(output: SimulationOutput): number {
  const reads = output.requestOutcomes.filter(
    (outcome) => outcome.requestType === 'read' && outcome.status === 'success'
  )
  return reads.reduce((sum, outcome) => sum + outcome.latencyMs, 0) / reads.length
}

describe('consistency model (engine integration)', () => {
  it('is off by default: no consistency report, no consistency verdict section', () => {
    const output = run(primaryReplicaTopology())
    expect(output.consistency).toBeUndefined()
    expect(projectToVerdict(output).consistency).toBeUndefined()
  })

  it('eventual replica reads are stale but fast; strong removes stale reads at a measured latency cost', () => {
    const eventual = run(primaryReplicaTopology({ model: 'eventual' }))
    const strong = run(primaryReplicaTopology({ model: 'strong' }))
    const e = eventual.consistency!
    const s = strong.consistency!

    expect(e.writes).toBeGreaterThan(500)
    expect(e.followerReads).toBeGreaterThan(1_500)
    // Eventual: reads served inside the replica-lag window miss the newest version.
    expect(e.staleReads).toBeGreaterThan(100)
    expect(e.maxStalenessMs).toBeGreaterThan(0)
    expect(e.maxStalenessMs).toBeLessThanOrEqual(REPLICA_LAG_MS + 1)
    expect(e.catchUpWaits).toBe(0)
    // ...and the history fails the register linearizability check.
    expect(e.linearizability.keysViolating).toBeGreaterThan(0)
    expect(e.linearizability.verified).toBe(false)

    // Strong: every follower read waits for the newest committed version.
    expect(s.staleReads).toBe(0)
    expect(s.catchUpWaits).toBeGreaterThan(100)
    expect(s.catchUpWaitMs).toBeGreaterThan(0)
    expect(s.linearizability.keysViolating).toBe(0)
    expect(s.linearizability.keysChecked).toBeGreaterThan(0)

    // The latency cost is measured from real waits, not declared.
    const eventualMs = meanReadLatencyMs(eventual)
    const strongMs = meanReadLatencyMs(strong)
    expect(strongMs).toBeGreaterThan(eventualMs + 5)
    // The mean extra latency matches the measured catch-up wait per read.
    expect(strongMs - eventualMs).toBeCloseTo(s.catchUpWaitMs / s.followerReads, 0)
  })

  it('read-your-writes removes RYW violations at a measured latency cost', () => {
    const eventual = run(primaryReplicaTopology({ model: 'eventual', sessions: 5 }))
    const ryw = run(primaryReplicaTopology({ model: 'read-your-writes', sessions: 5 }))
    const e = eventual.consistency!
    const r = ryw.consistency!

    expect(e.readYourWritesViolations).toBeGreaterThan(20)
    expect(r.readYourWritesViolations).toBe(0)
    expect(r.catchUpWaits).toBeGreaterThan(0)
    // RYW waits only for the session's own writes, so it waits less than strong would
    // and may still return data that is stale relative to other sessions' writes.
    expect(r.staleReads).toBeGreaterThan(0)
    expect(meanReadLatencyMs(ryw)).toBeGreaterThan(meanReadLatencyMs(eventual))
  })

  it('monotonic reads stops a session going back in time across replicas with different lag', () => {
    const topology = (model: string): TopologyJSON => {
      const base = primaryReplicaTopology({ model, sessions: 5 })
      const fast = datastore('replica-fast', 'follower', model, { replicationLagMs: 5 })
      const slow = datastore('replica-slow', 'follower', model, { replicationLagMs: 150 })
      const lb: ComponentNode = {
        id: 'read-lb',
        type: 'load-balancer',
        category: 'network-and-edge',
        label: 'Read LB',
        position: { x: 0, y: 0 },
        queue: { workers: 256, capacity: 10_000, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 0.1 }, timeout: 5_000 },
        config: { routingStrategy: 'round-robin' }
      }
      return {
        ...base,
        nodes: [api(), datastore('primary', 'leader', model), lb, fast, slow],
        edges: [
          edge('api', 'primary', 'request.type === "write"'),
          edge('api', 'read-lb', 'request.type === "read"'),
          edge('read-lb', 'replica-fast'),
          edge('read-lb', 'replica-slow')
        ]
      }
    }
    const eventual = run(topology('eventual')).consistency!
    const monotonic = run(topology('monotonic-reads')).consistency!
    expect(eventual.monotonicReadViolations).toBeGreaterThan(20)
    expect(monotonic.monotonicReadViolations).toBe(0)
    expect(monotonic.catchUpWaits).toBeGreaterThan(0)
  })

  it('reads served by the leader are never stale', () => {
    const output = run(primaryReplicaTopology({ model: 'eventual', readsToLeader: true }))
    const report = output.consistency!
    expect(report.leaderReads).toBeGreaterThan(1_000)
    expect(report.staleReads).toBe(0)
    expect(report.readYourWritesViolations).toBe(0)
    expect(report.linearizability.keysViolating).toBe(0)
  })

  it('reports reads without a session instead of passing session checks vacuously', () => {
    const report = run(
      primaryReplicaTopology({ model: 'read-your-writes', sessions: 0 })
    ).consistency!
    expect(report.sessionlessReads).toBe(report.reads)
    expect(report.readYourWritesViolations).toBe(0)
    expect(report.catchUpWaits).toBe(0)
  })

  it('reports operations beyond the per-key bound as not checked, never as verified', () => {
    const report = run(primaryReplicaTopology({ model: 'strong' })).consistency!
    // 10 keys x ~400 ops each far exceeds the 100-op per-key bound.
    expect(report.linearizability.opsNotChecked).toBeGreaterThan(0)
    expect(report.linearizability.verified).toBe(false)
    expect(
      projectToVerdict(run(primaryReplicaTopology({ model: 'strong' }))).consistency
    ).toMatchObject({ staleReads: 0, linearizableVerified: 0 })
  })

  it('a question can require consistency.staleReads == 0 as an invariant', () => {
    const invariants = [
      { id: 'no-stale', description: 'No stale reads', condition: 'consistency.staleReads == 0' }
    ]
    const eventual = run(primaryReplicaTopology({ model: 'eventual', invariants }))
    const strong = run(primaryReplicaTopology({ model: 'strong', invariants }))
    expect(eventual.invariantViolations.map((violation) => violation.invariantId)).toEqual([
      'no-stale'
    ])
    expect(strong.invariantViolations).toEqual([])
    // Untracked design: the metric does not resolve, so the invariant fails loudly.
    const untracked = run(primaryReplicaTopology({ invariants }))
    expect(untracked.invariantViolations[0]?.details).toMatch(/could not be resolved/)
  })
})
