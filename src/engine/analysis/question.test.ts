import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import type { SimulationOutput } from './output'
import { gradeAttempt, toHostContract, type QuestionPackage } from './question'
import type { GradedEvaluationBatch } from './rubric'

function fakeOutput(errorRate: number): SimulationOutput {
  return {
    seed: 's',
    simulationDuration: 1000,
    warmupDuration: 0,
    eventsProcessed: 1,
    reproducible: true,
    summary: {
      totalRequests: 10,
      postWarmupTotalRequests: 10,
      successfulRequests: 9,
      postWarmupSuccessfulRequests: 9,
      failedRequests: 1,
      postWarmupFailedRequests: 1,
      rejectedRequests: 0,
      timedOutRequests: 0,
      connectionResetRequests: 0,
      throughput: 100,
      errorRate,
      latency: { p50: 1, p90: 2, p95: 3, p99: 4, min: 1, max: 5, mean: 2 }
    },
    perNode: {},
    sloTargetCount: 0,
    sloBreaches: [],
    invariantViolations: [],
    conservationCheck: [],
    littlesLawCheck: []
  } as unknown as SimulationOutput
}

function studentTopology(): TopologyJSON {
  return {
    id: 't',
    name: 't',
    version: '2.0.0',
    global: { seed: 'base', simulationDuration: 1000, warmupDuration: 0 },
    nodes: [],
    edges: []
  } as unknown as TopologyJSON
}

const pkg: QuestionPackage = {
  id: 'q1',
  title: 'demo',
  difficulty: 'intermediate',
  type: 'open-build',
  prompt: { text: 'design it', functionalRequirements: [], nonFunctionalRequirements: [], scale: {} },
  scaffold: { type: 'empty' },
  constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
  suite: {
    name: 'demo-suite',
    visibleToStudent: false,
    cases: [{ id: 'baseline' }, { id: 'peak', global: { seed: 'peak-seed' }, workload: { baseRps: 500 } }]
  },
  rubric: {
    checks: [{ id: 'err', description: 'error rate < 10%', metric: 'summary.errorRate', op: '<', value: 0.1 }]
  }
}

describe('gradeAttempt', () => {
  it('injects the student topology into every case, applies overrides, grades, and collapses to a contract', () => {
    const seen: string[] = []
    const result = gradeAttempt(pkg, studentTopology(), (t) => {
      const seed = (t.global as { seed: string }).seed
      seen.push(seed)
      // peak case (overridden seed) fails the error-rate check; baseline passes.
      return fakeOutput(seed === 'peak-seed' ? 0.5 : 0.02)
    })

    // decision 4: overrides applied on top of the student topology
    expect(seen).toEqual(['base', 'peak-seed'])

    // grading
    expect(result.graded.summary).toEqual({ total: 2, ran: 2, errored: 0, passed: 1, failed: 1 })

    // collapsed host contract — one row per rubric check across cases
    expect(result.contract.tests).toEqual([
      { id: 'baseline:err', name: 'error rate < 10%', passed: true },
      { id: 'peak:err', name: 'error rate < 10%', passed: false }
    ])
    expect(result.contract).toMatchObject({ totalTests: 2, passedTests: 1, allPassed: false })
  })

  it('allPassed is true only when every check across every case passes', () => {
    const result = gradeAttempt(pkg, studentTopology(), () => fakeOutput(0.01))
    expect(result.contract.allPassed).toBe(true)
    expect(result.contract).toMatchObject({ totalTests: 2, passedTests: 2 })
  })

  it('a case that could not run collapses to a failed did-not-run row', () => {
    const result = gradeAttempt(pkg, studentTopology(), (t) => {
      if ((t.global as { seed: string }).seed === 'peak-seed') throw new Error('boom')
      return fakeOutput(0.01)
    })
    const peak = result.contract.tests.find((test) => test.id.startsWith('peak'))
    expect(peak).toEqual({ id: 'peak:did-not-run', name: 'Case peak could not run', passed: false })
    expect(result.contract.allPassed).toBe(false)
  })
})

describe('toHostContract', () => {
  it('flattens rubric checks and derives allPassed from all rows green', () => {
    const graded: GradedEvaluationBatch = {
      version: '1.0',
      cases: [
        {
          id: 'c1',
          ran: true,
          rubric: {
            version: '1.0',
            checks: [
              { id: 'a', description: 'A', metric: 'm', op: '<', value: 1, actual: 0, passed: true, points: 1, awarded: 1 },
              { id: 'b', description: 'B', metric: 'm', op: '<', value: 1, actual: 2, passed: false, points: 1, awarded: 0 }
            ],
            score: { earned: 1, possible: 2, fraction: 0.5 },
            passed: false
          }
        }
      ],
      summary: { total: 1, ran: 1, errored: 0, passed: 0, failed: 1 }
    }
    const contract = toHostContract(graded)
    expect(contract.tests.map((t) => t.passed)).toEqual([true, false])
    expect(contract).toMatchObject({ totalTests: 2, passedTests: 1, allPassed: false })
  })
})
