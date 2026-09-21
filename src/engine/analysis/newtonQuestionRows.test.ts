import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SemanticCriterion } from './gradingCriteria'
import {
  compileQuestionPackageToNewtonRows,
  parseNewtonRowsToQuestionPackage,
  toNewtonRowsSeed
} from './newtonQuestionRows'
import { parseQuestionPackage, type QuestionPackage } from './question'
import type { StructuralRule } from './structural'

function minimalQuestion(overrides: Partial<QuestionPackage> = {}): QuestionPackage {
  return parseQuestionPackage({
    version: '1.0',
    id: 'row-codec-fixture',
    title: 'Row codec fixture',
    description: 'A complete metadata fixture.',
    difficulty: 'beginner',
    tags: ['codec'],
    estimatedTimeMinutes: 15,
    type: 'open-build',
    entryFormat: 'blank-canvas',
    prompt: {
      text: 'Build a safe request path.',
      functionalRequirements: ['Serve reads'],
      nonFunctionalRequirements: [
        {
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms',
          description: 'p99 stays below 100ms'
        }
      ],
      scale: { peakRps: 1000 },
      additionalContext: 'Prefer a small design.'
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    workloadCategory: 'read-heavy',
    domains: ['compute'],
    concepts: ['read-cache'],
    suite: {
      name: 'codec-suite',
      visibleToStudent: false,
      cases: [
        {
          id: 'peak',
          workload: {
            baseRps: 1000,
            requestDistribution: [{ type: 'read', weight: 1, sizeBytes: 256 }]
          }
        }
      ]
    },
    rubric: {
      version: '1.0',
      id: 'codec-rubric',
      passThreshold: 1,
      checks: [
        {
          id: 'p99',
          description: 'p99 under 100ms',
          metric: 'summary.latency.p99',
          op: '<',
          value: 100,
          points: 2
        }
      ]
    },
    author: 'DSDS',
    createdAt: '2026-09-18T00:00:00.000Z',
    ...overrides
  })
}

function canonicalQuestions(): QuestionPackage[] {
  const root = resolve(process.cwd(), 'ns-simulator-docs/examples/question-bank')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) =>
      parseQuestionPackage(
        JSON.parse(readFileSync(join(root, entry.name, 'question.json'), 'utf8')) as unknown
      )
    )
}

describe('Newton question row codec', () => {
  it('compiles a typed SIMULATOR_CONFIG row with lossless prompt and metadata fields', () => {
    const question = minimalQuestion()
    const compiled = compileQuestionPackageToNewtonRows(question)

    expect(compiled.rows[0]).toMatchObject({
      order: 1,
      title: 'SIMULATOR_CONFIG: row-codec-fixture',
      hidden: false,
      output: '',
      spec: {
        type: 'SIMULATOR_CONFIG',
        configVersion: '1.0',
        questionId: question.id,
        presentationMode: 'raw-html',
        presentation: { prompt: question.prompt.text },
        author: 'DSDS'
      }
    })
    expect(compiled.questionTextHtml).toContain('<h3>Functional Requirements</h3>')
    expect(parseNewtonRowsToQuestionPackage(toNewtonRowsSeed(compiled)).questionPackage).toEqual(
      question
    )
  })

  it('exports every structural rule kind as an ordered STRUCTURAL_RULE row', () => {
    const structuralRules: StructuralRule[] = [
      { id: 'a', description: 'a', kind: 'requires_component', componentType: 'microservice' },
      { id: 'b', description: 'b', kind: 'requires_category', category: 'compute' },
      {
        id: 'c',
        description: 'c',
        kind: 'requires_edge',
        fromType: 'api-endpoint',
        toType: 'microservice'
      },
      {
        id: 'd',
        description: 'd',
        kind: 'max_component_count',
        componentType: 'microservice',
        maxCount: 2
      },
      {
        id: 'e',
        description: 'e',
        kind: 'requires_redundancy',
        componentType: 'microservice',
        minReplicas: 2
      },
      { id: 'f', description: 'f', kind: 'forbids_component', componentType: 'cdn' },
      { id: 'g', description: 'g', kind: 'requires_connected_graph' },
      { id: 'h', description: 'h', kind: 'requires_single_source' },
      { id: 'i', description: 'i', kind: 'min_node_count', count: 2 },
      { id: 'j', description: 'j', kind: 'max_node_count', count: 10 },
      {
        id: 'k',
        description: 'k',
        kind: 'requires_path',
        fromType: 'api-endpoint',
        toType: 'microservice'
      }
    ]
    const compiled = compileQuestionPackageToNewtonRows(minimalQuestion({ structuralRules }))
    const rows = compiled.rows.filter((row) => row.spec.type === 'STRUCTURAL_RULE')

    expect(rows.map((row) => row.spec.kind)).toEqual(structuralRules.map((rule) => rule.kind))
    expect(rows.map((row) => row.order)).toEqual(structuralRules.map((_, index) => index + 2))
  })

  it('exports every semantic criterion kind before rubric rows', () => {
    const semanticCriteria: SemanticCriterion[] = [
      { id: 'a', kind: 'placement', componentType: 'in-memory-cache', points: 1 },
      {
        id: 'b',
        kind: 'guardedPath',
        from: 'api-endpoint',
        guard: 'rate-limiter',
        to: 'microservice',
        points: 1
      },
      { id: 'c', kind: 'fanout', broker: 'pub-sub', minConsumers: 2, points: 1 },
      {
        id: 'd',
        kind: 'storageFit',
        accessPattern: 'point-lookup',
        accept: ['kv-store'],
        points: 1
      },
      { id: 'e', kind: 'forbidUnjustified', componentType: 'cdn', points: 1 },
      {
        id: 'f',
        kind: 'stateTransition',
        match: { scope: 'protocol', state: 'session-open' },
        minCount: 1,
        points: 1
      },
      {
        id: 'g',
        kind: 'stateSequence',
        sequence: [
          { scope: 'protocol', state: 'session-open' },
          { scope: 'protocol', state: 'session-closed' }
        ],
        points: 1
      }
    ]
    const compiled = compileQuestionPackageToNewtonRows(minimalQuestion({ semanticCriteria }))
    const types = compiled.rows.map((row) => row.spec.type)

    expect(
      compiled.rows
        .filter((row) => row.spec.type === 'SEMANTIC_CRITERION')
        .map((row) => row.spec.kind)
    ).toEqual(semanticCriteria.map((criterion) => criterion.kind))
    expect(types.at(-1)).toBe('RUBRIC_CHECK')
  })

  it('keeps deterministic config → structural → semantic → rubric ordering', () => {
    const question = minimalQuestion({
      structuralRules: [{ id: 'source', description: 'source', kind: 'requires_single_source' }],
      semanticCriteria: [
        {
          id: 'fit',
          kind: 'storageFit',
          accessPattern: 'point-lookup',
          accept: ['kv-store'],
          points: 1
        }
      ]
    })
    const first = compileQuestionPackageToNewtonRows(question)
    const second = compileQuestionPackageToNewtonRows(question)

    expect(first.rows.map((row) => row.spec.type)).toEqual([
      'SIMULATOR_CONFIG',
      'STRUCTURAL_RULE',
      'SEMANTIC_CRITERION',
      'RUBRIC_CHECK'
    ])
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('round-trips every canonical package through rows without normalized drift', () => {
    const questions = canonicalQuestions()
    expect(questions).toHaveLength(14)

    for (const question of questions) {
      const compiled = compileQuestionPackageToNewtonRows(question)
      const decoded = parseNewtonRowsToQuestionPackage(toNewtonRowsSeed(compiled)).questionPackage
      expect(decoded, question.id).toEqual(question)
    }
  })

  it('keeps source-only family and legacy _justify outside the normalized runtime package', () => {
    const raw = {
      ...minimalQuestion(),
      family: 'compute',
      _justify: [{ id: 'legacy' }]
    }
    const normalized = parseQuestionPackage(raw)
    const compiled = compileQuestionPackageToNewtonRows(normalized)
    const config = compiled.rows[0].spec

    expect(config).not.toHaveProperty('family')
    expect(config).not.toHaveProperty('_justify')
  })
})
