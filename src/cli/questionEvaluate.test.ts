import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EdgeDefinition, TopologyJSON } from '../engine/core/types'
import { parseQuestionPackage } from '../engine/analysis/question'
import { evaluateQuestionSubmission } from './questionEvaluate'
import { runQuestionBatchIsolated } from './questionBatch'

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

function topology(): TopologyJSON {
  return {
    id: 'fixture-topology',
    name: 'Fixture Topology',
    version: '2.0.0',
    global: {
      seed: 'fixture-seed',
      simulationDuration: 1_000,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1_000
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
      {
        id: 'api',
        type: 'microservice',
        category: 'compute',
        role: 'processor',
        label: 'api',
        position: { x: 160, y: 0 },
        queue: { workers: 2, capacity: 200, discipline: 'fifo' },
        processing: {
          distribution: { type: 'constant', value: 5 },
          timeout: 1_000
        }
      }
    ],
    edges: [edge('client-api', 'client', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  }
}

describe('question fixture parity', () => {
  it('grades the authored fixture identically in single and batch modes', () => {
    const question = parseQuestionPackage(
      JSON.parse(
        readFileSync(
          resolve(__dirname, '../engine/analysis/fixtures/rubric-check-hardening.question.json'),
          'utf-8'
        )
      )
    )
    const evaluatedAt = '2026-08-01T00:00:00.000Z'
    const simulatorVersion = '1.2.3'
    const attemptId = 'attempt-1'
    const submissionId = 'sub-1'
    const studentTopology = topology()

    const single = evaluateQuestionSubmission(question, studentTopology, {
      simulatorVersion,
      attemptId,
      submissionId,
      evaluatedAt
    })

    const batch = runQuestionBatchIsolated(
      [{ question, topology: studentTopology, attemptId, submissionId }],
      {
        simulatorVersion,
        evaluatedAt,
        executeAttempt: (attempt) =>
          evaluateQuestionSubmission(attempt.question, attempt.topology, {
            simulatorVersion,
            attemptId: attempt.attemptId,
            submissionId: attempt.submissionId,
            evaluatedAt
          })
      }
    )

    expect(single.status).toBe('passed')
    expect(single.score).toEqual({ earned: 8, possible: 8, fraction: 1 })
    expect(new Set(single.tests.map((test) => test.kind))).toEqual(
      new Set(['topology', 'simulation', 'invariant', 'execution'])
    )
    expect(batch.results[0]).toEqual(single)
    expect(batch.summary).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      invalidSubmissions: 0,
      evaluationErrors: 0
    })
  })
})
