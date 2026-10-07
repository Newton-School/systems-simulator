import { describe, expect, it } from 'vitest'
import { partitionsFromRows, weightsFromRows, type WeightRow } from './queueWeights'

const row = (type: string, weight: string, key = 0): WeightRow => ({ key, type, weight })

describe('weightsFromRows', () => {
  it('keeps named rows with a positive weight, trimming the type', () => {
    expect(weightsFromRows([row(' read ', '3'), row('write', '1', 1)])).toEqual({
      read: 3,
      write: 1
    })
  })

  it('drops rows with no type or a non-positive / non-numeric weight', () => {
    expect(
      weightsFromRows([row('', '2'), row('a', '0', 1), row('b', '-1', 2), row('c', '', 3)])
    ).toBeUndefined()
  })

  it('uses the last weight when a type repeats', () => {
    expect(weightsFromRows([row('read', '3'), row('read', '5', 1)])).toEqual({ read: 5 })
  })
})

describe('partitionsFromRows', () => {
  it('keeps named rows with a whole-number cap of at least 1', () => {
    expect(
      partitionsFromRows([
        row(' report ', '4'),
        row('a', '0.5', 1),
        row('b', '0', 2),
        row('', '3', 3)
      ])
    ).toEqual({ report: 4 })
  })

  it('returns undefined when no row is valid', () => {
    expect(partitionsFromRows([row('a', '', 0)])).toBeUndefined()
  })
})
