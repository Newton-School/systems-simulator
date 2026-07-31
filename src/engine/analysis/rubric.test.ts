import { describe, expect, it } from 'vitest'
import type { SimulationVerdict } from './verdict'
import type { EvaluationBatch } from './evaluate'
import { gradeBatch, gradeVerdict, resolveMetric, type Rubric } from './rubric'

function verdict(overrides: {
  errorRate?: number
  p99?: number | null
  sloBreaches?: number
  utils?: number[]
}): SimulationVerdict {
  const perNode = Object.fromEntries(
    (overrides.utils ?? []).map((utilization, i) => [
      `node-${i}`,
      {
        nodeLabel: `node-${i}`,
        utilization,
        errorRate: 0,
        latencyP99: 10
      }
    ])
  )
  return {
    version: '1.0',
    meta: { seed: 's', simulationDurationMs: 1000, warmupDurationMs: 0, eventsProcessed: 1, reproducible: true },
    summary: {
      errorRate: overrides.errorRate ?? 0,
      throughput: 100,
      latency: { p50: 1, p90: 2, p95: 3, p99: overrides.p99 === undefined ? 50 : overrides.p99 }
    },
    perNode,
    sloBreaches: Array.from({ length: overrides.sloBreaches ?? 0 }, () => ({})),
    invariantViolations: [],
    conservation: [],
    littlesLaw: []
  } as unknown as SimulationVerdict
}

describe('resolveMetric', () => {
  it('resolves dotted paths and derived aggregates', () => {
    const v = verdict({ errorRate: 0.05, sloBreaches: 2, utils: [0.3, 0.9, 0.5] })
    expect(resolveMetric(v, 'summary.errorRate')).toBe(0.05)
    expect(resolveMetric(v, 'summary.latency.p99')).toBe(50)
    expect(resolveMetric(v, 'sloBreaches.count')).toBe(2)
    expect(resolveMetric(v, 'perNode.maxUtilization')).toBeCloseTo(0.9)
  })

  it('returns null for a null latency percentile or an unknown path', () => {
    expect(resolveMetric(verdict({ p99: null }), 'summary.latency.p99')).toBeNull()
    expect(resolveMetric(verdict({}), 'summary.nope')).toBeNull()
  })
})

describe('gradeVerdict', () => {
  const rubric: Rubric = {
    id: 'r1',
    checks: [
      { id: 'err', description: 'error rate < 1%', metric: 'summary.errorRate', op: '<', value: 0.01 },
      { id: 'p99', description: 'p99 < 200ms', metric: 'summary.latency.p99', op: '<', value: 200, points: 2 },
      { id: 'slo', description: 'no SLO breaches', metric: 'sloBreaches.count', op: '==', value: 0 }
    ]
  }

  it('grades checks, awards points, and passes only when all points are earned', () => {
    const result = gradeVerdict(rubric, verdict({ errorRate: 0.005, p99: 120, sloBreaches: 0 }))
    expect(result.checks.map((c) => c.passed)).toEqual([true, true, true])
    expect(result.score).toEqual({ earned: 4, possible: 4, fraction: 1 })
    expect(result.passed).toBe(true)
  })

  it('fails the rubric when a check is not met and reports the actual value', () => {
    const result = gradeVerdict(rubric, verdict({ errorRate: 0.05, p99: 120, sloBreaches: 1 }))
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]))
    expect(byId.err.passed).toBe(false)
    expect(byId.err.actual).toBe(0.05)
    expect(byId.slo.passed).toBe(false)
    expect(byId.p99.passed).toBe(true)
    expect(result.score).toEqual({ earned: 2, possible: 4, fraction: 0.5 })
    expect(result.passed).toBe(false)
  })

  it('fails a check whose metric cannot be resolved, with a detail note', () => {
    const r: Rubric = { checks: [{ id: 'x', description: 'p99', metric: 'summary.latency.p99', op: '<', value: 100 }] }
    const result = gradeVerdict(r, verdict({ p99: null }))
    expect(result.checks[0].passed).toBe(false)
    expect(result.checks[0].actual).toBeNull()
    expect(result.checks[0].detail).toMatch(/could not be resolved/)
  })

  it('honours a partial passThreshold', () => {
    const r: Rubric = { passThreshold: 0.5, checks: rubric.checks }
    const result = gradeVerdict(r, verdict({ errorRate: 0.05, p99: 120, sloBreaches: 1 })) // fraction 0.5
    expect(result.passed).toBe(true)
  })
})

describe('gradeBatch', () => {
  it('grades ran cases and carries through run failures without grading them', () => {
    const batch: EvaluationBatch = {
      version: '1.0',
      results: [
        { id: 'ok', ok: true, verdict: verdict({ errorRate: 0 }) },
        { id: 'broken', ok: false, error: 'engine blew up' }
      ],
      summary: { total: 2, succeeded: 1, failed: 1 }
    }
    const graded = gradeBatch(
      { checks: [{ id: 'e', description: 'err<1%', metric: 'summary.errorRate', op: '<', value: 0.01 }] },
      batch
    )
    expect(graded.cases[0]).toMatchObject({ id: 'ok', ran: true })
    expect(graded.cases[0].rubric?.passed).toBe(true)
    expect(graded.cases[1]).toEqual({ id: 'broken', ran: false, error: 'engine blew up' })
    expect(graded.summary).toEqual({ total: 2, ran: 1, errored: 1, passed: 1, failed: 1 })
  })
})
