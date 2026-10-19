import { describe, expect, it } from 'vitest'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import type { ClassroomRunSummary } from '../../../../engine/classroom/runSummary'
import { summarizeRun } from './runSummaryModel'

function output(overrides: {
  errorRate?: number
  throughput?: number
  p95?: number | null
  breaches?: number
  failuresByLocus?: unknown[]
}): SimulationOutput {
  return {
    summary: {
      errorRate: overrides.errorRate ?? 0,
      throughput: overrides.throughput ?? 100,
      latency: { p95: overrides.p95 === undefined ? 120 : overrides.p95 },
      failuresByLocus: overrides.failuresByLocus ?? [],
      latencyDecomposition: []
    },
    perNode: { db: { nodeLabel: 'Database' } },
    perEdge: {},
    sloBreaches: new Array(overrides.breaches ?? 0).fill({})
  } as unknown as SimulationOutput
}

const classroom = (over: Partial<ClassroomRunSummary>): ClassroomRunSummary => ({
  components: [{ nodeId: 'db', label: 'Database', copies: 1, utilization: 0.5, overTarget: false }],
  targetUtilization: 0.8,
  servedRps: 5000,
  droppedShare: 0,
  ...over
})

describe('summarizeRun', () => {
  it('passes a clean run', () => {
    const summary = summarizeRun(output({}), null)
    expect(summary.verdict).toBe('passed')
    expect(summary.stats.map((s) => s.id)).toEqual(['served', 'dropped', 'p95'])
  })

  it('needs work on any errors or SLO breach, and fails at 5% errors', () => {
    expect(summarizeRun(output({ errorRate: 0.01 }), null).verdict).toBe('needs-work')
    expect(summarizeRun(output({ breaches: 1 }), null).verdict).toBe('needs-work')
    expect(summarizeRun(output({ errorRate: 0.05 }), null).verdict).toBe('failed')
  })

  it('shows N/A when there are no latency samples', () => {
    const p95 = summarizeRun(output({ p95: null }), null).stats.find((s) => s.id === 'p95')
    expect(p95?.value).toBe('N/A')
  })

  it('names the failure locus as the bottleneck', () => {
    const summary = summarizeRun(
      output({ failuresByLocus: [{ locus: 'db', locusKind: 'node' }], errorRate: 0.02 }),
      null
    )
    expect(summary.bottleneck).toBe('Most failures end at Database')
  })

  it('uses the classroom summary: over-target component is the bottleneck, cost shown', () => {
    const summary = summarizeRun(
      output({}),
      classroom({
        costPerHour: 0.42,
        components: [
          { nodeId: 'db', label: 'Database', copies: 1, utilization: 1.18, overTarget: true }
        ]
      })
    )
    expect(summary.verdict).toBe('needs-work')
    expect(summary.bottleneck).toBe('Bottleneck: Database at 118% (target 80% or less)')
    expect(summary.stats.find((s) => s.id === 'cost')?.value).toBe('$0.420/hr')
  })

  it('passes a classroom run with nothing dropped and everything under target', () => {
    expect(summarizeRun(output({}), classroom({})).verdict).toBe('passed')
  })
})
