import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import type { SimulationVerdict } from './verdict'
import type { EvaluationBatch } from './evaluate'
import {
  EXECUTION_CHECK_ID,
  gradeBatch,
  gradeQuestionBatch,
  gradeVerdict,
  resolveMetric,
  resolveTopologyMetric,
  type Rubric
} from './rubric'

function verdict(overrides: {
  errorRate?: number
  p99?: number | null
  sloBreaches?: number
  utils?: number[]
  invariantViolations?: number
  reservationOversells?: number
  rateLimitBreaches?: number
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
    meta: {
      seed: 's',
      simulationDurationMs: 1000,
      warmupDurationMs: 0,
      eventsProcessed: 1,
      reproducible: true
    },
    summary: {
      errorRate: overrides.errorRate ?? 0,
      throughput: 100,
      latency: { p50: 1, p90: 2, p95: 3, p99: overrides.p99 === undefined ? 50 : overrides.p99 }
    },
    perNode,
    reservations: {
      commits: 0,
      conflicts: 0,
      oversells: overrides.reservationOversells ?? 0
    },
    locks: { acquires: 0, contentions: 0, keyless: 0 },
    retries: { attempts: 0, budgetExhausted: 0 },
    rateLimit: {
      admitted: 0,
      rejected: 0,
      breaches: overrides.rateLimitBreaches ?? 0,
      keyless: 0
    },
    sloBreaches: Array.from({ length: overrides.sloBreaches ?? 0 }, () => ({})),
    invariantViolations: Array.from({ length: overrides.invariantViolations ?? 0 }, (_, index) => ({
      invariantId: `inv-${index + 1}`,
      invariantName: `Invariant ${index + 1}`
    })),
    conservation: [],
    littlesLaw: []
  } as unknown as SimulationVerdict
}

function topology(): TopologyJSON {
  return {
    id: 'topology-under-test',
    name: 'Topology Under Test',
    version: '2.0.0',
    global: {
      seed: 'seed',
      simulationDuration: 1_000,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1_000
    },
    nodes: [
      {
        id: 'client',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'client',
        position: { x: 0, y: 0 }
      },
      {
        id: 'api',
        type: 'microservice',
        category: 'compute',
        role: 'processor',
        label: 'api',
        position: { x: 120, y: 0 },
        queue: { workers: 2, capacity: 10, discipline: 'fifo' },
        processing: {
          distribution: { type: 'constant', value: 5 },
          timeout: 1_000
        }
      }
    ],
    edges: [
      {
        id: 'client-api',
        source: 'client',
        target: 'api',
        mode: 'synchronous',
        protocol: 'https',
        latency: {
          distribution: { type: 'constant', value: 1 },
          pathType: 'same-dc'
        },
        bandwidth: 1_000,
        maxConcurrentRequests: 100,
        packetLossRate: 0,
        errorRate: 0
      }
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  }
}

describe('resolveMetric', () => {
  it('resolves dotted paths and derived aggregates', () => {
    const v = verdict({
      errorRate: 0.05,
      sloBreaches: 2,
      utils: [0.3, 0.9, 0.5],
      reservationOversells: 1,
      rateLimitBreaches: 2
    })
    expect(resolveMetric(v, 'summary.errorRate')).toBe(0.05)
    expect(resolveMetric(v, 'summary.latency.p99')).toBe(50)
    expect(resolveMetric(v, 'sloBreaches.count')).toBe(2)
    expect(resolveMetric(v, 'perNode.maxUtilization')).toBeCloseTo(0.9)
    expect(resolveMetric(v, 'reservations.oversells')).toBe(1)
    expect(resolveMetric(v, 'rateLimit.breaches')).toBe(2)
  })

  it('returns null for a null latency percentile or an unknown path', () => {
    expect(resolveMetric(verdict({ p99: null }), 'summary.latency.p99')).toBeNull()
    expect(resolveMetric(verdict({}), 'summary.nope')).toBeNull()
  })
})

describe('resolveTopologyMetric', () => {
  it('resolves topology aggregates and component counts', () => {
    const t = topology()
    expect(resolveTopologyMetric(t, 'topology.nodeCount')).toBe(2)
    expect(resolveTopologyMetric(t, 'topology.edgeCount')).toBe(1)
    expect(resolveTopologyMetric(t, 'topology.sourceCount')).toBe(1)
    expect(resolveTopologyMetric(t, 'topology.componentCounts.microservice')).toBe(1)
    expect(resolveTopologyMetric(t, 'topology.categoryCounts.compute')).toBe(2)
    expect(resolveTopologyMetric(t, 'topology.totalWorkers')).toBe(2)
  })
})

describe('gradeVerdict', () => {
  const rubric: Rubric = {
    id: 'r1',
    checks: [
      {
        id: 'err',
        description: 'error rate < 1%',
        metric: 'summary.errorRate',
        op: '<',
        value: 0.01
      },
      {
        id: 'p99',
        description: 'p99 < 200ms',
        metric: 'summary.latency.p99',
        op: '<',
        value: 200,
        points: 2
      },
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
    const r: Rubric = {
      checks: [{ id: 'x', description: 'p99', metric: 'summary.latency.p99', op: '<', value: 100 }]
    }
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

  it('classifies invariant checks explicitly and reports invariant-derived failures', () => {
    const result = gradeVerdict(
      {
        checks: [
          {
            id: 'no-invariants',
            description: 'No invariant violations',
            kind: 'invariant',
            metric: 'invariantViolations.count',
            op: '==',
            value: 0
          }
        ]
      },
      verdict({ invariantViolations: 2 })
    )

    expect(result.checks[0]).toMatchObject({
      id: 'no-invariants',
      kind: 'invariant',
      status: 'failed',
      actual: 2,
      detail: 'actual 2 does not satisfy invariantViolations.count == 0'
    })
  })
})

describe('gradeBatch', () => {
  it('grades ran cases and normalizes run failures into execution + skipped rows', () => {
    const batch: EvaluationBatch = {
      version: '1.0',
      results: [
        { id: 'ok', ok: true, verdict: verdict({ errorRate: 0 }) },
        { id: 'broken', ok: false, error: 'engine blew up' }
      ],
      summary: { total: 2, succeeded: 1, failed: 1 }
    }
    const graded = gradeBatch(
      {
        checks: [
          { id: 'e', description: 'err<1%', metric: 'summary.errorRate', op: '<', value: 0.01 }
        ]
      },
      batch
    )
    expect(graded.cases[0]).toMatchObject({ id: 'ok', ran: true })
    expect(graded.cases[0].rubric?.passed).toBe(true)
    expect(graded.cases[1]).toMatchObject({
      id: 'broken',
      ran: false,
      executionStatus: 'failed',
      error: 'Execution failed before a verdict was produced.'
    })
    expect(graded.cases[1].rubric?.checks).toEqual([
      {
        id: EXECUTION_CHECK_ID,
        description: 'Case execution completed',
        kind: 'execution',
        actual: null,
        status: 'failed',
        passed: false,
        points: 0,
        awarded: 0,
        detail: 'Execution failed before a verdict was produced.'
      },
      {
        id: 'e',
        description: 'err<1%',
        kind: 'simulation',
        metric: 'summary.errorRate',
        op: '<',
        value: 0.01,
        actual: null,
        status: 'skipped',
        passed: false,
        points: 1,
        awarded: 0,
        detail: 'Check was not evaluated because execution did not complete.'
      }
    ])
    expect(graded.summary).toMatchObject({
      total: 2,
      ran: 1,
      errored: 1,
      passed: 1,
      failed: 1,
      totalChecks: 4,
      passedChecks: 2,
      failedChecks: 1,
      skippedChecks: 1
    })
  })
})

describe('gradeQuestionBatch', () => {
  it('evaluates topology checks once and aggregates them with case-level checks', () => {
    const batch: EvaluationBatch = {
      version: '1.0',
      results: [{ id: 'baseline', ok: true, verdict: verdict({ errorRate: 0.005 }) }],
      summary: { total: 1, succeeded: 1, failed: 0 }
    }

    const graded = gradeQuestionBatch(
      {
        passThreshold: 1,
        checks: [
          {
            id: 'single-source',
            kind: 'topology',
            description: 'Exactly one source node',
            metric: 'topology.sourceCount',
            op: '==',
            value: 1,
            points: 1
          },
          {
            id: 'error-rate',
            description: 'Error rate < 1%',
            metric: 'summary.errorRate',
            op: '<',
            value: 0.01,
            points: 2
          }
        ]
      },
      topology(),
      batch
    )

    expect(graded.question?.checks[0]).toMatchObject({
      id: 'single-source',
      kind: 'topology',
      status: 'passed',
      actual: 1
    })
    expect(graded.cases[0].rubric?.checks[0]).toMatchObject({
      id: EXECUTION_CHECK_ID,
      kind: 'execution',
      status: 'passed'
    })
    expect(graded.score).toEqual({ earned: 3, possible: 3, fraction: 1 })
    expect(graded.passed).toBe(true)
  })
})
