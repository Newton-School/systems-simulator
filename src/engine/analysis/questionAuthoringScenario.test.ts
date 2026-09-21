import { describe, expect, it } from 'vitest'
import {
  authoringScenarioReducer,
  compileAuthoringScenario,
  createAuthoringScenario,
  normalizeAuthoringScenarioWorkload
} from './questionAuthoringScenario'

describe('Question Studio deterministic scenario authoring', () => {
  it('compiles the default card through the runtime global and workload schemas', () => {
    expect(compileAuthoringScenario(createAuthoringScenario())).toEqual({
      id: 'baseline',
      description: 'Sustain steady traffic under normal conditions.',
      global: {
        seed: 'baseline-v1',
        simulationDuration: 60_000,
        warmupDuration: 5_000
      },
      workload: {
        pattern: 'constant',
        baseRps: 1000,
        requestDistribution: [
          { type: 'read', weight: 0.8, sizeBytes: 512 },
          { type: 'write', weight: 0.2, sizeBytes: 512 }
        ]
      }
    })
  })

  it('normalizes author percentages into exact fractional request weights', () => {
    const scenario = { ...createAuthoringScenario(), readPercent: 67.5 }

    expect(normalizeAuthoringScenarioWorkload(scenario)?.requestDistribution).toEqual([
      { type: 'read', weight: 0.675, sizeBytes: 512 },
      { type: 'write', weight: 0.325, sizeBytes: 512 }
    ])
  })

  it('keeps incomplete or invalid scenarios saveable but refuses to compile them', () => {
    expect(
      compileAuthoringScenario({
        ...createAuthoringScenario(),
        seed: '',
        durationSeconds: 5,
        warmupSeconds: 5,
        readPercent: 120
      })
    ).toBeNull()
    expect(
      normalizeAuthoringScenarioWorkload({ ...createAuthoringScenario(), baseRps: null })
    ).toBe(null)
  })

  it('edits and removes a scenario without changing its stable case ID', () => {
    const baseline = createAuthoringScenario()
    const duplicate = authoringScenarioReducer([baseline], {
      type: 'add',
      scenario: { ...baseline, description: 'Conflicting duplicate' }
    })
    const edited = authoringScenarioReducer(duplicate, {
      type: 'update-number',
      id: 'baseline',
      field: 'baseRps',
      value: 2500
    })
    const removed = authoringScenarioReducer(edited, { type: 'remove', id: 'baseline' })

    expect(duplicate).toEqual([baseline])
    expect(edited[0]).toMatchObject({ id: 'baseline', baseRps: 2500 })
    expect(removed).toEqual([])
  })
})
