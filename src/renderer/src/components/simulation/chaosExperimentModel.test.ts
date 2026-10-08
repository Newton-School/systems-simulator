import { describe, expect, it } from 'vitest'
import { normalizeScenarioState } from '@renderer/types/ui'
import { buildExperimentForTopology } from './chaosExperimentModel'
import { apiDbTopology, cacheTopology } from '../../../../engine/scenarios/__tests__/fixtures'

describe('buildExperimentForTopology', () => {
  it('builds and compiles a single preset', () => {
    const preview = buildExperimentForTopology(cacheTopology(), [
      { presetId: 'cache-stampede', offsetS: 0 }
    ])
    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.definition.id).toBe('cache-stampede')
      expect(preview.compiled.topology.faults?.[0].faultType).toBe('cache-flush')
    }
  })

  it('composes several presets with offsets', () => {
    const preview = buildExperimentForTopology(cacheTopology(), [
      { presetId: 'traffic-spike', offsetS: 0 },
      { presetId: 'cache-stampede', offsetS: 5 }
    ])
    expect(preview.ok).toBe(true)
    if (preview.ok) expect(preview.definition.name).toBe('Traffic spike + Cache stampede')
  })

  it('returns the reason when a preset does not fit the topology', () => {
    expect(
      buildExperimentForTopology(apiDbTopology(), [{ presetId: 'db-failover', offsetS: 0 }])
    ).toEqual({
      ok: false,
      reason: expect.stringMatching(/needs a replica/)
    })
  })
})

describe('normalizeScenarioState experiment entries', () => {
  it('keeps valid entries and drops the field when empty', () => {
    expect(
      normalizeScenarioState({
        experiment: [{ presetId: 'traffic-spike', offsetS: -2 }, { offsetS: 1 }]
      }).experiment
    ).toEqual([{ presetId: 'traffic-spike', offsetS: 0 }])
    expect('experiment' in normalizeScenarioState({ experiment: [] })).toBe(false)
  })
})
