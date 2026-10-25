/**
 * A queue's visibility timeout is the time a consumer has to finish (chapter 13 section 3, finding 20):
 * a message still being processed when it expires is delivered again, even though nothing failed.
 */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function queueNode(config: Record<string, unknown>): ComponentNode {
  return {
    id: 'q',
    type: 'queue',
    category: 'messaging',
    label: 'q',
    position: { x: 0, y: 0 },
    queue: { workers: 50, capacity: 1_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 100 }, timeout: 5_000 },
    config
  } as ComponentNode
}

function run(config: Record<string, unknown>) {
  const topology = {
    id: 't',
    name: 'visibility',
    version: '1.0.0',
    global: {
      simulationDuration: 10_000,
      seed: 'visibility',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 5_000,
      traceSampleRate: 0
    },
    nodes: [queueNode(config)],
    edges: [],
    workload: {
      sourceNodeId: 'q',
      pattern: 'constant',
      baseRps: 20,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  return new SimulationEngine(topology).run().perNode.q.traitCounters
}

describe('queue visibility timeout', () => {
  it('redelivers a message whose consumer is still working when the timeout expires', () => {
    const c = run({
      deliverySemantics: 'at-least-once',
      visibilityTimeoutMs: 40,
      maxReceiveCount: 3
    })
    // Processing takes 100 ms against a 40 ms timeout: every message is delivered up to maxReceiveCount times.
    expect(c.queueRedeliveries).toBeGreaterThan(c.queueAccepted)
  })

  it('does not redeliver when the consumer finishes inside the timeout', () => {
    const c = run({
      deliverySemantics: 'at-least-once',
      visibilityTimeoutMs: 500,
      maxReceiveCount: 3
    })
    expect(c.queueRedeliveries ?? 0).toBe(0)
  })

  it('never redelivers under at-most-once', () => {
    const c = run({ deliverySemantics: 'at-most-once', visibilityTimeoutMs: 40 })
    expect(c.queueRedeliveries ?? 0).toBe(0)
  })
})
