import { describe, expect, it } from 'vitest'
import {
  createInitialProbeState,
  evaluateProbe,
  parseHealthCheckManagerConfig
} from './healthProber'

describe('parseHealthCheckManagerConfig', () => {
  it('returns null when monitoredNodes is missing', () => {
    expect(parseHealthCheckManagerConfig(undefined)).toBeNull()
    expect(parseHealthCheckManagerConfig({})).toBeNull()
    expect(parseHealthCheckManagerConfig({ monitoredNodes: [] })).toBeNull()
  })

  it('applies defaults for interval and thresholds', () => {
    expect(parseHealthCheckManagerConfig({ monitoredNodes: ['worker-a'] })).toEqual({
      monitoredNodes: ['worker-a'],
      checkIntervalMs: 5_000,
      unhealthyThreshold: 3,
      healthyThreshold: 2
    })
  })

  it('honors explicit config values', () => {
    expect(
      parseHealthCheckManagerConfig({
        monitoredNodes: ['worker-a', 'worker-b'],
        checkIntervalMs: 1_000,
        unhealthyThreshold: 5,
        healthyThreshold: 1
      })
    ).toEqual({
      monitoredNodes: ['worker-a', 'worker-b'],
      checkIntervalMs: 1_000,
      unhealthyThreshold: 5,
      healthyThreshold: 1
    })
  })
})

describe('evaluateProbe', () => {
  const config = {
    monitoredNodes: ['worker-a'],
    checkIntervalMs: 1_000,
    unhealthyThreshold: 3,
    healthyThreshold: 2
  }

  it('stays healthy while probes succeed', () => {
    let state = createInitialProbeState()
    state = evaluateProbe(state, true, config)
    expect(state.healthy).toBe(true)
  })

  it('takes unhealthyThreshold consecutive failures to flip unhealthy', () => {
    let state = createInitialProbeState()
    state = evaluateProbe(state, false, config)
    expect(state.healthy).toBe(true)
    state = evaluateProbe(state, false, config)
    expect(state.healthy).toBe(true)
    state = evaluateProbe(state, false, config)
    expect(state.healthy).toBe(false)
  })

  it('a single success resets the failure streak', () => {
    let state = createInitialProbeState()
    state = evaluateProbe(state, false, config)
    state = evaluateProbe(state, false, config)
    state = evaluateProbe(state, true, config)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.healthy).toBe(true)
    state = evaluateProbe(state, false, config)
    state = evaluateProbe(state, false, config)
    expect(state.healthy).toBe(true)
  })

  it('takes healthyThreshold consecutive successes to recover', () => {
    let state = { consecutiveFailures: 3, consecutiveSuccesses: 0, healthy: false }
    state = evaluateProbe(state, true, config)
    expect(state.healthy).toBe(false)
    state = evaluateProbe(state, true, config)
    expect(state.healthy).toBe(true)
  })
})
