import { describe, expect, it } from 'vitest'
import { createEvent } from './core/events'
import { msToMicro } from './core/time'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'
import type { AdmissionDecision, DebugEvent } from './core/event-stream'
import { SimulationEngine } from './engine'
import type { NodeBehaviourTrait, TraitResolver } from './traits/types'

function makeNode(id: string): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 }
  }
}

function makeRouterNode(
  id: string,
  type: ComponentNode['type'] = 'load-balancer',
  config: Record<string, unknown> | undefined = undefined
): ComponentNode {
  return {
    id,
    type,
    category: 'network-and-edge',
    role: 'router',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

function makeHealthCheckManagerNode(
  id: string,
  config: Record<string, unknown> | undefined = undefined
): ComponentNode {
  return {
    id,
    type: 'health-check-manager',
    category: 'observability',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  }
}

function makeCacheNode(
  id: string,
  type: ComponentNode['type'] = 'in-memory-cache',
  config: Record<string, unknown> | undefined = undefined
): ComponentNode {
  return {
    id,
    type,
    category: type === 'cdn' || type === 'reverse-proxy' ? 'network-and-edge' : 'storage-and-data',
    role: type === 'cdn' || type === 'reverse-proxy' ? 'router' : 'storage',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 },
    config
  }
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<EdgeDefinition> = {}
): EdgeDefinition {
  return {
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
    ...overrides
  }
}

type TopologyOverrides = Omit<Partial<TopologyJSON>, 'global'> & {
  global?: Partial<TopologyJSON['global']>
}

function makeTopology(overrides: TopologyOverrides = {}): TopologyJSON {
  return {
    id: 'topology-test',
    name: 'engine-test',
    version: '1.0.0',
    global: {
      simulationDuration: 50,
      seed: 'engine-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000,
      traceSampleRate: 1,
      ...overrides.global
    },
    nodes: overrides.nodes ?? [makeNode('node-a')],
    edges: overrides.edges ?? [],
    workload: overrides.workload
  }
}

describe('SimulationEngine', () => {
  it('exposes an empty canonical event stream before a run', () => {
    const engine = new SimulationEngine(makeTopology({ workload: undefined }))

    expect(engine.getEventStream()).toEqual([])
    expect(engine.getEventCountsByType()['request-generated']).toBe(0)
    expect(engine.getEventCountsByType()['request-rejected']).toBe(0)
  })

  it('emits canonical lifecycle events for a successful request', () => {
    const topology = makeTopology({
      global: { simulationDuration: 20, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('worker')],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })
    const debugEvents: DebugEvent[] = []
    const engine = new SimulationEngine(topology)
    engine.onDebugEvent = (event) => debugEvents.push(event)

    engine.run()

    const eventStream = engine.getEventStream()
    expect(eventStream.map((event) => event.type)).toEqual([
      'request-generated',
      'request-forwarded',
      'request-arrived',
      'processing-started',
      'processing-completed',
      'request-completed'
    ])
    expect(eventStream.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5])
    expect(eventStream[3].nodeSnapshot).toMatchObject({
      nodeId: 'worker',
      activeWorkers: 1,
      queueLength: 0
    })
    expect(engine.getEventCountsByType()['request-completed']).toBe(1)
    expect(debugEvents.map((event) => event.type)).toEqual(eventStream.map((event) => event.type))
  })

  it('emits queued lifecycle events and admission decisions with node snapshots', () => {
    const worker: ComponentNode = {
      ...makeNode('worker'),
      queue: { workers: 1, capacity: 2, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 10 }, timeout: 1_000 }
    }
    const topology = makeTopology({
      global: { simulationDuration: 2, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), worker],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1_000,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })
    const decisions: AdmissionDecision[] = []
    const engine = new SimulationEngine(topology)
    engine.onAdmissionDecision = (decision) => decisions.push(decision)

    engine.run()

    expect(engine.getEventStream().map((event) => event.type)).toContain('request-queued')
    expect(engine.getEventCountsByType()['request-queued']).toBe(1)
    expect(decisions.map((decision) => decision.decision)).toEqual(['accepted', 'queued'])
    expect(decisions[1].nodeSnapshot).toMatchObject({
      nodeId: 'worker',
      activeWorkers: 1,
      queueLength: 1,
      workers: 1,
      capacity: 2
    })
  })

  it('emits rejection events and admission decisions with terminal node snapshots', () => {
    const worker: ComponentNode = {
      ...makeNode('worker'),
      queue: { workers: 1, capacity: 1, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 10 }, timeout: 1_000 }
    }
    const topology = makeTopology({
      global: { simulationDuration: 3, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), worker],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1_000,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })
    const decisions: AdmissionDecision[] = []
    const engine = new SimulationEngine(topology)
    engine.onAdmissionDecision = (decision) => decisions.push(decision)

    engine.run()

    const rejectedEvent = engine.getEventStream().find((event) => event.type === 'request-rejected')
    expect(rejectedEvent).toMatchObject({
      reasonCode: 'capacity_exceeded',
      nodeSnapshot: {
        nodeId: 'worker',
        activeWorkers: 1,
        queueLength: 0,
        workers: 1,
        capacity: 1
      }
    })
    expect(decisions.some((decision) => decision.decision === 'rejected')).toBe(true)
    expect(engine.getEventCountsByType()['request-rejected']).toBeGreaterThan(0)
  })

  it('records trait decisions and rejects requests when a beforeArrival trait rejects them', () => {
    const rejectAllTrait: NodeBehaviourTrait = {
      name: 'test.reject-all',
      beforeArrival: () => ({ action: 'rejected', reason: 'test_reject' })
    }
    const traitResolver: TraitResolver = (node) => (node.id === 'worker' ? [rejectAllTrait] : [])

    const topology = makeTopology({
      global: { simulationDuration: 20, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('worker')],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology, { resolveTraits: traitResolver }).run()
    const traitEvent = output.eventStream.find((event) => event.type === 'trait-evaluated')

    expect(traitEvent).toMatchObject({
      nodeId: 'worker',
      payload: {
        traitName: 'test.reject-all',
        hook: 'beforeArrival',
        decision: 'rejected',
        reason: 'test_reject'
      }
    })
    expect(traitEvent?.requestId).toMatch(/^req-/)
    expect(output.eventCountsByType['trait-evaluated']).toBe(1)
    expect(output.eventStream.map((event) => event.type)).toEqual([
      'request-generated',
      'request-forwarded',
      'request-arrived',
      'trait-evaluated',
      'request-rejected'
    ])
    expect(output.summary.rejectedRequests).toBe(1)
  })

  it('keeps baseline behavior unchanged when the trait resolver returns no traits', () => {
    const noTraits: TraitResolver = () => []
    const topology = makeTopology({
      global: { simulationDuration: 20, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('worker')],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology, { resolveTraits: noTraits }).run()

    expect(output.eventStream.map((event) => event.type)).toEqual([
      'request-generated',
      'request-forwarded',
      'request-arrived',
      'processing-started',
      'processing-completed',
      'request-completed'
    ])
    expect(output.eventCountsByType['trait-evaluated']).toBe(0)
  })

  it('health-aware routing sends all traffic to healthy targets when enabled', () => {
    const topology = makeTopology({
      global: { simulationDuration: 1_000, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeRouterNode('lb'), makeNode('worker-a'), makeNode('worker-b')],
      edges: [
        makeEdge('source-to-lb', 'source', 'lb'),
        makeEdge('lb-to-a', 'lb', 'worker-a'),
        makeEdge('lb-to-b', 'lb', 'worker-b')
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 4,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })
    const engine = new SimulationEngine(topology)
    const internal = engine as unknown as {
      eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
    }
    internal.eventQueue.insert(createEvent('node-failure', 'worker-b', '', {}, 0n))

    const output = engine.run()
    const arrivalsAtA = output.eventStream.filter(
      (event) => event.type === 'request-arrived' && event.nodeId === 'worker-a'
    ).length
    const arrivalsAtB = output.eventStream.filter(
      (event) => event.type === 'request-arrived' && event.nodeId === 'worker-b'
    ).length

    expect(arrivalsAtA).toBeGreaterThan(0)
    expect(arrivalsAtB).toBe(0)
    expect(
      output.eventStream.some(
        (event) =>
          event.type === 'trait-evaluated' &&
          event.nodeId === 'lb' &&
          event.payload.traitName === 'routing.health-aware'
      )
    ).toBe(true)
    // No Health Check Manager exists in this topology, so health knowledge
    // is instantaneous (the declared simplification) — no probes are run.
    expect(output.eventStream.some((event) => event.type === 'health-probed')).toBe(false)
  })

  it('health-aware routing can be disabled to preserve the old split-and-fail behavior', () => {
    const topology = makeTopology({
      global: { simulationDuration: 1_000, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [
        makeNode('source'),
        makeRouterNode('lb', 'load-balancer', { healthCheckEnabled: false }),
        makeNode('worker-a'),
        makeNode('worker-b')
      ],
      edges: [
        makeEdge('source-to-lb', 'source', 'lb'),
        makeEdge('lb-to-a', 'lb', 'worker-a'),
        makeEdge('lb-to-b', 'lb', 'worker-b')
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 4,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })
    const engine = new SimulationEngine(topology)
    const internal = engine as unknown as {
      eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
    }
    internal.eventQueue.insert(createEvent('node-failure', 'worker-b', '', {}, 0n))

    const output = engine.run()
    const arrivalsAtB = output.eventStream.filter(
      (event) => event.type === 'request-arrived' && event.nodeId === 'worker-b'
    ).length
    const nodeFailedRejections = output.eventStream.filter(
      (event) => event.type === 'request-rejected' && event.reasonCode === 'node_failed'
    ).length

    expect(arrivalsAtB).toBeGreaterThan(0)
    expect(nodeFailedRejections).toBeGreaterThan(0)
  })

  it('health-aware routing rejects when no healthy targets remain', () => {
    const topology = makeTopology({
      global: { simulationDuration: 250, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeRouterNode('lb'), makeNode('worker-a')],
      edges: [makeEdge('source-to-lb', 'source', 'lb'), makeEdge('lb-to-a', 'lb', 'worker-a')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })
    const engine = new SimulationEngine(topology)
    const internal = engine as unknown as {
      eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
    }
    internal.eventQueue.insert(createEvent('node-failure', 'worker-a', '', {}, 0n))

    const output = engine.run()

    expect(output.eventStream).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'request-rejected',
          nodeId: 'lb',
          reasonCode: 'no_healthy_targets'
        })
      ])
    )
  })

  it('health prober keeps routing to a failed target until detection, then shifts traffic', () => {
    const checkIntervalMs = 10
    const unhealthyThreshold = 2
    const detectionWindowUs = msToMicro(checkIntervalMs * unhealthyThreshold)

    const topology = makeTopology({
      global: {
        simulationDuration: 200,
        defaultTimeout: 1_000,
        traceSampleRate: 1,
        seed: 'prober-seed'
      },
      nodes: [
        makeNode('source'),
        makeRouterNode('lb'),
        makeNode('worker-a'),
        makeNode('worker-b'),
        makeHealthCheckManagerNode('health-manager', {
          monitoredNodes: ['worker-b'],
          checkIntervalMs,
          unhealthyThreshold,
          healthyThreshold: 2
        })
      ],
      edges: [
        makeEdge('source-to-lb', 'source', 'lb'),
        makeEdge('lb-to-a', 'lb', 'worker-a'),
        makeEdge('lb-to-b', 'lb', 'worker-b')
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 200,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })
    const engine = new SimulationEngine(topology)
    const internal = engine as unknown as {
      eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
    }
    internal.eventQueue.insert(createEvent('node-failure', 'worker-b', '', {}, 0n))

    const output = engine.run()

    const arrivalsAtBBeforeDetection = output.eventStream.filter(
      (event) =>
        event.type === 'request-arrived' &&
        event.nodeId === 'worker-b' &&
        BigInt(event.timestampUs) < detectionWindowUs
    ).length
    const arrivalsAtBAfterDetection = output.eventStream.filter(
      (event) =>
        event.type === 'request-arrived' &&
        event.nodeId === 'worker-b' &&
        BigInt(event.timestampUs) >= detectionWindowUs
    ).length

    expect(arrivalsAtBBeforeDetection).toBeGreaterThan(0)
    expect(arrivalsAtBAfterDetection).toBe(0)

    const probeEvents = output.eventStream.filter(
      (event) => event.type === 'health-probed' && event.nodeId === 'worker-b'
    )
    expect(probeEvents.length).toBeGreaterThan(0)
    expect(probeEvents[0]).toMatchObject({
      sourceNodeId: 'health-manager',
      payload: expect.objectContaining({ actualHealthy: false })
    })
    expect(probeEvents.at(-1)).toMatchObject({
      payload: expect.objectContaining({ probedHealthy: false })
    })
  })

  it('a gateway rate-limited to 50 rps under a 100 rps workload rejects roughly half the traffic', () => {
    const topology = makeTopology({
      global: {
        simulationDuration: 5_000,
        defaultTimeout: 1_000,
        traceSampleRate: 0,
        seed: 'rate-limiter-seed'
      },
      nodes: [
        makeNode('source'),
        makeRouterNode('gw', 'api-gateway', { maxTokens: 50, refillRatePerSecond: 50 }),
        makeNode('backend')
      ],
      edges: [makeEdge('source-gw', 'source', 'gw'), makeEdge('gw-backend', 'gw', 'backend')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()

    const generated = output.eventStream.filter(
      (event) => event.type === 'request-generated'
    ).length
    const rateLimited = output.eventStream.filter(
      (event) => event.type === 'request-rejected' && event.reasonCode === 'rate_limited'
    ).length

    expect(generated).toBeGreaterThan(0)
    const rejectionRatio = rateLimited / generated
    expect(rejectionRatio).toBeGreaterThan(0.35)
    expect(rejectionRatio).toBeLessThan(0.65)

    // rate_limited must stay distinguishable from other rejection reasons.
    const capacityExceeded = output.eventStream.filter(
      (event) => event.type === 'request-rejected' && event.reasonCode === 'capacity_exceeded'
    ).length
    expect(rateLimited).toBeGreaterThan(0)
    expect(capacityExceeded).toBe(0)
  })

  it('a Primary DB samples per-request-type latency: reads and writes see distinct, bimodal service times', () => {
    const readLatency = { type: 'constant' as const, value: 4 }
    const writeLatency = { type: 'constant' as const, value: 10 }

    const makeDbTopology = (requestType: string) =>
      makeTopology({
        global: {
          simulationDuration: 500,
          defaultTimeout: 1_000,
          traceSampleRate: 0,
          seed: 'rw-split-seed'
        },
        nodes: [
          makeNode('source'),
          {
            ...makeNode('db'),
            type: 'relational-db',
            category: 'storage-and-data',
            role: 'storage',
            config: { replicationRole: 'primary', readLatency, writeLatency }
          }
        ],
        edges: [makeEdge('source-db', 'source', 'db')],
        workload: {
          sourceNodeId: 'source',
          pattern: 'constant',
          baseRps: 20,
          requestDistribution: [{ type: requestType, weight: 1, sizeBytes: 100 }]
        }
      })

    const readOutput = new SimulationEngine(makeDbTopology('read')).run()
    const writeOutput = new SimulationEngine(makeDbTopology('write')).run()

    expect(readOutput.perNode.db.avgServiceTime).toBeCloseTo(4, 6)
    expect(writeOutput.perNode.db.avgServiceTime).toBeCloseTo(10, 6)
    expect(writeOutput.perNode.db.avgServiceTime).toBeGreaterThan(
      readOutput.perNode.db.avgServiceTime
    )
  })

  it('a Read Replica rejects writes with read_only_node while reads succeed', () => {
    const topology = makeTopology({
      global: {
        simulationDuration: 500,
        defaultTimeout: 1_000,
        traceSampleRate: 0,
        seed: 'read-only-seed'
      },
      nodes: [
        makeNode('source'),
        {
          ...makeNode('replica'),
          type: 'relational-db',
          category: 'storage-and-data',
          role: 'storage',
          config: { replicationRole: 'replica' }
        }
      ],
      edges: [makeEdge('source-replica', 'source', 'replica')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 20,
        requestDistribution: [
          { type: 'read', weight: 0.5, sizeBytes: 100 },
          { type: 'write', weight: 0.5, sizeBytes: 100 }
        ]
      }
    })

    const output = new SimulationEngine(topology).run()

    const readOnlyRejections = output.eventStream.filter(
      (event) => event.type === 'request-rejected' && event.reasonCode === 'read_only_node'
    ) as Array<{ payload: { request?: { type?: string } } }>

    expect(readOnlyRejections.length).toBeGreaterThan(0)
    expect(readOnlyRejections.every((event) => event.payload.request?.type === 'write')).toBe(true)
    expect(output.perNode.replica.totalProcessed).toBeGreaterThan(0)
    expect(output.perNode.replica.totalRejected).toBe(readOnlyRejections.length)
  })

  it('a Message Queue acks the producer at enqueue time while consumer processing lags independently', () => {
    const topology = makeTopology({
      global: {
        simulationDuration: 2_000,
        defaultTimeout: 30_000,
        traceSampleRate: 0,
        seed: 'ack-release-seed'
      },
      nodes: [
        makeNode('source'),
        {
          id: 'queue',
          type: 'queue',
          category: 'messaging-and-streaming',
          role: 'processor',
          label: 'queue',
          position: { x: 0, y: 0 },
          queue: { workers: 1, capacity: 1_000, discipline: 'fifo' },
          processing: { distribution: { type: 'constant', value: 50 }, timeout: 30_000 }
        }
      ],
      edges: [makeEdge('source-queue', 'source', 'queue')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 40,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()

    const generatedAtByRequestId = new Map<string, bigint>()
    for (const event of output.eventStream) {
      if (
        event.type === 'request-generated' &&
        event.requestId &&
        !event.requestId.includes('::branch-')
      ) {
        generatedAtByRequestId.set(event.requestId, BigInt(event.timestampUs))
      }
    }

    const producerLatenciesUs: bigint[] = []
    for (const event of output.eventStream) {
      if (
        event.type === 'request-completed' &&
        event.requestId &&
        !event.requestId.includes('::branch-')
      ) {
        const generatedAt = generatedAtByRequestId.get(event.requestId)
        if (generatedAt !== undefined) {
          producerLatenciesUs.push(BigInt(event.timestampUs) - generatedAt)
        }
      }
    }

    expect(producerLatenciesUs.length).toBeGreaterThan(0)
    // Ack is immediate (0us service time) — producer latency should be
    // microseconds, nowhere near the consumer's 50ms processing time.
    expect(producerLatenciesUs.every((latency) => latency < 1_000n)).toBe(true)

    // Consumers fall behind (40 rps against a 1-worker/50ms-per-message
    // queue) so backlog visibly grows instead of every message completing
    // immediately.
    expect(output.perNode.queue.peakQueueLength).toBeGreaterThan(5)
  })

  it("deleting an observability branch does not change the real downstream node's traffic or latency", () => {
    const buildTopology = (withMetrics: boolean) =>
      makeTopology({
        global: {
          simulationDuration: 1_000,
          defaultTimeout: 1_000,
          traceSampleRate: 0,
          seed: 'async-only-seed'
        },
        nodes: [
          makeNode('source'),
          makeNode('svc'),
          makeNode('api'),
          ...(withMetrics
            ? [
                {
                  ...makeNode('metrics'),
                  type: 'metrics-store' as const,
                  category: 'observability' as const,
                  role: 'sink' as const
                }
              ]
            : [])
        ],
        edges: [
          makeEdge('source-svc', 'source', 'svc'),
          // Misconfigured as synchronous on purpose — AsyncOnlyTrait must
          // still force it async so it can't steal traffic from 'api'.
          makeEdge('svc-api', 'svc', 'api', { mode: 'synchronous' }),
          ...(withMetrics
            ? [makeEdge('svc-metrics', 'svc', 'metrics', { mode: 'synchronous' })]
            : [])
        ],
        workload: {
          sourceNodeId: 'source',
          pattern: 'constant',
          baseRps: 20,
          requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
        }
      })

    const withMetricsOutput = new SimulationEngine(buildTopology(true)).run()
    const withoutMetricsOutput = new SimulationEngine(buildTopology(false)).run()

    expect(withMetricsOutput.perNode.api.totalArrived).toBe(
      withoutMetricsOutput.perNode.api.totalArrived
    )
    expect(withMetricsOutput.perNode.api.avgServiceTime).toBeCloseTo(
      withoutMetricsOutput.perNode.api.avgServiceTime,
      6
    )
    expect(withMetricsOutput.perNode.metrics?.totalArrived).toBe(
      withMetricsOutput.perNode.api.totalArrived
    )
  })

  it('cache hits reduce downstream arrivals to roughly the miss rate', () => {
    const topology = makeTopology({
      global: {
        simulationDuration: 1_000,
        defaultTimeout: 1_000,
        traceSampleRate: 1,
        seed: 'cache-seed'
      },
      nodes: [
        makeNode('source'),
        makeCacheNode('cache', 'in-memory-cache', { cacheHitRate: 0.9, cacheHitLatencyMs: 0.1 }),
        makeNode('db')
      ],
      edges: [makeEdge('source-cache', 'source', 'cache'), makeEdge('cache-db', 'cache', 'db')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()
    const cacheArrivals = output.perNode.cache.totalArrived
    const dbArrivals = output.perNode.db.totalArrived

    expect(cacheArrivals).toBeGreaterThan(0)
    expect(dbArrivals / cacheArrivals).toBeGreaterThan(0.05)
    expect(dbArrivals / cacheArrivals).toBeLessThan(0.2)
    expect(output.perNode.cache.cacheHits).toBeGreaterThan(output.perNode.cache.cacheMisses)
  })

  it('cache-hit completions use cache hit latency instead of queue service time', () => {
    const topology = makeTopology({
      global: {
        simulationDuration: 50,
        defaultTimeout: 1_000,
        traceSampleRate: 1,
        seed: 'cache-hit-latency'
      },
      nodes: [
        makeNode('source'),
        makeCacheNode('cache', 'in-memory-cache', { cacheHitRate: 1, cacheHitLatencyMs: 2.5 }),
        makeNode('db')
      ],
      edges: [makeEdge('source-cache', 'source', 'cache'), makeEdge('cache-db', 'cache', 'db')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()

    expect(output.perNode.cache.avgServiceTime).toBeCloseTo(2.5, 6)
    expect(output.perNode.db.totalArrived).toBe(0)
    expect(output.traces[0]?.spans[0]?.nodeId).toBe('cache')
  })

  it('cacheHitRate 0 preserves pass-through behavior', () => {
    const topology = makeTopology({
      global: {
        simulationDuration: 500,
        defaultTimeout: 1_000,
        traceSampleRate: 1,
        seed: 'cache-pass-through'
      },
      nodes: [
        makeNode('source'),
        makeCacheNode('cache', 'in-memory-cache', { cacheHitRate: 0, cacheHitLatencyMs: 0.1 }),
        makeNode('db')
      ],
      edges: [makeEdge('source-cache', 'source', 'cache'), makeEdge('cache-db', 'cache', 'db')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 10,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()

    expect(output.perNode.db.totalArrived).toBe(output.perNode.cache.totalArrived)
    expect(output.perNode.cache.cacheHits).toBe(0)
    expect(output.perNode.cache.cacheMisses).toBe(output.perNode.cache.totalArrived)
  })

  it('cache-served completions keep conservation balanced at the cache node', () => {
    const topology = makeTopology({
      global: {
        simulationDuration: 500,
        defaultTimeout: 1_000,
        traceSampleRate: 1,
        seed: 'cache-conservation'
      },
      nodes: [
        makeNode('source'),
        makeCacheNode('cache', 'in-memory-cache', { cacheHitRate: 1, cacheHitLatencyMs: 0.1 }),
        makeNode('db')
      ],
      edges: [makeEdge('source-cache', 'source', 'cache'), makeEdge('cache-db', 'cache', 'db')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 10,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()
    const cacheConservation = output.conservationCheck.find((entry) => entry.nodeId === 'cache')

    expect(cacheConservation).toMatchObject({
      balanced: true,
      inFlight: 0
    })
  })

  it('emits node failure and recovery events with snapshots', () => {
    const topology = makeTopology({ workload: undefined })
    const engine = new SimulationEngine(topology)
    const internal = engine as unknown as {
      eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
    }
    internal.eventQueue.insert(createEvent('node-failure', 'node-a', '', {}, 0n))
    internal.eventQueue.insert(createEvent('node-recovery', 'node-a', '', {}, 1n))

    engine.run()

    expect(engine.getEventStream()).toMatchObject([
      { type: 'node-failed', nodeId: 'node-a', nodeSnapshot: { status: 'failed' } },
      { type: 'node-recovered', nodeId: 'node-a', nodeSnapshot: { status: 'idle' } }
    ])
  })

  it('does not drop out-of-window events and reports no pending in-window events', () => {
    const topology = makeTopology({ workload: undefined })
    const engine = new SimulationEngine(topology)
    const futureEvent = createEvent('node-failure', 'node-a', '', {}, msToMicro(500))

    const internal = engine as unknown as {
      eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void; size: number }
    }
    internal.eventQueue.insert(futureEvent)

    expect(engine.hasPendingEvents()).toBe(false)

    engine.step(1)

    expect(engine.getEventsProcessed()).toBe(0)
    expect(internal.eventQueue.size).toBe(1)
    expect(engine.hasPendingEvents()).toBe(false)
  })

  it('records spans and traces from node processing', () => {
    const topology = makeTopology({
      global: { simulationDuration: 20, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('worker')],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()

    expect(output.summary.successfulRequests).toBe(1)
    expect(output.eventStream.map((event) => event.type)).toEqual([
      'request-generated',
      'request-forwarded',
      'request-arrived',
      'processing-started',
      'processing-completed',
      'request-completed'
    ])
    expect(output.eventCountsByType['request-completed']).toBe(1)
    expect(output.perNode.worker.totalProcessed).toBe(1)
    expect(output.traces).toHaveLength(1)
    expect(output.traces[0].spans).toHaveLength(1)
    expect(output.traces[0].spans[0].nodeId).toBe('worker')
  })

  it('captures a canonical debug event log when debug mode is enabled', () => {
    const topology = makeTopology({
      global: { simulationDuration: 20, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('worker')],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const engine = new SimulationEngine(topology)
    engine.enableDebug('all')

    const output = engine.run()
    expect(output.eventLog).not.toBeNull()
    expect(output.eventLog?.map((event) => event.type)).toEqual([
      'request-generated',
      'request-forwarded',
      'request-arrived',
      'processing-started',
      'processing-completed',
      'request-completed'
    ])
    expect(output.eventLog?.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5])
    expect(output.eventLog?.[0].requestId).toBe('req-000001')
    expect(output.eventLog?.[1].edgeId).toBe('source-to-worker')
    expect(output.eventLog?.[3].nodeSnapshot?.activeWorkers).toBe(1)
    expect(output.debuggedLifecycle).toBeNull()
  })

  it('assembles a focused request lifecycle when debugging a specific request', () => {
    const topology = makeTopology({
      global: { simulationDuration: 20, defaultTimeout: 1_000, traceSampleRate: 0 },
      nodes: [makeNode('source'), makeNode('worker')],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const engine = new SimulationEngine(topology)
    engine.enableDebug('req-000001', { forceTrace: true })

    const output = engine.run()
    expect(output.eventLog?.every((event) => event.requestId === 'req-000001')).toBe(true)
    expect(output.debuggedLifecycle).not.toBeNull()
    expect(output.debuggedLifecycle?.requestId).toBe('req-000001')
    expect(output.debuggedLifecycle?.status).toBe('success')
    expect(output.debuggedLifecycle?.path).toEqual(['worker'])
    expect(output.debuggedLifecycle?.events.map((event) => event.type)).toEqual([
      'request-generated',
      'request-forwarded',
      'request-arrived',
      'processing-started',
      'processing-completed',
      'request-completed'
    ])
    expect(output.debuggedLifecycle?.startedAtMs).toBeGreaterThanOrEqual(0)
    expect(output.debuggedLifecycle?.completedAtMs).toBeGreaterThanOrEqual(
      output.debuggedLifecycle?.startedAtMs ?? 0
    )
  })

  it('keeps udp packet-loss timeouts deferred to the request deadline', () => {
    const topology = makeTopology({
      global: { simulationDuration: 100, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('mid'), makeNode('dst')],
      edges: [
        makeEdge('source-to-mid', 'source', 'mid'),
        makeEdge('mid-to-dst', 'mid', 'dst', { protocol: 'udp', packetLossRate: 1 })
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const engine = new SimulationEngine(topology)
    const output = engine.run()

    expect(engine.getEventsProcessed()).toBeGreaterThan(0)
    expect(engine.hasPendingEvents()).toBe(false)
    expect(output.summary.totalRequests).toBe(0)
    expect(output.summary.timedOutRequests).toBe(0)
  })

  it('retransmits reliable edges instead of dropping on packet loss', () => {
    const topology = makeTopology({
      global: { simulationDuration: 50, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('dst')],
      edges: [
        makeEdge('source-to-dst', 'source', 'dst', {
          protocol: 'tcp',
          packetLossRate: 1,
          latency: { distribution: { type: 'constant', value: 5 }, pathType: 'same-dc' }
        })
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()
    const arrivalEvent = output.eventStream.find((event) => event.type === 'request-arrived')

    expect(output.summary.successfulRequests).toBe(1)
    expect(output.summary.rejectedRequests).toBe(0)
    expect(output.summary.timedOutRequests).toBe(0)
    expect(arrivalEvent?.edgeId).toBe('source-to-dst')
    expect(Number(arrivalEvent?.timestampUs)).toBeGreaterThan(10_000)
    expect(Number(arrivalEvent?.timestampUs)).toBeLessThan(10_100)
  })

  it('uses path-type-derived latency profiles when the edge is still on defaults', () => {
    const makeDerivedEdge = (id: string, pathType: EdgeDefinition['latency']['pathType']) =>
      makeEdge(id, 'source', 'dst', {
        latency: {
          distribution: { type: 'constant', value: 0 },
          pathType,
          derivedFromPathType: true
        }
      })

    const sameRackOutput = new SimulationEngine(
      makeTopology({
        global: {
          simulationDuration: 500,
          defaultTimeout: 5_000,
          traceSampleRate: 1,
          seed: 'same-seed'
        },
        nodes: [makeNode('source'), makeNode('dst')],
        edges: [makeDerivedEdge('same-rack-edge', 'same-rack')],
        workload: {
          sourceNodeId: 'source',
          pattern: 'constant',
          baseRps: 1,
          requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
        }
      })
    ).run()

    const crossRegionOutput = new SimulationEngine(
      makeTopology({
        global: {
          simulationDuration: 500,
          defaultTimeout: 5_000,
          traceSampleRate: 1,
          seed: 'same-seed'
        },
        nodes: [makeNode('source'), makeNode('dst')],
        edges: [makeDerivedEdge('cross-region-edge', 'cross-region')],
        workload: {
          sourceNodeId: 'source',
          pattern: 'constant',
          baseRps: 1,
          requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
        }
      })
    ).run()

    const sameRackArrival = Number(
      sameRackOutput.eventStream.find((event) => event.type === 'request-arrived')?.timestampUs
    )
    const crossRegionArrival = Number(
      crossRegionOutput.eventStream.find((event) => event.type === 'request-arrived')?.timestampUs
    )

    expect(crossRegionArrival).toBeGreaterThan(sameRackArrival)
  })

  it('forks requests on async fan-out so each branch has a distinct request id', () => {
    const topology = makeTopology({
      global: { simulationDuration: 20, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('a'), makeNode('b')],
      edges: [
        makeEdge('source-to-a', 'source', 'a', { mode: 'asynchronous' }),
        makeEdge('source-to-b', 'source', 'b', { mode: 'asynchronous' })
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()
    const traceIds = output.traces.map((trace) => trace.requestId)

    expect(output.summary.successfulRequests).toBe(2)
    expect(output.traces).toHaveLength(2)
    expect(new Set(traceIds).size).toBe(2)
    expect(output.perNode.a.totalProcessed).toBe(1)
    expect(output.perNode.b.totalProcessed).toBe(1)
  })

  it('times out a request when node processing exceeds the authored node timeout', () => {
    const slowWorker: ComponentNode = {
      ...makeNode('slow-worker'),
      processing: { distribution: { type: 'constant', value: 50 }, timeout: 1 }
    }

    const topology = makeTopology({
      global: { simulationDuration: 100, defaultTimeout: 30_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), slowWorker],
      edges: [makeEdge('source-to-worker', 'source', 'slow-worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()

    expect(output.summary.successfulRequests).toBe(0)
    expect(output.summary.timedOutRequests).toBe(1)
    expect(output.eventCountsByType['request-timed-out']).toBe(1)
    expect(output.eventCountsByType['request-completed']).toBe(0)
    expect(output.perNode['slow-worker'].postWarmupTimedOut).toBe(1)
  })

  it('step(1) processes exactly one scheduler event and matches the first full-run state', () => {
    const topology = makeTopology({
      global: { simulationDuration: 20, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('worker')],
      edges: [makeEdge('source-to-worker', 'source', 'worker')],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const stepped = new SimulationEngine(topology)
    stepped.step(1)

    const full = new SimulationEngine(topology)
    full.step(1)

    expect(stepped.getEventsProcessed()).toBe(1)
    expect(stepped.getEventStream()).toEqual(full.getEventStream())
  })

  it('rejects a request when an edge hits its configured error rate', () => {
    const topology = makeTopology({
      global: { simulationDuration: 20, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('dst')],
      edges: [makeEdge('source-to-dst', 'source', 'dst', { errorRate: 1 })],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()

    expect(output.summary.successfulRequests).toBe(0)
    expect(output.summary.rejectedRequests).toBe(1)
    expect(output.eventStream.find((event) => event.type === 'request-rejected')).toMatchObject({
      edgeId: 'source-to-dst',
      sourceNodeId: 'source',
      targetNodeId: 'dst',
      reasonCode: 'edge_error_rate'
    })
  })

  it('enforces maxConcurrentRequests as a connection limit on edges', () => {
    const topology = makeTopology({
      global: { simulationDuration: 100, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('dst')],
      edges: [
        makeEdge('source-to-dst', 'source', 'dst', {
          maxConcurrentRequests: 1,
          latency: { distribution: { type: 'constant', value: 50 }, pathType: 'same-dc' }
        })
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    })

    const output = new SimulationEngine(topology).run()
    const rejectionReasons = output.eventStream
      .filter((event) => event.type === 'request-rejected')
      .map((event) => event.reasonCode)

    expect(rejectionReasons).toContain('connection_refused')
  })

  it('adds transmission latency from edge bandwidth', () => {
    const topology = makeTopology({
      global: { simulationDuration: 300, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('dst')],
      edges: [
        makeEdge('source-to-dst', 'source', 'dst', {
          bandwidth: 1,
          latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' }
        })
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 1,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 12_500 }]
      }
    })

    const output = new SimulationEngine(topology).run()
    const arrivalEvent = output.eventStream.find((event) => event.type === 'request-arrived')

    expect(Number(arrivalEvent?.timestampUs)).toBe(100_200)
  })
})
