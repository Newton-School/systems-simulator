/** Independent random streams (chapter 04 section 3, decision A4). */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function topology(extraNodes: boolean, workers = 4): TopologyJSON {
  const node = (id: string, w = 4) =>
    ({
      id,
      type: 'microservice',
      category: 'compute',
      label: id,
      position: { x: 0, y: 0 },
      queue: { workers: w, capacity: 1_000, discipline: 'fifo' },
      processing: { distribution: { type: 'exponential', lambda: 1 / 20 }, timeout: 10_000 }
    }) as ComponentNode
  return {
    id: 't',
    name: 'streams',
    version: '1.0.0',
    global: {
      simulationDuration: 30_000,
      seed: 'streams',
      warmupDuration: 2_000,
      timeResolution: 'microsecond',
      defaultTimeout: 10_000,
      traceSampleRate: 0
    },
    nodes: [node('srv', workers), ...(extraNodes ? [node('idle-1'), node('idle-2')] : [])],
    edges: [],
    workload: {
      sourceNodeId: 'srv',
      pattern: 'poisson',
      baseRps: 120,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
}

describe('independent random streams', () => {
  it('adding unrelated, disconnected nodes does not change a run', () => {
    const a = new SimulationEngine(topology(false)).run().summary
    const b = new SimulationEngine(topology(true)).run().summary
    expect(b.latency.mean).toBe(a.latency.mean)
    expect(b.totalRequests).toBe(a.totalRequests)
  })

  it('a request gets the same service-time draw whatever else the design does: more workers only remove waiting', () => {
    const few = new SimulationEngine(topology(false, 4)).run().perNode.srv
    const many = new SimulationEngine(topology(false, 64)).run().perNode.srv
    // Same seed, same arrivals, same per-request draws: the mean service time is identical, only the wait differs.
    expect(many.avgServiceTime).toBeCloseTo(few.avgServiceTime, 6)
    expect(many.avgQueueWait).toBeLessThan(few.avgQueueWait)
  })
})
