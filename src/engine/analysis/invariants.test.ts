import { describe, expect, it } from 'vitest'
import type { SimulationOutput } from './output'
import { evaluateInvariantViolations } from './invariants'

function fakeOutput(errorRate: number): SimulationOutput {
  return {
    seed: 'seed',
    simulationDuration: 1_000,
    warmupDuration: 0,
    eventsProcessed: 1,
    reproducible: true,
    summary: {
      totalRequests: 10,
      postWarmupTotalRequests: 10,
      successfulRequests: 8,
      postWarmupSuccessfulRequests: 8,
      failedRequests: 2,
      postWarmupFailedRequests: 2,
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

describe('evaluateInvariantViolations', () => {
  it('returns a violation when an authored metric threshold fails', () => {
    const violations = evaluateInvariantViolations(
      [{ id: 'err-low', description: 'Keep errors low', condition: 'summary.errorRate < 0.1' }],
      fakeOutput(0.2)
    )

    expect(violations).toEqual([
      {
        invariantId: 'err-low',
        invariantName: 'Keep errors low',
        violatedAt: 1_000,
        details: 'actual 0.2 does not satisfy summary.errorRate < 0.1'
      }
    ])
  })

  it('fails closed for unsupported invariant expressions', () => {
    const violations = evaluateInvariantViolations(
      [{ id: 'expr', description: 'Boolean expr', condition: 'summary.errorRate < 0.1 && summary.throughput > 10' }],
      fakeOutput(0.01)
    )

    expect(violations[0]?.details).toContain("Unsupported invariant condition")
  })

  it('fails closed for self-referential invariant metrics', () => {
    const violations = evaluateInvariantViolations(
      [{ id: 'self', description: 'No invariant recursion', condition: 'invariantViolations.count == 0' }],
      fakeOutput(0.01)
    )

    expect(violations[0]?.details).toContain('self-referential')
  })
})
