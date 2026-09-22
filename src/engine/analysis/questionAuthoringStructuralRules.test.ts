import { describe, expect, it } from 'vitest'
import {
  AUTHORING_STRUCTURAL_RULE_KINDS,
  authoringStructuralRuleReducer,
  compileAuthoringStructuralRule,
  createAuthoringSingleSourceRule,
  createAuthoringStructuralRule,
  type AuthoringStructuralRuleDraft
} from './questionAuthoringStructuralRules'
import type { StructuralRule } from './structural'

describe('Question Studio structural obligation composer', () => {
  it('covers every catalog structural kind', () => {
    expect(AUTHORING_STRUCTURAL_RULE_KINDS).toEqual([
      'requires_component',
      'requires_category',
      'requires_edge',
      'requires_path',
      'max_component_count',
      'requires_redundancy',
      'forbids_component',
      'requires_connected_graph',
      'requires_single_source',
      'min_node_count',
      'max_node_count'
    ])
  })

  it('compiles the zero-config kinds from just a kind', () => {
    expect(compileAuthoringStructuralRule(createAuthoringSingleSourceRule())).toMatchObject({
      kind: 'requires_single_source',
      description: 'Use exactly one traffic source.'
    })
    expect(
      compileAuthoringStructuralRule(createAuthoringStructuralRule('requires_connected_graph', 'g'))
    ).toMatchObject({ kind: 'requires_connected_graph' })
  })

  it('compiles requires_component with a component and count', () => {
    const draft: AuthoringStructuralRuleDraft = {
      ...createAuthoringStructuralRule('requires_component', 'c1'),
      componentType: 'in-memory-cache',
      minCount: 2
    }
    expect(compileAuthoringStructuralRule(draft)).toMatchObject({
      id: 'c1',
      kind: 'requires_component',
      componentType: 'in-memory-cache',
      minCount: 2
    })
  })

  it('preserves an authored learner-facing description', () => {
    expect(
      compileAuthoringStructuralRule({
        ...createAuthoringStructuralRule('requires_single_source', 'source'),
        description: 'Include exactly one Users traffic source.'
      })
    ).toMatchObject({ description: 'Include exactly one Users traffic source.' })
  })

  it('requires both endpoints for edges and paths', () => {
    const edge = createAuthoringStructuralRule('requires_edge', 'e1')
    expect(compileAuthoringStructuralRule(edge)).toBeNull()
    expect(
      compileAuthoringStructuralRule({
        ...edge,
        fromType: 'load-balancer',
        toType: 'microservice',
        mode: 'synchronous'
      })
    ).toMatchObject({
      kind: 'requires_edge',
      fromType: 'load-balancer',
      toType: 'microservice',
      mode: 'synchronous'
    })
  })

  it('compiles the count-bounded kinds', () => {
    expect(
      compileAuthoringStructuralRule({
        ...createAuthoringStructuralRule('max_component_count', 'm1'),
        componentType: 'load-balancer',
        maxCount: 1
      })
    ).toMatchObject({ kind: 'max_component_count', maxCount: 1 })
    expect(
      compileAuthoringStructuralRule({
        ...createAuthoringStructuralRule('requires_redundancy', 'r1'),
        componentType: 'microservice',
        minReplicas: 3
      })
    ).toMatchObject({ kind: 'requires_redundancy', minReplicas: 3 })
    expect(
      compileAuthoringStructuralRule(createAuthoringStructuralRule('max_node_count', 'n1'))
    ).toMatchObject({ kind: 'max_node_count', count: 12 })
  })

  it('every kind produces a valid StructuralRule when its required fields are filled', () => {
    const filled: Record<string, Partial<AuthoringStructuralRuleDraft>> = {
      requires_component: { componentType: 'microservice' },
      requires_category: { category: 'storage-and-data' },
      requires_edge: { fromType: 'microservice', toType: 'relational-db' },
      requires_path: { fromType: 'microservice', toType: 'relational-db' },
      max_component_count: { componentType: 'load-balancer', maxCount: 1 },
      requires_redundancy: { componentType: 'microservice', minReplicas: 2 },
      forbids_component: { componentType: 'in-memory-cache' },
      requires_connected_graph: {},
      requires_single_source: {},
      min_node_count: { count: 3 },
      max_node_count: { count: 10 }
    }
    for (const kind of AUTHORING_STRUCTURAL_RULE_KINDS) {
      const draft = { ...createAuthoringStructuralRule(kind, `id-${kind}`), ...filled[kind] }
      const compiled = compileAuthoringStructuralRule(draft)
      expect(compiled, kind).not.toBeNull()
      expect((compiled as StructuralRule).kind).toBe(kind)
    }
  })

  it('resets fields on kind change and removes by id', () => {
    const original = {
      ...createAuthoringStructuralRule('requires_component', 'rule-1'),
      componentType: 'microservice'
    }
    const switched = authoringStructuralRuleReducer([original], {
      type: 'update-kind',
      id: 'rule-1',
      kind: 'requires_redundancy'
    })
    expect(switched[0]).toEqual({ id: 'rule-1', kind: 'requires_redundancy', minReplicas: 2 })

    const described = authoringStructuralRuleReducer(
      [{ ...original, description: 'Custom learner copy.' }],
      { type: 'update-kind', id: 'rule-1', kind: 'requires_redundancy' }
    )
    expect(described[0]?.description).toBe('Custom learner copy.')

    const removed = authoringStructuralRuleReducer(switched, { type: 'remove', id: 'rule-1' })
    expect(removed).toEqual([])
  })
})
