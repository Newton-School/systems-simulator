import { describe, expect, it } from 'vitest'
import {
  buildSupportLedgerMessage,
  getComponentCategorySupport,
  getConceptSupport,
  getDomainSupport,
  getTraitSupport,
  supportTierNeedsAuthorWarning
} from './supportLedger'

describe('support ledger', () => {
  it('marks compute as first-class and network as guided', () => {
    expect(getDomainSupport('compute').tier).toBe('first-class')
    expect(getDomainSupport('network').tier).toBe('guided')
  })

  it('normalizes known concept and trait lookups', () => {
    expect(getConceptSupport('Read-Cache')?.tier).toBe('first-class')
    expect(getTraitSupport('QUEUE.ACK-AND-RELEASE')?.tier).toBe('guided')
    expect(getTraitSupport('stream.partitioned-broker')?.tier).toBe('guided')
    expect(getConceptSupport('consumer-groups')?.tier).toBe('guided')
  })

  it('tracks presentational-only component categories', () => {
    expect(getComponentCategorySupport('observability').tier).toBe('presentational-only')
  })

  it('only requires warnings for non-first-class support tiers', () => {
    expect(supportTierNeedsAuthorWarning('first-class')).toBe(false)
    expect(supportTierNeedsAuthorWarning('guided')).toBe(true)
    expect(supportTierNeedsAuthorWarning('deferred')).toBe(true)
  })

  it('builds a readable support warning message', () => {
    expect(buildSupportLedgerMessage("domain 'network'", getDomainSupport('network'))).toContain(
      'domain'
    )
  })
})
