import { describe, expect, it } from 'vitest'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import {
  getPathTypeLatencyProfile,
  inferEdgeDefaults,
  inferEdgePathType,
  inferEdgeProtocol
} from './edgeDefaults'

function makeCanvasNode(
  overrides: Partial<CanvasNodeDataV2> &
    Pick<
      CanvasNodeDataV2,
      'templateId' | 'structuralRole' | 'profile' | 'rendererType' | 'label' | 'iconKey'
    >
): CanvasNodeDataV2 {
  return {
    schemaVersion: 2,
    ...overrides
  }
}

describe('edgeDefaults', () => {
  it('uses internet https defaults for client-facing edges', () => {
    const source = makeCanvasNode({
      templateId: 'client-user',
      structuralRole: 'source',
      profile: 'source',
      rendererType: 'serviceNode',
      label: 'Client App',
      iconKey: 'monitor',
      componentType: 'api-endpoint'
    })
    const target = makeCanvasNode({
      templateId: 'load-balancer-l7',
      structuralRole: 'router',
      profile: 'router',
      rendererType: 'serviceNode',
      label: 'Load Balancer L7',
      iconKey: 'lb',
      componentType: 'load-balancer-l7'
    })

    const defaults = inferEdgeDefaults(source, target)

    expect(defaults.protocol).toBe('https')
    expect(defaults.pathType).toBe('internet')
    expect(defaults.bandwidth).toBe(100)
    expect(defaults.errorRatePercent).toBe(0)
  })

  it('uses same-rack tcp defaults and a tighter connection pool for database edges', () => {
    const source = makeCanvasNode({
      templateId: 'backend-server',
      structuralRole: 'processor',
      profile: 'compute-service',
      rendererType: 'computeNode',
      label: 'API Server',
      iconKey: 'server',
      componentType: 'microservice'
    })
    const target = makeCanvasNode({
      templateId: 'primary-db',
      structuralRole: 'storage',
      profile: 'datastore',
      rendererType: 'serviceNode',
      label: 'Primary DB',
      iconKey: 'database',
      componentType: 'relational-db'
    })

    const defaults = inferEdgeDefaults(source, target)

    expect(defaults.protocol).toBe('tcp')
    expect(defaults.pathType).toBe('same-rack')
    expect(defaults.bandwidth).toBe(10_000)
    expect(defaults.maxConcurrentRequests).toBe(50)
  })

  it('uses cross-zone defaults for primary-to-replica replication edges', () => {
    const primary = makeCanvasNode({
      templateId: 'primary-db',
      structuralRole: 'storage',
      profile: 'datastore',
      rendererType: 'serviceNode',
      label: 'Primary DB',
      iconKey: 'database',
      componentType: 'relational-db',
      sim: { replicationRole: 'primary' }
    })
    const replica = makeCanvasNode({
      templateId: 'replica-db',
      structuralRole: 'storage',
      profile: 'datastore',
      rendererType: 'serviceNode',
      label: 'Replica DB',
      iconKey: 'database',
      componentType: 'relational-db',
      sim: { replicationRole: 'replica' }
    })

    expect(inferEdgePathType(primary, replica)).toBe('cross-zone')
    expect(inferEdgeProtocol(primary, replica)).toBe('tcp')
  })

  it('returns a fresh path-type latency profile object', () => {
    const profile = getPathTypeLatencyProfile('same-dc')
    const again = getPathTypeLatencyProfile('same-dc')

    expect(profile).toEqual({ type: 'log-normal', mu: 0, sigma: 0.4 })
    expect(profile).not.toBe(again)
  })
})
