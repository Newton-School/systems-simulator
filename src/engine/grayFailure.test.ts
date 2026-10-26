/** A gray-failure fault fails a share of real requests while health checks still pass (chapter 22, decision G3). */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function run(errorRate: number, healthChecked: boolean) {
  const node = (id: string, type: string, config?: Record<string, unknown>) =>
    ({
      id,
      type,
      category: 'compute',
      label: id,
      position: { x: 0, y: 0 },
      queue: { workers: 50, capacity: 500, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 2 }, timeout: 1_000 },
      ...(config ? { config } : {})
    }) as ComponentNode
  const edge = (id: string, source: string, target: string) =>
    ({
      id,
      source,
      target,
      mode: 'synchronous',
      protocol: 'grpc',
      latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
      bandwidth: 1000,
      maxConcurrentRequests: 1000,
      packetLossRate: 0,
      errorRate: 0
    }) as never
  const topology = {
    id: 't',
    name: 'gray',
    version: '1.0.0',
    global: {
      simulationDuration: 20_000,
      seed: 'gray',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000,
      traceSampleRate: 0
    },
    nodes: [
      node('src', 'microservice'),
      node('lb', 'load-balancer', {
        routingStrategy: 'round-robin',
        healthCheckEnabled: healthChecked
      }),
      node('a', 'microservice'),
      node('b', 'microservice')
    ],
    edges: [edge('e0', 'src', 'lb'), edge('e1', 'lb', 'a'), edge('e2', 'lb', 'b')],
    faults: [
      {
        targetId: 'a',
        faultType: 'gray-failure',
        timing: 'deterministic',
        duration: 'permanent',
        params: { atMs: 5_000, errorRate }
      }
    ],
    workload: {
      sourceNodeId: 'src',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  return new SimulationEngine(topology).run()
}

describe('gray-failure fault', () => {
  it("fails its rate of the node's requests from the start time, and the balancer still sends it traffic", () => {
    const out = run(0.4, true)
    // After 5 s of 20, half the traffic reaches `a`, and 40% of that fails: 0.75 x 0.5 x 0.4 = 15%.
    expect(out.summary.errorRate).toBeGreaterThan(0.12)
    expect(out.summary.errorRate).toBeLessThan(0.18)
    expect(out.perNode.a.totalArrived).toBeGreaterThan(0.45 * out.summary.totalRequests)
  })

  it('does nothing at rate 0', () => {
    expect(run(0, true).summary.errorRate).toBe(0)
  })
})
