/** A queue reports what it accepted from producers and what it delivered, not just a doubled arrival count. */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

describe('queue message counters', () => {
  it('splits arrivals into messages produced and deliveries made', () => {
    const queue = {
      id: 'q',
      type: 'queue',
      category: 'messaging',
      label: 'q',
      position: { x: 0, y: 0 },
      queue: { workers: 4, capacity: 1_000, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 10 }, timeout: 5_000 }
    } as ComponentNode
    const topology = {
      id: 't',
      name: 'counters',
      version: '1.0.0',
      global: {
        simulationDuration: 10_000,
        seed: 'counters',
        warmupDuration: 0,
        timeResolution: 'microsecond',
        defaultTimeout: 5_000,
        traceSampleRate: 0
      },
      nodes: [queue],
      edges: [],
      workload: {
        sourceNodeId: 'q',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    } as unknown as TopologyJSON
    const q = new SimulationEngine(topology).run().perNode.q
    expect(q.messagesProduced).toBe(1000)
    expect(q.messagesDelivered).toBe(1000)
    expect(q.totalArrived).toBe(q.messagesProduced! + q.messagesDelivered!)
  })
})
