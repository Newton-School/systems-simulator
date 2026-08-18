import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENARIO_STATE, normalizeScenarioState } from './ui'

describe('normalizeScenarioState', () => {
  it('preserves run-settings fields while backfilling defaults', () => {
    const scenario = normalizeScenarioState({
      global: {
        simulationDuration: 90_000,
        seed: 'run-seed'
      },
      selectedSourceNodeId: 'client',
      workloadOverride: {
        pattern: 'spike',
        baseRps: 250
      },
      faults: [
        {
          targetId: 'api',
          faultType: 'chaos',
          timing: 'deterministic',
          duration: 'fixed',
          params: { atMs: 5000, durationMs: 10_000, mode: 'reject' }
        }
      ],
      randomizeSeedEachRun: true
    })

    expect(scenario.global.simulationDuration).toBe(90_000)
    expect(scenario.global.warmupDuration).toBe(DEFAULT_SCENARIO_STATE.global.warmupDuration)
    expect(scenario.selectedSourceNodeId).toBe('client')
    expect(scenario.workloadOverride?.pattern).toBe('spike')
    expect(scenario.faults).toHaveLength(1)
    expect(scenario.randomizeSeedEachRun).toBe(true)
  })

  it('returns a full default scenario for invalid input', () => {
    expect(normalizeScenarioState(null)).toEqual({
      ...DEFAULT_SCENARIO_STATE,
      global: { ...DEFAULT_SCENARIO_STATE.global },
      workloadOverride: {}
    })
  })
})
