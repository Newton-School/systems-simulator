import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ComponentType, EdgeDefinition, TopologyJSON } from '../core/types'
import {
  COMPONENT_TYPE_FAMILIES,
  componentTypeSatisfies,
  expandComponentTypeFamilies
} from '../catalog/componentFamilies'
import { PALETTE_TEMPLATES } from '../catalog/paletteTemplates'
import { evaluateStructuralRules, type StructuralRule } from './structural'
import { evaluateSemanticCriteria } from './semanticCriteria'
import { resolveTopologyMetric } from './rubric'
import { gradeAttempt, parseQuestionPackage, type QuestionPackage } from './question'
import { validateAuthoredQuestion } from './authoringValidator'
import { runSimulation } from '../runSimulation'

const LB_FAMILY: ComponentType[] = ['load-balancer', 'load-balancer-l4', 'load-balancer-l7']

function edge(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 100_000,
    maxConcurrentRequests: 2_000_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

/** Users -> <lbType> -> api. */
function design(lbType: ComponentType): TopologyJSON {
  return {
    id: 'family',
    name: 'Family',
    version: '1',
    global: {
      simulationDuration: 1000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1000
    },
    nodes: [
      {
        id: 'users',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'Users',
        position: { x: 0, y: 0 }
      },
      {
        id: 'lb',
        type: lbType,
        category: 'network',
        role: 'router',
        label: 'LB',
        position: { x: 0, y: 0 }
      },
      {
        id: 'api',
        type: 'microservice',
        category: 'compute',
        role: 'processor',
        label: 'API',
        position: { x: 0, y: 0 },
        config: { capacityRps: 100_000, capacityAuthored: true }
      }
    ],
    edges: [edge('users', 'lb'), edge('lb', 'api')],
    workload: {
      sourceNodeId: 'users',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  }
}

function rulesFor(componentType: ComponentType): StructuralRule[] {
  return [
    { id: 'component', kind: 'requires_component', description: 'c', componentType },
    {
      id: 'edge-in',
      kind: 'requires_edge',
      description: 'e',
      fromType: 'api-endpoint',
      toType: componentType
    },
    {
      id: 'path',
      kind: 'requires_path',
      description: 'p',
      fromType: componentType,
      toType: 'microservice'
    },
    {
      id: 'redundancy',
      kind: 'requires_redundancy',
      description: 'r',
      componentType,
      minReplicas: 1
    }
  ]
}

describe('component families: the catalog map', () => {
  it('a generic type accepts its subtypes; subtypes accept only themselves', () => {
    for (const placed of LB_FAMILY) {
      expect(componentTypeSatisfies(placed, 'load-balancer')).toBe(true)
    }
    expect(componentTypeSatisfies('load-balancer', 'load-balancer-l7')).toBe(false)
    expect(componentTypeSatisfies('load-balancer-l4', 'load-balancer-l7')).toBe(false)
    expect(componentTypeSatisfies('load-balancer-l7', 'load-balancer-l7')).toBe(true)
    expect(componentTypeSatisfies('microservice', 'load-balancer')).toBe(false)
    expect([...expandComponentTypeFamilies(['load-balancer-l7'])]).toEqual(['load-balancer-l7'])
    expect([...expandComponentTypeFamilies(['load-balancer'])].sort()).toEqual(LB_FAMILY)
  })

  it('family labels stay in sync with the palette templates', () => {
    for (const family of COMPONENT_TYPE_FAMILIES) {
      for (const member of [family.generic, ...family.subtypes]) {
        expect(PALETTE_TEMPLATES[member.type]?.label).toBe(member.label)
        expect(PALETTE_TEMPLATES[member.type]?.componentType).toBe(member.type)
      }
    }
  })
})

describe('component families: structural rules', () => {
  it.each(LB_FAMILY)('generic load-balancer rules accept a %s design', (lbType) => {
    const evaluation = evaluateStructuralRules(design(lbType), rulesFor('load-balancer'))
    expect(evaluation.passed).toBe(true)
    const component = evaluation.checks.find((check) => check.id === 'component')
    expect(component?.detail).toBe(
      lbType === 'load-balancer' ? undefined : `satisfied by ${lbType} (a load-balancer subtype).`
    )
  })

  it.each(['load-balancer', 'load-balancer-l4'] as const)(
    'an L7 rule rejects a %s design and names the needed type',
    (lbType) => {
      const evaluation = evaluateStructuralRules(design(lbType), rulesFor('load-balancer-l7'))
      expect(evaluation.checks.every((check) => !check.passed)).toBe(true)
      expect(evaluation.checks.find((check) => check.id === 'component')?.detail).toContain(
        'this check needs an L7 (HTTP / gRPC) load balancer specifically (load-balancer-l7).'
      )
    }
  )

  it('an L7 rule accepts an L7 design without a subtype note', () => {
    const evaluation = evaluateStructuralRules(
      design('load-balancer-l7'),
      rulesFor('load-balancer-l7')
    )
    expect(evaluation.passed).toBe(true)
    expect(evaluation.checks.every((check) => check.detail === undefined)).toBe(true)
  })

  it('forbids / caps on the generic type count its subtypes', () => {
    const evaluation = evaluateStructuralRules(design('load-balancer-l7'), [
      { id: 'forbid', kind: 'forbids_component', description: 'f', componentType: 'load-balancer' },
      {
        id: 'cap',
        kind: 'max_component_count',
        description: 'm',
        componentType: 'load-balancer',
        maxCount: 0
      },
      {
        id: 'forbid-l4',
        kind: 'forbids_component',
        description: 'f4',
        componentType: 'load-balancer-l4'
      }
    ])
    expect(evaluation.checks.map((check) => check.passed)).toEqual([false, false, true])
    expect(evaluation.checks[0].detail).toBe(
      'forbidden component load-balancer is present 1 time (counting its subtype load-balancer-l7).'
    )
  })
})

describe('component families: semantic criteria and rubric counts', () => {
  it('componentPresence / guardedPath on the generic type accept a subtype', () => {
    const evaluation = evaluateSemanticCriteria(design('load-balancer-l4'), [
      { id: 'presence', kind: 'componentPresence', componentType: 'load-balancer', points: 1 },
      {
        id: 'guard',
        kind: 'guardedPath',
        from: 'api-endpoint',
        guard: 'load-balancer',
        to: 'microservice',
        points: 1
      }
    ])
    expect(evaluation.passed).toBe(true)
  })

  it('componentPresence on L7 rejects the generic type with a plain-words hint', () => {
    const evaluation = evaluateSemanticCriteria(design('load-balancer'), [
      { id: 'presence', kind: 'componentPresence', componentType: 'load-balancer-l7', points: 1 }
    ])
    expect(evaluation.results[0].outcome).toBe('failed')
    expect(evaluation.results[0].detail).toContain(
      'Load Balancer does not count here: this check needs an L7 (HTTP / gRPC) load balancer'
    )
  })

  it('topology.componentCounts.<generic> counts subtypes; a subtype count is exact', () => {
    expect(
      resolveTopologyMetric(design('load-balancer-l7'), 'topology.componentCounts.load-balancer')
    ).toBe(1)
    expect(
      resolveTopologyMetric(design('load-balancer'), 'topology.componentCounts.load-balancer-l7')
    ).toBe(0)
  })
})

describe('component families: allowed / forbidden node types', () => {
  const quickcart = parseQuestionPackage(
    JSON.parse(
      readFileSync(resolve(__dirname, 'fixtures/quickcart-flash-sale.question.json'), 'utf-8')
    )
  )
  const withConstraints = (
    constraints: Partial<QuestionPackage['constraints']>
  ): QuestionPackage => ({
    ...quickcart,
    constraints: { ...quickcart.constraints, ...constraints }
  })
  const constraintCheck = (pkg: QuestionPackage, lbType: ComponentType, id: string) =>
    gradeAttempt(pkg, design(lbType), runSimulation).constraints?.checks.find((c) => c.id === id)

  it.each(LB_FAMILY)('an allowed generic load-balancer allows %s', (lbType) => {
    expect(constraintCheck(quickcart, lbType, 'allowed-node-types')?.passed).toBe(true)
  })

  it('an allowed L7 rejects the generic and L4, naming the needed type', () => {
    const pkg = withConstraints({
      allowedNodeTypes: ['api-endpoint', 'load-balancer-l7', 'microservice']
    })
    expect(constraintCheck(pkg, 'load-balancer-l7', 'allowed-node-types')?.passed).toBe(true)
    const generic = constraintCheck(pkg, 'load-balancer', 'allowed-node-types')
    expect(generic?.passed).toBe(false)
    expect(generic?.detail).toBe(
      'Found disallowed component types: load-balancer (this question needs an L7 (HTTP / gRPC) load balancer: load-balancer-l7).'
    )
    expect(constraintCheck(pkg, 'load-balancer-l4', 'allowed-node-types')?.passed).toBe(false)
  })

  it('forbidding the generic load-balancer also forbids its subtypes', () => {
    const pkg = withConstraints({
      allowedNodeTypes: undefined,
      forbiddenNodeTypes: ['load-balancer']
    })
    for (const lbType of LB_FAMILY) {
      expect(constraintCheck(pkg, lbType, 'forbidden-node-types')?.passed).toBe(false)
    }
    expect(constraintCheck(pkg, 'load-balancer-l7', 'forbidden-node-types')?.detail).toBe(
      'Found forbidden component types: load-balancer-l7 (a load-balancer subtype).'
    )
  })

  it('forbidding L4 leaves the generic and L7 allowed', () => {
    const pkg = withConstraints({
      allowedNodeTypes: undefined,
      forbiddenNodeTypes: ['load-balancer-l4']
    })
    expect(constraintCheck(pkg, 'load-balancer', 'forbidden-node-types')?.passed).toBe(true)
    expect(constraintCheck(pkg, 'load-balancer-l7', 'forbidden-node-types')?.passed).toBe(true)
    expect(constraintCheck(pkg, 'load-balancer-l4', 'forbidden-node-types')?.passed).toBe(false)
  })

  it('the authoring validator flags a required component the constraints make unplaceable', () => {
    const codes = (pkg: QuestionPackage) =>
      validateAuthoredQuestion(pkg)
        .filter((d) => d.code === 'constraints.requiredComponentUnplaceable')
        .map((d) => d.path)
    expect(codes(quickcart)).toEqual([])
    // Allowing only an L4 still satisfies the generic requirement.
    expect(
      codes(
        withConstraints({ allowedNodeTypes: ['api-endpoint', 'load-balancer-l4', 'microservice'] })
      )
    ).toEqual([])
    expect(codes(withConstraints({ allowedNodeTypes: ['api-endpoint', 'microservice'] }))).toEqual([
      'structuralRules[0]',
      'rubric.checks[1].metric'
    ])
    expect(
      codes(withConstraints({ allowedNodeTypes: undefined, forbiddenNodeTypes: ['load-balancer'] }))
    ).toEqual(['structuralRules[0]', 'rubric.checks[1].metric'])
  })
})
