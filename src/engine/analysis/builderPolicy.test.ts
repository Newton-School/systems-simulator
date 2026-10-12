import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import {
  createDefaultTraits,
  defaultServiceOperations,
  type CustomNodeDefinition
} from '../catalog/customDefinitions'
import {
  admitDefinitions,
  allowedRuntimeTemplatesFor,
  areDefinitionsLocked,
  BuilderPolicySchema,
  builderAvailability,
  DEFAULT_RESOLVED_BUILDER_POLICY,
  DEFINITIONS_LOCKED_REASON,
  definitionEditBlockReason,
  definitionEntriesFromCanvasNodes,
  definitionEntriesFromTopology,
  definitionFieldLockReason,
  evaluateBuilderPolicy,
  isBuilderPolicyRestrictive,
  normalizeBuilderPolicy,
  resolveBuilderPolicy,
  type DefinitionEntry
} from './builderPolicy'
import { validateAuthoredQuestion } from './authoringValidator'
import {
  buildQuestionTestRows,
  constraintTestId,
  gradeAttempt,
  parseQuestionPackage,
  type QuestionPackage
} from './question'
import type { SimulationOutput } from './output'

function service(overrides: Partial<CustomNodeDefinition> = {}): CustomNodeDefinition {
  return {
    kind: 'service',
    runtimeTemplate: 'long-running-service',
    name: 'Orders',
    traits: createDefaultTraits('long-running-service'),
    operations: defaultServiceOperations(),
    ...overrides
  }
}

function customCache(overrides: Partial<CustomNodeDefinition> = {}): CustomNodeDefinition {
  return {
    kind: 'custom-node',
    runtimeTemplate: 'distributed-cache',
    nodeClass: 'storage',
    name: 'Hot keys',
    traits: createDefaultTraits('distributed-cache'),
    operations: [],
    ...overrides
  }
}

function entry(nodeId: string, definition: CustomNodeDefinition): DefinitionEntry {
  return { nodeId, label: definition.name, definition }
}

describe('builder policy defaults', () => {
  it('an absent policy resolves to today: both builders on, nothing restricted', () => {
    expect(resolveBuilderPolicy(undefined)).toEqual(DEFAULT_RESOLVED_BUILDER_POLICY)
    expect(resolveBuilderPolicy({})).toEqual(DEFAULT_RESOLVED_BUILDER_POLICY)
    expect(isBuilderPolicyRestrictive(undefined)).toBe(false)
    expect(isBuilderPolicyRestrictive({ allowServiceBuilder: true })).toBe(false)
    expect(normalizeBuilderPolicy({ allowServiceBuilder: true, allowMyServices: true })).toBe(
      undefined
    )
  })

  it('the default policy offers every runtime each builder offered before', () => {
    expect(allowedRuntimeTemplatesFor(DEFAULT_RESOLVED_BUILDER_POLICY, 'service')).toEqual([
      'long-running-service',
      'serverless-function',
      'background-worker'
    ])
    expect(allowedRuntimeTemplatesFor(DEFAULT_RESOLVED_BUILDER_POLICY, 'custom-node')).toHaveLength(
      9
    )
  })

  it('the default policy reports nothing for created nodes of any kind', () => {
    const entries = [entry('a', service()), entry('b', customCache())]
    expect(evaluateBuilderPolicy(DEFAULT_RESOLVED_BUILDER_POLICY, entries)).toEqual([])
    expect(
      admitDefinitions(DEFAULT_RESOLVED_BUILDER_POLICY, entries, [entry('c', service())], false)
    ).toEqual({ ok: true })
  })

  it('My Services follows the Service builder', () => {
    expect(resolveBuilderPolicy({ allowServiceBuilder: false }).allowMyServices).toBe(false)
  })

  it('the schema is strict so unimplemented spec fields are not silently ignored', () => {
    expect(BuilderPolicySchema.safeParse({ requireContracts: true }).success).toBe(false)
    expect(BuilderPolicySchema.safeParse({ allowedRuntimeTemplates: ['nope'] }).success).toBe(false)
    expect(
      BuilderPolicySchema.safeParse({
        allowCustomNodeBuilder: false,
        allowedRuntimeTemplates: ['long-running-service'],
        maxDefinitions: 2
      }).success
    ).toBe(true)
  })
})

describe('builder policy findings', () => {
  it('reports each kind of violation with a fix', () => {
    const policy = resolveBuilderPolicy({
      allowCustomNodeBuilder: false,
      allowedRuntimeTemplates: ['long-running-service'],
      allowedTraitPacks: ['capacity', 'workload-profile'],
      maxOperationsPerService: 1,
      maxDefinitions: 1
    })
    const violations = evaluateBuilderPolicy(policy, [
      entry(
        'svc',
        service({
          runtimeTemplate: 'serverless-function',
          traits: createDefaultTraits('serverless-function'),
          operations: [...defaultServiceOperations(), ...defaultServiceOperations()]
        })
      ),
      entry('cache', customCache())
    ])
    const codes = violations.map((violation) => violation.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'runtime-template-not-allowed',
        'trait-pack-not-allowed',
        'too-many-operations',
        'custom-node-builder-disabled',
        'too-many-definitions'
      ])
    )
    for (const violation of violations) {
      expect(violation.fix.length).toBeGreaterThan(0)
    }
    const runtime = violations.find(
      (violation) => violation.code === 'runtime-template-not-allowed'
    )
    expect(runtime?.fix).toContain('Long-running service')
  })

  it('checks node classes against the definition class (or its runtime class)', () => {
    const policy = resolveBuilderPolicy({ allowedNodeClasses: ['compute'] })
    const [violation] = evaluateBuilderPolicy(policy, [entry('cache', customCache())])
    expect(violation.code).toBe('node-class-not-allowed')
    expect(evaluateBuilderPolicy(policy, [entry('svc', service())])).toEqual([])
  })

  it('reads definitions from topology config and canvas data, skipping scaffold nodes', () => {
    const topology = {
      nodes: [
        { id: 'scaffold-svc', type: 'microservice', config: { customDefinition: service() } },
        {
          id: 'mine',
          type: 'in-memory-cache',
          label: 'Mine',
          config: { customDefinition: customCache() }
        },
        { id: 'plain', type: 'microservice', config: {} }
      ]
    } as unknown as TopologyJSON
    expect(definitionEntriesFromTopology(topology, ['scaffold-svc']).map((e) => e.nodeId)).toEqual([
      'mine'
    ])
    expect(
      definitionEntriesFromCanvasNodes([
        { id: 'x', data: { label: 'X', customDefinition: service() } },
        { id: 'y', data: { label: 'Y' } }
      ]).map((e) => e.nodeId)
    ).toEqual(['x'])
  })
})

describe('builder availability, admission and lock', () => {
  it('explains why a builder tile is unavailable', () => {
    const off = resolveBuilderPolicy({ allowServiceBuilder: false })
    expect(builderAvailability(off, 'service', { definitionCount: 0, locked: false })).toEqual({
      available: false,
      reason: 'This question does not allow the Service builder.'
    })
    expect(
      builderAvailability(off, 'my-service', { definitionCount: 0, locked: false }).available
    ).toBe(false)
    expect(
      builderAvailability(off, 'custom-node', { definitionCount: 0, locked: false }).available
    ).toBe(true)

    const capped = resolveBuilderPolicy({ maxDefinitions: 1 })
    expect(
      builderAvailability(capped, 'service', { definitionCount: 1, locked: false }).reason
    ).toContain('at most 1')
    const noRuntime = resolveBuilderPolicy({ allowedRuntimeTemplates: ['distributed-cache'] })
    expect(
      builderAvailability(noRuntime, 'service', { definitionCount: 0, locked: false }).reason
    ).toContain('No service runtime')
    const lock = resolveBuilderPolicy({ lockDefinitionsAfterFirstRun: true })
    expect(builderAvailability(lock, 'service', { definitionCount: 0, locked: true }).reason).toBe(
      DEFINITIONS_LOCKED_REASON
    )
  })

  it('admits incoming definitions only within the policy and the cap', () => {
    const policy = resolveBuilderPolicy({ maxDefinitions: 1 })
    expect(admitDefinitions(policy, [], [entry('a', service())], false)).toEqual({ ok: true })
    expect(
      admitDefinitions(policy, [entry('a', service())], [entry('b', service())], false).ok
    ).toBe(false)
    expect(admitDefinitions(policy, [], [entry('a', service())], true)).toEqual({
      ok: false,
      reason: DEFINITIONS_LOCKED_REASON
    })
    // Non-definition nodes are never blocked.
    expect(admitDefinitions(policy, [entry('a', service())], [], true)).toEqual({ ok: true })
  })

  it('locks only once the attempt has run, and only when the author asked', () => {
    const lock = resolveBuilderPolicy({ lockDefinitionsAfterFirstRun: true })
    expect(areDefinitionsLocked(lock, {})).toBe(false)
    expect(areDefinitionsLocked(lock, { sessionRunCount: 1 })).toBe(true)
    expect(areDefinitionsLocked(lock, { testRunCount: 1 })).toBe(true)
    expect(areDefinitionsLocked(lock, { hasGrade: true })).toBe(true)
    expect(areDefinitionsLocked(DEFAULT_RESOLVED_BUILDER_POLICY, { sessionRunCount: 3 })).toBe(
      false
    )
  })

  it('blocks definition and trait-backed edits when locked or the trait is disallowed', () => {
    const before = {
      customDefinition: service(),
      sim: { resources: { instanceCount: 1 }, maxTokens: 10 }
    } as Record<string, unknown>
    const lock = resolveBuilderPolicy({ lockDefinitionsAfterFirstRun: true })
    expect(
      definitionEditBlockReason(
        lock,
        before,
        { ...before, customDefinition: service({ description: 'x' }) },
        true
      )
    ).toBe(DEFINITIONS_LOCKED_REASON)
    expect(
      definitionEditBlockReason(
        lock,
        before,
        { ...before, sim: { resources: { instanceCount: 3 }, maxTokens: 10 } },
        true
      )
    ).toContain('Capacity')
    expect(
      definitionEditBlockReason(lock, before, { ...before, label: 'renamed' }, true)
    ).toBeNull()
    expect(
      definitionEditBlockReason(
        lock,
        before,
        { ...before, customDefinition: service({ description: 'x' }) },
        false
      )
    ).toBeNull()

    const noRateLimit = resolveBuilderPolicy({
      allowedTraitPacks: ['capacity', 'workload-profile']
    })
    expect(
      definitionEditBlockReason(
        noRateLimit,
        before,
        { ...before, sim: { resources: { instanceCount: 1 }, maxTokens: 50 } },
        false
      )
    ).toContain('Rate limiting')
    expect(definitionFieldLockReason(noRateLimit, before, 'sim.maxTokens', false)).toContain(
      'Rate limiting'
    )
    expect(
      definitionFieldLockReason(noRateLimit, before, 'sim.resources.instanceCount', false)
    ).toBeNull()
    // Palette nodes (no definition) are never affected.
    expect(definitionFieldLockReason(noRateLimit, { sim: {} }, 'sim.maxTokens', true)).toBeNull()
  })
})

const basePackage = {
  version: '1.0',
  id: 'bp',
  title: 'Builder policy',
  difficulty: 'intermediate',
  type: 'open-build',
  prompt: { text: 'design', functionalRequirements: [], nonFunctionalRequirements: [], scale: {} },
  scaffold: { type: 'empty' },
  constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
  suite: { name: 's', visibleToStudent: false, cases: [{ id: 'base' }] },
  rubric: {
    checks: [{ id: 'err', description: 'err', metric: 'summary.errorRate', op: '<', value: 1 }]
  }
}

const okOutput = {
  summary: { errorRate: 0, latency: { p50: 1, p99: 1 }, throughput: 1 },
  perNode: {},
  invariantViolations: [],
  sloBreaches: []
} as unknown as SimulationOutput

function topologyWith(
  nodes: Array<{ id: string; type: string; definition?: CustomNodeDefinition }>
): TopologyJSON {
  return {
    id: 't',
    name: 't',
    version: '2.0.0',
    global: { seed: 's', simulationDuration: 1000, warmupDuration: 0 },
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.id,
      ...(node.definition ? { config: { customDefinition: node.definition } } : {})
    })),
    edges: []
  } as unknown as TopologyJSON
}

describe('builder policy in grading', () => {
  it('a question without a policy grades exactly as before (no extra constraint row)', () => {
    const pkg = parseQuestionPackage(basePackage)
    expect(pkg.builderPolicy).toBeUndefined()
    const grade = gradeAttempt(
      pkg,
      topologyWith([{ id: 'c', type: 'in-memory-cache', definition: customCache() }]),
      () => okOutput
    )
    expect(grade.constraints).toBeUndefined()
    expect(
      buildQuestionTestRows(pkg).some((row) => row.id === constraintTestId('builder-policy'))
    ).toBe(false)
  })

  it('reports a custom node in a question that forbids them as a failed constraint with the fix', () => {
    const pkg = parseQuestionPackage({
      ...basePackage,
      builderPolicy: { allowCustomNodeBuilder: false }
    })
    expect(
      buildQuestionTestRows(pkg).find((row) => row.id === constraintTestId('builder-policy'))
        ?.status
    ).toBe('pending')
    const grade = gradeAttempt(
      pkg,
      topologyWith([
        { id: 'svc', type: 'microservice', definition: service() },
        { id: 'cache', type: 'in-memory-cache', definition: customCache() }
      ]),
      () => okOutput
    )
    const check = grade.constraints?.checks.find((candidate) => candidate.id === 'builder-policy')
    expect(check?.passed).toBe(false)
    expect(check?.detail).toContain('Custom Node builder')
    expect(check?.detail).toContain('Fix:')
    expect(grade.contract.allPassed).toBe(false)
    expect(
      grade.contract.tests.find((test) => test.id === constraintTestId('builder-policy'))?.passed
    ).toBe(false)
  })

  it('keeps componentType grading unchanged and exempts scaffold nodes', () => {
    const scaffold = topologyWith([
      { id: 'given', type: 'in-memory-cache', definition: customCache() }
    ])
    const pkg = {
      ...parseQuestionPackage(basePackage),
      scaffold: { type: 'partial', topology: scaffold },
      constraints: { ...basePackage.constraints, allowedNodeTypes: ['in-memory-cache'] },
      builderPolicy: { allowCustomNodeBuilder: false }
    } as QuestionPackage
    const grade = gradeAttempt(pkg, scaffold, () => okOutput)
    expect(grade.constraints?.checks.map((check) => [check.id, check.passed])).toEqual([
      ['allowed-node-types', true],
      ['builder-policy', true]
    ])
  })
})

describe('builder policy authoring diagnostics', () => {
  it('warns when policy settings cancel each other out', () => {
    const pkg = parseQuestionPackage({
      ...basePackage,
      builderPolicy: {
        allowedRuntimeTemplates: ['distributed-cache'],
        allowedNodeClasses: ['compute']
      }
    }) as QuestionPackage
    const codes = validateAuthoredQuestion(pkg).map((diagnostic) => diagnostic.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'builderPolicy.serviceBuilderUnusable',
        'builderPolicy.customNodeBuilderUnusable',
        'builderPolicy.runtimeClassConflict'
      ])
    )
  })

  it('adds no diagnostics for questions without a policy', () => {
    const pkg = parseQuestionPackage(basePackage)
    expect(
      validateAuthoredQuestion(pkg).filter((diagnostic) =>
        diagnostic.code.startsWith('builderPolicy')
      )
    ).toEqual([])
  })
})

describe('trait-backed field ownership', () => {
  it('only locks fields of trait packs the runtime offers', () => {
    const data = { customDefinition: service(), sim: { nodeErrorRate: 0 } } as Record<
      string,
      unknown
    >
    const policy = resolveBuilderPolicy({ lockDefinitionsAfterFirstRun: true })
    // A long-running service has no external-dependency pack, so its error rate stays editable.
    expect(definitionFieldLockReason(policy, data, 'sim.nodeErrorRate', true)).toBeNull()
    expect(definitionFieldLockReason(policy, data, 'sim.processing.timeout', true)).toContain(
      'Retry and timeout'
    )
  })
})
