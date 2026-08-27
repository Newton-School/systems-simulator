import { describe, expect, it } from 'vitest'
import { SimulationEngine } from './engine'
import { projectToVerdict } from './analysis/verdict'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'

function edge(source: string, target: string, errorRate = 0): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 10_000,
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate
  }
}

function node(
  id: string,
  type: ComponentNode['type'],
  extra: Partial<ComponentNode> = {}
): ComponentNode {
  return {
    id,
    type,
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 32, capacity: 5_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 2 }, timeout: 2_000 },
    ...extra
  }
}

function topology(
  nodes: ComponentNode[],
  edges: EdgeDefinition[],
  workload: TopologyJSON['workload'],
  seed: string
): TopologyJSON {
  return {
    id: seed,
    name: seed,
    version: '1.0.0',
    global: {
      simulationDuration: 6_000,
      seed,
      warmupDuration: 300,
      timeResolution: 'microsecond',
      defaultTimeout: 2_000
    },
    nodes,
    edges,
    workload
  }
}

describe('run-wide trait counter aggregates in the verdict', () => {
  it('surfaces distributed-lock contention as verdict.locks', () => {
    const verdict = projectToVerdict(
      new SimulationEngine(
        topology(
          [
            node('gw', 'api-gateway'),
            node('lock', 'distributed-lock', { config: { lockKeyField: 'seatId', leaseMs: 50 } }),
            node('db', 'relational-db')
          ],
          [edge('gw', 'lock'), edge('lock', 'db')],
          {
            sourceNodeId: 'gw',
            pattern: 'constant',
            baseRps: 1_500,
            requestDistribution: [
              { type: 'write', weight: 1, sizeBytes: 256, keyspace: { field: 'seatId', size: 20 } }
            ]
          },
          'lock-agg'
        )
      ).run()
    )

    expect(verdict.locks.acquires).toBeGreaterThan(0)
    // A small keyspace under a burst means many requests find the lease still held.
    expect(verdict.locks.contentions).toBeGreaterThan(0)
    expect(verdict.locks.keyless).toBe(0)
  })

  it('surfaces caller retries as verdict.retries', () => {
    const verdict = projectToVerdict(
      new SimulationEngine(
        topology(
          [
            node('gw', 'api-gateway'),
            node('svc', 'microservice', {
              resilience: { retry: { maxAttempts: 3, baseDelay: 5, maxDelay: 50, multiplier: 2 } }
            }),
            node('db', 'relational-db')
          ],
          // Lossy downstream forces retryable failures at the caller.
          [edge('gw', 'svc'), edge('svc', 'db', 0.5)],
          {
            sourceNodeId: 'gw',
            pattern: 'constant',
            baseRps: 400,
            requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 256 }]
          },
          'retry-agg'
        )
      ).run()
    )

    expect(verdict.retries.attempts).toBeGreaterThan(0)
    expect(verdict.retries.budgetExhausted).toBeGreaterThan(0)
  })
})
