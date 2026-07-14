import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../../../engine/core/types'
import { isTopologyJsonLike, topologyToCanvasFileData } from './topologyCanvasAdapter'

const SERVERLESS_COLD_START: TopologyJSON = {
  id: 'serverless-cold-start',
  name: 'Serverless Cold Start',
  version: '2.0.0',
  global: {
    simulationDuration: 20_000,
    warmupDuration: 2_000,
    seed: 'cold-start-seed',
    defaultTimeout: 5_000,
    timeResolution: 'millisecond',
    traceSampleRate: 0.01
  },
  nodes: [
    {
      id: 'client',
      type: 'api-endpoint',
      category: 'compute',
      role: 'source',
      label: 'Client App',
      position: { x: 0, y: 0 }
    },
    {
      id: 'lambda',
      type: 'serverless-function',
      category: 'compute',
      role: 'processor',
      label: 'Checkout Function',
      position: { x: 260, y: 0 },
      queue: { workers: 4, capacity: 20, discipline: 'fifo' },
      processing: {
        distribution: { type: 'exponential', lambda: 1 / 20 },
        timeout: 2_000
      },
      config: {
        coldStartLatency: { type: 'exponential', lambda: 1 / 220 },
        idleTimeoutMs: 4_000,
        maxConcurrency: 2
      }
    }
  ],
  edges: [
    {
      id: 'client-lambda',
      source: 'client',
      target: 'lambda',
      mode: 'synchronous',
      protocol: 'https',
      latency: {
        distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
        pathType: 'same-dc'
      },
      bandwidth: 100,
      maxConcurrentRequests: 100,
      packetLossRate: 0,
      errorRate: 0
    }
  ],
  workload: {
    sourceNodeId: 'client',
    pattern: 'bursty',
    baseRps: 2,
    bursty: { burstRps: 18, burstDuration: 2_000, normalDuration: 5_000 },
    requestDistribution: [{ type: 'invoke', weight: 1, sizeBytes: 1_024 }]
  }
}

describe('topologyCanvasAdapter', () => {
  it('recognizes topology-json shaped inputs', () => {
    expect(isTopologyJsonLike(SERVERLESS_COLD_START)).toBe(true)
    expect(isTopologyJsonLike({ nodes: [], edges: [] })).toBe(false)
  })

  it('converts a topology into canvas file data', () => {
    const canvas = topologyToCanvasFileData(SERVERLESS_COLD_START)

    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.scenario).toMatchObject({
      selectedSourceNodeId: 'client',
      global: {
        simulationDuration: SERVERLESS_COLD_START.global.simulationDuration,
        warmupDuration: SERVERLESS_COLD_START.global.warmupDuration,
        seed: SERVERLESS_COLD_START.global.seed
      }
    })

    const lambda = canvas.nodes.find((node) => node.id === 'lambda')
    expect(lambda?.data).toMatchObject({
      componentType: 'serverless-function',
      label: 'Checkout Function',
      sim: expect.objectContaining({
        maxConcurrency: 2,
        idleTimeoutMs: 4_000
      })
    })
  })
})
