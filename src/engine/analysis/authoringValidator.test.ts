import { describe, expect, it } from 'vitest'
import type { ComponentType } from '../core/types'
import type { QuestionPackage } from './question'
import { isAuthoredValid, validateAuthoredQuestion } from './authoringValidator'

function base(): QuestionPackage {
  return {
    version: '1.0',
    id: 'q',
    title: 'q',
    difficulty: 'intermediate',
    type: 'open-build',
    domains: ['compute'],
    prompt: {
      text: 't',
      functionalRequirements: [],
      nonFunctionalRequirements: [
        { metric: 'latency_p99', operator: '<', value: 100, unit: 'ms', description: 'p99 < 100ms' }
      ],
      scale: { peakRps: 2000, readWriteRatio: 99 }
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: {
      name: 's',
      visibleToStudent: false,
      cases: [
        {
          id: 'peak',
          workload: {
            baseRps: 2000,
            requestDistribution: [
              { type: 'read', weight: 0.99, sizeBytes: 256 },
              { type: 'write', weight: 0.01, sizeBytes: 512 }
            ]
          }
        }
      ]
    },
    rubric: {
      checks: [
        {
          id: 'p99',
          kind: 'simulation',
          description: 'p99',
          metric: 'summary.latency.p99',
          op: '<',
          value: 100,
          points: 3
        }
      ]
    }
  }
}

const codes = (pkg: QuestionPackage) => validateAuthoredQuestion(pkg).map((d) => d.code)

describe('validateAuthoredQuestion', () => {
  it('passes a correctly authored question with no diagnostics', () => {
    const d = validateAuthoredQuestion(base())
    expect(d).toEqual([])
    expect(isAuthoredValid(d)).toBe(true)
  })

  it('warns when no domains are declared', () => {
    const pkg = base()
    delete pkg.domains
    expect(codes(pkg)).toContain('domains.missing')
  })

  it('warns when a domain is storage but there is no storageFit/fanout criterion', () => {
    const pkg = base()
    pkg.domains = ['storage'] // base() grades by a simulation p99 check, not storageFit
    expect(codes(pkg)).toContain('domains.mismatch')
  })

  it('keeps legacy questions clean when entryFormat is omitted', () => {
    const pkg = base()
    delete pkg.entryFormat
    expect(codes(pkg)).not.toContain('entryFormat.blankCanvasMismatch')
    expect(codes(pkg)).not.toContain('entryFormat.requirementsFirstScaffold')
  })

  it('accepts a multi-domain question when each domain matches its grading', () => {
    const pkg = base()
    pkg.domains = ['compute', 'storage']
    pkg.semanticCriteria = [
      {
        id: 'store',
        kind: 'storageFit',
        accessPattern: 'point-lookup',
        accept: ['kv-store' as ComponentType],
        points: 2
      }
    ]
    // compute is satisfied by the base p99 sim check; storage by the storageFit above
    const cs = codes(pkg)
    expect(cs).not.toContain('domains.mismatch')
    expect(cs).not.toContain('domains.missing')
  })

  it('warns that a V2 domain (network) has no physics yet', () => {
    const pkg = base()
    pkg.domains = ['network']
    expect(codes(pkg)).toContain('domains.v2')
  })

  it('errors when explicit blank-canvas entryFormat does not match scaffold shape', () => {
    const pkg = base()
    pkg.entryFormat = 'blank-canvas'
    pkg.scaffold = { type: 'partial' }
    expect(codes(pkg)).toContain('entryFormat.blankCanvasMismatch')
  })

  it('warns when requirements-first has no explicit requirements and no scaffold anchor', () => {
    const pkg = base()
    pkg.entryFormat = 'requirements-first'
    pkg.prompt.nonFunctionalRequirements = []
    expect(codes(pkg)).toContain('entryFormat.requirementsFirstScaffold')
    expect(codes(pkg)).toContain('entryFormat.requirementsFirstPrompt')
  })

  it('errors when broken-scaffold is authored without a fix question and starter scaffold', () => {
    const pkg = base()
    pkg.entryFormat = 'broken-scaffold'
    expect(codes(pkg)).toContain('entryFormat.brokenScaffoldTypeMismatch')
    expect(codes(pkg)).toContain('entryFormat.brokenScaffoldShape')
  })

  it('warns when baseline-optimize is missing a baseline verdict', () => {
    const pkg = base()
    pkg.type = 'optimize'
    pkg.entryFormat = 'baseline-optimize'
    pkg.scaffold = {
      type: 'partial',
      topology: {
        id: 'baseline',
        name: 'baseline',
        version: '2.0.0',
        global: {
          seed: 'seed',
          simulationDuration: 1000,
          warmupDuration: 0,
          timeResolution: 'millisecond',
          defaultTimeout: 5000
        },
        nodes: [],
        edges: []
      } as unknown as QuestionPackage['scaffold']['topology']
    }
    expect(codes(pkg)).toContain('entryFormat.baselineVerdictMissing')
  })

  it('errors when locked-lab is authored with an unlocked scaffold', () => {
    const pkg = base()
    pkg.entryFormat = 'locked-lab'
    pkg.scaffold = { type: 'complete' }
    pkg.constraints = {
      canModifyScaffold: true,
      canRemoveScaffoldNodes: false,
      allowedNodeTypes: ['microservice']
    }
    expect(codes(pkg)).toContain('entryFormat.lockedLabUnlocked')
  })

  it('errors on the classic bad latency metric key', () => {
    const pkg = base()
    pkg.rubric.checks[0].metric = 'summary.latencyP99Ms'
    const d = validateAuthoredQuestion(pkg)
    expect(d.some((x) => x.code === 'metric.badLatencyKey' && x.level === 'error')).toBe(true)
    expect(isAuthoredValid(d)).toBe(false)
  })

  it('accepts prompt.scale read/write mix when cases rely on runtime derivation', () => {
    const pkg = base()
    pkg.suite.cases[0].workload = { baseRps: 2000 } // no requestDistribution
    expect(codes(pkg)).not.toContain('scale.mixNotInjected')
  })

  it('accepts prompt.scale peakRps when cases rely on runtime derivation', () => {
    const pkg = base()
    pkg.suite.cases[0].workload = {
      requestDistribution: [
        { type: 'read', weight: 0.99, sizeBytes: 1 },
        { type: 'write', weight: 0.01, sizeBytes: 1 }
      ]
    }
    expect(codes(pkg)).not.toContain('scale.rpsNotInjected')
  })

  it('warns on a requestDistribution entry missing sizeBytes', () => {
    const pkg = base()
    pkg.suite.cases[0].workload!.requestDistribution = [
      { type: 'read', weight: 1 } as unknown as { type: string; weight: number; sizeBytes: number }
    ]
    expect(codes(pkg)).toContain('workload.missingSizeBytes')
  })

  it('warns on an orphan NFR with no matching rubric check', () => {
    const pkg = base()
    pkg.prompt.nonFunctionalRequirements = [
      {
        metric: 'throughput',
        operator: '>=',
        value: 1000,
        unit: 'req_per_sec',
        description: 'thru'
      }
    ]
    // rubric only checks latency → throughput NFR is orphaned
    expect(codes(pkg)).toContain('nfr.orphan')
  })

  it('flags a correctness-heavy question that leans on a simulation perf check', () => {
    const pkg = base()
    pkg.workloadCategory = 'correctness-heavy'
    expect(codes(pkg)).toContain('correctness.simulationCheck')
  })

  it('errors on a dangling forbidUnjustified.justifyId', () => {
    const pkg = base()
    pkg.semanticCriteria = [
      {
        id: 'no-cdn',
        kind: 'forbidUnjustified',
        componentType: 'cdn' as ComponentType,
        justifyId: 'missing',
        points: 2
      }
    ]
    const d = validateAuthoredQuestion(pkg)
    expect(d.some((x) => x.code === 'justify.dangling' && x.level === 'error')).toBe(true)
  })

  it('warns on a guardedPath with a destination under a read/write mix', () => {
    const pkg = base()
    pkg.semanticCriteria = [
      {
        id: 'g',
        kind: 'guardedPath',
        from: 'microservice' as ComponentType,
        guard: 'in-memory-cache' as ComponentType,
        to: 'kv-store' as ComponentType,
        points: 3
      }
    ]
    expect(codes(pkg)).toContain('guardedPath.readWriteMix')
  })

  it('errors when the grading suite is empty', () => {
    const pkg = base()
    pkg.suite.cases = []
    const d = validateAuthoredQuestion(pkg)
    expect(d.some((x) => x.code === 'suite.empty' && x.level === 'error')).toBe(true)
  })
})
