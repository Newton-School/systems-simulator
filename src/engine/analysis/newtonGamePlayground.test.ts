import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import type { GamePlaygroundResult } from './gamePlayground'
import { createAttemptState, type QuestionPackage } from './question'
import {
  buildNewtonSaveBlob,
  explainNewtonSeedParseFailure,
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
  structuralRules: [
    {
      id: 'single-source',
      kind: 'requires_single_source',
      description: 'Exactly one traffic source'
    }
  ],
  suite: {
    name: 'suite',
    visibleToStudent: false,
    cases: [{ id: 'baseline' }]
  },
  rubric: {
    id: 'url-rubric',
    passThreshold: 1,
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

function rowAuthoredSeed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    question_title: pkg.title,
    question_text:
      '<p>Design a write path that stores short-code mappings.</p><h3>Scale</h3><ul><li>Peak RPS: 200,000</li></ul>',
    rubric: [
      {
        title: 'SIMULATOR_CONFIG',
        spec: {
          type: 'SIMULATOR_CONFIG',
          questionId: pkg.id,
          questionVersion: pkg.version,
          questionType: pkg.type,
          entryFormat: 'requirements-first',
          domains: ['compute', 'storage'],
          concepts: ['read-cache', 'store-fit'],
          difficulty: pkg.difficulty,
          presentationMode: 'raw-html',
          scaffold: pkg.scaffold,
          constraints: pkg.constraints,
          suite: pkg.suite,
          justify: [
            {
              id: 'why-store',
              decision: 'Why this store?',
              boundTo: { componentType: 'kv-store' },
              requires: { choice: true, tradeoff: true }
            }
          ],
          environmentProfile: {
            mode: 'ASSIGNMENT',
            capabilities: {
              edgeModel: 'connector',
              canEditEdges: false,
              canEditResources: false,
              canEditExecutionProfile: false
            }
          },
          rubric: {
            id: pkg.rubric.id,
            passThreshold: pkg.rubric.passThreshold
          }
        }
      },
      {
        title: 'STRUCTURAL_RULE: single-source',
        spec: {
          type: 'STRUCTURAL_RULE',
          id: 'single-source',
          kind: 'requires_single_source',
          description: 'Exactly one traffic source'
        }
      },
      {
        title: 'RUBRIC_CHECK: c',
        spec: {
          type: 'RUBRIC_CHECK',
          id: 'c',
          description: 'c',
          metric: 'summary.errorRate',
          op: '<',
          value: 0.1
        }
      }
    ],
    ...overrides
  }
}

describe('parseNewtonSeed', () => {
  it('parses a legacy first-open seed where the seed IS the QuestionPackage', () => {
    const seed = parseNewtonSeed(pkg)
    expect(seed.questionPackage.id).toBe('url-shortener-v1')
    expect(seed.priorAttempt).toBeUndefined()
    expect(seed.promptHtml).toBeUndefined()
    expect(seed.saveMode).toBe('legacy-package')
    expect(seed.readOnly).toBe(false)
  })

  it('parses a row-authored Django seed into a QuestionPackage plus raw prompt HTML', () => {
    const seed = parseNewtonSeed(
      JSON.stringify({
        ...rowAuthoredSeed(),
        read_only: true,
        playgroundHash: 'abc123'
      })
    )

    expect(seed.questionPackage.id).toBe(pkg.id)
    expect(seed.questionPackage.structuralRules?.[0]?.id).toBe('single-source')
    expect(seed.questionPackage.prompt.text).toContain('Design a write path')
    expect(seed.questionPackage.domains).toEqual(['compute', 'storage'])
    expect(seed.questionPackage.concepts).toEqual(['read-cache', 'store-fit'])
    expect(seed.questionPackage.entryFormat).toBe('requirements-first')
    expect(seed.questionPackage.justify?.[0]?.id).toBe('why-store')
    expect(seed.promptHtml).toContain('<h3>Scale</h3>')
    expect(seed.environmentProfile).toEqual({
      mode: 'ASSIGNMENT',
      capabilities: {
        edgeModel: 'connector',
        canEditEdges: false,
        canEditResources: false,
        canEditExecutionProfile: false
      }
    })
    expect(seed.readOnly).toBe(true)
    expect(seed.playgroundHash).toBe('abc123')
    expect(seed.saveMode).toBe('mutable-only')
  })

  it('preserves mutable seed topology for row-authored first-open seeds', () => {
    const seed = parseNewtonSeed(rowAuthoredSeed({ topology: topo() }))
    expect(seed.priorAttempt).toBeUndefined()
    expect(seed.seedTopology).toEqual(topo())
  })

  it('parses a row-authored reopen seed (save blob + Django metadata) and restores the attempt', () => {
    const attempt = createAttemptState({ questionId: pkg.id, topology: topo() })
    const blob = buildNewtonSaveBlob(pkg, attempt, result(), '2026-08-04T00:00:00.000Z')
    const seed = parseNewtonSeed({
      ...rowAuthoredSeed(),
      ...blob,
      playgroundHash: 'p1',
      read_only: false
    })

    expect(seed.questionPackage.id).toBe(pkg.id)
    expect(seed.priorAttempt?.attemptId).toBe(attempt.attemptId)
    expect(seed.playgroundHash).toBe('p1')
    expect(seed.saveMode).toBe('mutable-only')
  })

  it('prefers row-authored Django metadata over a legacy carried-forward questionPackage', () => {
    const attempt = createAttemptState({ questionId: pkg.id, topology: topo() })
    const blob = buildNewtonSaveBlob(
      {
        ...pkg,
        title: 'Old carried package title',
        prompt: { ...pkg.prompt, text: 'old prompt text' }
      },
      attempt,
      result(),
      '2026-08-04T00:00:00.000Z',
      { saveMode: 'legacy-package' }
    )

    const seed = parseNewtonSeed({
      ...rowAuthoredSeed({
        question_title: 'Fresh Django title',
        question_text: '<p>Fresh Django prompt</p>'
      }),
      ...blob
    })

    expect(seed.questionPackage.title).toBe('Fresh Django title')
    expect(seed.questionPackage.prompt.text).toContain('Fresh Django prompt')
    expect(seed.priorAttempt?.attemptId).toBe(attempt.attemptId)
    expect(seed.saveMode).toBe('mutable-only')
  })

  it('throws on a seed with no recoverable question metadata', () => {
    expect(() => parseNewtonSeed({ playgroundHash: 'x' })).toThrow()
    expect(() => parseNewtonSeed('not json')).toThrow()
  })

  it('explains when a row-authored Django seed is missing SIMULATOR_CONFIG', () => {
    expect(
      explainNewtonSeedParseFailure({
        question_title: 'Design a URL shortener',
        question_text: '<p>Prompt only</p>',
        rubric: [
          {
            title: 'RUBRIC_CHECK: p99',
            spec: {
              type: 'RUBRIC_CHECK',
              id: 'p99',
              description: 'p99 under 100ms',
              metric: 'summary.latency.p99',
              op: '<',
              value: 100
            }
          }
        ]
      })
    ).toContain('SIMULATOR_CONFIG')
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
  it('builds the mutable-only save blob for row-authored Newton questions', () => {
    const attempt = createAttemptState({ questionId: pkg.id, topology: topo() })
    const blob = buildNewtonSaveBlob(pkg, attempt, result(), '2026-08-04T00:00:00.000Z')

    expect(blob.version).toBe(NEWTON_SAVE_BLOB_VERSION)
    expect(blob.test_cases_passed).toBe(3)
    expect(blob.test_cases_total).toBe(4)
    expect(blob.all_test_cases_passed).toBe(false)
    expect(blob.questionPackage).toBeUndefined()
    expect(blob.topology).toEqual(attempt.topology)
    expect(blob.attemptState.attemptId).toBe(attempt.attemptId)
    expect(blob.rubric_results).toHaveLength(1)
    expect(blob.saved_at).toBe('2026-08-04T00:00:00.000Z')
  })

  it('keeps carrying the package forward for legacy Newton questions', () => {
    const attempt = createAttemptState({ questionId: pkg.id, topology: topo() })
    const blob = buildNewtonSaveBlob(pkg, attempt, result(), '2026-08-04T00:00:00.000Z', {
      saveMode: 'legacy-package'
    })

    expect(blob.questionPackage?.id).toBe(pkg.id)
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
