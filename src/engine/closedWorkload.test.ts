/**
 * A closed population (chapter 05 section 3, decision B4): N users, think time Z. The interactive response time law
 * R = N / X - Z holds, and the offered load falls as the system slows.
 */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function run(users: number, thinkTimeMs: number, workers: number, serviceMs: number) {
  const server = {
    id: 'srv',
    type: 'microservice',
    category: 'compute',
    label: 'srv',
    position: { x: 0, y: 0 },
    queue: { workers, capacity: 100_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 120_000 }
  } as ComponentNode
  const topology = {
    id: 't',
    name: 'closed',
    version: '1.0.0',
    global: {
      simulationDuration: 120_000,
      seed: 'closed',
      warmupDuration: 20_000,
      timeResolution: 'microsecond',
      defaultTimeout: 120_000,
      traceSampleRate: 0
    },
    nodes: [server],
    edges: [],
    workload: {
      sourceNodeId: 'srv',
      pattern: 'closed',
      baseRps: 1,
      closed: { users, thinkTimeMs },
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  const out = new SimulationEngine(topology).run()
  const measuredSeconds = 100
  return { x: out.perNode.srv.postWarmupProcessed / measuredSeconds, r: out.summary.latency.mean }
}

describe('closed workload', () => {
  it('lightly loaded: throughput is N / (R + Z), response time is the service time', () => {
    const { x, r } = run(10, 1_000, 8, 100)
    expect(r).toBeCloseTo(100, 0)
    expect(x).toBeCloseTo(10 / 1.1, 0)
  })

  it('saturated: throughput is the server capacity and R = N / X - Z', () => {
    // One worker at 100 ms serves 10 req/s whatever the population; 30 users think for 1 s.
    const { x, r } = run(30, 1_000, 1, 100)
    expect(Math.abs(x - 10)).toBeLessThan(0.3)
    const lawR = (30 / x) * 1000 - 1_000
    expect(Math.abs(r - lawR) / lawR).toBeLessThan(0.05)
    expect(Math.abs(r - 2_000) / 2_000).toBeLessThan(0.08)
  })

  it('does not collapse like an open source: doubling the users doubles R, not the queue', () => {
    const a = run(30, 1_000, 1, 100).r
    const b = run(60, 1_000, 1, 100).r
    expect(b).toBeGreaterThan(a * 1.8)
    expect(b).toBeLessThan(a * 2.8) // R = N/X - Z: (60/10 - 1) / (30/10 - 1) = 2.5
  })
})
