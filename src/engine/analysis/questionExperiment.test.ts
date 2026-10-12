import { describe, expect, it } from 'vitest'
import type { FaultSpec, TopologyJSON, TopologyLocation } from '../core/types'
import { runSimulation } from '../runSimulation'
import type { SimulationOutput } from './output'
import {
  buildQuestionTestRows,
  caseRubricTestId,
  gradeAttempt,
  parseQuestionPackage,
  type QuestionPackage
} from './question'
import { EXPERIMENT_VERDICT_CHECK_ID, experimentObligationId } from './questionExperiment'
import { runQuestionAuthoringVerification } from './questionAuthoringVerification'
import { validateAuthoredQuestion } from './authoringValidator'
import {
  compileQuestionPackageToNewtonRows,
  parseNewtonRowsToQuestionPackage,
  toNewtonRowsSeed
} from './newtonQuestionRows'
import { cacheTopology, edge, node, source, topology } from '../scenarios/__tests__/fixtures'

const LOCATIONS: TopologyLocation[] = [
  { id: 'region', kind: 'region', label: 'us-east-1' },
  { id: 'az-a', kind: 'availability-zone', label: 'us-east-1a', parentId: 'region' },
  { id: 'az-b', kind: 'availability-zone', label: 'us-east-1b', parentId: 'region' }
]

/** client -> lb (region) -> api-a (az-a) [+ api-b (az-b)]; api-a -> db-a (az-a). */
function zoned(opts: { twoZones?: boolean; locations?: boolean } = {}): TopologyJSON {
  const twoZones = opts.twoZones ?? true
  const lb = node('lb', 'load-balancer', { workers: 64, capacity: 512, serviceMs: 0.2 })
  lb.role = 'router'
  lb.placement = { regionId: 'region' }
  const api = (id: string, zone: string) => {
    const n = node(id, 'microservice', { workers: 16, capacity: 128, serviceMs: 2 })
    n.placement = { regionId: 'region', availabilityZoneId: zone }
    return n
  }
  const dbA = node('db-a', 'microservice', { workers: 16, capacity: 128, serviceMs: 1 })
  dbA.placement = { regionId: 'region', availabilityZoneId: 'az-a' }
  const base = topology(
    [source(), lb, api('api-a', 'az-a'), ...(twoZones ? [api('api-b', 'az-b')] : []), dbA],
    [
      edge('client', 'lb'),
      edge('lb', 'api-a'),
      ...(twoZones ? [edge('lb', 'api-b')] : []),
      edge('api-a', 'db-a')
    ],
    { baseRps: 100 }
  )
  if (opts.locations === false) {
    return { ...base, nodes: base.nodes.map((n) => ({ ...n, placement: undefined })) }
  }
  return { ...base, locations: structuredClone(LOCATIONS) }
}

function pkgWith(cases: QuestionPackage['suite']['cases']): QuestionPackage {
  return parseQuestionPackage({
    version: '1.0',
    id: 'zone-q',
    title: 'Survive a zone outage',
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'Stay up',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: { name: 'zone-suite', visibleToStudent: false, cases },
    rubric: {
      checks: [
        {
          id: 'errors',
          description: 'Error rate under 5%',
          metric: 'summary.errorRate',
          op: '<',
          value: 0.05
        }
      ]
    }
  })
}

const run = (t: TopologyJSON): SimulationOutput => runSimulation(t, { mode: 'discrete' })

const AZ_CASE = {
  id: 'zone-outage',
  description: 'Lose one availability zone',
  experiment: { presets: [{ presetId: 'az-outage' as const }] }
}

describe('chaos experiment test cases', () => {
  it('passes on a two-AZ design and fails on a single-AZ design through the real grader', () => {
    const pkg = pkgWith([AZ_CASE])
    const good = gradeAttempt(pkg, zoned(), run)
    const goodCase = good.graded.cases[0]
    expect(goodCase.executionStatus).toBe('completed')
    expect(goodCase.rubric!.passed).toBe(true)
    expect(good.experiments).toEqual([
      expect.objectContaining({ caseId: 'zone-outage', verdict: 'passed', passed: true })
    ])
    expect(goodCase.rubric!.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        'experiment.verdict',
        'errors',
        'experiment.steady-state',
        'experiment.final'
      ])
    )
    expect(goodCase.rubric!.score).toEqual({ earned: 2, possible: 2, fraction: 1 })
    expect(good.contract.allPassed).toBe(true)

    const gamed = gradeAttempt(pkg, zoned({ twoZones: false }), run)
    expect(gamed.experiments![0].verdict).toBe('failed')
    const verdictRow = gamed.graded.cases[0].rubric!.checks.find(
      (check) => check.id === EXPERIMENT_VERDICT_CHECK_ID
    )!
    expect(verdictRow).toMatchObject({ status: 'failed', points: 1, awarded: 0 })
    expect(verdictRow.detail).toMatch(/^Failed: /)
    expect(gamed.graded.passed).toBe(false)
    expect(gamed.contract.allPassed).toBe(false)
  })

  it('keeps the experiment verdict mandatory below a relaxed score threshold', () => {
    const pkg = pkgWith([AZ_CASE])
    pkg.rubric.passThreshold = 0.5
    pkg.rubric.checks = [
      {
        id: 'requests-ran',
        description: 'The run handled requests',
        metric: 'summary.totalRequests',
        op: '>',
        value: 0
      }
    ]

    const grade = gradeAttempt(pkg, zoned({ twoZones: false }), run)
    expect(grade.graded.score.fraction).toBe(0.5)
    expect(grade.graded.cases[0].rubric?.passed).toBe(false)
    expect(grade.graded.passed).toBe(false)
    expect(grade.contract.allPassed).toBe(false)
  })

  it('fails the case with the preset reason when the design cannot run it', () => {
    const pkg = pkgWith([AZ_CASE])
    const grade = gradeAttempt(pkg, zoned({ locations: false }), run)
    const entry = grade.graded.cases[0]
    expect(entry).toMatchObject({ ran: false, executionStatus: 'failed' })
    expect(entry.error).toMatch(/cannot run the AZ outage experiment: An AZ outage needs/)
    expect(grade.experiments![0]).toMatchObject({ verdict: 'unavailable', passed: false })
    expect(grade.graded.score).toEqual({ earned: 0, possible: 2, fraction: 0 })
  })

  it('composes presets and applies options', () => {
    const pkg = pkgWith([
      {
        id: 'composed',
        experiment: {
          presets: [
            { presetId: 'az-outage', options: { zoneId: 'az-a', outageSeconds: 5 } },
            { presetId: 'traffic-spike', offsetSeconds: 2, options: { multiplier: 2 } }
          ],
          points: 3
        }
      }
    ])
    const grade = gradeAttempt(pkg, zoned(), run)
    expect(grade.experiments![0].name).toBe('AZ outage + Traffic spike (2s in)')
    expect(grade.graded.cases[0].rubric!.score.possible).toBe(4)
  })

  it('composes the experiment verdict with authored invariant rubric checks', () => {
    const base = pkgWith([
      {
        ...AZ_CASE,
        invariants: [
          {
            id: 'impossible-errors',
            description: 'Prove the ordinary invariant still runs',
            condition: 'summary.errorRate < 0'
          }
        ]
      }
    ])
    const pkg: QuestionPackage = {
      ...base,
      rubric: {
        checks: [
          {
            id: 'no-invariant-violations',
            kind: 'invariant',
            description: 'All case invariants hold',
            metric: 'invariantViolations.count',
            op: '==',
            value: 0
          }
        ]
      }
    }
    const grade = gradeAttempt(pkg, zoned(), run)
    const rows = grade.graded.cases[0].rubric!.checks
    expect(rows.find((check) => check.id === EXPERIMENT_VERDICT_CHECK_ID)?.passed).toBe(true)
    expect(rows.find((check) => check.id === 'no-invariant-violations')).toMatchObject({
      passed: false,
      actual: 1
    })
    expect(grade.graded.cases[0].rubric!.passed).toBe(false)
  })

  it('rejects unknown preset options in the schema', () => {
    expect(() =>
      pkgWith([
        { id: 'bad', experiment: { presets: [{ presetId: 'az-outage', options: { zone: 'x' } }] } }
      ])
    ).toThrow(/AZ outage has no option "zone"/)
  })

  it('keeps an ordinary package unchanged (no experiments key, same rows)', () => {
    const pkg = pkgWith([{ id: 'baseline' }])
    const grade = gradeAttempt(pkg, zoned(), run)
    expect('experiments' in grade).toBe(false)
    expect(grade.graded.cases[0].rubric!.checks.map((check) => check.id)).toEqual([
      '__execution__',
      'errors'
    ])
  })

  it('lists the verdict row as a pending authored test', () => {
    const rows = buildQuestionTestRows(pkgWith([AZ_CASE]))
    expect(rows).toContainEqual(
      expect.objectContaining({
        id: caseRubricTestId('zone-outage', 'simulation', EXPERIMENT_VERDICT_CHECK_ID),
        name: 'Chaos experiment "AZ outage" passes',
        status: 'pending'
      })
    )
  })

  it('round-trips through the Django / Newton rows', () => {
    const pkg = pkgWith([{ id: 'baseline' }, AZ_CASE])
    const parsed = parseNewtonRowsToQuestionPackage(
      toNewtonRowsSeed(compileQuestionPackageToNewtonRows(pkg))
    )
    expect(parsed.questionPackage.suite.cases[1].experiment).toEqual(AZ_CASE.experiment)
  })

  it('verification runs experiment cases on reference and gamed designs as obligations', () => {
    const pkg = pkgWith([{ id: 'baseline' }, AZ_CASE])
    const report = runQuestionAuthoringVerification(
      pkg,
      {
        reference: { id: 'ref', label: 'Two zones', topology: zoned() },
        gamed: [
          {
            id: 'one-zone',
            label: 'One zone',
            topology: zoned({ twoZones: false }),
            expectedObligationId: experimentObligationId('zone-outage')
          }
        ]
      },
      { mode: 'discrete' }
    )
    expect(report.reference.overallPassed).toBe(true)
    // The plain rubric check is judged on both ordinary and experiment runs.
    expect(report.reference.obligations).toContainEqual({
      id: 'errors',
      axis: 'rubric',
      passed: true
    })
    expect(report.gamed[0].expectedDiscriminator).toBe('caught')
    expect(report.ready).toBe(true)
  })

  it('validator warns (never errors) about reference-design mismatches', () => {
    const pkg = pkgWith([
      AZ_CASE,
      {
        id: 'flush',
        faults: [
          {
            targetId: 'ghost',
            faultType: 'crash',
            timing: 'deterministic',
            duration: 'fixed',
            params: { atMs: 1000, durationMs: 1000 }
          },
          {
            targetId: 'api-a',
            faultType: 'cache-flush',
            timing: 'deterministic',
            duration: 'fixed',
            params: { atMs: 1000 }
          }
        ]
      }
    ])
    const diagnostics = validateAuthoredQuestion(pkg, {
      referenceTopology: zoned({ locations: false })
    })
    const codes = diagnostics.map((d) => `${d.level}:${d.code}`)
    expect(codes).toEqual(
      expect.arrayContaining([
        'warning:experiment.referenceCannotRun',
        'warning:fault.targetNotInReference',
        'warning:fault.cacheFlushTarget'
      ])
    )
    expect(validateAuthoredQuestion(pkg).map((d) => d.code)).not.toContain(
      'experiment.referenceCannotRun'
    )
  })
})

describe('authored faults in question cases', () => {
  function zoneFault(): FaultSpec {
    return {
      targetId: 'az-a',
      faultType: 'crash',
      timing: 'deterministic',
      duration: 'fixed',
      params: { atMs: 2_000, durationMs: 3_000, mode: 'blackhole' }
    }
  }

  it('a container-target fault fails every contained node when graded', () => {
    const pkg = pkgWith([{ id: 'zone-down', faults: [zoneFault()] }])
    const outputs: SimulationOutput[] = []
    gradeAttempt(pkg, zoned(), (t) => {
      const output = run(t)
      outputs.push(output)
      return output
    })
    const failed = outputs[0].statusTimeline.map((window) => window.componentId).sort()
    expect(failed).toEqual(['api-a', 'db-a'])
  })

  it('a cache-flush case empties the cache so the origin takes the misses', () => {
    const flush: FaultSpec = {
      targetId: 'cache',
      faultType: 'cache-flush',
      timing: 'deterministic',
      duration: 'fixed',
      params: { atMs: 3_000, durationMs: 3_000 }
    }
    const pkg = pkgWith([{ id: 'plain' }, { id: 'flushed', faults: [flush] }])
    const dbLoad: number[] = []
    gradeAttempt(pkg, cacheTopology({ dbWorkers: 64, dbCapacity: 512 }), (t) => {
      const output = run(t)
      dbLoad.push(output.perNode['db'].throughput)
      return output
    })
    expect(dbLoad[1]).toBeGreaterThan(dbLoad[0] * 1.5)
  })
})
