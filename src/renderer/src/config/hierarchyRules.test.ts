import { describe, expect, it } from 'vitest'
import { validatePlacement } from './hierarchyRules'

describe('validatePlacement', () => {
  it('keeps VPC regions at the root', () => {
    expect(validatePlacement('vpc-region', null).valid).toBe(true)
    expect(validatePlacement('vpc-region', 'vpc-region').valid).toBe(false)
  })

  it('allows availability zones at the root or inside a region', () => {
    expect(validatePlacement('availability-zone', null).valid).toBe(true)
    expect(validatePlacement('availability-zone', 'vpc-region').valid).toBe(true)
    expect(validatePlacement('availability-zone', 'subnet').valid).toBe(false)
  })

  it('allows subnets at the root, in a region, or in an availability zone', () => {
    expect(validatePlacement('subnet', null).valid).toBe(true)
    expect(validatePlacement('subnet', 'vpc-region').valid).toBe(true)
    expect(validatePlacement('subnet', 'availability-zone').valid).toBe(true)
    expect(validatePlacement('subnet', 'subnet').valid).toBe(false)
  })

  it('keeps generic resources compatible with current serializer placements', () => {
    for (const parent of [null, 'vpc-region', 'availability-zone', 'subnet'] as const) {
      expect(validatePlacement('backend-server', parent).valid).toBe(true)
    }
  })
})
