import { describe, expect, it } from 'vitest'
import { projectToVerdict } from './analysis/verdict'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function node(
  id: string,
  type: ComponentNode['type'] = 'microservice',
  config?: Record<string, unknown>,
  overrides: Partial<ComponentNode> = {}
): ComponentNode {
  return {
    id,
    type,
    category:
      type === 'queue' || type === 'stream'
        ? 'messaging-and-streaming'
        : type === 'sharding'
          ? 'auxiliary'
          : 'compute',
    role: type === 'sharding' ? 'router' : 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 5_000 },
    config,
    ...overrides
  }
}

function edge(id: string, source: string, target: string): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
    bandwidth: 1_000,
    maxConcurrentRequests: 1_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(
  nodes: ComponentNode[],
  edges: EdgeDefinition[],
  options: {
    durationMs?: number
    baseRps?: number
    metadata?: Record<string, unknown>
  } = {}
): TopologyJSON {
  return {
    id: 'p0-runtime',
    name: 'Priority zero runtime',
    version: '1.0.0',
    global: {
      simulationDuration: options.durationMs ?? 100,
      warmupDuration: 0,
      seed: 'p0-runtime-seed',
      timeResolution: 'microsecond',
      defaultTimeout: 5_000,
      traceSampleRate: 0
    },
    nodes,
    edges,
    workload: {
      sourceNodeId: 'source',
      pattern: 'constant',
      baseRps: options.baseRps ?? 100,
      requestDistribution: [
        { type: 'order', weight: 1, sizeBytes: 100, metadata: options.metadata }
      ]
    }
  }
}

describe('priority-zero runtime contracts', () => {
  it('conserves every queue-accepted order as delivered, pending, or lost', () => {
    const queue = node(
      'orders',
      'queue',
      { deliverySemantics: 'at-least-once' },
      {
        queue: { workers: 1, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 40 }, timeout: 5_000 }
      }
    )
    const output = new SimulationEngine(
      topology(
        [node('source'), queue, node('consumer')],
        [edge('source-orders', 'source', 'orders'), edge('orders-consumer', 'orders', 'consumer')],
        { durationMs: 100, baseRps: 100 }
      )
    ).run()
    const verdict = projectToVerdict(output)

    expect(verdict.queue?.accepted).toBeGreaterThan(0)
    expect(verdict.queue?.lost).toBe(0)
    expect(verdict.queue?.noLoss).toBe(1)
    expect(verdict.queue!.delivered + verdict.queue!.pending + verdict.queue!.lost).toBe(
      verdict.queue!.accepted
    )
  })

  it('uses partner capacity as real concurrency and waits through unavailability', () => {
    const delivery = node('delivery', 'microservice', {
      partnerPoolEnabled: true,
      partnerCapacity: 1,
      partnerUnavailableUntilMs: 50,
      partnerMatchMs: 5
    })
    const output = new SimulationEngine(
      topology([node('source'), delivery], [edge('source-delivery', 'source', 'delivery')], {
        durationMs: 120,
        baseRps: 40
      })
    ).run()
    const verdict = projectToVerdict(output)

    expect(output.timeSeries.some((snapshot) => snapshot.node.delivery?.workers === 1)).toBe(true)
    expect(verdict.partners?.queuedForAvailability).toBeGreaterThan(0)
    expect(verdict.partners?.assignments).toBeGreaterThan(0)
    expect(verdict.partners?.waitMs).toBeGreaterThan(0)
  })

  it('detects skew and performs a stable hot-key split/rebalance', () => {
    const router = node('router', 'sharding', {
      routingKeyField: 'tenantId',
      hotShardThresholdRatio: 1.2,
      hotShardMinSamples: 4,
      autoShardRebalance: true
    })
    const output = new SimulationEngine(
      topology(
        [node('source'), router, node('shard-a'), node('shard-b')],
        [
          edge('source-router', 'source', 'router'),
          edge('router-a', 'router', 'shard-a'),
          edge('router-b', 'router', 'shard-b')
        ],
        { durationMs: 100, baseRps: 100, metadata: { tenantId: 'hot-tenant' } }
      )
    ).run()
    const verdict = projectToVerdict(output)

    expect(verdict.sharding?.hotDetections).toBeGreaterThan(0)
    expect(verdict.sharding?.splits).toBe(1)
    expect(verdict.sharding?.migratedKeys).toBe(1)
    expect(verdict.sharding?.shardTargets).toBe(2)
  })

  it('projects partition, lag, offset, and rebalance counters for grading', () => {
    const stream = node('stream', 'stream', {
      streamBrokerEnabled: true,
      consumerGroupMode: true,
      partitionCount: 2
    })
    const consumer = node('consumer', 'microservice', { consumerGroup: 'orders' })
    const output = new SimulationEngine(
      topology(
        [node('source'), stream, consumer],
        [edge('source-stream', 'source', 'stream'), edge('stream-consumer', 'stream', 'consumer')],
        { durationMs: 20, baseRps: 100, metadata: { partitionKey: 'order-key' } }
      )
    ).run()
    const verdict = projectToVerdict(output)

    expect(verdict.stream?.partitions).toBe(2)
    expect(verdict.stream?.appends).toBeGreaterThan(0)
    expect(verdict.stream?.offsetCommits).toBeGreaterThan(0)
    expect(verdict.stream?.rebalances).toBe(1)
  })
})
