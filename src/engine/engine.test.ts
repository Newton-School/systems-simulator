import { describe, expect, it } from 'vitest'
import { createEvent } from './core/events'
import { msToMicro } from './core/time'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'
import type { AdmissionDecision, DebugEvent } from './core/event-stream'
import { SimulationEngine } from './engine'

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
      'request-arrived',
      'processing-started',
      'processing-completed',
      'request-completed',
      'request-forwarded'
    ])
    expect(output.debuggedLifecycle?.startedAtMs).toBeGreaterThanOrEqual(0)
    expect(output.debuggedLifecycle?.completedAtMs).toBeGreaterThanOrEqual(
      output.debuggedLifecycle?.startedAtMs ?? 0
    )
  })

  it('schedules packet-loss timeout at request deadline, not immediately', () => {
    const topology = makeTopology({
      global: { simulationDuration: 100, defaultTimeout: 1_000, traceSampleRate: 1 },
      nodes: [makeNode('source'), makeNode('mid'), makeNode('dst')],
      edges: [
        makeEdge('source-to-mid', 'source', 'mid'),
        makeEdge('mid-to-dst', 'mid', 'dst', { packetLossRate: 1 })
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
})
