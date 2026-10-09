import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function topology(edgeOverrides: Partial<EdgeDefinition> = {}): TopologyJSON {
  const api: ComponentNode = {
    id: 'api',
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: 'api',
    position: { x: 0, y: 0 },
    queue: { workers: 64, capacity: 256, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 5 }, timeout: 5000 }
  }
  return {
    id: 't',
    name: 't',
    version: '1',
    global: {
      simulationDuration: 2_000,
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
      api
    ],
    edges: [
      {
        id: 'src->api',
        source: 'src',
        target: 'api',
        mode: 'synchronous',
        protocol: 'kafka',
        latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-rack' },
        bandwidth: Number.MAX_SAFE_INTEGER,
        maxConcurrentRequests: Number.MAX_SAFE_INTEGER,
        packetLossRate: 0,
        errorRate: 0,
        ...edgeOverrides
      }
    ],
    workload: {
      sourceNodeId: 'src',
      pattern: 'constant',
      baseRps: 20,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  }
}

describe('edge protocolOverheadMs override', () => {
  it('replaces the protocol default, so a connector edge adds no latency', () => {
    const withDefault = new SimulationEngine(topology()).run()
    const neutral = new SimulationEngine(topology({ protocolOverheadMs: 0 })).run()
    // kafka's default per-request cost is 2ms; the override removes it and keeps the protocol.
    expect(withDefault.summary.latency.p50! - neutral.summary.latency.p50!).toBeCloseTo(2, 1)
    expect(neutral.summary.latency.p50).toBeCloseTo(5, 1)
  })
})
