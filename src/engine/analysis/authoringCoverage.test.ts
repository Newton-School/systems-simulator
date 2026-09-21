import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildQuestionAuthoringCoverageReport,
  findSourceOnlyPaths,
  formatQuestionAuthoringCoverageMarkdown,
  QUESTION_STUDIO_MVP_SHAPE_PROFILE,
  type QuestionAuthoringCoverageInput
} from './authoringCoverage'

function minimalQuestion(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.0',
    id: 'coverage-fixture',
    title: 'Coverage fixture',
    difficulty: 'beginner',
    type: 'open-build',
    prompt: {
      text: 'Build a request path.',
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
        description: 'Exactly one source'
      }
    ],
    suite: {
      name: 'coverage-suite',
      visibleToStudent: false,
      cases: [{ id: 'baseline', workload: { baseRps: 10 } }]
    },
    rubric: {
      id: 'coverage-rubric',
      passThreshold: 1,
      checks: [
        {
          id: 'no-invariants',
          kind: 'invariant',
          description: 'No invariant violations',
          metric: 'invariantViolations.count',
          op: '==',
          value: 0
        }
      ]
    },
    ...extra
  }
}

function loadCanonicalBank(): QuestionAuthoringCoverageInput[] {
  const rootDir = resolve(process.cwd(), 'ns-simulator-docs/examples/question-bank')
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const source = join(rootDir, entry.name, 'question.json')
      return { source, raw: JSON.parse(readFileSync(source, 'utf8')) as unknown }
    })
}

describe('question authoring coverage audit', () => {
  it('reports the shallowest source-only paths stripped by canonical parsing', () => {
    const raw = minimalQuestion({
      family: 'compute',
      _justify: [{ id: 'why', nested: { token: 'tradeoff' } }]
    })
    const report = buildQuestionAuthoringCoverageReport([{ source: 'fixture.json', raw }])

    expect(report.questions[0].sourceOnlyPaths).toEqual(['_justify', 'family'])
    expect(report.sourceOnlyPathUsage).toEqual({ _justify: 1, family: 1 })
    expect(report.totals.candidateShapeEligible).toBe(1)
    expect(report.totals.exactSourceFidelityEligible).toBe(0)
  })

  it('keeps shape eligibility separate from unsupported profile choices', () => {
    const profile = {
      ...QUESTION_STUDIO_MVP_SHAPE_PROFILE,
      structuralKinds: []
    }
    const report = buildQuestionAuthoringCoverageReport(
      [{ source: 'fixture.json', raw: minimalQuestion() }],
      profile
    )

    expect(report.questions[0].candidateShapeEligible).toBe(false)
    expect(report.questions[0].candidateShapeBlockers).toContain(
      'structural kind: requires_single_source'
    )
  })

  it('reports invalid packages without aborting the complete audit', () => {
    const report = buildQuestionAuthoringCoverageReport([
      { source: 'good.json', raw: minimalQuestion() },
      { source: 'bad.json', raw: { id: 'bad' } }
    ])

    expect(report.totals.questions).toBe(2)
    expect(report.totals.parseable).toBe(1)
    expect(report.questions.find((question) => question.id === 'bad')).toMatchObject({
      parses: false,
      candidateShapeEligible: false
    })
  })

  it('formats the measured codec proof and source-only limitation separately', () => {
    const report = buildQuestionAuthoringCoverageReport([
      { source: 'fixture.json', raw: minimalQuestion({ family: 'compute' }) }
    ])
    const markdown = formatQuestionAuthoringCoverageMarkdown(report)

    expect(markdown).toContain('Package↔row round-trip: measured')
    expect(markdown).toContain('Grading parity: verified-by-fixture-test')
    expect(markdown).toContain('| coverage-fixture | yes | yes | yes | no |')
  })

  it('locks the current canonical-bank inventory for the MVP coverage checkpoint', () => {
    const report = buildQuestionAuthoringCoverageReport(loadCanonicalBank())

    expect(report.totals).toEqual({
      questions: 14,
      parseable: 14,
      candidateShapeEligible: 14,
      exactSourceFidelityEligible: 0,
      normalizedPackageRoundTrip: 14
    })
    expect(report.sourceOnlyPathUsage).toEqual({ _justify: 9, family: 14 })
    expect(report.structuralKindUsage).toMatchObject({
      requires_component: 12,
      requires_path: 1,
      requires_single_source: 10
    })
    expect(report.semanticKindUsage.stateTransition).toBe(8)
    expect(report.rubricKindUsage).toEqual({ invariant: 13, simulation: 9 })
  })
})

describe('findSourceOnlyPaths', () => {
  it('does not repeat descendants when an entire source object is absent', () => {
    expect(findSourceOnlyPaths({ outer: { inner: 1 } }, {})).toEqual(['outer'])
  })
})
