import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import type { SimulationOutput } from './output'
import {
  evaluateScenarios,
  evaluateSuite,
  mergeTopologyWithOverrides,
  type PreparedCase
} from './evaluate'

function sourceNode(id: string): ComponentNode {
  return {
    id,
    type: 'api-endpoint',
    category: 'compute',
    role: 'source',
    label: id,
    position: { x: 0, y: 0 }
  }
}

function processorNode(id: string): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 120, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: {
      distribution: { type: 'constant', value: 5 },
      timeout: 1_000
    }
  }
}

function edge(id: string, source: string, target: string): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: {
      distribution: { type: 'constant', value: 1 },
      pathType: 'same-dc'
    },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

// Minimal SimulationOutput stub carrying only the fields projectToVerdict reads.
function fakeOutput(seed: string): SimulationOutput {
  return {
    seed,
    simulationDuration: 1000,
    warmupDuration: 0,
    eventsProcessed: 42,
    reproducible: true,
    summary: {
      totalRequests: 10,
      postWarmupTotalRequests: 10,
      successfulRequests: 9,
      postWarmupSuccessfulRequests: 9,
      failedRequests: 1,
      postWarmupFailedRequests: 1,
      rejectedRequests: 0,
      timedOutRequests: 0,
      connectionResetRequests: 0,
      throughput: 9,
      errorRate: 0.1,
      latency: { p50: 1, p90: 2, p95: 3, p99: 4, min: 1, max: 5, mean: 2 }
    },
    perNode: {},
    sloTargetCount: 0,
    sloBreaches: [],
    invariantViolations: [],
    conservationCheck: [],
    littlesLawCheck: []
  } as unknown as SimulationOutput
}

function topology(seed: string): TopologyJSON {
  return {
    id: 'topology-under-test',
    name: 'Topology Under Test',
    version: '2.0.0',
    global: {
      seed,
      simulationDuration: 1000,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1000
    },
    nodes: [sourceNode('client'), processorNode('api')],
    edges: [edge('client-api', 'client', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  } as TopologyJSON
}

describe('evaluateSuite', () => {
  it('runs each ready case, projects a verdict, and preserves order', () => {
    const cases: PreparedCase[] = [
      { id: 'a', topology: topology('seed-a') },
      { id: 'b', topology: topology('seed-b') }
    ]

    const batch = evaluateSuite(
      cases,
      (t) => fakeOutput((t.global as { seed: string }).seed),
      'demo'
    )

    expect(batch.suite).toBe('demo')
    expect(batch.results.map((r) => r.id)).toEqual(['a', 'b'])
    const first = batch.results[0]
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.verdict.version).toBe('1.0')
      expect(first.verdict.meta.seed).toBe('seed-a') // per-case topology actually ran
    }
    expect(batch.summary).toEqual({ total: 2, succeeded: 2, failed: 0 })
  })

  it('isolates a throwing case as that case error without aborting the rest', () => {
    const cases: PreparedCase[] = [
      { id: 'ok', topology: topology('s1') },
      { id: 'boom', topology: topology('explode') }
    ]

    const batch = evaluateSuite(cases, (t) => {
      if ((t.global as { seed: string }).seed === 'explode') throw new Error('engine blew up')
      return fakeOutput('s1')
    })

    expect(batch.results[0]).toMatchObject({ id: 'ok', ok: true })
    expect(batch.results[1]).toEqual({ id: 'boom', ok: false, error: 'engine blew up' })
    expect(batch.summary).toEqual({ total: 2, succeeded: 1, failed: 1 })
    expect(batch.suite).toBeUndefined()
  })

  it('passes through cases that failed before they could run', () => {
    const cases: PreparedCase[] = [
      { id: 'unreadable', error: 'Could not read topology' },
      { id: 'good', topology: topology('s') }
    ]

    const batch = evaluateSuite(cases, () => fakeOutput('s'))

    expect(batch.results[0]).toEqual({
      id: 'unreadable',
      ok: false,
      error: 'Could not read topology'
    })
    expect(batch.summary).toEqual({ total: 2, succeeded: 1, failed: 1 })
  })
})

describe('mergeTopologyWithOverrides', () => {
  it('merges global/workload overrides and replaces faults without mutating the base topology', () => {
    const base: TopologyJSON = {
      ...topology('base-seed'),
      faults: [
        {
          targetId: 'db',
          faultType: 'node-failure',
          timing: 'deterministic',
          duration: 'fixed',
          params: { atMs: 1000 }
        }
      ]
    }

    const merged = mergeTopologyWithOverrides(base, {
      global: { seed: 'override-seed' },
      workload: { baseRps: 500 },
      faults: [
        {
          targetId: 'cache',
          faultType: 'blackhole',
          timing: 'deterministic',
          duration: 'permanent',
          params: {}
        }
      ]
    })

    expect(base.global.seed).toBe('base-seed')
    expect(base.workload?.baseRps).toBe(100)
    expect(base.faults?.[0]?.targetId).toBe('db')

    expect(merged.global.seed).toBe('override-seed')
    expect(merged.workload?.baseRps).toBe(500)
    expect(merged.faults?.[0]?.targetId).toBe('cache')
  })
})

describe('evaluateScenarios', () => {
  it('runs one base topology under many scenarios and emits the backend-facing verdict envelope', () => {
    const batch = evaluateScenarios(
      topology('base-seed'),
      [
        { id: 'baseline', name: 'Baseline' },
        { id: 'peak', overrides: { global: { seed: 'peak-seed' }, workload: { baseRps: 1000 } } }
      ],
      (t) => fakeOutput(t.global.seed),
      { submissionId: 'sub-123', evaluatedAt: '2026-08-01T00:00:00.000Z' }
    )

    expect(batch).toMatchObject({
      version: '1.0',
      submissionId: 'sub-123',
      topologyId: 'topology-under-test',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
      summary: { total: 2, completed: 2, errored: 0, timedOut: 0 }
    })
    expect(batch.verdicts[0]).toMatchObject({
      scenarioId: 'baseline',
      scenarioName: 'Baseline',
      status: 'completed'
    })
    const peak = batch.verdicts[1]
    expect(peak.status).toBe('completed')
    if (peak.status === 'completed') {
      expect(peak.verdict.meta.seed).toBe('peak-seed')
    }
  })

  it('isolates per-scenario validation failures and engine exceptions without aborting later scenarios', () => {
    const batch = evaluateScenarios(
      topology('base-seed'),
      [
        { id: 'invalid', overrides: { workload: { sourceNodeId: '' } } },
        { id: 'boom', overrides: { global: { seed: 'explode' } } },
        { id: 'ok', overrides: { global: { seed: 'safe' } } }
      ],
      (t) => {
        if (t.global.seed === 'explode') {
          throw new Error('engine blew up')
        }
        return fakeOutput(t.global.seed)
      },
      { evaluatedAt: '2026-08-01T00:00:00.000Z' }
    )

    expect(batch.summary).toEqual({ total: 3, completed: 1, errored: 2, timedOut: 0 })
    expect(batch.verdicts[0]).toMatchObject({
      scenarioId: 'invalid',
      status: 'error'
    })
    expect(batch.verdicts[1]).toEqual({
      scenarioId: 'boom',
      status: 'error',
      error: 'engine blew up'
    })
    expect(batch.verdicts[2]).toMatchObject({
      scenarioId: 'ok',
      status: 'completed'
    })
  })
})
