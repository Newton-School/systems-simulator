import { describe, expect, it } from 'vitest'
import {
  ChaosExperiment,
  ExperimentCompileError,
  compileExperiment,
  evaluateExperiment,
  runChaosExperiment
} from '../chaosExperiment'
import type { ChaosExperimentDefinition, ExperimentAssertion } from '../types'
import { apiDbTopology, cacheTopology } from './fixtures'

const STEADY: ExperimentAssertion[] = [
  { metric: 'error_rate', operator: '<', value: 0.01 },
  { metric: 'latency_p99', operator: '<', value: 500 }
]

function dbCrash(overrides: Partial<ChaosExperimentDefinition> = {}): ChaosExperimentDefinition {
  return {
    id: 'db-crash',
    name: 'DB crash',
    warmupMs: 2_000,
    baselineMs: 3_000,
    steadyState: STEADY,
    steps: [
      { type: 'inject', fault: { targetId: 'db' } },
      { type: 'wait', durationMs: 4_000 },
      { type: 'verify', assertions: [{ metric: 'error_rate', operator: '<', value: 0.01 }] },
      { type: 'restore', targetId: 'db' },
      { type: 'wait', durationMs: 3_000 },
      { type: 'verify', assertions: [{ metric: 'error_rate', operator: '<', value: 0.01 }] }
    ],
    finalCheckMs: 3_000,
    ...overrides
  }
}

describe('compileExperiment', () => {
  it('turns waits into absolute times, faults into scheduled faults, and sets the run timing', () => {
    const { topology, plan } = compileExperiment(apiDbTopology(), dbCrash())

    expect(plan.stepsStartMs).toBe(5_000)
    expect(plan.durationMs).toBe(5_000 + 4_000 + 3_000 + 3_000)
    expect(topology.global.warmupDuration).toBe(2_000)
    expect(topology.global.simulationDuration).toBe(15_000)
    expect(topology.faults).toEqual([
      expect.objectContaining({
        targetId: 'db',
        duration: 'fixed',
        params: expect.objectContaining({ atMs: 5_000, durationMs: 4_000, mode: 'blackhole' })
      })
    ])
    expect(plan.checks.map((c) => [c.id, c.fromMs, c.toMs])).toEqual([
      ['steady-state', 2_000, 5_000],
      ['verify-2', 5_000, 9_000],
      ['verify-5', 9_000, 12_000],
      ['final', 12_000, 15_000]
    ])
    expect(plan.timeline.map((e) => [e.type, e.atMs])).toEqual([
      ['warmup', 0],
      ['steady-state', 2_000],
      ['inject', 5_000],
      ['wait', 5_000],
      ['verify', 9_000],
      ['restore', 9_000],
      ['wait', 9_000],
      ['verify', 12_000],
      ['final', 12_000]
    ])
  })

  it('replaces faults already on the topology and says so', () => {
    const base = apiDbTopology()
    base.faults = [
      {
        targetId: 'api',
        faultType: 'chaos',
        timing: 'deterministic',
        duration: 'permanent',
        params: {}
      }
    ]
    const { topology, plan } = compileExperiment(base, dbCrash())
    expect(topology.faults?.every((f) => f.targetId === 'db')).toBe(true)
    expect(plan.notes.join(' ')).toMatch(/set aside/)
  })

  it('reports every problem at once', () => {
    let error: unknown
    try {
      compileExperiment(apiDbTopology(), {
        ...dbCrash(),
        baselineMs: 1_500,
        steps: [
          { type: 'verify', assertions: STEADY },
          { type: 'restore', targetId: 'api' },
          { type: 'inject', fault: { targetId: 'ghost' } },
          { type: 'wait', durationMs: 2_500 }
        ]
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ExperimentCompileError)
    const issues = (error as ExperimentCompileError).issues.join('\n')
    expect(issues).toMatch(/baseline must be at least 1 second/)
    expect(issues).toMatch(/Step 1: verify has nothing to measure/)
    expect(issues).toMatch(/Step 2: nothing is failing on api/)
    expect(issues).toMatch(/"ghost", which is not in this topology/)
    expect(issues).toMatch(/Step 4: a wait must be a positive whole number of seconds/)
  })

  it('resolves overlapping faults on one node: the later start wins from that moment', () => {
    const { topology, plan } = compileExperiment(apiDbTopology(), {
      ...dbCrash(),
      steps: [
        {
          type: 'inject',
          fault: {
            targetId: 'db',
            mode: 'degraded',
            degradation: { fraction: 1, serviceTimeMultiplier: 4 },
            durationMs: 6_000
          }
        },
        { type: 'wait', durationMs: 2_000 },
        { type: 'inject', fault: { targetId: 'db', mode: 'reject', durationMs: 2_000 } },
        { type: 'wait', durationMs: 4_000 }
      ]
    })
    expect(
      topology.faults?.map((f) => [f.params.mode, f.params.atMs, f.params.durationMs])
    ).toEqual([
      ['degraded', 5_000, 2_000],
      ['reject', 7_000, 2_000]
    ])
    expect(plan.notes.join(' ')).toMatch(/later fault takes over/)
  })

  it('applies a traffic step as the engine spike pattern', () => {
    const { topology } = compileExperiment(apiDbTopology({ baseRps: 50 }), {
      ...dbCrash(),
      steps: [
        { type: 'traffic', multiplier: 4, durationMs: 3_000 },
        { type: 'wait', durationMs: 3_000 }
      ]
    })
    expect(topology.workload).toMatchObject({
      pattern: 'spike',
      spike: { spikeTime: 5_000, spikeRps: 200, spikeDuration: 3_000 }
    })
    expect(topology.faults).toEqual([])
  })
})

describe('runChaosExperiment (engine-level)', () => {
  it('passes a healthy system against errorRate < 1%', () => {
    const { result } = runChaosExperiment(apiDbTopology(), {
      ...dbCrash(),
      steps: [
        { type: 'wait', durationMs: 3_000 },
        {
          type: 'verify',
          assertions: [
            { metric: 'error_rate', operator: '<', value: 0.01 },
            { metric: 'throughput', operator: '>=', value: 95 }
          ]
        }
      ]
    })
    expect(result.verdict).toBe('passed')
    expect(result.passed).toBe(true)
    expect(result.violations).toEqual([])
    const verify = result.checks.find((c) => c.phase === 'verify')!
    expect(verify.assertions[1].actual).toBeCloseTo(100, 0)
  })

  it('injects a DB crash, sees the error rate spike, restores it and sees recovery', () => {
    const { result, output } = runChaosExperiment(apiDbTopology(), dbCrash())

    expect(result.steadyStateHeld).toBe(true)
    expect(result.verdict).toBe('failed')
    const [steady, during, after, final] = result.checks
    expect(steady.status).toBe('pass')
    expect(during.status).toBe('fail')
    expect(during.assertions[0].actual).toBeGreaterThan(0.5)
    // The 9-12s window includes requests that were blackholed just before the
    // restore and time out after it, so recovery is checked in the final window.
    expect(final.status).toBe('pass')
    expect(final.assertions[0].actual).toBe(0)
    expect(after.fromMs).toBe(9_000)

    expect(result.violations[0]).toMatchObject({ checkId: 'verify-2', stepIndex: 2 })
    expect(result.violations[0].actual).toBeGreaterThan(0.5)
    // Timeline records every step with its outcome.
    expect(result.timeline.map((e) => [e.type, e.result])).toEqual([
      ['warmup', 'executed'],
      ['steady-state', 'pass'],
      ['inject', 'executed'],
      ['wait', 'executed'],
      ['verify', 'fail'],
      ['restore', 'executed'],
      ['wait', 'executed'],
      ['verify', after.status === 'pass' ? 'pass' : 'fail'],
      ['final', 'pass']
    ])
    expect(output.statusTimeline.some((w) => w.componentId === 'db')).toBe(true)
  })

  it('stops at "not stable" when the steady state fails before injection', () => {
    const { result } = runChaosExperiment(apiDbTopology(), {
      ...dbCrash(),
      steadyState: [{ metric: 'latency_p99', operator: '<', value: 1 }]
    })
    expect(result.verdict).toBe('not-stable')
    expect(result.checks[0].status).toBe('fail')
    expect(result.checks.slice(1).every((c) => c.status === 'skipped')).toBe(true)
    expect(result.summary).toMatch(/not stable before any fault/)
  })

  it('reports observations without failing on them', () => {
    const { result } = runChaosExperiment(apiDbTopology(), {
      ...dbCrash(),
      steadyState: [...STEADY, { metric: 'throughput', nodeId: 'db' }],
      steps: [{ type: 'wait', durationMs: 2_000 }]
    })
    expect(result.verdict).toBe('passed')
    const observed = result.checks[0].assertions[2]
    expect(observed.status).toBe('observed')
    expect(observed.actual).toBeCloseTo(100, 0)
  })

  it('is deterministic for a fixed seed', () => {
    const a = runChaosExperiment(apiDbTopology(), dbCrash()).result
    const b = runChaosExperiment(apiDbTopology(), dbCrash()).result
    expect(a).toEqual(b)
  })

  it('works through the fluent builder', () => {
    const run = new ChaosExperiment('builder', {
      warmupMs: 1_000,
      baselineMs: 2_000,
      finalCheckMs: 2_000
    })
      .defineSteadyState([{ metric: 'error_rate', operator: '<', value: 0.01 }])
      .addStep({ type: 'inject', fault: { targetId: 'db', mode: 'reject', durationMs: 2_000 } })
      .addStep({ type: 'wait', durationMs: 2_000 })
      .addStep({
        type: 'verify',
        assertions: [{ metric: 'error_rate', operator: '>', value: 0.5 }]
      })
      .addStep({ type: 'wait', durationMs: 2_000 })
      .run(apiDbTopology())
    expect(run.result.verdict).toBe('passed')
    expect(run.compiled.topology.global.simulationDuration).toBe(9_000)
  })
})

describe('evaluateExperiment edge cases', () => {
  it('is inconclusive for an analytic run', () => {
    const { plan } = compileExperiment(apiDbTopology(), dbCrash())
    const { output } = runChaosExperiment(apiDbTopology(), dbCrash())
    const result = evaluateExperiment(plan, { ...output, evaluationMode: 'analytic' })
    expect(result.verdict).toBe('inconclusive')
    expect(result.checks.every((c) => c.status === 'skipped')).toBe(true)
  })

  it('skips checks after a user stop', () => {
    const { plan } = compileExperiment(apiDbTopology(), dbCrash())
    const { output } = runChaosExperiment(apiDbTopology(), dbCrash())
    const result = evaluateExperiment(plan, output, { stoppedAtMs: 10_000 })
    expect(result.checks.map((c) => c.status)).toEqual(['pass', 'fail', 'skipped', 'skipped'])
    expect(result.verdict).toBe('failed')
  })
})

describe('cache-flush fault', () => {
  it('makes a declared-rate cache miss everything for the cold window', () => {
    const base = cacheTopology({ dbWorkers: 4 })
    const { output } = runChaosExperiment(base, {
      ...dbCrash(),
      steadyState: [{ metric: 'throughput', nodeId: 'db' }],
      steps: [
        { type: 'inject', fault: { targetId: 'cache', kind: 'cache-flush', durationMs: 3_000 } },
        { type: 'wait', durationMs: 3_000 },
        { type: 'verify', assertions: [{ metric: 'throughput', nodeId: 'db' }] }
      ]
    })
    const dbWindows = output.perNode.db.latencyWindows
    const rate = (from: number, to: number) =>
      dbWindows
        .filter((w) => w.windowStartMs >= from && w.windowEndMs <= to)
        .reduce((sum, w) => sum + w.successCount, 0) /
      ((to - from) / 1000)
    expect(rate(2_000, 5_000)).toBeLessThan(20) // ~10% of 120 rps miss
    expect(rate(5_000, 8_000)).toBeGreaterThan(110) // everything misses
    expect(rate(8_000, 11_000)).toBeLessThan(20) // declared rate snaps back
    expect(output.perNode.cache.traitCounters.cacheFlushMisses).toBeGreaterThan(300)
  })

  it('wipes a derived-LRU cache, which then re-warms from traffic', () => {
    const base = cacheTopology({
      dbWorkers: 8,
      cacheConfig: { cacheModel: 'derived-lru', cacheRamMb: 0.2, valueSizeBytes: 1_000 }
    })
    base.workload!.requestDistribution = [
      { type: 'GET', weight: 1, sizeBytes: 512, keyspace: { field: 'id', size: 400, skew: 0 } }
    ]
    // 200 slots over 400 uniform keys: ~50% hits once warm, 0% right after a wipe.
    const run = (flush: boolean) =>
      runChaosExperiment(base, {
        ...dbCrash(),
        warmupMs: 6_000,
        steadyState: [{ metric: 'throughput', nodeId: 'db' }],
        steps: [
          ...(flush
            ? [
                {
                  type: 'inject' as const,
                  fault: { targetId: 'cache', kind: 'cache-flush' as const }
                }
              ]
            : []),
          { type: 'wait', durationMs: 1_000 },
          { type: 'verify', assertions: [{ metric: 'throughput', nodeId: 'db' }] },
          { type: 'wait', durationMs: 4_000 }
        ]
      }).result.checks[1].assertions[0].actual!
    const withFlush = run(true)
    const without = run(false)
    expect(withFlush).toBeGreaterThan(without * 1.2)
  })
})
