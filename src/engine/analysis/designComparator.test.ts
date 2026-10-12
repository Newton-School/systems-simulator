import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import type { PerNodeMetrics, SimulationSummary } from '../metrics'
import { topologyCost } from './cost'
import {
  compareDesigns,
  compareMetric,
  costRunContextFromOutput,
  TIE_TOLERANCE,
  type MetricComparison
} from './designComparator'
import type { SimulationOutput } from './output'

interface MockRun {
  p50: number | null
  p90: number | null
  p95: number | null
  p99: number | null
  throughput: number
  errorRate: number
  successfulRequests: number
  nodes: Record<string, { utilization: number; timeInSystem: number; throughput?: number }>
}

function output(run: MockRun): SimulationOutput {
  const summary = {
    latency: {
      p50: run.p50,
      p90: run.p90,
      p95: run.p95,
      p99: run.p99,
      min: null,
      max: null,
      mean: null
    },
    throughput: run.throughput,
    errorRate: run.errorRate,
    successfulRequests: run.successfulRequests,
    postWarmupDurationSec: 10
  } as unknown as SimulationSummary
  const perNode = Object.fromEntries(
    Object.entries(run.nodes).map(([id, n]) => [
      id,
      {
        nodeLabel: id.toUpperCase(),
        utilization: n.utilization,
        postWarmupAvgTimeInSystem: n.timeInSystem,
        throughput: n.throughput ?? run.throughput
      } as unknown as PerNodeMetrics
    ])
  )
  return { summary, perNode, perEdge: {} } as unknown as SimulationOutput
}

const baseline: MockRun = {
  p50: 20,
  p90: 60,
  p95: 90,
  p99: 250,
  throughput: 100,
  errorRate: 0.05,
  successfulRequests: 9500,
  nodes: {
    lb: { utilization: 0.3, timeInSystem: 1 },
    api: { utilization: 0.9, timeInSystem: 40 },
    db: { utilization: 0.6, timeInSystem: 10 }
  }
}

const withCache: MockRun = {
  p50: 8,
  p90: 20,
  p95: 30,
  p99: 90,
  throughput: 120,
  errorRate: 0.01,
  successfulRequests: 11_880,
  nodes: {
    lb: { utilization: 0.3, timeInSystem: 1 },
    api: { utilization: 0.5, timeInSystem: 12 },
    cache: { utilization: 0.2, timeInSystem: 0.5 }
  }
}

const metric = (comparison: { metrics: MetricComparison[] }, id: string): MetricComparison =>
  comparison.metrics.find((m) => m.metric === id)!

describe('compareDesigns', () => {
  const comparison = compareDesigns(
    { name: 'No cache', output: output(baseline) },
    { name: 'With cache', output: output(withCache) }
  )

  it('compares every latency percentile, throughput, error rate and successful requests', () => {
    expect(comparison.metrics.map((m) => m.metric)).toEqual([
      'latency.p50',
      'latency.p90',
      'latency.p95',
      'latency.p99',
      'throughput',
      'errorRate',
      'successfulRequests'
    ])
    expect(comparison.designA).toBe('No cache')
    expect(comparison.designB).toBe('With cache')
  })

  it('computes delta as B - A and percentChange relative to A', () => {
    const p99 = metric(comparison, 'latency.p99')
    expect(p99.designA).toBe(250)
    expect(p99.designB).toBe(90)
    expect(p99.delta).toBe(-160)
    expect(p99.percentChange).toBeCloseTo(-64)
    expect(metric(comparison, 'throughput').percentChange).toBeCloseTo(20)
    expect(metric(comparison, 'errorRate').delta).toBeCloseTo(-0.04)
  })

  it('picks the right winner per metric: lower latency/error is better, higher throughput is better', () => {
    for (const m of comparison.metrics) expect(m.winner, m.metric).toBe('B')
    const reversed = compareDesigns(
      { name: 'With cache', output: output(withCache) },
      { name: 'No cache', output: output(baseline) }
    )
    for (const m of reversed.metrics) expect(m.winner, m.metric).toBe('A')
  })

  it('reports per-node utilization/latency deltas for shared nodes and flags one-sided nodes', () => {
    expect(comparison.perNode.api).toEqual({
      label: 'API',
      onlyInA: false,
      onlyInB: false,
      utilizationA: 0.9,
      utilizationB: 0.5,
      utilizationDelta: expect.closeTo(-0.4),
      latencyDelta: -28
    })
    expect(comparison.perNode.lb.utilizationDelta).toBe(0)
    expect(comparison.perNode.db).toEqual({ label: 'DB', onlyInA: true, onlyInB: false })
    expect(comparison.perNode.cache).toEqual({ label: 'CACHE', onlyInA: false, onlyInB: true })
  })

  it('writes a coherent summary sentence naming the biggest difference', () => {
    expect(comparison.summary).toMatch(/^With cache has a lower error rate \(1\.0% vs 5\.0%\)/)
    expect(comparison.summary).toContain('With cache is better or equal on every compared metric.')
    expect(comparison.summary).not.toMatch(/—/)
  })

  it('names the trade-off when each design wins something', () => {
    const fasterButSmaller = compareDesigns(
      { name: 'A', output: output(baseline) },
      { name: 'B', output: output({ ...baseline, p99: 90, throughput: 80 }) }
    )
    expect(fasterButSmaller.summary).toBe(
      'B has lower p99 latency by 64%, but A has higher throughput by 25%. A wins 1 metric, B wins 1.'
    )
  })

  it('treats differences within the tie tolerance as ties and says so', () => {
    const nudged = { ...baseline, p99: 250 * (1 + TIE_TOLERANCE / 2) }
    const same = compareDesigns(
      { name: 'A', output: output(baseline) },
      { name: 'B', output: output(nudged) }
    )
    expect(metric(same, 'latency.p99').winner).toBe('tie')
    expect(same.summary).toBe('A and B perform the same on every compared metric (within 1%).')
  })

  it('handles missing latency (no successful requests) without inventing a winner', () => {
    const failed = compareDesigns(
      { name: 'A', output: output(baseline) },
      {
        name: 'B',
        output: output({ ...baseline, p50: null, p90: null, p95: null, p99: null })
      }
    )
    const p50 = metric(failed, 'latency.p50')
    expect(p50).toMatchObject({ designB: null, delta: null, percentChange: null, winner: 'n/a' })
  })

  it('adds a cost comparison when both topologies are supplied', () => {
    const topo = (count: number): TopologyJSON =>
      ({
        id: 't',
        name: 't',
        version: '2.0.0',
        global: {
          simulationDuration: 1000,
          seed: 's',
          warmupDuration: 0,
          timeResolution: 'millisecond',
          defaultTimeout: 1000
        },
        nodes: [
          {
            id: 'api',
            type: 'microservice',
            category: 'compute',
            label: 'api',
            position: { x: 0, y: 0 },
            resources: { instanceType: 'c5.large', instanceCount: count }
          }
        ],
        edges: []
      }) as TopologyJSON
    const a = { name: '3 replicas', output: output(baseline), topology: topo(3) }
    const b = { name: '5 replicas', output: output(baseline), topology: topo(5) }
    const result = compareDesigns(a, b)
    const cost = metric(result, 'costPerHour')
    const expectedA = topologyCost(a.topology, costRunContextFromOutput(a.output)).totalPerHour
    expect(expectedA).toBeGreaterThan(0)
    expect(cost.designA).toBeCloseTo(expectedA)
    expect(cost.percentChange).toBeCloseTo(((5 - 3) / 3) * 100)
    expect(cost.winner).toBe('A')
    expect(result.summary).toBe(
      '3 replicas is cheaper by 40%. 3 replicas is better or equal on every compared metric.'
    )
  })

  it('omits cost when a topology is missing', () => {
    const result = compareDesigns(
      { name: 'A', output: output(baseline) },
      { name: 'B', output: output(withCache) }
    )
    expect(result.metrics.some((m) => m.metric === 'costPerHour')).toBe(false)
  })
})

describe('compareMetric', () => {
  const spec = {
    metric: 'throughput',
    label: 'Throughput',
    unit: 'req/s',
    better: 'higher'
  } as const

  it('leaves percentChange undefined when A is zero and B is not', () => {
    expect(compareMetric(spec, 0, 10)).toMatchObject({
      delta: 10,
      percentChange: null,
      winner: 'B'
    })
  })

  it('calls two zeros a tie with 0% change', () => {
    expect(compareMetric(spec, 0, 0)).toMatchObject({ delta: 0, percentChange: 0, winner: 'tie' })
  })

  it('treats non-finite values as missing', () => {
    expect(compareMetric(spec, Number.NaN, 5).winner).toBe('n/a')
  })
})
