import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionEvaluationContract } from './evaluationContract'
import {
  GAME_PLAYGROUND_PAYLOAD_VERSION,
  buildGamePlaygroundLaunchPayload,
  buildGamePlaygroundResult,
  buildGamePlaygroundResultFromEvaluationContract,
  buildGamePlaygroundSubmitPayload,
  parseGamePlaygroundLaunchPayload,
  parseGamePlaygroundSubmitPayload
} from './gamePlayground'
import { createAttemptState } from './question'
import type { TopologyJSON } from '../core/types'

type HostProjection = {
  tests: { id: string; name: string; passed: boolean; detail?: string }[]
  totalTests: number
  passedTests: number
  allPassed: boolean
}

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/evaluation-contracts.json'), 'utf-8')
) as {
  questionPassed: { status: string; host: HostProjection }
  questionFailed: { status: string; host: HostProjection }
  questionInvalidSubmission: unknown
}

function topology(): TopologyJSON {
  return {
    id: 'topology-under-test',
    name: 'Topology Under Test',
    version: '2.0.0',
    global: {
      seed: 'seed',
      simulationDuration: 1000,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1000
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
        position: { x: 100, y: 0 },
        queue: { workers: 1, capacity: 10, discipline: 'fifo' },
        processing: {
          distribution: { type: 'constant', value: 5 },
          timeout: 1000
        }
      }
    ],
    edges: [
      {
        id: 'client-api',
        source: 'client',
        target: 'api',
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
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  }
}

function questionPackage() {
  return {
    version: '1.0' as const,
    id: 'q1',
    title: 'demo',
    difficulty: 'intermediate' as const,
    type: 'open-build' as const,
    prompt: {
      text: 'design it',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'partial' as const, topology: topology() },
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
          op: '<' as const,
          value: 0.1
        }
      ]
    }
  }
}

describe('gamePlayground adapter', () => {
  it('collapses full evaluation contracts to the thin host result contract', () => {
    const passed = buildGamePlaygroundResultFromEvaluationContract(
      parseQuestionEvaluationContract(fixtures.questionPassed)
    )
    const failed = buildGamePlaygroundResultFromEvaluationContract(
      parseQuestionEvaluationContract(fixtures.questionFailed)
    )
    const invalid = buildGamePlaygroundResultFromEvaluationContract(
      parseQuestionEvaluationContract(fixtures.questionInvalidSubmission)
    )

    const passedHost = fixtures.questionPassed.host
    expect(passed).toEqual({
      version: GAME_PLAYGROUND_PAYLOAD_VERSION,
      status: 'passed',
      tests: passedHost.tests,
      totalTests: passedHost.totalTests,
      passedTests: passedHost.passedTests,
      allPassed: true
    })

    const failedHost = fixtures.questionFailed.host
    expect(failed.status).toBe('failed')
    expect(failed.totalTests).toBe(failedHost.totalTests)
    expect(failed.passedTests).toBe(failedHost.passedTests)
    expect(failed.allPassed).toBe(false)

    expect(invalid).toEqual({
      version: GAME_PLAYGROUND_PAYLOAD_VERSION,
      status: 'invalid_submission',
      tests: [],
      totalTests: 0,
      passedTests: 0,
      allPassed: false
    })
  })

  it('builds and parses launch payloads with versioned question and attempt state', () => {
    const attempt = createAttemptState({
      questionId: 'q1',
      topology: topology(),
      attemptId: 'attempt-1',
      now: '2026-08-01T00:00:00.000Z'
    })

    const payload = buildGamePlaygroundLaunchPayload(questionPackage(), {
      priorAttempt: attempt,
      environmentProfile: { mode: 'INTERVIEW' }
    })

    expect(parseGamePlaygroundLaunchPayload(payload)).toEqual(payload)
    expect(() =>
      buildGamePlaygroundLaunchPayload(questionPackage(), {
        priorAttempt: { ...attempt, questionId: 'other-question' }
      })
    ).toThrow(/priorAttempt\.questionId/)
  })

  it('builds and parses submit payloads, and still accepts the legacy contract field', () => {
    const question = questionPackage()
    const attempt = createAttemptState({
      questionId: 'q1',
      topology: topology(),
      attemptId: 'attempt-1',
      now: '2026-08-01T00:00:00.000Z'
    })
    const result = buildGamePlaygroundResult({
      tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed: true }],
      totalTests: 1,
      passedTests: 1,
      allPassed: true
    })

    const payload = buildGamePlaygroundSubmitPayload(question, attempt, result, {
      submissionId: 'sub-1'
    })

    expect(parseGamePlaygroundSubmitPayload(payload, 'q1')).toEqual(payload)
    expect(
      parseGamePlaygroundSubmitPayload(
        {
          contract: result,
          attemptState: attempt
        },
        'q1'
      )
    ).toMatchObject({
      version: GAME_PLAYGROUND_PAYLOAD_VERSION,
      questionId: 'q1',
      attemptId: 'attempt-1',
      result
    })
  })
})
