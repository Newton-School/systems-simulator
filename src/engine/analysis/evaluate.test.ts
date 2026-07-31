import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import type { SimulationOutput } from './output'
import { evaluateSuite, type PreparedCase } from './evaluate'

// Minimal SimulationOutput stub carrying only the fields projectToVerdict reads.
function fakeOutput(seed: string): SimulationOutput {
  return {
    seed,
    simulationDuration: 1000,
    warmupDuration: 0,
    eventsProcessed: 42,
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
      throughput: 9,
      errorRate: 0.1,
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

function topology(seed: string): TopologyJSON {
  return { global: { seed } } as unknown as TopologyJSON
}

describe('evaluateSuite', () => {
  it('runs each ready case, projects a verdict, and preserves order', () => {
    const cases: PreparedCase[] = [
      { id: 'a', topology: topology('seed-a') },
      { id: 'b', topology: topology('seed-b') }
    ]

    const batch = evaluateSuite(cases, (t) => fakeOutput((t.global as { seed: string }).seed), 'demo')

    expect(batch.suite).toBe('demo')
    expect(batch.results.map((r) => r.id)).toEqual(['a', 'b'])
    const first = batch.results[0]
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.verdict.version).toBe('1.0')
      expect(first.verdict.meta.seed).toBe('seed-a') // per-case topology actually ran
    }
    expect(batch.summary).toEqual({ total: 2, succeeded: 2, failed: 0 })
  })

  it('isolates a throwing case as that case error without aborting the rest', () => {
    const cases: PreparedCase[] = [
      { id: 'ok', topology: topology('s1') },
      { id: 'boom', topology: topology('explode') }
    ]

    const batch = evaluateSuite(cases, (t) => {
      if ((t.global as { seed: string }).seed === 'explode') throw new Error('engine blew up')
      return fakeOutput('s1')
    })

    expect(batch.results[0]).toMatchObject({ id: 'ok', ok: true })
    expect(batch.results[1]).toEqual({ id: 'boom', ok: false, error: 'engine blew up' })
    expect(batch.summary).toEqual({ total: 2, succeeded: 1, failed: 1 })
    expect(batch.suite).toBeUndefined()
  })

  it('passes through cases that failed before they could run', () => {
    const cases: PreparedCase[] = [
      { id: 'unreadable', error: 'Could not read topology' },
      { id: 'good', topology: topology('s') }
    ]

    const batch = evaluateSuite(cases, () => fakeOutput('s'))

    expect(batch.results[0]).toEqual({ id: 'unreadable', ok: false, error: 'Could not read topology' })
    expect(batch.summary).toEqual({ total: 2, succeeded: 1, failed: 1 })
  })
})
