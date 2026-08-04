import { describe, expect, it } from 'vitest'
import type { ComponentNode, ComponentType, EdgeDefinition, TopologyJSON } from '../core/types'
import type { SemanticCriterion } from './gradingCriteria'
import { evaluateSemanticCriteria, type SemanticContext } from './semanticCriteria'

// ── tiny topology builder ────────────────────────────────────────────────────

let seq = 0
function node(type: ComponentType, id?: string): ComponentNode {
  return {
    id: id ?? `${type}-${seq++}`,
    type,
    category: 'compute',
    label: type,
    position: { x: 0, y: 0 }
  } as unknown as ComponentNode
}

function edge(source: string, target: string): EdgeDefinition {
  return { id: `${source}->${target}`, source, target } as unknown as EdgeDefinition
}

function topo(nodes: ComponentNode[], edges: EdgeDefinition[]): TopologyJSON {
  return {
    version: '1.0',
    id: 'test-topo',
    name: 'test',
    nodes,
    edges
  } as unknown as TopologyJSON
}

// A linear read path: microservice → in-memory-cache → kv-store
function guardedTopo(): TopologyJSON {
  const svc = node('microservice' as ComponentType, 'svc')
  const cache = node('in-memory-cache' as ComponentType, 'cache')
  const store = node('kv-store' as ComponentType, 'store')
  return topo([svc, cache, store], [edge('svc', 'cache'), edge('cache', 'store')])
}

describe('guardedPath', () => {
  const criterion: SemanticCriterion = {
    id: 'reads-through-cache',
    kind: 'guardedPath',
    from: 'microservice' as ComponentType,
    guard: 'in-memory-cache' as ComponentType,
    to: 'kv-store' as ComponentType,
    points: 3
  }

  it('passes when all traffic traverses the guard', () => {
    const res = evaluateSemanticCriteria(guardedTopo(), [criterion])
    expect(res.results[0].outcome).toBe('passed')
    expect(res.pointsEarned).toBe(3)
  })

  it('fails when a path bypasses the guard', () => {
    // svc → store directly, plus svc → cache → store: a bypass exists.
    const t = topo(
      [
        node('microservice' as ComponentType, 'svc'),
        node('in-memory-cache' as ComponentType, 'cache'),
        node('kv-store' as ComponentType, 'store')
      ],
      [edge('svc', 'cache'), edge('cache', 'store'), edge('svc', 'store')]
    )
    const res = evaluateSemanticCriteria(t, [criterion])
    expect(res.results[0].outcome).toBe('failed')
    expect(res.results[0].detail).toMatch(/without passing through/i)
  })

  it('fails when the guard is absent', () => {
    const t = topo(
      [node('microservice' as ComponentType, 'svc'), node('kv-store' as ComponentType, 'store')],
      [edge('svc', 'store')]
    )
    const res = evaluateSemanticCriteria(t, [criterion])
    expect(res.results[0].outcome).toBe('failed')
    expect(res.results[0].detail).toMatch(/guard .* absent/i)
  })
})

describe('placement', () => {
  it('between: passes when the component sits on the A→B path', () => {
    const c: SemanticCriterion = {
      id: 'cache-between',
      kind: 'placement',
      componentType: 'in-memory-cache' as ComponentType,
      between: ['microservice' as ComponentType, 'kv-store' as ComponentType],
      points: 2
    }
    expect(evaluateSemanticCriteria(guardedTopo(), [c]).results[0].outcome).toBe('passed')
  })

  it('notBefore: fails when the component is upstream of the forbidden type', () => {
    // cache → load-balancer : cache appears before the LB, which is wrong.
    const t = topo(
      [
        node('in-memory-cache' as ComponentType, 'cache'),
        node('load-balancer' as ComponentType, 'lb')
      ],
      [edge('cache', 'lb')]
    )
    const c: SemanticCriterion = {
      id: 'cache-not-before-lb',
      kind: 'placement',
      componentType: 'in-memory-cache' as ComponentType,
      notBefore: 'load-balancer' as ComponentType,
      points: 2
    }
    const res = evaluateSemanticCriteria(t, [c])
    expect(res.results[0].outcome).toBe('failed')
    expect(res.results[0].detail).toMatch(/before/i)
  })

  it('orderedPipeline: passes in order, fails out of order', () => {
    const pipeline = [
      'load-balancer' as ComponentType,
      'microservice' as ComponentType,
      'kv-store' as ComponentType
    ]
    const good = topo(
      [
        node('load-balancer' as ComponentType, 'lb'),
        node('microservice' as ComponentType, 'svc'),
        node('kv-store' as ComponentType, 'store')
      ],
      [edge('lb', 'svc'), edge('svc', 'store')]
    )
    const c: SemanticCriterion = {
      id: 'pipeline',
      kind: 'placement',
      componentType: 'microservice' as ComponentType,
      orderedPipeline: pipeline,
      points: 3
    }
    expect(evaluateSemanticCriteria(good, [c]).results[0].outcome).toBe('passed')

    // reversed edges: lb never reaches the store through the service
    const bad = topo(
      [
        node('load-balancer' as ComponentType, 'lb'),
        node('microservice' as ComponentType, 'svc'),
        node('kv-store' as ComponentType, 'store')
      ],
      [edge('store', 'svc'), edge('svc', 'lb')]
    )
    expect(evaluateSemanticCriteria(bad, [c]).results[0].outcome).toBe('failed')
  })
})

describe('fanout', () => {
  const criterion: SemanticCriterion = {
    id: 'broker-fanout',
    kind: 'fanout',
    broker: 'message-broker' as ComponentType,
    minConsumers: 2,
    forbiddenBroker: 'queue' as ComponentType,
    points: 2,
    hardFail: true
  }

  it('passes when a broker fans out to enough distinct consumers', () => {
    const t = topo(
      [
        node('message-broker' as ComponentType, 'broker'),
        node('microservice' as ComponentType, 'c1'),
        node('microservice' as ComponentType, 'c2')
      ],
      [edge('broker', 'c1'), edge('broker', 'c2')]
    )
    expect(evaluateSemanticCriteria(t, [criterion]).results[0].outcome).toBe('passed')
  })

  it('hard-fails when a queue is misused for fan-out', () => {
    const t = topo(
      [
        node('queue' as ComponentType, 'q'),
        node('microservice' as ComponentType, 'c1'),
        node('microservice' as ComponentType, 'c2')
      ],
      [edge('q', 'c1'), edge('q', 'c2')]
    )
    const res = evaluateSemanticCriteria(t, [criterion])
    expect(res.results[0].outcome).toBe('failed')
    expect(res.results[0].hardFailed).toBe(true)
    expect(res.hardFailed).toBe(true)
    expect(res.results[0].detail).toMatch(/not fan-out/i)
  })
})

describe('storageFit', () => {
  const criterion: SemanticCriterion = {
    id: 'store-fit',
    kind: 'storageFit',
    accessPattern: 'point-lookup',
    accept: ['kv-store' as ComponentType, 'nosql-db' as ComponentType],
    partial: ['in-memory-cache' as ComponentType],
    antiPattern: ['relational-db' as ComponentType],
    points: 3,
    hardFail: true
  }

  it('passes on an accepted store', () => {
    const t = topo([node('kv-store' as ComponentType)], [])
    expect(evaluateSemanticCriteria(t, [criterion]).results[0].outcome).toBe('passed')
  })

  it('is partial on a defensible store (half points, floored)', () => {
    const t = topo([node('in-memory-cache' as ComponentType)], [])
    const res = evaluateSemanticCriteria(t, [criterion])
    expect(res.results[0].outcome).toBe('partial')
    expect(res.results[0].pointsEarned).toBe(1) // floor(3/2)
  })

  it('hard-fails on an anti-pattern store', () => {
    const t = topo([node('relational-db' as ComponentType)], [])
    const res = evaluateSemanticCriteria(t, [criterion])
    expect(res.results[0].outcome).toBe('failed')
    expect(res.results[0].hardFailed).toBe(true)
    expect(res.results[0].detail).toMatch(/anti-pattern/i)
  })

  it('fails when no fitting store is present', () => {
    const t = topo([node('microservice' as ComponentType)], [])
    expect(evaluateSemanticCriteria(t, [criterion]).results[0].outcome).toBe('failed')
  })
})

describe('forbidUnjustified', () => {
  const criterion: SemanticCriterion = {
    id: 'cdn-justified',
    kind: 'forbidUnjustified',
    componentType: 'cdn' as ComponentType,
    justifyId: 'why-cdn',
    points: 2
  }

  it('passes when the component is absent', () => {
    const t = topo([node('microservice' as ComponentType)], [])
    expect(evaluateSemanticCriteria(t, [criterion]).results[0].outcome).toBe('passed')
  })

  it('passes when present and defended by a valid justification', () => {
    const t = topo([node('cdn' as ComponentType)], [])
    const ctx: SemanticContext = { justificationPassed: (id) => id === 'why-cdn' }
    expect(evaluateSemanticCriteria(t, [criterion], ctx).results[0].outcome).toBe('passed')
  })

  it('fails when present but undefended', () => {
    const t = topo([node('cdn' as ComponentType)], [])
    const ctx: SemanticContext = { justificationPassed: () => false }
    expect(evaluateSemanticCriteria(t, [criterion], ctx).results[0].outcome).toBe('failed')
  })

  it('fails conservatively when present and no justification result exists', () => {
    const t = topo([node('cdn' as ComponentType)], [])
    const res = evaluateSemanticCriteria(t, [criterion]) // no ctx
    expect(res.results[0].outcome).toBe('failed')
    expect(res.results[0].detail).toMatch(/not evaluated/i)
  })
})

describe('aggregation', () => {
  it('sums points and flags a hard fail across the batch', () => {
    const criteria: SemanticCriterion[] = [
      {
        id: 'good',
        kind: 'storageFit',
        accessPattern: 'point-lookup',
        accept: ['kv-store' as ComponentType],
        points: 3
      },
      {
        id: 'bad',
        kind: 'storageFit',
        accessPattern: 'point-lookup',
        accept: ['kv-store' as ComponentType],
        antiPattern: ['relational-db' as ComponentType],
        points: 3,
        hardFail: true
      }
    ]
    const t = topo([node('kv-store' as ComponentType), node('relational-db' as ComponentType)], [])
    const res = evaluateSemanticCriteria(t, criteria)
    expect(res.pointsPossible).toBe(6)
    expect(res.pointsEarned).toBe(3) // good passes (3), bad fails (0)
    expect(res.passed).toBe(false)
    expect(res.hardFailed).toBe(true)
  })
})
