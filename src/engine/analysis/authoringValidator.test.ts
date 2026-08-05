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

  it('errors on the classic bad latency metric key', () => {
    const pkg = base()
    pkg.rubric.checks[0].metric = 'summary.latencyP99Ms'
    const d = validateAuthoredQuestion(pkg)
    expect(d.some((x) => x.code === 'metric.badLatencyKey' && x.level === 'error')).toBe(true)
    expect(isAuthoredValid(d)).toBe(false)
  })

  it('warns when readWriteRatio is set but not injected as typed traffic', () => {
    const pkg = base()
    pkg.suite.cases[0].workload = { baseRps: 2000 } // no requestDistribution
    expect(codes(pkg)).toContain('scale.mixNotInjected')
  })

  it('warns when peakRps is set but no case injects baseRps', () => {
    const pkg = base()
    pkg.suite.cases[0].workload = {
      requestDistribution: [
        { type: 'read', weight: 0.99, sizeBytes: 1 },
        { type: 'write', weight: 0.01, sizeBytes: 1 }
      ]
    }
    expect(codes(pkg)).toContain('scale.rpsNotInjected')
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
