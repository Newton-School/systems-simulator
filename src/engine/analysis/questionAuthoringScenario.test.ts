import { describe, expect, it } from 'vitest'
import {
  authoringScenarioReducer,
  compileAuthoringScenario,
  createAuthoringScenario,
  decompileAuthoringScenario,
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

  it('round-trips a closed-population workload', () => {
    const scenario = {
      ...createAuthoringScenario(),
      pattern: 'closed' as const,
      closedUsers: 40,
      closedThinkTimeMs: 500
    }
    const compiled = compileAuthoringScenario(scenario)
    expect(compiled?.workload?.closed).toEqual({ users: 40, thinkTimeMs: 500 })
    expect(decompileAuthoringScenario(compiled!)).toMatchObject({
      pattern: 'closed',
      closedUsers: 40,
      closedThinkTimeMs: 500
    })
    expect(compileAuthoringScenario({ ...scenario, closedUsers: 0.5 })).toBeNull()
  })

  it('keeps a replay trace and a diurnal start hour through compile and decompile', () => {
    const trace = [{ atMs: 0 }, { atMs: 250, type: 'write' }]
    const replay = { ...createAuthoringScenario(), pattern: 'replay' as const, replayTrace: trace }
    const compiledReplay = compileAuthoringScenario(replay)
    expect(compiledReplay?.workload?.trace).toEqual(trace)
    expect(decompileAuthoringScenario(compiledReplay!).replayTrace).toEqual(trace)

    const diurnal = {
      ...createAuthoringScenario(),
      pattern: 'diurnal' as const,
      diurnalStartHour: 14
    }
    const compiledDiurnal = compileAuthoringScenario(diurnal)
    expect(compiledDiurnal?.workload?.diurnal?.startHour).toBe(14)
    expect(decompileAuthoringScenario(compiledDiurnal!).diurnalStartHour).toBe(14)
    expect(compileAuthoringScenario({ ...diurnal, diurnalStartHour: 30 })).toBeNull()
  })

  it('compiles a gray-failure fault with its failing share and reads it back', () => {
    const scenario = {
      ...createAuthoringScenario(),
      faults: [
        {
          id: 'fault-1',
          targetId: 'api',
          faultType: 'gray-failure',
          timing: 'deterministic' as const,
          mode: '',
          atSeconds: 10,
          duration: 'fixed' as const,
          durationSeconds: 20,
          grayErrorPercent: 25,
          extraParams: []
        }
      ]
    }
    const compiled = compileAuthoringScenario(scenario)
    expect(compiled?.faults?.[0]).toMatchObject({
      faultType: 'gray-failure',
      params: { errorRate: 0.25, atMs: 10_000, durationMs: 20_000 }
    })
    const back = decompileAuthoringScenario(compiled!)
    expect(back.faults?.[0]).toMatchObject({ faultType: 'gray-failure', grayErrorPercent: 25 })
    expect(back.faults?.[0].extraParams).toEqual([])
    expect(
      compileAuthoringScenario({
        ...scenario,
        faults: [{ ...scenario.faults[0], grayErrorPercent: 100 }]
      })
    ).toBeNull()
  })
})
