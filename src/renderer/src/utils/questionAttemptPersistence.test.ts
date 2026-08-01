// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { createAttemptState, markAttemptGrading } from '../../../engine/analysis/question'
import type { TopologyJSON } from '../../../engine/core/types'
import {
  clearPersistedAttemptState,
  loadPersistedAttemptState,
  persistAttemptState
} from './questionAttemptPersistence'

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
      }
    ],
    edges: [],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  }
}

describe('questionAttemptPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips persisted attempts for the same question', () => {
    const attempt = createAttemptState({
      questionId: 'q1',
      topology: topology(),
      now: '2026-08-01T00:00:00.000Z',
      attemptId: 'attempt-1'
    })

    persistAttemptState(attempt)

    expect(loadPersistedAttemptState('q1')).toEqual(attempt)
  })

  it('downgrades interrupted grading attempts to autosaved on restore', () => {
    const gradingAttempt = markAttemptGrading(
      createAttemptState({
        questionId: 'q1',
        topology: topology(),
        now: '2026-08-01T00:00:00.000Z',
        attemptId: 'attempt-1'
      }),
      {
        questionId: 'q1',
        topology: topology(),
        now: '2026-08-01T00:01:00.000Z'
      }
    )

    persistAttemptState(gradingAttempt)

    const restored = loadPersistedAttemptState('q1', '2026-08-01T00:02:00.000Z')

    expect(restored?.status).toBe('AUTOSAVED')
    expect(restored?.lastSavedAt).toBe('2026-08-01T00:02:00.000Z')
  })

  it('drops invalid persisted blobs so they cannot poison later restores', () => {
    localStorage.setItem(
      'ns-simulator.question-attempt.v1:q1',
      JSON.stringify({ questionId: 'q1', invalid: true })
    )

    expect(loadPersistedAttemptState('q1')).toBeNull()
    expect(localStorage.getItem('ns-simulator.question-attempt.v1:q1')).toBeNull()

    clearPersistedAttemptState('q1')
  })
})
