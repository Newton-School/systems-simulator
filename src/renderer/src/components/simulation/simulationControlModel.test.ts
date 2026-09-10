import { describe, expect, it } from 'vitest'
import {
  buildFault,
  DEFAULT_DEGRADED_FRACTION,
  DEFAULT_DEGRADED_SERVICE_MULTIPLIER,
  readFault,
  type SimpleFault
} from './simulationControlModel'

const base: SimpleFault = {
  targetId: 'db-1',
  atS: 5,
  durationS: 10,
  mode: 'blackhole',
  degradedFraction: DEFAULT_DEGRADED_FRACTION,
  degradedServiceMultiplier: DEFAULT_DEGRADED_SERVICE_MULTIPLIER
}

describe('buildFault / readFault degradation params', () => {
  it('omits degradation params for non-degraded modes', () => {
    const fault = buildFault(base)
    expect((fault.params as Record<string, unknown>).degradation).toBeUndefined()
  })

  it('round-trips author-set degradation params for degraded mode', () => {
    const fault = buildFault({
      ...base,
      mode: 'degraded',
      degradedFraction: 0.6,
      degradedServiceMultiplier: 4
    })
    expect((fault.params as { degradation: unknown }).degradation).toEqual({
      fraction: 0.6,
      serviceTimeMultiplier: 4
    })
    const round = readFault(fault)
    expect(round.degradedFraction).toBe(0.6)
    expect(round.degradedServiceMultiplier).toBe(4)
  })

  it('clamps degraded fraction into [0, 1]', () => {
    const fault = buildFault({ ...base, mode: 'degraded', degradedFraction: 5 })
    expect((fault.params as { degradation: { fraction: number } }).degradation.fraction).toBe(1)
  })

  it('falls back to defaults when a degraded fault carries no degradation block', () => {
    const round = readFault({
      targetId: 'db-1',
      faultType: 'chaos',
      timing: 'deterministic',
      duration: 'fixed',
      params: { atMs: 5000, durationMs: 10000, mode: 'degraded' }
    })
    expect(round.degradedFraction).toBe(DEFAULT_DEGRADED_FRACTION)
    expect(round.degradedServiceMultiplier).toBe(DEFAULT_DEGRADED_SERVICE_MULTIPLIER)
  })
})
