import { describe, expect, it } from 'vitest'
import { stringifyCliJson } from './json'

describe('stringifyCliJson', () => {
  it('emits safe BigInts as numbers and unsafe ones as strings', () => {
    const parsed = JSON.parse(
      stringifyCliJson({ small: 26_002n, huge: 2n ** 64n, nested: [{ t: -5n }], plain: 1.5 })
    )
    expect(parsed).toEqual({
      small: 26_002,
      huge: '18446744073709551616',
      nested: [{ t: -5 }],
      plain: 1.5
    })
  })
})
