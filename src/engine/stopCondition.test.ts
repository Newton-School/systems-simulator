import { describe, expect, it } from 'vitest'
import type {
  ComponentNode,
  EdgeDefinition,
  TopologyJSON,
  WorkloadStopCondition
} from './core/types'
import { resolveStopCondition } from './core/stopCondition'
import { SimulationEngine } from './engine'
import { runFluidSimulation } from './analysis/fluidSimulation'
import { estimateDiscreteEventCount } from './analysis/fluidModel'

function svc(id: string, workers: number, serviceMs: number): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers, capacity: workers * 4, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 5000 }
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
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topo(opts: {
  baseRps: number
  serviceMs: number
  workers: number
  durationMs?: number
  stopCondition?: WorkloadStopCondition
}): TopologyJSON {
  return {
    id: 't',
    name: 't',
    version: '1',
    global: {
      simulationDuration: opts.durationMs ?? 10_000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 5_000
    },
    nodes: [
      {
        id: 'src',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'src',
        position: { x: 0, y: 0 }
      },
      svc('api', opts.workers, opts.serviceMs)
    ],
    edges: [edge('src', 'api')],
    workload: {
      sourceNodeId: 'src',
      pattern: 'constant',
      baseRps: opts.baseRps,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }],
      ...(opts.stopCondition ? { stopCondition: opts.stopCondition } : {})
    }
  }
}

describe('resolveStopCondition', () => {
  it('defaults to duration mode', () => {
    const r = resolveStopCondition(
      topo({ baseRps: 100, serviceMs: 5, workers: 2, durationMs: 3000 })
    )
    expect(r.mode).toBe('duration')
    expect(r.maxRequests).toBeNull()
    expect(r.effectiveDurationMs).toBe(3000)
    expect(r.haltUtilization).toBeNull()
  })

  it('derives a run window from the request budget and base rate', () => {
    const r = resolveStopCondition(
      topo({
        baseRps: 100,
        serviceMs: 5,
        workers: 2,
        stopCondition: { mode: 'requestBudget', maxRequests: 500 }
      })
    )
    expect(r.mode).toBe('requestBudget')
    expect(r.maxRequests).toBe(500)
    // 500 / 100 rps = 5s emit + drain margin (>= defaultTimeout 5s).
    expect(r.effectiveDurationMs).toBeGreaterThanOrEqual(5_000 + 5_000)
  })

  it('reads the saturation guard with a default utilization of 1.0', () => {
    const r = resolveStopCondition(
      topo({
        baseRps: 100,
        serviceMs: 5,
        workers: 2,
        stopCondition: { mode: 'duration', haltOnSaturation: {} }
      })
    )
    expect(r.haltUtilization).toBe(1.0)
  })
})

describe('request-budget mode (discrete engine)', () => {
  it('generates exactly maxRequests source requests, ignoring the time bound', () => {
    // 1000 rps for a nominal 10s would be ~10k requests; the budget caps it at 200.
    const out = new SimulationEngine(
      topo({
        baseRps: 1000,
        serviceMs: 1,
        workers: 8,
        durationMs: 10_000,
        stopCondition: { mode: 'requestBudget', maxRequests: 200 }
      })
    ).run()
    expect(out.summary.totalRequests).toBe(200)
    expect(out.stopReason).toBe('request-budget')
  })
})

describe('saturation halt (discrete engine)', () => {
  it('stops early when a node is exhausted', () => {
    // 1 worker at 10ms service = 100 rps capacity, offered 1000 rps → saturates.
    const out = new SimulationEngine(
      topo({
        baseRps: 1000,
        serviceMs: 10,
        workers: 1,
        durationMs: 60_000,
        stopCondition: { mode: 'duration', haltOnSaturation: { utilization: 1.0 } }
      })
    ).run()
    expect(out.stopReason).toBe('saturation')
    // Aborted well before the 60s window.
    expect(out.stoppedAtMs ?? Infinity).toBeLessThan(60_000)
  })

  it('runs the full window when never saturated', () => {
    const out = new SimulationEngine(
      topo({
        baseRps: 50,
        serviceMs: 5,
        workers: 8,
        durationMs: 2_000,
        stopCondition: { mode: 'duration', haltOnSaturation: { utilization: 1.0 } }
      })
    ).run()
    expect(out.stopReason).toBe('duration')
  })
})

describe('stop condition (analytic path)', () => {
  it('scales totals to the request budget', () => {
    const out = runFluidSimulation(
      topo({
        baseRps: 1_000_000,
        serviceMs: 1,
        workers: 1,
        stopCondition: { mode: 'requestBudget', maxRequests: 2_000_000 }
      })
    )
    // 2M budget at 1M rps → 2s of traffic → totalRequests ≈ 2M.
    expect(out.summary.totalRequests).toBeCloseTo(2_000_000, -3)
    // No saturation guard armed here, so the stop reason is the budget itself.
    expect(out.stopReason).toBe('request-budget')
  })

  it('reports saturation when the bottleneck is over the guard threshold', () => {
    const out = runFluidSimulation(
      topo({
        baseRps: 1_000_000,
        serviceMs: 1,
        workers: 1,
        stopCondition: { mode: 'duration', haltOnSaturation: { utilization: 1.0 } }
      })
    )
    expect(out.stopReason).toBe('saturation')
    expect(out.stoppedAtMs).toBe(0)
  })
})

describe('auto-routing honours the budget', () => {
  it('a large budget still routes to analytic; a small one keeps the sim', () => {
    const big = topo({
      baseRps: 1_000_000,
      serviceMs: 1,
      workers: 1,
      stopCondition: { mode: 'requestBudget', maxRequests: 5_000_000 }
    })
    const small = topo({
      baseRps: 1_000_000,
      serviceMs: 1,
      workers: 1,
      stopCondition: { mode: 'requestBudget', maxRequests: 1_000 }
    })
    expect(estimateDiscreteEventCount(big)).toBeGreaterThan(2_000_000)
    expect(estimateDiscreteEventCount(small)).toBeLessThan(2_000_000)
  })
})
