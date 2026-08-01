import { describe, expect, it } from 'vitest'
import { GAME_PLAYGROUND_PAYLOAD_VERSION } from '../../../engine/analysis/gamePlayground'
import { createAttemptState } from '../../../engine/analysis/question'
import type { TopologyJSON } from '../../../engine/core/types'
import {
  parseQuestionHostOutboundMessage,
  parseQuestionLaunchContextMessage
} from './questionHostMessaging'

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
    id: 'q1',
    title: 'demo',
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'design it',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'partial', topology: topology() },
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

describe('parseQuestionLaunchContextMessage', () => {
  it('normalizes valid launch payloads and rejects cross-question prior attempts', () => {
    const draft = createAttemptState({
      questionId: 'q1',
      topology: topology(),
      attemptId: 'attempt-1',
      now: '2026-08-01T00:00:00.000Z'
    })
    const legacyAttempt = { ...draft }
    delete legacyAttempt.version

    const parsed = parseQuestionLaunchContextMessage({
      type: 'ns-simulator:launch-context',
      payload: {
        version: GAME_PLAYGROUND_PAYLOAD_VERSION,
        questionPackage: questionPackage(),
        priorAttempt: legacyAttempt
      }
    })

    expect(parsed?.payload.questionPackage.version).toBe('1.0')
    expect(parsed?.payload.priorAttempt?.version).toBe('1.0')

    expect(
      parseQuestionLaunchContextMessage({
        type: 'ns-simulator:launch-context',
        payload: {
          version: GAME_PLAYGROUND_PAYLOAD_VERSION,
          questionPackage: questionPackage(),
          priorAttempt: { ...legacyAttempt, questionId: 'other-question' }
        }
      })
    ).toBeNull()
  })
})

describe('parseQuestionHostOutboundMessage', () => {
  it('parses valid submit payloads and rejects malformed ones', () => {
    const attemptState = createAttemptState({
      questionId: 'q1',
      topology: topology(),
      attemptId: 'attempt-1',
      now: '2026-08-01T00:00:00.000Z'
    })

    const parsed = parseQuestionHostOutboundMessage(
      {
        type: 'ns-simulator:submit',
        payload: {
          version: GAME_PLAYGROUND_PAYLOAD_VERSION,
          questionId: 'q1',
          questionVersion: '1.0',
          attemptId: 'attempt-1',
          result: {
            version: GAME_PLAYGROUND_PAYLOAD_VERSION,
            status: 'passed',
            tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed: true }],
            totalTests: 1,
            passedTests: 1,
            allPassed: true
          },
          attemptState
        }
      },
      'q1'
    )

    expect(parsed?.type).toBe('ns-simulator:submit')
    if (!parsed || parsed.type !== 'ns-simulator:submit') {
      throw new Error('Expected a parsed submit message.')
    }
    expect(parsed.payload.result.status).toBe('passed')

    const legacy = parseQuestionHostOutboundMessage(
      {
        type: 'ns-simulator:submit',
        payload: {
          contract: {
            tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed: true }],
            totalTests: 1,
            passedTests: 1,
            allPassed: true
          },
          attemptState
        }
      },
      'q1'
    )
    if (!legacy || legacy.type !== 'ns-simulator:submit') {
      throw new Error('Expected a legacy submit message to parse.')
    }
    expect(legacy.payload.result.status).toBe('passed')

    expect(
      parseQuestionHostOutboundMessage({
        type: 'ns-simulator:submit',
        payload: {
          contract: { totalTests: 1 }
        }
      })
    ).toBeNull()
  })
})
