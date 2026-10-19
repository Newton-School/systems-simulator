/**
 * Known issues in the Little's Law check, pinned with `it.fails`: each test states the CORRECT
 * expectation and currently fails, so this file passes today. When one of the issues is fixed its
 * test starts passing, `it.fails` turns red, and the marker should be removed (the test then
 * guards the fix). See docs/engine-probe-findings.md.
 */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from '../core/types'
import { SimulationEngine } from '../engine'

function server(id: string, capacity: number, serviceMs: number): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 60_000 }
  } as ComponentNode
}

function run(opts: {
  capacity: number
  rps: number
  pattern: 'constant' | 'poisson'
  durationMs: number
  warmupMs: number
}) {
  const topology = {
    id: 't',
    name: 'littles-law',
    version: '1.0.0',
    global: {
      simulationDuration: opts.durationMs,
      seed: 'littles-law',
      warmupDuration: opts.warmupMs,
      timeResolution: 'microsecond',
      defaultTimeout: 60_000,
      traceSampleRate: 0
    },
    nodes: [server('source', 100, 0), server('srv', opts.capacity, 10)],
    edges: [
      {
        id: 'e',
        source: 'source',
        target: 'srv',
        mode: 'synchronous',
        protocol: 'grpc',
        latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
        bandwidth: 1000,
        maxConcurrentRequests: 100_000,
        packetLossRate: 0,
        errorRate: 0
      }
    ],
    workload: {
      sourceNodeId: 'source',
      pattern: opts.pattern,
      baseRps: opts.rps,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  const output = new SimulationEngine(topology).run()
  return {
    node: output.perNode.srv,
    littles: output.littlesLawCheck.find((check) => check.nodeId === 'srv')!
  }
}

describe("Little's Law check: known issues", () => {
  it('sanity: a stable M/D/1 queue (rho 0.8, Poisson) passes and matches theory', () => {
    const { node, littles } = run({
      capacity: 100_000,
      rps: 80,
      pattern: 'poisson',
      durationMs: 60_000,
      warmupMs: 5_000
    })
    expect(littles.withinTolerance).toBe(true)
    // Pollaczek-Khinchine: Wq = rho / (2 mu (1 - rho)) = 20 ms. One seeded run is noisy at this
    // utilization (16 to 19 ms across seeds), so the band is wide.
    expect(node.avgQueueWait).toBeGreaterThan(13)
    expect(node.avgQueueWait).toBeLessThan(27)
  })

  // Little's Law holds for the requests the node ADMITS. The check uses every arrival, rejected
  // ones included, so an overloaded finite buffer is reported as a violation although the node is
  // consistent (observed L = 5 against 5 slots; admitted rate x time in system is about 4.7).
  it.fails(
    'does not flag a consistent overloaded node: lambda must exclude rejected arrivals',
    () => {
      const { littles } = run({
        capacity: 5,
        rps: 300,
        pattern: 'constant',
        durationMs: 4_000,
        warmupMs: 500
      })
      expect(littles.withinTolerance).toBe(true)
    }
  )

  // L is a point-sampled average of snapshots, not a time integral. With constant arrivals every
  // snapshot lands between jobs and sees an empty system, so L reads 0 while utilization is 0.5.
  // The check still passes only because of its `absoluteError <= 0.5` guard.
  it.fails('measures L as a time average: half-busy server has L of about 0.5', () => {
    const { node, littles } = run({
      capacity: 10,
      rps: 50,
      pattern: 'constant',
      durationMs: 10_000,
      warmupMs: 1_000
    })
    expect(node.utilization).toBeGreaterThan(0.45)
    expect(littles.observedL).toBeGreaterThan(0.4)
    expect(littles.observedL).toBeLessThan(0.6)
  })
})
