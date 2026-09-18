import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON, WorkloadProfile } from '../core/types'
import {
  DEFAULT_TARGET_UTILIZATION,
  distributionMean,
  estimateDiscreteEventCount,
  evaluateFluidModel,
  nodeCapacityRps,
  peakOfferedRps,
  shouldUseFluidModel
} from './fluidModel'

// ---------------------------------------------------------------------------
// Topology builders — a QuickCart flash-sale shape: Users → LB → N servers.
// ---------------------------------------------------------------------------

function serverNode(id: string, capacityRps: number, instanceCount = 1): ComponentNode {
  return {
    id,
    type: 'service',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    resources: { instanceCount },
    config: { capacityRps, capacityAuthored: true }
  }
}

function loadBalancer(id: string): ComponentNode {
  return {
    id,
    type: 'load-balancer',
    category: 'network',
    label: 'Load Balancer',
    position: { x: 0, y: 0 }
  }
}

function usersNode(id: string): ComponentNode {
  return {
    id,
    type: 'client',
    category: 'client',
    label: 'Users',
    position: { x: 0, y: 0 }
  }
}

function edge(source: string, target: string, weight?: number): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 1_000_000,
    packetLossRate: 0,
    errorRate: 0,
    weight
  }
}

/** Users → LB → `serverCount` identical servers, each at `perServerRps`. */
function flashSaleTopology(opts: {
  offeredRps: number
  serverCount: number
  perServerRps: number
  durationMs?: number
}): TopologyJSON {
  const servers = Array.from({ length: opts.serverCount }, (_, i) =>
    serverNode(`srv-${i}`, opts.perServerRps)
  )
  const workload: WorkloadProfile = {
    sourceNodeId: 'users',
    pattern: 'constant',
    baseRps: opts.offeredRps,
    requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
  }
  return {
    id: 'flash-sale',
    name: 'QuickCart Flash Sale',
    version: '1',
    global: {
      simulationDuration: opts.durationMs ?? 5000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30000
    },
    nodes: [usersNode('users'), loadBalancer('lb'), ...servers],
    edges: [edge('users', 'lb'), ...servers.map((s) => edge('lb', s.id))],
    workload
  }
}

// ---------------------------------------------------------------------------
// distributionMean
// ---------------------------------------------------------------------------

describe('distributionMean', () => {
  it('reads constant/normal/uniform/exponential means', () => {
    expect(distributionMean({ type: 'constant', value: 10 })).toBe(10)
    expect(distributionMean({ type: 'normal', mean: 7, stdDev: 2 })).toBe(7)
    expect(distributionMean({ type: 'uniform', min: 2, max: 8 })).toBe(5)
    expect(distributionMean({ type: 'exponential', lambda: 0.5 })).toBe(2)
  })

  it('weights a mixture by component means', () => {
    const mean = distributionMean({
      type: 'mixture',
      components: [
        { weight: 0.5, distribution: { type: 'constant', value: 10 } },
        { weight: 0.5, distribution: { type: 'constant', value: 30 } }
      ]
    })
    expect(mean).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// nodeCapacityRps
// ---------------------------------------------------------------------------

describe('nodeCapacityRps', () => {
  it('prefers an explicit authored capacityRps', () => {
    expect(nodeCapacityRps(serverNode('s', 100_000))).toBe(100_000)
  })

  it('derives capacity from concurrency / service time when not authored', () => {
    // 4 workers, 2ms service → 4 / 0.002 = 2000 rps.
    const node: ComponentNode = {
      id: 's',
      type: 'service',
      category: 'compute',
      label: 's',
      position: { x: 0, y: 0 },
      queue: { workers: 4, capacity: 4, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 2 }, timeout: 1000 }
    }
    expect(nodeCapacityRps(node)).toBeCloseTo(2000, 5)
  })

  it('treats a load balancer as infinite-capacity passthrough', () => {
    expect(nodeCapacityRps(loadBalancer('lb'))).toBe(Number.POSITIVE_INFINITY)
  })

  it('ignores capacityRps that is not author-flagged (anti-gaming gate)', () => {
    // A student-set capacityRps with no capacityAuthored flag must NOT be honored;
    // capacity falls back to the derived value (here: no service model → passthrough).
    const node: ComponentNode = {
      id: 's',
      type: 'service',
      category: 'compute',
      label: 's',
      position: { x: 0, y: 0 },
      config: { capacityRps: 999_999_999 } // no capacityAuthored
    }
    expect(nodeCapacityRps(node)).not.toBe(999_999_999)

    // With the author flag, the same value IS honored.
    const authored: ComponentNode = {
      ...node,
      config: { capacityRps: 999_999_999, capacityAuthored: true }
    }
    expect(nodeCapacityRps(authored)).toBe(999_999_999)
  })
})

// ---------------------------------------------------------------------------
// peakOfferedRps
// ---------------------------------------------------------------------------

describe('peakOfferedRps', () => {
  it('uses baseRps for a constant workload', () => {
    expect(
      peakOfferedRps({
        sourceNodeId: 'u',
        pattern: 'constant',
        baseRps: 1_000_000,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1 }]
      })
    ).toBe(1_000_000)
  })

  it('uses the spike rate for a spike workload', () => {
    expect(
      peakOfferedRps({
        sourceNodeId: 'u',
        pattern: 'spike',
        baseRps: 1000,
        spike: { spikeTime: 0, spikeRps: 500_000, spikeDuration: 1000 },
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1 }]
      })
    ).toBe(500_000)
  })
})

// ---------------------------------------------------------------------------
// evaluateFluidModel — the flash-sale arithmetic
// ---------------------------------------------------------------------------

describe('evaluateFluidModel — flash sale', () => {
  it('needs 13 servers for 1M rps at 100k/server with 80% headroom', () => {
    // 12 servers: 1M / (12 · 100k) = 0.8333 → over the 80% budget.
    const twelve = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 12, perServerRps: 100_000 })
    )
    expect(twelve.headroom.maxUtilization).toBeCloseTo(0.8333, 3)
    expect(twelve.headroom.tier).toBe('no-headroom')
    expect(twelve.headroom.score).toBeLessThan(1)
    expect(twelve.droppedRps).toBe(0) // still under 100% capacity → nothing dropped

    // 13 servers: 1M / (13 · 100k) = 0.7692 → within the 80% budget.
    const thirteen = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 13, perServerRps: 100_000 })
    )
    expect(thirteen.headroom.maxUtilization).toBeCloseTo(0.7692, 3)
    expect(thirteen.headroom.tier).toBe('pass')
    expect(thirteen.headroom.score).toBe(1)
    expect(thirteen.droppedRps).toBe(0)
  })

  it('drops the overflow and fails when under-provisioned', () => {
    // 8 servers: capacity 800k < 1M offered → 200k dropped, utilization 1.25.
    const evaln = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 8, perServerRps: 100_000 })
    )
    expect(evaln.headroom.maxUtilization).toBeCloseTo(1.25, 3)
    expect(evaln.headroom.tier).toBe('fail')
    expect(evaln.headroom.score).toBe(0)
    expect(evaln.droppedRps).toBeCloseTo(200_000, 0)
    expect(evaln.dropRate).toBeCloseTo(0.2, 3)
  })

  it('splits load evenly across servers behind the LB', () => {
    const result = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 13, perServerRps: 100_000 })
    )
    const perServer = result.perNode['srv-0']!
    expect(perServer.offeredRps).toBeCloseTo(1_000_000 / 13, 0)
    // Every server sees the same share.
    for (let i = 0; i < 13; i++) {
      expect(result.perNode[`srv-${i}`]!.offeredRps).toBeCloseTo(1_000_000 / 13, 0)
    }
  })

  it('conserves flow: served + dropped == offered', () => {
    const result = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 8, perServerRps: 100_000 })
    )
    expect(result.servedRps + result.droppedRps).toBeCloseTo(result.offeredRps, 0)
  })

  it('is deterministic across runs', () => {
    const topo = flashSaleTopology({
      offeredRps: 1_000_000,
      serverCount: 13,
      perServerRps: 100_000
    })
    expect(evaluateFluidModel(topo)).toEqual(evaluateFluidModel(topo))
  })

  it('honours a custom headroom target', () => {
    const result = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 13, perServerRps: 100_000 }),
      { targetUtilization: 0.7 }
    )
    // 0.7692 > 0.7 target → no longer full marks.
    expect(result.headroom.tier).toBe('no-headroom')
  })

  it('defaults the headroom target to 80%', () => {
    const result = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 800_000, serverCount: 10, perServerRps: 100_000 })
    )
    expect(result.headroom.targetUtilization).toBe(DEFAULT_TARGET_UTILIZATION)
    expect(result.headroom.maxUtilization).toBeCloseTo(0.8, 5)
    expect(result.headroom.tier).toBe('pass') // exactly at target still passes
  })

  it('weighted edges skew the split', () => {
    const topo = flashSaleTopology({
      offeredRps: 100_000,
      serverCount: 2,
      perServerRps: 100_000
    })
    // Send 3:1 to srv-0.
    topo.edges = [edge('users', 'lb'), edge('lb', 'srv-0', 3), edge('lb', 'srv-1', 1)]
    const result = evaluateFluidModel(topo)
    expect(result.perNode['srv-0']!.offeredRps).toBeCloseTo(75_000, 0)
    expect(result.perNode['srv-1']!.offeredRps).toBeCloseTo(25_000, 0)
  })
})

// ---------------------------------------------------------------------------
// Latency (M/M/c) integration.
// ---------------------------------------------------------------------------

describe('per-node latency', () => {
  it('reports finite queueing latency for a server within headroom', () => {
    const result = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 13, perServerRps: 100_000 })
    )
    const l = result.perNode['srv-0']!.latency!
    expect(l).not.toBeNull()
    expect(l.waitProbability).toBeGreaterThanOrEqual(0)
    expect(l.meanResponseMs).toBeGreaterThan(0)
    expect(Number.isFinite(l.meanResponseMs)).toBe(true)
    expect(l.p99Ms).toBeGreaterThanOrEqual(l.p50Ms)
  })

  it('reports infinite latency for an overloaded server', () => {
    const result = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 8, perServerRps: 100_000 })
    )
    const l = result.perNode['srv-0']!.latency!
    expect(l.meanResponseMs).toBe(Number.POSITIVE_INFINITY)
    expect(l.waitProbability).toBe(1)
  })

  it('leaves latency null for a passthrough load balancer', () => {
    const result = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 13, perServerRps: 100_000 })
    )
    expect(result.perNode['lb']!.latency).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Scale-invariance: utilization is identical at true and scaled-down rates.
// ---------------------------------------------------------------------------

describe('scale invariance', () => {
  it('utilization at 1M rps equals utilization at a 1000x-scaled 1k rps', () => {
    const big = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000_000, serverCount: 13, perServerRps: 100_000 })
    )
    const small = evaluateFluidModel(
      flashSaleTopology({ offeredRps: 1_000, serverCount: 13, perServerRps: 100 })
    )
    expect(small.headroom.maxUtilization).toBeCloseTo(big.headroom.maxUtilization, 6)
    expect(small.headroom.tier).toBe(big.headroom.tier)
  })
})

// ---------------------------------------------------------------------------
// Auto-routing between discrete-event and fluid paths.
// ---------------------------------------------------------------------------

describe('auto-routing', () => {
  it('estimates event count as rps × seconds × hops', () => {
    const topo = flashSaleTopology({
      offeredRps: 1_000_000,
      serverCount: 13,
      perServerRps: 100_000,
      durationMs: 5000
    })
    // 1M × 5s × 15 nodes = 75,000,000.
    expect(estimateDiscreteEventCount(topo)).toBe(1_000_000 * 5 * 15)
  })

  it('routes heavy load to the fluid model and light load to the simulator', () => {
    const heavy = flashSaleTopology({
      offeredRps: 1_000_000,
      serverCount: 13,
      perServerRps: 100_000
    })
    const light = flashSaleTopology({
      offeredRps: 100,
      serverCount: 2,
      perServerRps: 100_000
    })
    expect(shouldUseFluidModel(heavy)).toBe(true)
    expect(shouldUseFluidModel(light)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Edge cases.
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('drops everything when there are no servers behind the LB', () => {
    const topo = flashSaleTopology({
      offeredRps: 1_000_000,
      serverCount: 0,
      perServerRps: 100_000
    })
    const result = evaluateFluidModel(topo)
    // LB is a sink now (no downstream); it forwards nothing useful. No capacity-
    // bound node exists, so there is no bottleneck utilization to report.
    expect(result.headroom.bottleneckNodeId).toBeNull()
    expect(result.perNode['lb']!.servedRps).toBe(1_000_000)
  })

  it('applies edge error/loss to the flow', () => {
    const topo = flashSaleTopology({
      offeredRps: 100_000,
      serverCount: 1,
      perServerRps: 100_000
    })
    topo.edges = [edge('users', 'lb'), { ...edge('lb', 'srv-0'), errorRate: 0.5 }]
    const result = evaluateFluidModel(topo)
    // Half the flow lost on the edge → server sees 50k.
    expect(result.perNode['srv-0']!.offeredRps).toBeCloseTo(50_000, 0)
  })
})
