import { describe, expect, it } from 'vitest'
import { broadcastFanoutTrait } from './broadcastFanout'

describe('broadcastFanoutTrait', () => {
  it('marks broker nodes with the broadcast routing hint', () => {
    expect(broadcastFanoutTrait.routingStrategyHint).toBe('broadcast')
  })
})
