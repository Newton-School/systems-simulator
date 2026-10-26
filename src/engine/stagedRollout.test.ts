/** A weight schedule on an edge stages a rollout (chapter 17 section 2, decision H4). */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function run() {
  const node = (id: string, extra: Partial<ComponentNode> = {}) =>
    ({
      id,
      type: 'microservice',
      category: 'compute',
      label: id,
      position: { x: 0, y: 0 },
      queue: { workers: 50, capacity: 500, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 2 }, timeout: 1_000 },
      ...extra
    }) as ComponentNode
  const edge = (id: string, source: string, target: string, extra: Record<string, unknown> = {}) =>
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
      errorRate: 0,
      ...extra
    }) as never
  const topology = {
    id: 't',
    name: 'rollout',
    version: '1.0.0',
    global: {
      simulationDuration: 30_000,
      seed: 'rollout',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000,
      traceSampleRate: 0
    },
    nodes: [
      node('client'),
      node('lb', { type: 'load-balancer', config: { routingStrategy: 'weighted' } }),
      node('v1'),
      node('v2')
    ],
    edges: [
      edge('e0', 'client', 'lb'),
      edge('e1', 'lb', 'v1', { weight: 1 }),
      edge('e2', 'lb', 'v2', {
        weight: 0,
        weightSchedule: [
          { atMs: 10_000, weight: 0.05 },
          { atMs: 20_000, weight: 1 }
        ]
      })
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 200,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  const out = new SimulationEngine(topology).run()
  const share = (from: number, to: number) => {
    const rows = out.requestOutcomes.filter((o) => o.createdAtMs >= from && o.createdAtMs < to)
    return rows.filter((o) => o.nodeId === 'v2').length / rows.length
  }
  return { share }
}

describe('weighted edge schedule', () => {
  it('moves traffic to the new version in stages', () => {
    const { share } = run()
    expect(share(0, 10_000)).toBe(0) // weight 0 before the first step
    expect(Math.abs(share(10_500, 19_500) - 0.05 / 1.05)).toBeLessThan(0.015) // 5% canary
    expect(Math.abs(share(20_500, 29_500) - 0.5)).toBeLessThan(0.03) // equal weights
  })
})
