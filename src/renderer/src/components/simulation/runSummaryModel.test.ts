import { describe, expect, it } from 'vitest'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import type { ClassroomRunSummary } from '../../../../engine/classroom/runSummary'
import {
  statDelta,
  summarizeRun,
  type InjectedFailure,
  type RunSummaryStat
} from './runSummaryModel'

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
    expect(summary.bottleneckNodeId).toBe('db')
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
    expect(summary.bottleneckNodeId).toBe('db')
    expect(summary.stats.find((s) => s.id === 'cost')?.value).toBe('$0.420/hr')
  })

  it('passes a classroom run with nothing dropped and everything under target', () => {
    expect(summarizeRun(output({}), classroom({})).verdict).toBe('passed')
  })
})

describe('statDelta', () => {
  const stat = (
    id: RunSummaryStat['id'],
    raw: number | null,
    better: RunSummaryStat['better']
  ): RunSummaryStat => ({ id, label: id, value: String(raw), raw, better })

  it('marks more served as better and fewer as worse', () => {
    expect(statDelta(stat('served', 100, 'higher'), stat('served', 160, 'higher'))).toEqual({
      text: '+60 req/s',
      tone: 'better'
    })
    expect(statDelta(stat('served', 100, 'higher'), stat('served', 40, 'higher'))?.tone).toBe(
      'worse'
    )
  })

  it('marks a drop in errors or latency as better', () => {
    expect(statDelta(stat('dropped', 0.04, 'lower'), stat('dropped', 0, 'lower'))).toEqual({
      text: '-4 pts',
      tone: 'better'
    })
    expect(statDelta(stat('p95', 120, 'lower'), stat('p95', 140, 'lower'))).toEqual({
      text: '+20 ms',
      tone: 'worse'
    })
  })

  it('ignores no change, noise and missing numbers', () => {
    expect(statDelta(stat('served', 100, 'higher'), stat('served', 100, 'higher'))).toBeNull()
    expect(statDelta(stat('served', 1000, 'higher'), stat('served', 1005, 'higher'))).toBeNull()
    expect(statDelta(stat('p95', null, 'lower'), stat('p95', 10, 'lower'))).toBeNull()
    expect(statDelta(undefined, stat('p95', 10, 'lower'))).toBeNull()
  })
})

describe('injected failure notes', () => {
  const withNode = (stats: Record<string, number>): SimulationOutput =>
    ({
      ...output({}),
      perNode: {
        a: {
          nodeLabel: 'API Server A',
          postWarmupArrived: 0,
          postWarmupRejected: 0,
          postWarmupTimedOut: 0,
          postWarmupConnectionReset: 0,
          ...stats
        }
      }
    }) as unknown as SimulationOutput
  const injected = (rate: number): InjectedFailure[] => [
    { nodeId: 'a', label: 'API Server A', rate }
  ]

  it('says a down node got no traffic and was routed around', () => {
    const notes = summarizeRun(withNode({}), null, { injected: injected(1) }).injectedFailureNotes
    expect(notes).toEqual([
      'API Server A is down and got no traffic: its requests were routed elsewhere.'
    ])
  })

  it('counts the requests a failing node actually failed', () => {
    const notes = summarizeRun(
      withNode({ postWarmupArrived: 1000, postWarmupRejected: 380, postWarmupTimedOut: 20 }),
      null,
      { injected: injected(0.4) }
    ).injectedFailureNotes
    expect(notes).toEqual([
      'API Server A is failing 40% of requests: 400 of 1,000 requests it received failed.'
    ])
  })

  it('does not claim failures that never showed up', () => {
    const notes = summarizeRun(withNode({ postWarmupArrived: 50 }), null, {
      injected: injected(0.4)
    }).injectedFailureNotes
    expect(notes[0]).toContain('none of the 50 requests it received failed')
  })

  it('has no notes without injected failures, and ignores nodes missing from the run', () => {
    expect(summarizeRun(withNode({}), null, { injected: [] }).injectedFailureNotes).toEqual([])
    expect(
      summarizeRun(withNode({}), null, { injected: [{ nodeId: 'gone', label: 'Gone', rate: 1 }] })
        .injectedFailureNotes
    ).toEqual([])
  })

  it('describes a scheduled failure with its timing and what it cost', () => {
    const fault = (mode: string, atMs: number, durationMs: number) =>
      ({
        targetId: 'a',
        faultType: 'chaos',
        timing: 'deterministic',
        duration: 'fixed',
        params: { atMs, durationMs, mode }
      }) as never
    const hit = withNode({ postWarmupArrived: 900, postWarmupRejected: 120 })
    expect(
      summarizeRun(hit, null, { faults: [fault('reject', 5000, 10000)] }).injectedFailureNotes
    ).toEqual([
      'Scheduled failure: API Server A rejects requests from 5s for 10s. 120 requests failed there.'
    ])
    expect(
      summarizeRun(withNode({ postWarmupArrived: 900 }), null, {
        faults: [fault('blackhole', 2000, 0)]
      }).injectedFailureNotes
    ).toEqual([
      'Scheduled failure: API Server A stops responding from 2s onward. No requests failed there.'
    ])
  })

  it('reports the experiment verdict, and a failed one is not a pass', () => {
    const run = withNode({})
    const passed = summarizeRun(run, null, {
      experiment: { name: 'Traffic spike', passed: true, summary: 'Steady state held.' }
    })
    expect(passed.injectedFailureNotes[0]).toBe(
      'Experiment "Traffic spike" passed: Steady state held.'
    )
    expect(passed.verdict).toBe('passed')
    const failed = summarizeRun(run, null, {
      experiment: { name: 'Traffic spike', passed: false, summary: 'Errors rose above 1%.' }
    })
    expect(failed.injectedFailureNotes[0]).toContain('failed')
    expect(failed.verdict).toBe('needs-work')
  })
})
