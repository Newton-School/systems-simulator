import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import { runFluidSimulation } from './fluidSimulation'
import { resolveEvaluationMode, runSimulation } from '../runSimulation'

function server(id: string, capacityRps: number): ComponentNode {
  return {
    id,
    type: 'service',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    config: { capacityRps }
  }
}

function edge(source: string, target: string): EdgeDefinition {
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
    errorRate: 0
  }
}

function quickCart(serverCount: number): TopologyJSON {
  const servers = Array.from({ length: serverCount }, (_, i) => server(`srv-${i}`, 100_000))
  return {
    id: 'quickcart',
    name: 'QuickCart Flash Sale',
    version: '1',
    global: {
      simulationDuration: 5000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30000
    },
    nodes: [
      { id: 'users', type: 'client', category: 'client', label: 'Users', position: { x: 0, y: 0 } },
      {
        id: 'lb',
        type: 'load-balancer',
        category: 'network',
        label: 'Load Balancer',
        position: { x: 0, y: 0 }
      },
      ...servers
    ],
    edges: [edge('users', 'lb'), ...servers.map((s) => edge('lb', s.id))],
    workload: {
      sourceNodeId: 'users',
      pattern: 'constant',
      baseRps: 1_000_000,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    },
    invariants: [
      {
        id: 'headroom-80',
        description: 'No server may exceed 80% of its capacity',
        condition: 'perNode.maxUtilization <= 0.8'
      }
    ]
  }
}

describe('runFluidSimulation', () => {
  it('produces a valid SimulationOutput with per-node utilization overlaid', () => {
    const out = runFluidSimulation(quickCart(13))
    expect(out.perNode['srv-0']!.utilization).toBeCloseTo(0.769, 2)
    expect(out.perNode['srv-0']!.throughput).toBeCloseTo(1_000_000 / 13, 0)
    expect(out.summary.throughput).toBeCloseTo(1_000_000, 0)
    expect(out.reproducible).toBe(true)
  })

  it('tags the output as analytic and reports a dot scale for the UI', () => {
    const out = runFluidSimulation(quickCart(13))
    expect(out.evaluationMode).toBe('analytic')
    expect(out.requestsPerDot).toBeGreaterThan(0)
  })

  it('overlays finite per-node and summary latency, clamped to the timeout when overloaded', () => {
    const healthy = runFluidSimulation(quickCart(13))
    expect(healthy.perNode['srv-0']!.latencyP99).toBeGreaterThan(0)
    expect(Number.isFinite(healthy.summary.latency.p99 ?? Infinity)).toBe(true)

    // 8 servers → overloaded → latency clamps to the 30s default timeout, never Infinity.
    const overloaded = runFluidSimulation(quickCart(8))
    expect(overloaded.perNode['srv-0']!.latencyP99).toBe(30_000)
    expect(Number.isFinite(overloaded.summary.latency.mean ?? Infinity)).toBe(true)
  })

  it('passes the 80% headroom invariant with 13 servers', () => {
    const out = runFluidSimulation(quickCart(13))
    expect(out.invariantViolations).toHaveLength(0)
  })

  it('violates the 80% headroom invariant with 12 servers', () => {
    const out = runFluidSimulation(quickCart(12))
    // 1M / (12·100k) = 0.833 > 0.8 → invariant fails.
    expect(out.invariantViolations.length).toBeGreaterThan(0)
    expect(out.invariantViolations[0]!.invariantId).toBe('headroom-80')
  })

  it('flags a single overloaded server as dropping (error rate > 0)', () => {
    const out = runFluidSimulation(quickCart(8))
    expect(out.summary.errorRate).toBeCloseTo(0.2, 3)
    expect(out.perNode['srv-0']!.errorRate).toBeGreaterThan(0)
  })
})

describe('runSimulation auto-routing', () => {
  it('routes the 1M-rps flash sale to the analytic path', () => {
    expect(resolveEvaluationMode(quickCart(13))).toBe('analytic')
  })

  it('honours an explicit mode override', () => {
    expect(resolveEvaluationMode(quickCart(13), { mode: 'discrete' })).toBe('discrete')
    expect(resolveEvaluationMode(quickCart(13), { mode: 'analytic' })).toBe('analytic')
  })

  it('runs to completion in milliseconds at flash-sale scale', () => {
    const start = Date.now()
    const out = runSimulation(quickCart(13))
    expect(Date.now() - start).toBeLessThan(1000)
    expect(out.summary.throughput).toBeGreaterThan(0)
  })
})
