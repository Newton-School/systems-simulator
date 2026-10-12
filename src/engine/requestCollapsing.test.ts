import { describe, expect, it } from 'vitest'
import { SimulationEngine } from './engine'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'
import { validateTopology } from './validation/validator'

/**
 * Request collapsing (single-flight) on a cold cache with a hot key: the
 * thundering-herd case. A cold derived-LRU fills a key only when its backing
 * store fetch returns, so every miss for the hot key during that in-flight
 * window goes to the DB - unless collapsing parks them behind one leader.
 */

function edge(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 10_000,
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

interface Options {
  collapsing: boolean
  keyed?: boolean
  dbServiceMs?: number
  dbErrorRate?: number
  timeoutMs?: number
}

function collapsingTopology({
  collapsing,
  keyed = true,
  dbServiceMs = 50,
  dbErrorRate,
  timeoutMs = 2_000
}: Options): TopologyJSON {
  const nodes: ComponentNode[] = [
    {
      id: 'gw',
      type: 'api-gateway',
      category: 'network-and-edge',
      label: 'Gateway',
      position: { x: 0, y: 0 },
      queue: { workers: 256, capacity: 50_000, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 0.1 }, timeout: 5_000 }
    },
    {
      id: 'cache',
      type: 'in-memory-cache',
      category: 'storage-and-data',
      label: 'Redis',
      position: { x: 0, y: 0 },
      queue: { workers: 256, capacity: 50_000, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 0.2 }, timeout: 5_000 },
      config: {
        cacheModel: 'derived-lru',
        cacheRamMb: 10,
        valueSizeBytes: 1_000,
        cacheHitLatencyMs: 0.2,
        ...(collapsing ? { requestCollapsing: true } : {})
      }
    },
    {
      id: 'db',
      type: 'relational-db',
      category: 'storage-and-data',
      label: 'Primary DB',
      position: { x: 0, y: 0 },
      queue: { workers: 512, capacity: 50_000, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: dbServiceMs }, timeout: 10_000 },
      // storageReadMs drives the DB's read service time (storage.profile trait).
      config: {
        storageReadMs: dbServiceMs,
        ...(dbErrorRate !== undefined ? { nodeErrorRate: dbErrorRate } : {})
      }
    }
  ]
  return {
    id: 'celebrity-upload',
    name: 'Celebrity upload stampede',
    version: '1.0.0',
    global: {
      simulationDuration: 2_000,
      seed: 'collapse-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: timeoutMs
    },
    nodes,
    edges: [edge('gw', 'cache'), edge('cache', 'db')],
    workload: {
      sourceNodeId: 'gw',
      pattern: 'constant',
      baseRps: 5_000,
      requestDistribution: [
        {
          type: 'GET',
          weight: 1,
          sizeBytes: 256,
          ...(keyed ? { keyspace: { field: 'postId', size: 5, skew: 1.5 } } : {})
        }
      ]
    }
  }
}

function run(options: Options) {
  return new SimulationEngine(collapsingTopology(options)).run()
}

function hitRatio(output: ReturnType<typeof run>): number {
  const cache = output.perNode['cache']
  return cache.cacheHits / (cache.cacheHits + cache.cacheMisses)
}

describe('request collapsing (engine integration)', () => {
  it('cuts downstream DB calls for a cold hot key to about one per key, hit rate unchanged', () => {
    const off = run({ collapsing: false })
    const on = run({ collapsing: true })

    const dbOff = off.perNode['db'].totalArrived
    const dbOn = on.perNode['db'].totalArrived
    // Without collapsing every miss during the ~50ms cold fetch window hits the DB.
    expect(dbOff).toBeGreaterThan(100)
    // With collapsing: one leader per key (5 keys), followers wait at the cache.
    expect(dbOn).toBeLessThanOrEqual(5)
    expect(on.perNode['cache'].traitCounters['collapseLeaders']).toBe(dbOn)
    const collapsed = on.perNode['cache'].traitCounters['collapsedMisses']
    // Every miss is either a leader (goes to the DB) or a collapsed follower.
    expect(collapsed + dbOn).toBe(on.perNode['cache'].cacheMisses)
    expect(on.perNode['cache'].traitCounters['collapsedFollowersServed']).toBe(collapsed)

    // Collapsing removes duplicate miss traffic; it does not raise the hit rate.
    // (Misses still miss - they just wait. Tiny drift comes from event ordering.)
    expect(hitRatio(on)).toBeCloseTo(hitRatio(off), 2)
    expect(
      Math.abs(on.perNode['cache'].cacheMisses - off.perNode['cache'].cacheMisses)
    ).toBeLessThan(off.perNode['cache'].cacheMisses * 0.05)

    // Every request completes exactly once in both runs.
    expect(on.summary.totalRequests).toBe(off.summary.totalRequests)
    expect(on.summary.successfulRequests).toBe(on.summary.totalRequests)
  })

  it('follower latency includes its wait for the leader', () => {
    const on = run({ collapsing: true })
    const followers = on.requestOutcomes.filter(
      (row) => row.status === 'success' && row.cacheOutcome === 'miss' && row.nodeId === 'cache'
    )
    expect(followers.length).toBeGreaterThan(100)
    const latencies = followers.map((row) => row.latencyMs)
    // A hit costs well under 2ms; a follower waits for the rest of the 50ms fetch.
    expect(Math.max(...latencies)).toBeGreaterThan(40)
    expect(Math.max(...latencies)).toBeLessThan(60)
    const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    expect(mean).toBeGreaterThan(10)
  })

  it('a failed leader fails its followers with the same cause', () => {
    const on = run({ collapsing: true, dbErrorRate: 1 })
    const cache = on.perNode['cache']
    expect(on.perNode['db'].totalArrived).toBeGreaterThan(0)
    expect(cache.traitCounters['collapsedFollowersFailed']).toBeGreaterThan(0)
    expect(cache.traitCounters['collapsedFollowersServed'] ?? 0).toBe(0)
    // Followers fail at the cache with the leader's reason, not a new one.
    expect(cache.rejectionsByReason['node_error_rate']).toBe(
      cache.traitCounters['collapsedFollowersFailed']
    )
    expect(on.summary.successfulRequests).toBe(0)
  })

  it('a timed-out leader times out its followers as collapsed_leader_timeout', () => {
    // The DB takes 500ms but clients give up after 200ms: the leader times out.
    const on = run({ collapsing: true, dbServiceMs: 500, timeoutMs: 200 })
    const followerTimeouts = on.requestOutcomes.filter(
      (row) => row.status === 'timeout' && row.nodeId === 'cache'
    )
    // Nothing is ever cached (every fetch times out), so the herd keeps waiting
    // on slow leaders and fails with them - only ~one DB call per window though.
    expect(followerTimeouts.length).toBe(
      on.perNode['cache'].traitCounters['collapsedFollowersFailed']
    )
    expect(followerTimeouts.length).toBeGreaterThan(1_000)
    expect(on.perNode['db'].totalArrived).toBeLessThan(100)
    expect(
      followerTimeouts.every((row) =>
        row.stateTimeline?.some(
          (transition) =>
            transition.state === 'timed-out' && transition.reasonCode === 'collapsed_leader_timeout'
        )
      )
    ).toBe(true)
  })

  it('has no effect when requests carry no key', () => {
    const off = run({ collapsing: false, keyed: false })
    const on = run({ collapsing: true, keyed: false })
    expect(on.perNode['db'].totalArrived).toBe(off.perNode['db'].totalArrived)
    expect(on.perNode['cache'].traitCounters['collapsedMisses'] ?? 0).toBe(0)
    expect(on.perNode['cache'].traitCounters['collapseNoKey']).toBe(on.perNode['cache'].cacheMisses)
  })

  it('keeps requestCollapsing through validateTopology', () => {
    const result = validateTopology(collapsingTopology({ collapsing: true }))
    expect(result.valid).toBe(true)
    const cache = result.data?.nodes.find((node) => node.id === 'cache')
    expect(cache?.config?.['requestCollapsing']).toBe(true)
  })

  it('rejects a non-boolean requestCollapsing', () => {
    const topology = collapsingTopology({ collapsing: true })
    topology.nodes[1].config = { ...topology.nodes[1].config, requestCollapsing: 'yes' }
    const result = validateTopology(topology)
    expect(result.valid).toBe(false)
  })
})
