import { describe, expect, it } from 'vitest'
import {
  deriveIdAllocationDistribution,
  idAllocationMeanMs,
  ID_COORDINATION_MS,
  ID_LOCAL_SERVE_MS
} from './idAllocation'
import { instantiateTemplate } from './paletteTemplates'

describe('id-generator palette node', () => {
  it('seeds a range-allocator allocation config with a derived mixture service time', () => {
    const data = instantiateTemplate('id-generator')
    expect(data.componentType).toBe('microservice')
    expect(data.sim?.idAllocation).toEqual({
      kind: 'range-allocator',
      mode: 'block',
      blockSize: 1000
    })
    expect(data.sim?.processing?.distribution.type).toBe('mixture')
  })
})

describe('deriveIdAllocationDistribution', () => {
  it('central mode pays coordination on every request', () => {
    const dist = deriveIdAllocationDistribution({
      kind: 'db-sequence',
      mode: 'central',
      blockSize: 1000
    })
    expect(dist).toEqual({ type: 'constant', value: ID_COORDINATION_MS })
    expect(idAllocationMeanMs({ kind: 'db-sequence', mode: 'central', blockSize: 1000 })).toBe(
      ID_COORDINATION_MS
    )
  })

  it('block mode is a mixture with 1/blockSize coordination weight', () => {
    const dist = deriveIdAllocationDistribution({
      kind: 'range-allocator',
      mode: 'block',
      blockSize: 1000
    })
    expect(dist.type).toBe('mixture')
    if (dist.type !== 'mixture') throw new Error('expected mixture')
    const coord = dist.components.find(
      (component) =>
        component.distribution.type === 'constant' &&
        component.distribution.value === ID_COORDINATION_MS
    )
    expect(coord?.weight).toBeCloseTo(1 / 1000)
    // mean is dominated by the near-instant local serves
    expect(
      idAllocationMeanMs({ kind: 'range-allocator', mode: 'block', blockSize: 1000 })
    ).toBeLessThan(ID_LOCAL_SERVE_MS + 0.01)
  })

  it('snowflake is local-only regardless of mode', () => {
    const dist = deriveIdAllocationDistribution({
      kind: 'snowflake',
      mode: 'central',
      blockSize: 1
    })
    expect(dist).toEqual({ type: 'constant', value: ID_LOCAL_SERVE_MS })
  })

  it('a block of 1 collapses to central', () => {
    const dist = deriveIdAllocationDistribution({
      kind: 'range-allocator',
      mode: 'block',
      blockSize: 1
    })
    expect(dist).toEqual({ type: 'constant', value: ID_COORDINATION_MS })
  })
})
