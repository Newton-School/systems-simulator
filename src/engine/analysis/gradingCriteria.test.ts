import { describe, expect, it } from 'vitest'
import {
  parseBudget,
  parseJustifyPrompt,
  parseSemanticCriterion,
  type SemanticCriterion
} from './gradingCriteria'
import { parseQuestionPackage, type QuestionPackage } from './question'

describe('parseSemanticCriterion', () => {
  const cases: SemanticCriterion[] = [
    {
      id: 'cache-placement',
      kind: 'placement',
      points: 20,
      componentType: 'cache' as never,
      between: ['microservice', 'sql-database'] as never,
      notBefore: 'load-balancer' as never
    },
    {
      id: 'limiter-guard',
      kind: 'guardedPath',
      points: 30,
      hardFail: true,
      from: 'api-gateway' as never,
      guard: 'cache' as never
    },
    {
      id: 'purchase-fanout',
      kind: 'fanout',
      points: 15,
      broker: 'event-broker' as never,
      minConsumers: 3,
      forbiddenBroker: 'message-queue' as never
    },
    {
      id: 'iot-storage',
      kind: 'storageFit',
      points: 60,
      hardFail: true,
      accessPattern: 'time-series',
      accept: ['wide-column-db'] as never,
      partial: ['key-value-store'] as never,
      antiPattern: ['sql-database'] as never
    },
    {
      id: 'cdn-omission',
      kind: 'forbidUnjustified',
      points: 10,
      componentType: 'cdn' as never,
      justifyId: 'why-cdn'
    }
  ]

  it('round-trips every semantic criterion kind', () => {
    for (const criterion of cases) {
      expect(parseSemanticCriterion(criterion)).toEqual(criterion)
    }
  })

  it('rejects an unknown kind and a missing required field', () => {
    expect(() => parseSemanticCriterion({ id: 'x', kind: 'nope', points: 1 })).toThrow()
    // storageFit requires a non-empty accept list
    expect(() =>
      parseSemanticCriterion({
        id: 's',
        kind: 'storageFit',
        points: 1,
        accessPattern: 'time-series',
        accept: []
      })
    ).toThrow()
  })
})

describe('parseJustifyPrompt / parseBudget', () => {
  it('round-trips a justification prompt', () => {
    const prompt = {
      id: 'why-db',
      decision: 'Why this database type for the write path?',
      boundTo: { nodeId: 'primary-store' },
      requires: { choice: true, number: true, tradeoff: true },
      acceptTradeoffTokens: ['joins', 'transactions']
    }
    expect(parseJustifyPrompt(prompt)).toEqual(prompt)
  })

  it('round-trips a budget and rejects a non-positive cap', () => {
    expect(parseBudget({ unit: 'cost', cap: 1200 })).toEqual({ unit: 'cost', cap: 1200 })
    expect(() => parseBudget({ unit: 'nodes', cap: 0 })).toThrow()
  })
})

describe('QuestionPackage integration', () => {
  const basePackage: QuestionPackage = {
    version: '1.0',
    id: 'q-iot',
    title: 'IoT storage',
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'Design the storage layer.',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: { name: 'suite', visibleToStudent: false, cases: [{ id: 'baseline' }] },
    rubric: {
      checks: [
        { id: 'err', description: 'error rate', metric: 'summary.errorRate', op: '<', value: 0.1 }
      ]
    }
  }

  it('accepts the new grading axes on a package (optional, non-breaking)', () => {
    const parsed = parseQuestionPackage({
      ...basePackage,
      workloadCategory: 'write-heavy',
      budget: { unit: 'cost', cap: 500 },
      semanticCriteria: [
        {
          id: 'iot-storage',
          kind: 'storageFit',
          points: 60,
          accessPattern: 'time-series',
          accept: ['wide-column-db']
        }
      ],
      justify: [
        {
          id: 'why-db',
          decision: 'Why this DB type?',
          requires: { choice: true, tradeoff: true }
        }
      ]
    })

    expect(parsed.workloadCategory).toBe('write-heavy')
    expect(parsed.semanticCriteria?.[0].kind).toBe('storageFit')
    expect(parsed.justify?.[0].id).toBe('why-db')
    expect(parsed.budget?.cap).toBe(500)
  })

  it('still parses a package with none of the new fields', () => {
    expect(parseQuestionPackage(basePackage).semanticCriteria).toBeUndefined()
  })

  it('rejects duplicate semantic-criterion ids', () => {
    expect(() =>
      parseQuestionPackage({
        ...basePackage,
        semanticCriteria: [
          { id: 'dup', kind: 'forbidUnjustified', points: 5, componentType: 'cdn' },
          { id: 'dup', kind: 'forbidUnjustified', points: 5, componentType: 'cache' }
        ]
      })
    ).toThrow(/semanticCriteria|unique/i)
  })
})
