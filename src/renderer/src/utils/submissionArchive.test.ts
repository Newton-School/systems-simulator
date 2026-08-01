// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../../../engine/core/types'
import {
  buildEvaluationEnvelope,
  type EvaluationEnvelope
} from '../../../engine/analysis/evaluationEnvelope'
import { buildQuestionEvaluationErrorContract } from '../../../engine/analysis/evaluationContract'
import {
  archiveSubmission,
  listArchivedSubmissionIds,
  loadArchivedSubmission,
  loadArchivedSubmissions
} from './submissionArchive'

function topology(): TopologyJSON {
  return {
    id: 'topology-1',
    name: 'topology-1',
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
      }
    ],
    edges: [],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 10,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  } as TopologyJSON
}

function envelope(
  submissionId: string,
  questionId = 'q1',
  attemptId = 'attempt-1'
): EvaluationEnvelope {
  const contract = buildQuestionEvaluationErrorContract({
    questionId,
    topologyId: 'topology-1',
    status: 'invalid_submission',
    message: 'demo'
  })
  return buildEvaluationEnvelope({
    submissionId,
    attemptId,
    submittedAt: '2026-08-01T00:00:00.000Z',
    evaluatedAt: '2026-08-01T00:00:01.000Z',
    topologySnapshot: topology(),
    cases: [],
    contract
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
})

describe('submissionArchive', () => {
  it('archives an envelope and loads it back verified', () => {
    const sealed = envelope('sub-1')
    expect(archiveSubmission(sealed)).toEqual({ stored: true })
    expect(loadArchivedSubmission('sub-1')).toEqual(sealed)
  })

  it('is append-only — a second write of the same id never overwrites', () => {
    const first = envelope('sub-1', 'q1', 'attempt-1')
    expect(archiveSubmission(first)).toEqual({ stored: true })

    const impostor = envelope('sub-1', 'q1', 'attempt-DIFFERENT')
    expect(archiveSubmission(impostor)).toEqual({ stored: false, reason: 'already-archived' })

    // The original record is preserved untouched.
    expect(loadArchivedSubmission('sub-1')?.attemptId).toBe('attempt-1')
  })

  it('maintains a per-question index in insertion order', () => {
    archiveSubmission(envelope('sub-1'))
    archiveSubmission(envelope('sub-2'))
    archiveSubmission(envelope('other', 'q2'))

    expect(listArchivedSubmissionIds('q1')).toEqual(['sub-1', 'sub-2'])
    expect(loadArchivedSubmissions('q1').map((e) => e.submissionId)).toEqual(['sub-1', 'sub-2'])
    expect(listArchivedSubmissionIds('q2')).toEqual(['other'])
  })

  it('returns null for a corrupt entry without deleting the stored bytes', () => {
    globalThis.localStorage.setItem('ns-simulator.submission.v1:sub-x', '{ not valid json')
    expect(loadArchivedSubmission('sub-x')).toBeNull()
    // Archive must not erase evidence.
    expect(globalThis.localStorage.getItem('ns-simulator.submission.v1:sub-x')).toBe(
      '{ not valid json'
    )
  })

  it('returns null for a tampered (checksum-mismatched) entry', () => {
    const sealed = envelope('sub-1')
    archiveSubmission(sealed)
    const tampered = { ...sealed, attemptId: 'tampered' }
    globalThis.localStorage.setItem(
      'ns-simulator.submission.v1:sub-1',
      JSON.stringify(tampered)
    )
    expect(loadArchivedSubmission('sub-1')).toBeNull()
  })
})
