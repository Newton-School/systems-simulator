import { describe, expect, it } from 'vitest'
import { CausalGraphRecorder, failureEffectLabel } from './causalGraph'
import { createEvent } from '../core/events'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import { SimulationEngine } from '../engine'

const chain = [
  { source: 'client', target: 'gw' },
  { source: 'gw', target: 'api' },
  { source: 'api', target: 'db' }
]

describe('CausalGraphRecorder', () => {
  it('returns an empty graph when nothing failed', () => {
    const graph = new CausalGraphRecorder().build(chain)
    expect(graph.rootCauses).toEqual([])
    expect(graph.propagation).toEqual([])
    expect(graph.impactSummary).toEqual({
      totalNodesAffected: 0,
      cascadeDepth: 0,
      timeToFullCascade: 0
    })
    expect(graph.nodes).toEqual([])
  })

  it('links callers to the dependency that failed first and measures the cascade', () => {
    const recorder = new CausalGraphRecorder()
    recorder.recordFault('db', 'hang', 12_000)
    recorder.recordSignal('db', 'timeout', null, 12_250)
    recorder.recordSignal('api', 'timeout', null, 12_500)
    recorder.recordSignal('api', 'timeout', null, 12_600)
    recorder.recordSignal('gw', 'rejected', 'queue_full', 14_000)

    const graph = recorder.build(chain)
    expect(graph.rootCauses).toEqual([{ nodeId: 'db', event: 'hang', time: 12_000 }])
    expect(graph.propagation).toEqual([
      { from: 'db', to: 'api', effect: 'timeout_cascade', time: 12_500 },
      { from: 'api', to: 'gw', effect: 'queue_saturation', time: 14_000 }
    ])
    expect(graph.impactSummary).toEqual({
      totalNodesAffected: 3,
      cascadeDepth: 2,
      timeToFullCascade: 2_000
    })
    expect(graph.nodes?.map((node) => [node.nodeId, node.severity, node.timedOut])).toEqual([
      ['db', 'failed', 1],
      ['api', 'degraded', 2],
      ['gw', 'degraded', 0]
    ])
  })

  it('does not blame a dependency that started failing later', () => {
    const recorder = new CausalGraphRecorder()
    recorder.recordSignal('api', 'rejected', 'queue_full', 1_000)
    recorder.recordFault('db', 'reject', 5_000)

    const graph = recorder.build(chain)
    expect(graph.rootCauses.map((root) => root.nodeId)).toEqual(['api', 'db'])
    expect(graph.propagation).toEqual([])
  })

  it('looks through pass-through nodes that showed no failures', () => {
    const recorder = new CausalGraphRecorder()
    recorder.recordFault('db', 'reject', 100)
    recorder.recordSignal('gw', 'circuit-open', null, 300)

    const graph = recorder.build(chain)
    expect(graph.propagation).toEqual([{ from: 'db', to: 'gw', effect: 'circuit_open', time: 300 }])
    expect(graph.impactSummary.cascadeDepth).toBe(1)
  })

  it('keeps independent root causes as separate trees', () => {
    const recorder = new CausalGraphRecorder()
    const edges = [
      { source: 'web', target: 'cache' },
      { source: 'worker', target: 'queue' }
    ]
    recorder.recordFault('cache', 'reject', 10)
    recorder.recordSignal('web', 'rejected', 'node_failed', 20)
    recorder.recordFault('queue', 'blackhole', 30)
    recorder.recordSignal('worker', 'timeout', null, 40)

    const graph = recorder.build(edges)
    expect(graph.rootCauses.map((root) => root.nodeId)).toEqual(['cache', 'queue'])
    expect(graph.propagation.map((step) => `${step.from}->${step.to}`)).toEqual([
      'cache->web',
      'queue->worker'
    ])
  })

  it('never treats an injected fault as caused by a neighbour', () => {
    const recorder = new CausalGraphRecorder()
    recorder.recordFault('db', 'reject', 100)
    recorder.recordFault('api', 'reject', 200)

    const graph = recorder.build(chain)
    expect(graph.rootCauses.map((root) => root.nodeId)).toEqual(['db', 'api'])
    expect(graph.propagation).toEqual([])
  })

  it('reads faults and signals from canonical events', () => {
    const recorder = new CausalGraphRecorder()
    recorder.observe({
      type: 'node-failed',
      timestampUs: 2_000_000n,
      priority: 0,
      nodeId: 'db',
      payload: { failureSpec: { mode: 'hang' } }
    })
    recorder.observe({
      type: 'request-rejected',
      timestampUs: '2500000',
      priority: 0,
      nodeId: 'api',
      reasonCode: 'rate_limited'
    })
    recorder.observe({ type: 'request-completed', timestampUs: 1, priority: 0, nodeId: 'gw' })

    const graph = recorder.build(chain)
    expect(graph.rootCauses).toEqual([{ nodeId: 'db', event: 'hang', time: 2_000 }])
    expect(graph.propagation).toEqual([
      { from: 'db', to: 'api', effect: 'rate_limited', time: 2_500 }
    ])
    expect(graph.nodes?.find((node) => node.nodeId === 'api')?.dominantReason).toBe('rate_limited')
  })
})

describe('failureEffectLabel', () => {
  it('maps signal kinds to cascade effect labels', () => {
    expect(failureEffectLabel('timeout', null)).toBe('timeout_cascade')
    expect(failureEffectLabel('circuit-open', null)).toBe('circuit_open')
    expect(failureEffectLabel('rejected', 'queue_full')).toBe('queue_saturation')
    expect(failureEffectLabel('rejected', 'connection_reset')).toBe('connection_reset')
  })
})

function server(id: string): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 24, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 8 }, timeout: 250 }
  }
}

function link(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}-${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 10_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

describe('engine causal graph', () => {
  function run(withFault: boolean) {
    const topology: TopologyJSON = {
      id: 'causal-graph-test',
      name: 'causal-graph',
      version: '1.0.0',
      global: {
        simulationDuration: 2_000,
        seed: 'causal-seed',
        warmupDuration: 0,
        timeResolution: 'microsecond',
        defaultTimeout: 1_000,
        traceSampleRate: 0
      },
      nodes: [
        {
          id: 'client',
          type: 'api-endpoint',
          category: 'compute',
          role: 'source',
          label: 'client',
          position: { x: 0, y: 0 }
        },
        server('api'),
        server('db')
      ],
      edges: [link('client', 'api'), link('api', 'db')],
      workload: {
        sourceNodeId: 'client',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
      }
    }
    const engine = new SimulationEngine(topology)
    if (withFault) {
      const internal = engine as unknown as {
        eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
      }
      internal.eventQueue.insert(
        createEvent(
          'node-failure',
          'db',
          '',
          { failureSpec: { mode: 'reject', inFlightPolicy: 'reset', recoveryPolicy: 'reset' } },
          500_000n
        )
      )
    }
    return engine.run()
  }

  it('reports an empty (not missing) cascade for a healthy run', () => {
    const output = run(false)
    expect(output.causalGraph).not.toBeNull()
    expect(output.causalGraph?.rootCauses).toEqual([])
  })

  it('reports an injected fault as the root cause with its rejections', () => {
    const output = run(true)
    expect(output.causalGraph?.rootCauses).toEqual([{ nodeId: 'db', event: 'reject', time: 500 }])
    const db = output.causalGraph?.nodes?.find((node) => node.nodeId === 'db')
    expect(db?.severity).toBe('failed')
    expect(db?.rejected).toBeGreaterThan(0)
  })
})
