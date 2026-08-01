import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../engine/core/types'
import { runScenarioBatchIsolated } from './scenarioBatch'

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

function topology(seed = 'base-seed'): TopologyJSON {
  return {
    id: 'student-topology',
    name: 'Student Topology',
    version: '2.0.0',
    global: {
      simulationDuration: 1_000,
      seed,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1_000
    },
    nodes: [sourceNode('client'), processorNode('api')],
    edges: [edge('client-api', 'client', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  }
}

describe('runScenarioBatchIsolated', () => {
  it('uses caller-supplied execution, keeps stable metadata, and isolates timeout/error/completed rows', () => {
    const seenSeeds: string[] = []
    const batch = runScenarioBatchIsolated(
      topology(),
      [
        { id: 'ok' },
        { id: 'timeout', overrides: { global: { seed: 'timeout-seed' } } },
        { id: 'boom', overrides: { global: { seed: 'boom-seed' } } }
      ],
      {
        simulatorVersion: '1.0.0',
        submissionId: 'sub-1',
        evaluatedAt: '2026-08-01T00:00:00.000Z',
        timeoutMs: 1234,
        executeScenario: (scenarioTopology, timeoutMs) => {
          seenSeeds.push(`${scenarioTopology.global.seed}:${timeoutMs}`)
          if (scenarioTopology.global.seed === 'timeout-seed') {
            return { scenarioId: '', status: 'timeout', error: 'Scenario exceeded timeout of 1234ms' }
          }
          if (scenarioTopology.global.seed === 'boom-seed') {
            return { scenarioId: '', status: 'error', error: 'engine blew up' }
          }
          return {
            scenarioId: '',
            status: 'completed',
            verdict: { version: '1.0', meta: { seed: scenarioTopology.global.seed } } as never
          }
        }
      }
    )

    expect(seenSeeds).toEqual(['base-seed:1234', 'timeout-seed:1234', 'boom-seed:1234'])
    expect(batch).toMatchObject({
      version: '1.0',
      simulatorVersion: '1.0.0',
      topologyId: 'student-topology',
      topologySchemaVersion: '2.0.0',
      submissionId: 'sub-1',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
      summary: { total: 3, completed: 1, errored: 1, timedOut: 1 }
    })
    expect(batch.verdicts.map((entry) => entry.status)).toEqual(['completed', 'timeout', 'error'])
  })

  it('fails invalid merged scenarios before invoking the isolated executor', () => {
    let called = false
    const batch = runScenarioBatchIsolated(
      topology(),
      [{ id: 'invalid', overrides: { workload: { sourceNodeId: '' } } }],
      {
        executeScenario: () => {
          called = true
          throw new Error('should not be called')
        }
      }
    )

    expect(called).toBe(false)
    expect(batch.summary).toEqual({ total: 1, completed: 0, errored: 1, timedOut: 0 })
    expect(batch.verdicts[0]).toMatchObject({
      scenarioId: 'invalid',
      status: 'error'
    })
  })
})
