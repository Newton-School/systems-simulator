import { describe, expect, it } from 'vitest'
import { GEO_LATENCY_COMPONENT_TYPES } from './geoLatency'
import { getTraitCapabilityModulesForComponentType } from './capabilityModules'

describe('trait capability registry', () => {
  it.each(GEO_LATENCY_COMPONENT_TYPES)('registers the geo-latency module for %s', (type) => {
    const names = getTraitCapabilityModulesForComponentType(type).map((m) => m.name)
    expect(names).toContain('network.geo-latency')
  })
})

describe('security traits cover every node type that carries the behaviour', () => {
  const cases: [string, string[]][] = [
    ['security.inspection-cost', ['waf', 'firewall', 'network-policy', 'policy-engine']],
    ['security.crypto-cost', ['kms-storage', 'kms-security']],
    ['security.authentication', ['api-gateway', 'auth-service', 'identity-provider', 'iam-rbac']]
  ]
  it.each(cases)('%s applies to %j', (name, types) => {
    for (const type of types) {
      const names = getTraitCapabilityModulesForComponentType(type as never).map((m) => m.name)
      expect(names).toContain(name)
    }
  })
})
