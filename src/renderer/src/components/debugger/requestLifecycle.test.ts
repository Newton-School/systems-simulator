import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../../../../engine/core/types'
import { SimulationEngine } from '../../../../engine/engine'
import type { RequestTrace } from '../../../../engine/tracer'
import { explainAdmission } from './admissionExplainer'
import {
  buildExpectedPath,
  buildRequestLifecycle,
  diffPaths,
  initialStepIndex,
  stepForPhase
} from './requestLifecycle'

function node(id: string, overrides: Partial<ComponentNode> = {}): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
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
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 1000,
    packetLossRate: 0,
    errorRate: 0
  }
}

/** source -> api -> db, with a db small enough that 1000 rps overloads it. */
function runOverloadedDb(dbOverrides: Partial<ComponentNode> = {}): RequestTrace[] {
  const topology: TopologyJSON = {
    id: 't',
    name: 'overloaded-db',
    version: '1.0.0',
    global: {
      simulationDuration: 200,
      seed: 'lifecycle',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000,
      traceSampleRate: 1
    },
    nodes: [
      node('source'),
      node('api'),
      node('db', {
        queue: { workers: 2, capacity: 4, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 20 }, timeout: 1_000 },
        ...dbOverrides
      })
    ],
    edges: [edge('source-api', 'source', 'api'), edge('api-db', 'api', 'db')],
    workload: {
      sourceNodeId: 'source',
      pattern: 'constant',
      baseRps: 1_000,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  }
  return new SimulationEngine(topology).run().traces
}

describe('buildRequestLifecycle', () => {
  const traces = runOverloadedDb()

  it('walks a successful request through every state in order', () => {
    const trace = traces.find((candidate) => candidate.status === 'success')!
    const lifecycle = buildRequestLifecycle(trace)!
    expect(lifecycle.status).toBe('success')
    expect(lifecycle.actualPath).toEqual(['source', 'api', 'db'])
    expect(lifecycle.actualEdgeIds).toEqual(['source-api', 'api-db'])
    expect(lifecycle.steps.map((step) => step.state)).toEqual([
      'generated',
      'in-flight',
      'arrived',
      'processing',
      'routing',
      'in-flight',
      'arrived',
      'processing',
      'completed'
    ])
    // Steps are chronological and the phases cover them.
    const times = lifecycle.steps.map((step) => step.atMs)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(lifecycle.phases.map((phase) => phase.result)).toEqual([
      'generated',
      'passed',
      'completed'
    ])
    expect(lifecycle.failureStepIndex).toBeNull()
    expect(initialStepIndex(lifecycle)).toBe(0)
  })

  it('ends a rejected request at the rejecting node with the raw reason', () => {
    const trace = traces.find((candidate) => candidate.status === 'rejected')!
    const lifecycle = buildRequestLifecycle(trace)!
    expect(lifecycle.status).toBe('rejected')
    const last = lifecycle.steps[lifecycle.steps.length - 1]
    expect(last).toMatchObject({ state: 'rejected', nodeId: 'db', failed: true })
    expect(lifecycle.terminal).toMatchObject({ locus: 'db', reasonCode: 'capacity_exceeded' })
    expect(initialStepIndex(lifecycle)).toBe(last.index)
    const dbPhase = lifecycle.phases[2]
    expect(dbPhase.result).toBe('rejected')
    expect(dbPhase.queueMs).toBe(0)
    expect(dbPhase.serviceMs).toBeNull()
    expect(lifecycle.steps[stepForPhase(lifecycle, 2)].state).toBe('arrived')
  })

  it('shows a queued step when the request waited for a worker', () => {
    const queued = traces
      .map((trace) => buildRequestLifecycle(trace)!)
      .find((lifecycle) => lifecycle.steps.some((step) => step.state === 'queued'))!
    const states = queued.steps.map((step) => step.state)
    expect(states.indexOf('queued')).toBeLessThan(states.lastIndexOf('processing'))
    const dbPhase = queued.phases.find((phase) => phase.nodeId === 'db')!
    expect(dbPhase.queueMs).toBeGreaterThan(0)
  })
})

describe('explainAdmission', () => {
  const traces = runOverloadedDb()

  it('substitutes the recorded G/G/c/K counters into the capacity rule', () => {
    const lifecycle = buildRequestLifecycle(traces.find((t) => t.status === 'rejected')!)!
    const lens = explainAdmission(lifecycle.phases[2], lifecycle.terminal, true)
    expect(lens.rule).toBe('capacity')
    expect(lens.outcome).toBe('rejected')
    expect(lens.equation).toEqual({
      expression: 'active + queued >= K',
      substituted: '2 + 2 = 4 >= 4',
      holds: true
    })
    expect(lens.gauges.map((gauge) => gauge.text)).toEqual(['2 / 2', '2 / 2', '4 / 4'])
    expect(lens.slots).toMatchObject({ capacity: 4, active: 2, queued: 2, arrivingInside: false })
  })

  it('explains an admitted arrival with the rule that let it in', () => {
    const lifecycle = buildRequestLifecycle(traces.find((t) => t.status === 'success')!)!
    const lens = explainAdmission(lifecycle.phases[2], lifecycle.terminal, true)
    expect(lens.outcome).toBe('admitted')
    expect(lens.equation?.holds).toBe(false)
    expect(lens.explanation).toContain('started processing immediately')
  })

  it('names the trait when a trait rejected before the queue', () => {
    const shedTraces = runOverloadedDb({
      queue: { workers: 2, capacity: 50, discipline: 'fifo' },
      config: { loadShedQueueDepth: 1 }
    })
    const lifecycle = buildRequestLifecycle(
      shedTraces.find((trace) => trace.terminalReason === 'load_shed')!
    )!
    const lens = explainAdmission(lifecycle.phases[2], lifecycle.terminal, true)
    expect(lens.rule).toBe('trait')
    expect(lens.ruleLabel).toContain('resilience.load-shedding')
    expect(lens.equation).toEqual({
      expression: 'queued >= shed threshold',
      substituted: '1 >= 1',
      holds: true
    })
    expect(lens.explanation).toContain('not from capacity')
  })

  it('says the admission is unavailable for the source phase', () => {
    const lifecycle = buildRequestLifecycle(traces[0])!
    const lens = explainAdmission(lifecycle.phases[0], lifecycle.terminal, false)
    expect(lens.available).toBe(false)
  })
})

describe('expected path and diff', () => {
  const edges = [
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'b-c', source: 'b', target: 'c', weight: 3 },
    { id: 'b-d', source: 'b', target: 'd', weight: 1 },
    { id: 'c-a', source: 'c', target: 'a' }
  ]

  it('follows the highest-weight edge, stops on cycles and flags branching', () => {
    expect(buildExpectedPath('a', edges)).toEqual({
      nodeIds: ['a', 'b', 'c'],
      edgeIds: ['a-b', 'b-c'],
      deterministic: false
    })
    expect(buildExpectedPath('a', edges.slice(0, 2)).deterministic).toBe(true)
  })

  it('classifies match, early stop and divergence', () => {
    expect(diffPaths(['a', 'b'], ['a', 'b']).kind).toBe('match')
    expect(diffPaths(['a', 'b', 'c'], ['a', 'b'])).toEqual({
      kind: 'stopped-early',
      divergenceIndex: 2,
      expectedNodeId: 'c',
      actualNodeId: 'b'
    })
    expect(diffPaths(['a', 'b', 'c'], ['a', 'd'])).toMatchObject({
      kind: 'diverged',
      divergenceIndex: 1
    })
  })
})

describe('terminal shapes', () => {
  function syntheticTrace(overrides: Partial<RequestTrace>): RequestTrace {
    return { requestId: 'req-x', totalLatency: 0, status: 'success', spans: [], ...overrides }
  }

  it('ends a timed-out request in service with a timed-out step', () => {
    const lifecycle = buildRequestLifecycle(
      syntheticTrace({
        status: 'timeout',
        phaseRecord: {
          bornAtUs: 0n,
          nodes: [{ nodeId: 'a', nodeArrivalUs: 1_000n, serviceStartUs: 1_000n }],
          edges: [{ edgeId: 's-a', source: 's', target: 'a', edgeInUs: 0n, edgeOutUs: 1_000n }],
          terminal: { timeUs: 5_000n, cause: 'timeout', locus: 'a', locusKind: 'node' }
        }
      })
    )!
    expect(lifecycle.status).toBe('timeout')
    expect(lifecycle.steps.map((step) => step.state)).toEqual([
      'generated',
      'in-flight',
      'arrived',
      'processing',
      'timed-out'
    ])
    expect(lifecycle.phases[1]).toMatchObject({ result: 'timeout', serviceMs: 4 })
  })

  it('ends a request that failed on the wire at the edge', () => {
    const lifecycle = buildRequestLifecycle(
      syntheticTrace({
        status: 'rejected',
        terminalReason: 'connection_refused',
        phaseRecord: {
          bornAtUs: 0n,
          nodes: [
            { nodeId: 'a', nodeArrivalUs: 1_000n, serviceStartUs: 1_000n, departureUs: 2_000n }
          ],
          edges: [
            { edgeId: 's-a', source: 's', target: 'a', edgeInUs: 0n, edgeOutUs: 1_000n },
            { edgeId: 'a-b', source: 'a', target: 'b', edgeInUs: 2_000n }
          ],
          terminal: { timeUs: 2_500n, cause: 'network_error', locus: 'a-b', locusKind: 'edge' }
        }
      })
    )!
    const last = lifecycle.steps[lifecycle.steps.length - 1]
    expect(last).toMatchObject({ state: 'rejected', edgeId: 'a-b', nodeId: null, failed: true })
    expect(lifecycle.actualEdgeIds).toEqual(['s-a', 'a-b'])
    expect(lifecycle.edgeEnds['a-b']).toEqual({ source: 'a', target: 'b' })
  })

  it('keeps a request that was still in flight at cutoff open-ended', () => {
    const lifecycle = buildRequestLifecycle(
      syntheticTrace({
        phaseRecord: {
          bornAtUs: 0n,
          nodes: [{ nodeId: 'a', nodeArrivalUs: 1_000n }],
          edges: [{ edgeId: 's-a', source: 's', target: 'a', edgeInUs: 0n, edgeOutUs: 1_000n }]
        }
      })
    )!
    expect(lifecycle.status).toBe('in-flight')
    expect(lifecycle.terminal).toBeNull()
    expect(lifecycle.failureStepIndex).toBeNull()
    expect(lifecycle.phases[1].result).toBe('in-flight')
  })

  it('handles long (7+ hop) lifecycles', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const nodes = ids.map((nodeId, index) => {
      const at = BigInt((index + 1) * 1_000)
      return { nodeId, nodeArrivalUs: at, serviceStartUs: at, departureUs: at + 500n }
    })
    const edges = ids.map((target, index) => ({
      edgeId: `e${index}`,
      source: index === 0 ? 's' : ids[index - 1],
      target,
      edgeInUs: index === 0 ? 0n : BigInt(index * 1_000 + 500),
      edgeOutUs: BigInt((index + 1) * 1_000)
    }))
    const lifecycle = buildRequestLifecycle(
      syntheticTrace({
        phaseRecord: {
          bornAtUs: 0n,
          nodes,
          edges,
          terminal: { timeUs: 8_500n, cause: 'completed', locus: 'h', locusKind: 'node' }
        }
      })
    )!
    expect(lifecycle.actualPath).toEqual(['s', ...ids])
    expect(lifecycle.phases).toHaveLength(9)
    expect(lifecycle.steps[lifecycle.steps.length - 1].state).toBe('completed')
  })
})
