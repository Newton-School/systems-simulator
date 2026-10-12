import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function node(id: string, overrides: Partial<ComponentNode> = {}): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
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

function overloadedDbTopology(): TopologyJSON {
  return {
    id: 't',
    name: 'overloaded-db',
    version: '1.0.0',
    global: {
      simulationDuration: 200,
      seed: 'tracer-admission',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000,
      traceSampleRate: 1
    },
    nodes: [
      node('source'),
      node('api', { queue: { workers: 8, capacity: 100, discipline: 'fifo' } }),
      node('db', {
        type: 'relational-db',
        category: 'storage-and-data',
        queue: { workers: 2, capacity: 4, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 20 }, timeout: 1_000 }
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
}

describe('traced admission records', () => {
  it('records the occupancy the capacity rule compared when a request is rejected', () => {
    const output = new SimulationEngine(overloadedDbTopology()).run()
    const rejected = output.traces.find((trace) => trace.status === 'rejected')
    expect(rejected).toBeDefined()
    const dbAdmission = rejected!.admissions!.find((record) => record.nodeId === 'db')
    expect(dbAdmission).toMatchObject({
      stage: 'node',
      outcome: 'rejected',
      reasonCode: 'capacity_exceeded',
      admissionBoundBy: 'backlog',
      state: { activeWorkers: 2, queueLength: 2, totalInSystem: 4, workers: 2, capacity: 4 }
    })
    // The record is the state BEFORE the arrival is counted, at the arrival instant.
    const dbVisit = rejected!.phaseRecord!.nodes.find((phase) => phase.nodeId === 'db')
    expect(dbAdmission!.atUs).toBe(dbVisit!.nodeArrivalUs)
    expect(rejected!.terminalReason).toBe('capacity_exceeded')
  })

  it('distinguishes immediate service from queueing', () => {
    const output = new SimulationEngine(overloadedDbTopology()).run()
    const outcomes = new Set(
      output.traces.flatMap((trace) =>
        (trace.admissions ?? [])
          .filter((record) => record.nodeId === 'db')
          .map((record) => record.outcome)
      )
    )
    expect(outcomes).toEqual(new Set(['processing', 'queued', 'rejected']))
    const queued = output.traces
      .flatMap((trace) => trace.admissions ?? [])
      .find((record) => record.nodeId === 'db' && record.outcome === 'queued')
    // Queued means every worker was busy but a K slot was free.
    expect(queued!.state!.activeWorkers).toBe(queued!.state!.workers)
    expect(queued!.state!.totalInSystem).toBeLessThan(queued!.state!.capacity)
  })

  it('names the trait that rejected an arrival before the queue was checked', () => {
    const topology = overloadedDbTopology()
    topology.nodes[2] = {
      ...topology.nodes[2],
      type: 'microservice',
      category: 'compute',
      queue: { workers: 2, capacity: 50, discipline: 'fifo' },
      config: { loadShedQueueDepth: 1 }
    }
    const output = new SimulationEngine(topology).run()
    const shed = output.traces.find((trace) => trace.terminalReason === 'load_shed')
    expect(shed).toBeDefined()
    const admission = shed!.admissions!.find((record) => record.nodeId === 'db')
    expect(admission).toMatchObject({
      stage: 'trait',
      outcome: 'rejected',
      reasonCode: 'load_shed',
      traitName: 'resilience.load-shedding'
    })
    const decision = shed!.traitDecisions!.find(
      (record) => record.nodeId === 'db' && record.decision === 'rejected'
    )
    expect(decision).toMatchObject({
      traitName: 'resilience.load-shedding',
      reasonCode: 'load_shed',
      detail: { loadShedTrigger: 'queue-depth', queueLength: 1, threshold: 1 }
    })
  })

  it('records nothing for unsampled requests', () => {
    const topology = overloadedDbTopology()
    topology.global.traceSampleRate = 0
    const output = new SimulationEngine(topology).run()
    expect(output.traces).toEqual([])
  })
})
