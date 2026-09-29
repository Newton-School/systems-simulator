import { describe, expect, it } from 'vitest'
import { weightsFromRows, type WeightRow } from './queueWeights'

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
