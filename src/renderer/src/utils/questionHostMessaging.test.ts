import { describe, expect, it } from 'vitest'
import { GAME_PLAYGROUND_PAYLOAD_VERSION } from '../../../engine/analysis/gamePlayground'
import { createAttemptState } from '../../../engine/analysis/question'
import type { TopologyJSON } from '../../../engine/core/types'
import {
  computeHostTargetOrigin,
  getTrustedHostOrigin,
  isHostOriginAllowed,
  parseQuestionCommandMessage,
  parseQuestionHostOutboundMessage,
  parseQuestionLaunchContextMessage,
  rememberTrustedHostOrigin,
  resetTrustedHostOrigin
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

describe('host origin trust', () => {
  it('enforces a configured allowlist strictly, ignoring TOFU', () => {
    const configured = ['https://playground.example.com']
    expect(
      isHostOriginAllowed('https://playground.example.com', { configured, trusted: null })
    ).toBe(true)
    expect(isHostOriginAllowed('https://evil.example.com', { configured, trusted: null })).toBe(
      false
    )
    // Even a previously trusted origin cannot override the configured allowlist.
    expect(
      isHostOriginAllowed('https://evil.example.com', {
        configured,
        trusted: 'https://evil.example.com'
      })
    ).toBe(false)
  })

  it('falls back to trust-on-first-use when nothing is configured', () => {
    // Nothing trusted yet → first origin is accepted.
    expect(
      isHostOriginAllowed('https://host-a.example.com', { configured: [], trusted: null })
    ).toBe(true)
    // Once locked, only the trusted origin is accepted.
    const trusted = 'https://host-a.example.com'
    expect(isHostOriginAllowed('https://host-a.example.com', { configured: [], trusted })).toBe(
      true
    )
    expect(isHostOriginAllowed('https://host-b.example.com', { configured: [], trusted })).toBe(
      false
    )
  })

  it('routes sensitive messages only to a known trusted origin, never broadcast', () => {
    const referrer = 'https://ref.example.com'
    const trusted = 'https://host.example.com'
    // submit/error require a trusted origin; drop (null) otherwise.
    expect(
      computeHostTargetOrigin('ns-simulator:submit', { trusted: null, configured: [], referrer })
    ).toBeNull()
    expect(
      computeHostTargetOrigin('ns-simulator:error', { trusted: null, configured: [], referrer })
    ).toBeNull()
    expect(
      computeHostTargetOrigin('ns-simulator:submit', { trusted, configured: [], referrer })
    ).toBe(trusted)
  })

  it('lets the content-less ready bootstrap fall back to configured/referrer/wildcard', () => {
    expect(
      computeHostTargetOrigin('ns-simulator:ready', {
        trusted: 'https://host.example.com',
        configured: [],
        referrer: null
      })
    ).toBe('https://host.example.com')
    expect(
      computeHostTargetOrigin('ns-simulator:ready', {
        trusted: null,
        configured: ['https://only.example.com'],
        referrer: null
      })
    ).toBe('https://only.example.com')
    expect(
      computeHostTargetOrigin('ns-simulator:ready', {
        trusted: null,
        configured: [],
        referrer: 'https://ref.example.com'
      })
    ).toBe('https://ref.example.com')
    expect(
      computeHostTargetOrigin('ns-simulator:ready', {
        trusted: null,
        configured: [],
        referrer: null
      })
    ).toBe('*')
  })

  it('locks the trusted origin on first write only', () => {
    resetTrustedHostOrigin()
    expect(getTrustedHostOrigin()).toBeNull()
    rememberTrustedHostOrigin('https://first.example.com')
    rememberTrustedHostOrigin('https://second.example.com')
    expect(getTrustedHostOrigin()).toBe('https://first.example.com')
    resetTrustedHostOrigin()
  })
})

describe('parseQuestionCommandMessage', () => {
  it('accepts the three lifecycle commands and rejects anything else', () => {
    expect(parseQuestionCommandMessage({ type: 'ns-simulator:command', command: 'reset' })).toEqual(
      {
        type: 'ns-simulator:command',
        command: 'reset'
      }
    )
    expect(
      parseQuestionCommandMessage({ type: 'ns-simulator:command', command: 'lock' })?.command
    ).toBe('lock')
    expect(
      parseQuestionCommandMessage({ type: 'ns-simulator:command', command: 'reveal' })?.command
    ).toBe('reveal')

    expect(
      parseQuestionCommandMessage({ type: 'ns-simulator:command', command: 'nuke' })
    ).toBeNull()
    expect(parseQuestionCommandMessage({ type: 'ns-simulator:launch-context' })).toBeNull()
    expect(parseQuestionCommandMessage('reset')).toBeNull()
    expect(parseQuestionCommandMessage(null)).toBeNull()
  })
})
