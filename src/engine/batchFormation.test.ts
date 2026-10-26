/** Batch formation (chapter 18 section 4, decision E2): the wait is min(window, time to fill) / 2 and holds no worker. */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function run(rps: number, config: Record<string, unknown>, workers = 1) {
  const node = (id: string, type: string, extra: Partial<ComponentNode> = {}) =>
    ({
      id,
      type,
      category: 'compute',
      label: id,
      position: { x: 0, y: 0 },
      queue: { workers, capacity: 100_000, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 0.5 }, timeout: 60_000 },
      ...extra
    }) as ComponentNode
  const topology = {
    id: 't',
    name: 'batch',
    version: '1.0.0',
    global: {
      simulationDuration: 30_000,
      seed: 'batch',
      warmupDuration: 5_000,
      timeResolution: 'microsecond',
      defaultTimeout: 60_000,
      traceSampleRate: 0
    },
    nodes: [
      node('client', 'microservice', {
        queue: { workers: 5_000, capacity: 100_000, discipline: 'fifo' }
      }),
      node('gpu', 'gpu-node', { config })
    ],
    edges: [
      {
        id: 'e',
        source: 'client',
        target: 'gpu',
        mode: 'synchronous',
        protocol: 'tcp',
        latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
        bandwidth: 100_000,
        maxConcurrentRequests: 100_000,
        packetLossRate: 0,
        errorRate: 0
      }
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: rps,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1 }]
    }
  } as unknown as TopologyJSON
  return new SimulationEngine(topology).run()
}

describe('batch formation wait', () => {
  const config = { batchSize: 8, batchWindowMs: 10, fixedCostMs: 0.001 }

  it('a trickle waits half the window: the batch never fills inside it', () => {
    // 20 req/s fills 8 in 350 ms, far past the 10 ms window: wait = 10 / 2 = 5 ms.
    const out = run(20, config)
    expect(Math.abs(out.summary.latency.mean - (0.5 + 5))).toBeLessThan(0.4)
  })

  it('a busy node fills a batch before the window: wait = (batch - 1) / rate / 2', () => {
    // 4,000 req/s fills 8 in 1.75 ms, so the wait is 0.875 ms, not 5 ms.
    const out = run(4_000, config, 8)
    expect(out.summary.latency.mean).toBeLessThan(0.5 + 1.6)
    expect(out.summary.latency.mean).toBeGreaterThan(0.5 + 0.5)
  })

  it('does not hold a worker: a worker serves each item in its own time, not its time plus the wait', () => {
    const out = run(20, config)
    expect(out.perNode.gpu.avgServiceTime).toBeLessThan(1)
  })
})
