import { describe, expect, it } from 'vitest'
import { compileExperiment, runChaosExperiment } from '../chaosExperiment'
import { composeScenarios } from '../composer'
import { createCacheStampedeExperiment, createTrafficSpikeExperiment } from '../presets'
import type { ChaosExperimentDefinition } from '../types'
import { apiDbTopology, cacheTopology } from './fixtures'

function crash(
  id: string,
  target: string,
  mode: 'blackhole' | 'reject',
  durationMs: number
): ChaosExperimentDefinition {
  return {
    id,
    name: id,
    warmupMs: 1_000,
    baselineMs: 2_000,
    steadyState: [{ metric: 'error_rate', operator: '<', value: 0.01 }],
    steps: [
      { type: 'inject', fault: { targetId: target, mode, durationMs } },
      { type: 'wait', durationMs },
      { type: 'verify', assertions: [{ metric: 'throughput' }] }
    ],
    finalCheckMs: 2_000
  }
}

describe('composeScenarios', () => {
  it('places a second scenario 5s later and keeps verify windows', () => {
    const topology = cacheTopology({ dbWorkers: 2 })
    const composed = composeScenarios([
      { experiment: createTrafficSpikeExperiment(topology, { multiplier: 2 }), offsetMs: 0 },
      { experiment: createCacheStampedeExperiment(topology), offsetMs: 5_000 }
    ])
    const { plan, topology: compiled } = compileExperiment(topology, composed)
    const start = plan.stepsStartMs
    expect(compiled.workload?.spike?.spikeTime).toBe(start)
    expect(compiled.faults).toEqual([
      expect.objectContaining({
        targetId: 'cache',
        faultType: 'cache-flush',
        params: expect.objectContaining({ atMs: start + 5_000 })
      })
    ])
    const verifies = plan.checks.filter((c) => c.phase === 'verify')
    expect(verifies.map((c) => [c.fromMs - start, c.toMs - start])).toEqual([
      [0, 10_000],
      [5_000, 10_000]
    ])
  })

  it('takes the union of steady-state assertions, once each', () => {
    const topology = cacheTopology()
    const spike = createTrafficSpikeExperiment(topology)
    const stampede = createCacheStampedeExperiment(topology)
    const composed = composeScenarios([
      { experiment: spike, offsetMs: 0 },
      { experiment: stampede, offsetMs: 0 }
    ])
    expect(composed.steadyState).toHaveLength(3) // error rate + p99 shared, origin load from the stampede
  })

  it('lets the later fault win on the same node, and the later scenario on a tie', () => {
    const overlapping = composeScenarios([
      { experiment: crash('a', 'db', 'blackhole', 6_000), offsetMs: 0 },
      { experiment: crash('b', 'db', 'reject', 2_000), offsetMs: 2_000 }
    ])
    const { topology, plan } = compileExperiment(apiDbTopology(), overlapping)
    expect(
      topology.faults?.map((f) => [
        f.params.mode,
        f.params.atMs - plan.stepsStartMs,
        f.params.durationMs
      ])
    ).toEqual([
      ['blackhole', 0, 2_000],
      ['reject', 2_000, 2_000]
    ])
    expect(overlapping.notes?.join(' ')).toMatch(
      /b's fault starts at .* while a's fault is still active/
    )

    const tie = composeScenarios([
      { experiment: crash('a', 'db', 'blackhole', 3_000), offsetMs: 0 },
      { experiment: crash('b', 'db', 'reject', 3_000), offsetMs: 0 }
    ])
    const tied = compileExperiment(apiDbTopology(), tie).topology
    expect(tied.faults?.map((f) => f.params.mode)).toEqual(['reject'])
  })

  it('keeps only the latest-starting traffic spike', () => {
    const topology = apiDbTopology()
    const composed = composeScenarios([
      {
        experiment: createTrafficSpikeExperiment(topology, { multiplier: 2, spikeSeconds: 3 }),
        offsetMs: 0
      },
      {
        experiment: createTrafficSpikeExperiment(topology, { multiplier: 3, spikeSeconds: 3 }),
        offsetMs: 4_000
      }
    ])
    const { topology: compiled, plan } = compileExperiment(topology, composed)
    expect(compiled.workload?.spike).toMatchObject({
      spikeRps: 300,
      spikeTime: plan.stepsStartMs + 4_000
    })
    expect(composed.notes?.join(' ')).toMatch(/one traffic spike per run/)
  })

  it('rejects offsets that are not whole seconds', () => {
    expect(() =>
      composeScenarios([{ experiment: crash('a', 'db', 'reject', 2_000), offsetMs: 1_500 }])
    ).toThrow(/whole number of seconds/)
  })

  it('runs a composed experiment end to end', () => {
    const topology = cacheTopology({ dbWorkers: 2 })
    const composed = composeScenarios([
      { experiment: createTrafficSpikeExperiment(topology, { multiplier: 2 }), offsetMs: 0 },
      { experiment: createCacheStampedeExperiment(topology), offsetMs: 5_000 }
    ])
    const { result } = runChaosExperiment(topology, composed)
    expect(result.steadyStateHeld).toBe(true)
    // 240 rps all missing to a 2-worker, 10ms origin (200 rps) overloads it.
    expect(result.verdict).toBe('failed')
    expect(result.violations.every((v) => v.checkId !== 'steady-state')).toBe(true)
    expect(result.checks.find((c) => c.phase === 'final')?.status).toBe('pass')
  })
})
