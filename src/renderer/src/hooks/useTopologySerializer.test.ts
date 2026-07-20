import { describe, expect, it } from 'vitest'
import { resolveEdgeLatencyDistribution } from './useTopologySerializer'

const SAME_DC_PROFILE = { type: 'log-normal' as const, mu: 0, sigma: 0.4 }

describe('resolveEdgeLatencyDistribution', () => {
  it('serializes an explicit constant edge latency as a constant distribution', () => {
    expect(
      resolveEdgeLatencyDistribution(
        {
          latencyDistributionType: 'constant',
          latencyValue: 12
        },
        SAME_DC_PROFILE
      )
    ).toEqual({
      distribution: { type: 'constant', value: 12 },
      derivedFromPathType: false
    })
  })

  it('preserves explicit log-normal mu values, including negative ones', () => {
    expect(
      resolveEdgeLatencyDistribution(
        {
          latencyDistributionType: 'log-normal',
          latencyMu: -1.2,
          latencySigma: 0.3
        },
        SAME_DC_PROFILE
      )
    ).toEqual({
      distribution: { type: 'log-normal', mu: -1.2, sigma: 0.3 },
      derivedFromPathType: false
    })
  })
})
