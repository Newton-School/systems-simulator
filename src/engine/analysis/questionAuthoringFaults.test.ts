import { describe, expect, it } from 'vitest'
import {
  authoringFaultTargetStatus,
  authoringScenarioFieldErrors,
  compileAuthoringScenario,
  createAuthoringFault,
  createAuthoringScenario,
  decompileAuthoringScenario,
  type AuthoringScenarioDraft
} from './questionAuthoringScenario'
import {
  createQuestionAuthoringProject,
  parseQuestionAuthoringProject
} from './questionAuthoringProject'
import {
  compileQuestionAuthoringExportBundle,
  deserializeQuestionAuthoringExportBundle
} from './questionAuthoringExportBundle'
import { createQuestionAuthoringProjectFromPackage } from './questionAuthoringImport'

function withFaults(): AuthoringScenarioDraft {
  return {
    ...createAuthoringScenario('outage'),
    faults: [
      {
        ...createAuthoringFault('fault-1'),
        targetId: 'az-a',
        mode: 'hang',
        atSeconds: 10,
        duration: 'fixed',
        durationSeconds: 5,
        inFlightPolicy: 'hang',
        recoveryPolicy: 'resume'
      },
      {
        ...createAuthoringFault('fault-2'),
        targetId: 'api',
        mode: 'degraded',
        duration: 'permanent',
        durationSeconds: null,
        degradedPercent: 25,
        degradedMultiplier: 4
      },
      {
        ...createAuthoringFault('fault-3'),
        targetId: 'cache',
        faultType: 'cache-flush',
        mode: '',
        atSeconds: 20,
        durationSeconds: 3
      }
    ]
  }
}

describe('Question Studio fault editor model', () => {
  it('compiles typed failure modes, policies, degradation and cache flushes', () => {
    const compiled = compileAuthoringScenario(withFaults())!
    expect(compiled.faults).toEqual([
      {
        targetId: 'az-a',
        faultType: 'crash',
        timing: 'deterministic',
        duration: 'fixed',
        params: {
          atMs: 10_000,
          mode: 'hang',
          inFlightPolicy: 'hang',
          recoveryPolicy: 'resume',
          durationMs: 5_000
        }
      },
      {
        targetId: 'api',
        faultType: 'crash',
        timing: 'deterministic',
        duration: 'permanent',
        params: {
          atMs: 10_000,
          mode: 'degraded',
          degradation: { fraction: 0.25, serviceTimeMultiplier: 4 }
        }
      },
      {
        targetId: 'cache',
        faultType: 'cache-flush',
        timing: 'deterministic',
        duration: 'fixed',
        params: { atMs: 20_000, durationMs: 3_000 }
      }
    ])
  })

  it('round-trips through the runtime case and back', () => {
    const draft = withFaults()
    const compiled = compileAuthoringScenario(draft)!
    const back = decompileAuthoringScenario(compiled)
    expect(compileAuthoringScenario(back)).toEqual(compiled)
    expect(back.faults![0]).toMatchObject({ inFlightPolicy: 'hang', recoveryPolicy: 'resume' })
    expect(back.faults![1]).toMatchObject({ degradedPercent: 25, degradedMultiplier: 4 })
    expect(back.faults!.every((fault) => fault.extraParams.length === 0)).toBe(true)
  })

  it('needs both degradation numbers for a slowed-down fault', () => {
    const draft = withFaults()
    draft.faults![1] = { ...draft.faults![1], degradedMultiplier: null }
    expect(authoringScenarioFieldErrors(draft).pattern).toMatch(/slowed-down fault/)
    expect(compileAuthoringScenario(draft)).toBeNull()
  })

  it('classifies targets against the reference design, warning but never blocking', () => {
    const targets = [
      { id: 'api', label: 'API (api)', group: 'component' as const },
      { id: 'cache', label: 'Cache (cache)', group: 'component' as const, isCache: true },
      { id: 'az-a', label: 'Availability zone: AZ A - 2 components', group: 'location' as const }
    ]
    const status = (targetId: string, faultType = 'crash') =>
      authoringFaultTargetStatus({ targetId, faultType }, targets)
    expect(status('api')).toEqual({ kind: 'component' })
    expect(status('az-a')).toEqual({ kind: 'location' })
    expect(status('cache', 'cache-flush')).toEqual({ kind: 'cache' })
    expect(status('api', 'cache-flush').warning).toMatch(/not a cache/)
    expect(status('az-a', 'cache-flush').warning).toMatch(/does nothing/)
    expect(status('learner-only').warning).toMatch(/not in the reference design/)
    expect(authoringFaultTargetStatus({ targetId: 'x', faultType: 'crash' }, [])).toEqual({
      kind: 'unknown'
    })
    // An unknown target still compiles: learner designs may use that id.
    const draft = withFaults()
    draft.faults![0] = { ...draft.faults![0], targetId: 'learner-only' }
    expect(compileAuthoringScenario(draft)).not.toBeNull()
  })
})

describe('chaos experiment scenario drafts', () => {
  const experimentScenario: AuthoringScenarioDraft = {
    ...createAuthoringScenario('zone-outage'),
    experiment: {
      presets: [
        { presetId: 'az-outage', options: { outageSeconds: 15, maxOutageErrorRate: 0.02 } }
      ],
      points: 2
    }
  }

  it('compiles to a case experiment and round-trips', () => {
    const compiled = compileAuthoringScenario(experimentScenario)!
    expect(compiled.experiment).toEqual(experimentScenario.experiment)
    expect(decompileAuthoringScenario(compiled).experiment).toEqual(experimentScenario.experiment)
  })

  it('reports bad options as a field error', () => {
    const errors = authoringScenarioFieldErrors({
      ...experimentScenario,
      experiment: { presets: [{ presetId: 'az-outage', options: { maxOutageErrorRate: 5 } }] }
    })
    expect(errors.experiment).toMatch(/fraction between 0 and 1/)
  })

  it('survives the project file, the export bundle and a package re-import', () => {
    const project = createQuestionAuthoringProject({
      projectId: 'zone-project',
      updatedAt: '2026-10-12T00:00:00.000Z',
      title: 'Survive a zone outage',
      problemStatement: 'Keep serving when an availability zone fails.',
      scenarios: [createAuthoringScenario('baseline'), experimentScenario],
      structuralRules: [{ id: 'single-source', kind: 'requires_single_source' }],
      metricRules: [
        { id: 'metric-target', metric: 'latency_p99', operator: '<', value: 100, unit: 'ms' }
      ],
      activeStage: 'export'
    })
    expect(parseQuestionAuthoringProject(JSON.parse(JSON.stringify(project)))).toEqual(project)

    const result = compileQuestionAuthoringExportBundle(project)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const bundle = deserializeQuestionAuthoringExportBundle(result.content)
    expect(bundle.questionPackage.suite.cases[1].experiment).toEqual(experimentScenario.experiment)
    const simulatorConfig = bundle.django.rows.find((row) => row.input.type === 'SIMULATOR_CONFIG')!
      .input as unknown as { suite: { cases: Array<{ experiment?: unknown }> } }
    expect(simulatorConfig.suite.cases[1].experiment).toEqual(experimentScenario.experiment)

    const reimported = createQuestionAuthoringProjectFromPackage(bundle.questionPackage)
    expect(reimported.question.scenarios[1].experiment).toEqual(experimentScenario.experiment)
  })
})
