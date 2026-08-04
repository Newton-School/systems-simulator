import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import type { GamePlaygroundResult } from './gamePlayground'
import { createAttemptState, type QuestionPackage } from './question'
import {
  buildNewtonSaveBlob,
  isNewtonSaveCommand,
  mapResultToNewtonScores,
  NEWTON_SAVE_BLOB_VERSION,
  parseNewtonSeed
} from './newtonGamePlayground'

const pkg: QuestionPackage = {
  version: '1.0',
  id: 'url-shortener-v1',
  title: 'Design a URL shortener',
  difficulty: 'intermediate',
  type: 'open-build',
  prompt: {
    text: 'design it',
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    scale: {}
  },
  scaffold: { type: 'empty' },
  constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
  suite: { name: 's', visibleToStudent: false, cases: [{ id: 'baseline' }] },
  rubric: {
    checks: [{ id: 'c', description: 'c', metric: 'summary.errorRate', op: '<', value: 0.1 }]
  }
}

function topo(): TopologyJSON {
  return {
    id: 't',
    name: 't',
    version: '2.0.0',
    global: {
      seed: 'base',
      simulationDuration: 1000,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 5000
    },
    nodes: [],
    edges: []
  } as unknown as TopologyJSON
}

function result(overrides: Partial<GamePlaygroundResult> = {}): GamePlaygroundResult {
  return {
    version: '1.0',
    status: 'failed',
    tests: [{ id: 'topology.rubric.c', name: 'c', passed: false }],
    totalTests: 4,
    passedTests: 3,
    allPassed: false,
    ...overrides
  }
}

describe('parseNewtonSeed', () => {
  it('parses a first-open seed where the seed IS the QuestionPackage', () => {
    const seed = parseNewtonSeed(pkg)
    expect(seed.questionPackage.id).toBe('url-shortener-v1')
    expect(seed.priorAttempt).toBeUndefined()
    expect(seed.readOnly).toBe(false)
  })

  it('accepts a JSON string and reads host metadata (read_only, playgroundHash)', () => {
    const seed = parseNewtonSeed(
      JSON.stringify({
        ...pkg,
        read_only: true,
        playgroundHash: 'abc123',
        question_text: '<p>x</p>'
      })
    )
    expect(seed.questionPackage.id).toBe('url-shortener-v1')
    expect(seed.readOnly).toBe(true)
    expect(seed.playgroundHash).toBe('abc123')
  })

  it('parses a reopen seed (prior save blob) and restores the attempt', () => {
    const attempt = createAttemptState({ questionId: pkg.id, topology: topo() })
    const blob = buildNewtonSaveBlob(pkg, attempt, result(), '2026-08-04T00:00:00.000Z')
    const seed = parseNewtonSeed({ ...blob, playgroundHash: 'p1', read_only: false })
    expect(seed.questionPackage.id).toBe('url-shortener-v1')
    expect(seed.priorAttempt?.attemptId).toBe(attempt.attemptId)
    expect(seed.playgroundHash).toBe('p1')
  })

  it('throws on a seed with no recoverable QuestionPackage', () => {
    expect(() => parseNewtonSeed({ playgroundHash: 'x' })).toThrow()
    expect(() => parseNewtonSeed('not json')).toThrow()
  })
})

describe('mapResultToNewtonScores', () => {
  it('maps the host contract onto the backend score keys', () => {
    expect(
      mapResultToNewtonScores(result({ passedTests: 3, totalTests: 4, allPassed: false }))
    ).toEqual({
      test_cases_passed: 3,
      test_cases_total: 4,
      all_test_cases_passed: false
    })
    expect(
      mapResultToNewtonScores(
        result({ passedTests: 4, totalTests: 4, allPassed: true, status: 'passed' })
      ).all_test_cases_passed
    ).toBe(true)
  })
})

describe('buildNewtonSaveBlob', () => {
  it('carries the package + attempt forward and puts score keys at the top level', () => {
    const attempt = createAttemptState({ questionId: pkg.id, topology: topo() })
    const blob = buildNewtonSaveBlob(pkg, attempt, result(), '2026-08-04T00:00:00.000Z')
    expect(blob.version).toBe(NEWTON_SAVE_BLOB_VERSION)
    expect(blob.test_cases_passed).toBe(3)
    expect(blob.test_cases_total).toBe(4)
    expect(blob.all_test_cases_passed).toBe(false)
    expect(blob.questionPackage.id).toBe('url-shortener-v1') // carried forward
    expect(blob.topology).toEqual(attempt.topology) // mirrored at the top level
    expect(blob.attemptState.attemptId).toBe(attempt.attemptId)
    expect(blob.rubric_results).toHaveLength(1)
    expect(blob.saved_at).toBe('2026-08-04T00:00:00.000Z')
  })

  it('round-trips through a reopen seed', () => {
    const attempt = createAttemptState({ questionId: pkg.id, topology: topo() })
    const blob = buildNewtonSaveBlob(pkg, attempt, result(), '2026-08-04T00:00:00.000Z')
    const reopened = parseNewtonSeed(JSON.stringify(blob))
    expect(reopened.questionPackage.id).toBe(pkg.id)
    expect(reopened.priorAttempt?.attemptId).toBe(attempt.attemptId)
  })
})

describe('isNewtonSaveCommand', () => {
  it('recognizes the raw string and the typed form', () => {
    expect(isNewtonSaveCommand('save')).toBe(true)
    expect(isNewtonSaveCommand({ type: 'save' })).toBe(true)
    expect(isNewtonSaveCommand('ready-event')).toBe(false)
    expect(isNewtonSaveCommand({ type: 'ns-simulator:submit' })).toBe(false)
  })
})
