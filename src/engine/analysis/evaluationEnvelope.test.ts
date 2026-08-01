import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CanonicalEventRecord } from '../core/event-stream'
import type { TopologyJSON } from '../core/types'
import { parseQuestionEvaluationContract } from './evaluationContract'
import {
  EVALUATION_ENVELOPE_VERSION,
  buildEvaluationEnvelope,
  buildReplayDigest,
  computeEnvelopeChecksum,
  parseEvaluationEnvelope,
  verifyEvaluationEnvelope,
  type EvaluationEnvelope
} from './evaluationEnvelope'

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/evaluation-contracts.json'), 'utf-8')
) as { questionPassed: unknown }

const contract = parseQuestionEvaluationContract(fixtures.questionPassed)

function topology(): TopologyJSON {
  return {
    id: 'topology-1',
    name: 'topology-1',
    version: '2.0.0',
    global: {
      simulationDuration: 1_000,
      seed: 'seed',
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
        processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 }
      }
    ],
    edges: [
      {
        id: 'client-api',
        source: 'client',
        target: 'api',
        mode: 'synchronous',
        protocol: 'https',
        latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
        bandwidth: 1_000,
        maxConcurrentRequests: 100,
        packetLossRate: 0,
        errorRate: 0
      }
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 50,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1_024 }]
    }
  } as TopologyJSON
}

function events(): CanonicalEventRecord[] {
  return [
    {
      sequence: 0,
      timestampUs: '0',
      type: 'request-arrived',
      priority: 0,
      requestId: 'r1',
      nodeId: 'api',
      payload: {}
    },
    {
      sequence: 1,
      timestampUs: '5',
      type: 'request-completed',
      priority: 0,
      requestId: 'r1',
      nodeId: 'api',
      payload: {}
    },
    {
      sequence: 2,
      timestampUs: '6',
      type: 'request-arrived',
      priority: 0,
      requestId: 'r2',
      nodeId: 'api',
      payload: {}
    },
    {
      sequence: 3,
      timestampUs: '9',
      type: 'request-timed-out',
      priority: 0,
      requestId: 'r2',
      nodeId: 'api',
      payload: {}
    }
  ]
}

function sealed(): EvaluationEnvelope {
  return buildEvaluationEnvelope({
    submissionId: 'sub-1',
    attemptId: 'attempt-1',
    submittedAt: '2026-08-01T00:00:00.000Z',
    evaluatedAt: '2026-08-01T00:00:01.000Z',
    topologySnapshot: topology(),
    cases: [
      {
        caseId: 'baseline',
        executionStatus: 'completed',
        verdict: { version: '1.0' } as never,
        replayDigest: buildReplayDigest(events())
      }
    ],
    contract
  })
}

describe('buildReplayDigest', () => {
  it('summarizes lifecycles and terminal statuses with a stable stream checksum', () => {
    const digest = buildReplayDigest(events())
    expect(digest.lifecycleCount).toBe(2)
    expect(digest.terminalStatusCounts.success).toBe(1)
    expect(digest.terminalStatusCounts.timeout).toBe(1)
    expect(digest.terminalStatusCounts.rejected).toBe(0)
    expect(digest.eventCountsByType['request-arrived']).toBe(2)
    // Deterministic: rebuilding the same stream yields the same checksum.
    expect(buildReplayDigest(events()).eventStreamChecksum).toBe(digest.eventStreamChecksum)
  })
})

describe('buildEvaluationEnvelope', () => {
  it('seals a versioned, self-consistent envelope derived from the contract identity', () => {
    const envelope = sealed()
    expect(envelope.version).toBe(EVALUATION_ENVELOPE_VERSION)
    expect(envelope.questionId).toBe(contract.questionId)
    expect(envelope.topologyId).toBe(contract.topologyId)
    expect(envelope.checksum).toMatch(/^[0-9a-f]{32}$/)
    expect(verifyEvaluationEnvelope(envelope)).toEqual({ valid: true })
  })

  it('round-trips through the parser with full integrity validation', () => {
    const envelope = sealed()
    expect(parseEvaluationEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope)
  })
})

describe('evaluation envelope integrity', () => {
  it('rejects a tampered topology snapshot', () => {
    const envelope = sealed()
    const tampered = {
      ...envelope,
      topologySnapshot: { ...envelope.topologySnapshot, id: 'someone-elses-topology' }
    }
    expect(() => parseEvaluationEnvelope(tampered)).toThrow(/checksum|topologyId/i)
    expect(verifyEvaluationEnvelope(tampered as EvaluationEnvelope).valid).toBe(false)
  })

  it('rejects an identity that disagrees with the sealed contract', () => {
    const envelope = sealed()
    const mismatched = { ...envelope, questionId: 'not-the-contract-question' }
    // Recompute checksum so we isolate the identity check, not the integrity check.
    const { checksum: _drop, ...rest } = mismatched
    const resealed = { ...mismatched, checksum: computeEnvelopeChecksum(rest) }
    expect(() => parseEvaluationEnvelope(resealed)).toThrow(/questionId/i)
  })

  it('keeps the checksum stable whether or not full replay is attached', () => {
    const withDigestOnly = sealed()
    const withFullReplay: EvaluationEnvelope = {
      ...withDigestOnly,
      cases: withDigestOnly.cases.map((entry) => ({
        ...entry,
        replay: {
          lifecycles: [],
          lifecycleByRequestId: {},
          eventCountsByType: {} as never,
          terminalStatusByRequestId: {}
        }
      }))
    }
    // Attaching full replay must not change the sealed checksum.
    expect(withFullReplay.cases[0].replay).toBeDefined()
    expect(computeEnvelopeChecksum(withFullReplay)).toBe(withDigestOnly.checksum)
    expect(verifyEvaluationEnvelope(withFullReplay)).toEqual({ valid: true })
    expect(parseEvaluationEnvelope(JSON.parse(JSON.stringify(withFullReplay)))).toEqual(
      withFullReplay
    )
  })
})
