import { describe, expect, it } from 'vitest'
import { SEMANTIC_AUTHORING_CAPABILITIES } from './authoringCapabilities'
import {
  AUTHORING_SEMANTIC_RULE_KINDS,
  AUTHORING_SEMANTIC_RULE_KIND_META,
  authoringSemanticRuleReducer,
  compileAuthoringSemanticRule,
  createAuthoringSemanticRule,
  type AuthoringSemanticRuleDraft
} from './questionAuthoringSemanticRules'

describe('Question Studio semantic obligation composer', () => {
  it('covers every semantic kind in the registry, including runtime-trace kinds', () => {
    for (const kind of AUTHORING_SEMANTIC_RULE_KINDS) {
      const capability = SEMANTIC_AUTHORING_CAPABILITIES.find(
        (definition) => definition.id === kind
      )
      expect(capability, kind).toBeDefined()
    }
    // Runtime-trace kinds are now authorable (stateTransition / stateSequence).
    expect(AUTHORING_SEMANTIC_RULE_KINDS).toContain('stateTransition')
    expect(AUTHORING_SEMANTIC_RULE_KINDS).toContain('stateSequence')
    expect(AUTHORING_SEMANTIC_RULE_KIND_META).toHaveLength(AUTHORING_SEMANTIC_RULE_KINDS.length)
  })

  it('compiles a complete guarded-path draft into the canonical criterion', () => {
    const draft: AuthoringSemanticRuleDraft = {
      ...createAuthoringSemanticRule('guardedPath', 'guard-1'),
      from: 'microservice',
      guard: 'in-memory-cache',
      to: 'kv-store',
      points: 3
    }
    expect(compileAuthoringSemanticRule(draft)).toEqual({
      id: 'guard-1',
      kind: 'guardedPath',
      from: 'microservice',
      guard: 'in-memory-cache',
      to: 'kv-store',
      points: 3
    })
  })

  it('treats the guarded-path destination as optional', () => {
    const draft: AuthoringSemanticRuleDraft = {
      ...createAuthoringSemanticRule('guardedPath', 'guard-2'),
      from: 'microservice',
      guard: 'rate-limiter'
    }
    expect(compileAuthoringSemanticRule(draft)).toEqual({
      id: 'guard-2',
      kind: 'guardedPath',
      from: 'microservice',
      guard: 'rate-limiter',
      points: 1
    })
  })

  it('requires both placement endpoints when either is set', () => {
    const half: AuthoringSemanticRuleDraft = {
      ...createAuthoringSemanticRule('placement', 'place-1'),
      componentType: 'in-memory-cache',
      betweenFrom: 'microservice'
    }
    expect(compileAuthoringSemanticRule(half)).toBeNull()

    const full: AuthoringSemanticRuleDraft = { ...half, betweenTo: 'kv-store' }
    expect(compileAuthoringSemanticRule(full)).toEqual({
      id: 'place-1',
      kind: 'placement',
      componentType: 'in-memory-cache',
      between: ['microservice', 'kv-store'],
      points: 1
    })
  })

  it('rejects a fan-out below two consumers and a store-fit with no accepted store', () => {
    const fanout: AuthoringSemanticRuleDraft = {
      ...createAuthoringSemanticRule('fanout', 'fan-1'),
      broker: 'message-broker',
      minConsumers: 1
    }
    expect(compileAuthoringSemanticRule(fanout)).toBeNull()
    expect(compileAuthoringSemanticRule({ ...fanout, minConsumers: 2 })).toEqual({
      id: 'fan-1',
      kind: 'fanout',
      broker: 'message-broker',
      minConsumers: 2,
      points: 1
    })

    const storeFit = createAuthoringSemanticRule('storageFit', 'store-1')
    expect(compileAuthoringSemanticRule(storeFit)).toBeNull()
    expect(compileAuthoringSemanticRule({ ...storeFit, accept: ['kv-store'] })).toEqual({
      id: 'store-1',
      kind: 'storageFit',
      accessPattern: 'point-lookup',
      accept: ['kv-store'],
      points: 1
    })
  })

  it('refuses to compile a rule with non-positive points', () => {
    const draft: AuthoringSemanticRuleDraft = {
      ...createAuthoringSemanticRule('forbidUnjustified', 'forbid-1'),
      componentType: 'cdn',
      points: 0
    }
    expect(compileAuthoringSemanticRule(draft)).toBeNull()
    expect(compileAuthoringSemanticRule({ ...draft, points: 2 })).toEqual({
      id: 'forbid-1',
      kind: 'forbidUnjustified',
      componentType: 'cdn',
      points: 2
    })
  })

  it('resets kind-specific fields when the kind changes but keeps id and points', () => {
    const original: AuthoringSemanticRuleDraft = {
      ...createAuthoringSemanticRule('guardedPath', 'rule-1'),
      from: 'microservice',
      guard: 'in-memory-cache',
      points: 5
    }
    const switched = authoringSemanticRuleReducer([original], {
      type: 'update-kind',
      id: 'rule-1',
      kind: 'fanout'
    })
    expect(switched[0]).toEqual({
      id: 'rule-1',
      kind: 'fanout',
      points: 5,
      minConsumers: 2
    })
  })

  it('carries hardFail, storageFit partial/antiPattern, and fanout forbiddenBroker', () => {
    expect(
      compileAuthoringSemanticRule({
        ...createAuthoringSemanticRule('guardedPath', 'g'),
        from: 'api-endpoint',
        guard: 'idempotency-manager',
        hardFail: true
      })
    ).toMatchObject({ kind: 'guardedPath', hardFail: true })

    expect(
      compileAuthoringSemanticRule({
        ...createAuthoringSemanticRule('storageFit', 's'),
        accept: ['kv-store'],
        partial: ['in-memory-cache'],
        antiPattern: ['relational-db'],
        hardFail: true
      })
    ).toMatchObject({
      kind: 'storageFit',
      accept: ['kv-store'],
      partial: ['in-memory-cache'],
      antiPattern: ['relational-db'],
      hardFail: true
    })

    expect(
      compileAuthoringSemanticRule({
        ...createAuthoringSemanticRule('fanout', 'f'),
        broker: 'message-broker',
        minConsumers: 2,
        forbiddenBroker: 'queue'
      })
    ).toMatchObject({ kind: 'fanout', forbiddenBroker: 'queue' })
  })

  it('patches, dedupes, and removes rules by stable id', () => {
    const original = createAuthoringSemanticRule('guardedPath', 'rule-1')
    const duplicate = authoringSemanticRuleReducer([original], {
      type: 'add',
      rule: { ...original, guard: 'conflict' }
    })
    expect(duplicate).toEqual([original])

    const patched = authoringSemanticRuleReducer(duplicate, {
      type: 'update',
      id: 'rule-1',
      changes: { from: 'microservice', guard: 'rate-limiter' }
    })
    expect(patched[0]).toMatchObject({ id: 'rule-1', from: 'microservice', guard: 'rate-limiter' })

    const removed = authoringSemanticRuleReducer(patched, { type: 'remove', id: 'rule-1' })
    expect(removed).toEqual([])
  })
})
