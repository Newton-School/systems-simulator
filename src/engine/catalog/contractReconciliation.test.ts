import { describe, expect, it } from 'vitest'
import { reconcileContractWithGraph } from './contractReconciliation'
import type { CustomNodeDefinition } from './customDefinitions'
import type { ComponentType } from '../core/types'

function defWithCacheDep(): CustomNodeDefinition {
  return {
    kind: 'service',
    runtimeTemplate: 'long-running-service',
    operations: [
      {
        id: 'resolve',
        label: 'Resolve',
        requestType: 'resolve',
        responseType: 'redirect',
        dependencies: [
          { target: 'MyCache', targetRole: 'cache', action: 'read', condition: 'always' }
        ]
      }
    ]
  }
}

describe('reconcileContractWithGraph', () => {
  it('flags a declared cache dependency when no cache is reachable', () => {
    const findings = reconcileContractWithGraph({
      definition: defWithCacheDep(),
      nodeId: 'svc',
      edges: [{ source: 'svc', target: 'db' }],
      componentTypeByNodeId: new Map<string, ComponentType>([['db', 'relational-db']])
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].targetRole).toBe('cache')
    expect(findings[0].message).toContain('cache')
  })

  it('is satisfied when a matching cache is directly wired', () => {
    const findings = reconcileContractWithGraph({
      definition: defWithCacheDep(),
      nodeId: 'svc',
      edges: [{ source: 'svc', target: 'cache' }],
      componentTypeByNodeId: new Map<string, ComponentType>([['cache', 'in-memory-cache']])
    })
    expect(findings).toEqual([])
  })

  it('is satisfied when the match is reachable transitively (through a gateway)', () => {
    const findings = reconcileContractWithGraph({
      definition: defWithCacheDep(),
      nodeId: 'svc',
      edges: [
        { source: 'svc', target: 'gw' },
        { source: 'gw', target: 'cache' }
      ],
      componentTypeByNodeId: new Map<string, ComponentType>([
        ['gw', 'api-gateway'],
        ['cache', 'kv-store']
      ])
    })
    expect(findings).toEqual([])
  })

  it('skips dependencies with role "any"', () => {
    const definition = defWithCacheDep()
    definition.operations[0].dependencies[0].targetRole = 'any'
    const findings = reconcileContractWithGraph({
      definition,
      nodeId: 'svc',
      edges: [],
      componentTypeByNodeId: new Map()
    })
    expect(findings).toEqual([])
  })
})
