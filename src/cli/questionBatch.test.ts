import { describe, expect, it } from 'vitest'
import type { EdgeDefinition, TopologyJSON } from '../engine/core/types'
import {
  buildQuestionEvaluationContract,
  buildQuestionEvaluationErrorContract
} from '../engine/analysis/evaluationContract'
import type { AttemptGrade, QuestionPackage } from '../engine/analysis/question'
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

function topology(id: string): TopologyJSON {
  return {
    id,
    name: id,
    version: '2.0.0',
    global: {
      simulationDuration: 1_000,
      seed: `${id}-seed`,
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
        position: { x: 120, y: 0 },
        queue: { workers: 1, capacity: 10, discipline: 'fifo' },
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

function question(id: string): QuestionPackage {
  return {
    version: '1.0',
    id,
    title: id,
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'Design it',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: {
      name: 'suite',
      visibleToStudent: false,
      cases: [{ id: 'baseline' }]
    },
    rubric: {
      checks: [
        {
          id: 'err',
          description: 'error rate < 10%',
          metric: 'summary.errorRate',
          op: '<',
          value: 0.1
        }
      ]
    }
  }
}

function grade(passed: boolean): AttemptGrade {
  return {
    structural: { version: '1.0', checks: [], passed: true },
    graded: {
      version: '1.0',
      cases: [
        {
          id: 'baseline',
          ran: true,
          rubric: {
            version: '1.0',
            checks: [
              {
                id: 'err',
                description: 'error rate < 10%',
                metric: 'summary.errorRate',
                op: '<',
                value: 0.1,
                actual: passed ? 0.01 : 0.5,
                passed,
                points: 1,
                awarded: passed ? 1 : 0
              }
            ],
            score: { earned: passed ? 1 : 0, possible: 1, fraction: passed ? 1 : 0 },
            passed
          }
        }
      ],
      summary: { total: 1, ran: 1, errored: 0, passed: passed ? 1 : 0, failed: passed ? 0 : 1 }
    },
    contract: {
      tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed }],
      totalTests: 1,
      passedTests: passed ? 1 : 0,
      allPassed: passed
    }
  }
}

describe('runQuestionBatchIsolated', () => {
  it('uses caller-supplied execution, preserves order, and summarizes passed/failed/error rows', () => {
    const seen: string[] = []
    const batch = runQuestionBatchIsolated(
      [
        { question: question('q-pass'), topology: topology('t-pass'), attemptId: 'attempt-pass' },
        { question: question('q-fail'), topology: topology('t-fail'), attemptId: 'attempt-fail' },
        { question: question('q-boom'), topology: topology('t-boom'), attemptId: 'attempt-boom' }
      ],
      {
        simulatorVersion: '1.2.3',
        evaluatedAt: '2026-08-01T00:00:00.000Z',
        timeoutMs: 4321,
        executeAttempt: (attempt, timeoutMs) => {
          seen.push(`${attempt.attemptId}:${timeoutMs}`)
          if (attempt.attemptId === 'attempt-boom') {
            throw new Error('engine blew up')
          }

          return buildQuestionEvaluationContract(
            attempt.question,
            attempt.topology,
            grade(attempt.attemptId === 'attempt-pass'),
            {
              simulatorVersion: '1.2.3',
              attemptId: attempt.attemptId,
              evaluatedAt: '2026-08-01T00:00:00.000Z'
            }
          )
        }
      }
    )

    expect(seen).toEqual(['attempt-pass:4321', 'attempt-fail:4321', 'attempt-boom:4321'])
    expect(batch).toMatchObject({
      version: '1.0',
      mode: 'question-batch',
      simulatorVersion: '1.2.3',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
      summary: {
        total: 3,
        passed: 1,
        failed: 1,
        invalidSubmissions: 0,
        evaluationErrors: 1
      }
    })
    expect(batch.results.map((result) => result.status)).toEqual([
      'passed',
      'failed',
      'evaluation_error'
    ])
    expect(batch.results[2]).toMatchObject({
      questionId: 'q-boom',
      topologyId: 't-boom',
      error: { code: 'EVALUATION_ERROR', message: 'engine blew up' }
    })
  })

  it('accepts explicit error contracts from the executor without reclassifying them', () => {
    const batch = runQuestionBatchIsolated(
      [{ question: question('q-invalid'), topology: topology('t-invalid'), submissionId: 'sub-1' }],
      {
        executeAttempt: (attempt) =>
          buildQuestionEvaluationErrorContract({
            questionId: attempt.question.id,
            questionVersion: attempt.question.version,
            topologyId: attempt.topology.id,
            topologySchemaVersion: attempt.topology.version,
            submissionId: attempt.submissionId,
            status: 'invalid_submission',
            message: 'bad input'
          })
      }
    )

    expect(batch.summary).toEqual({
      total: 1,
      passed: 0,
      failed: 0,
      invalidSubmissions: 1,
      evaluationErrors: 0
    })
    expect(batch.results[0]).toMatchObject({
      status: 'invalid_submission',
      submissionId: 'sub-1',
      error: { code: 'INVALID_SUBMISSION', message: 'bad input' }
    })
  })
})
