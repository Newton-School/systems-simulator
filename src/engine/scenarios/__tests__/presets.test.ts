import { describe, expect, it } from 'vitest'
import { runChaosExperiment } from '../chaosExperiment'
import {
  CHAOS_PRESETS,
  PresetUnavailableError,
  createCacheStampedeExperiment,
  createDbFailoverExperiment,
  createTrafficSpikeExperiment,
  tryBuildPreset
} from '../presets'
import { apiDbTopology, cacheTopology, failoverTopology } from './fixtures'

describe('cache stampede preset', () => {
  it('targets the cache and its database origin', () => {
    const definition = createCacheStampedeExperiment(cacheTopology())
    expect(definition.steps[0]).toMatchObject({
      type: 'inject',
      fault: { targetId: 'cache', kind: 'cache-flush' }
    })
    expect(definition.steps.filter((s) => s.type === 'verify')).toHaveLength(1)
    expect(definition.steadyState.length).toBeGreaterThanOrEqual(2)
    expect(definition.notes?.join(' ')).toMatch(/no request coalescing/)
  })

  it('passes when the origin has headroom for every miss', () => {
    const { result } = runChaosExperiment(
      cacheTopology({ dbWorkers: 2 }),
      createCacheStampedeExperiment(cacheTopology({ dbWorkers: 2 }))
    )
    expect(result.verdict).toBe('passed')
    const during = result.checks.find((c) => c.phase === 'verify')!
    const steady = result.checks[0]
    // Origin load goes from ~10% of traffic to all of it.
    expect(steady.assertions[2].actual!).toBeLessThan(20)
    expect(during.assertions[2].actual!).toBeGreaterThan(100)
  })

  it('fails when the origin cannot absorb the stampede', () => {
    const topology = cacheTopology({ dbWorkers: 1, dbCapacity: 8 })
    const { result } = runChaosExperiment(topology, createCacheStampedeExperiment(topology))
    expect(result.verdict).toBe('failed')
    expect(result.steadyStateHeld).toBe(true)
    expect(result.violations.some((v) => v.assertion.nodeId === 'db')).toBe(true)
    expect(result.checks.find((c) => c.phase === 'final')?.status).toBe('pass')
  })

  it('explains when there is no cache, or the cache has no hit model', () => {
    expect(() => createCacheStampedeExperiment(apiDbTopology())).toThrow(PresetUnavailableError)
    expect(() => createCacheStampedeExperiment(apiDbTopology())).toThrow(/needs a cache component/)
    expect(() => createCacheStampedeExperiment(cacheTopology({ cacheConfig: {} }))).toThrow(
      /no hit\/miss model/
    )
  })
})

describe('database failover preset', () => {
  it('passes behind a health-aware router', () => {
    const topology = failoverTopology()
    const definition = createDbFailoverExperiment(topology)
    expect(definition.steps[0]).toMatchObject({ type: 'inject', fault: { targetId: 'primary' } })
    const { result } = runChaosExperiment(topology, definition)
    expect(result.verdict).toBe('passed')
    const during = result.checks.find((c) => c.phase === 'verify')!
    expect(during.assertions[2].actual!).toBeGreaterThan(90) // replica took the load
  })

  it('fails, and says why, when nothing routes around the failed primary', () => {
    const topology = failoverTopology({ withRouter: false })
    const definition = createDbFailoverExperiment(topology)
    expect(definition.notes?.[0]).toMatch(/not a health-aware router/)
    const { result } = runChaosExperiment(topology, definition)
    expect(result.verdict).toBe('failed')
    expect(result.violations[0].actual!).toBeGreaterThan(0.05)
  })

  it('needs a database and a replica', () => {
    const noDb = apiDbTopology()
    noDb.nodes = noDb.nodes.filter((n) => n.id !== 'db')
    noDb.edges = noDb.edges.filter((e) => e.target !== 'db')
    expect(() => createDbFailoverExperiment(noDb)).toThrow(/no database component/)
    expect(() => createDbFailoverExperiment(apiDbTopology())).toThrow(/needs a replica/)
  })
})

describe('traffic spike preset', () => {
  it('fails when capacity is fixed and too small, then recovers', () => {
    const topology = apiDbTopology({ dbWorkers: 2 })
    const { result, compiled } = runChaosExperiment(
      topology,
      createTrafficSpikeExperiment(topology)
    )
    expect(compiled.topology.workload?.spike?.spikeRps).toBe(1_000)
    expect(result.verdict).toBe('failed')
    expect(result.checks.find((c) => c.phase === 'verify')!.status).toBe('fail')
    expect(result.checks.find((c) => c.phase === 'final')!.status).toBe('pass')
  })

  it('passes when the system has headroom', () => {
    const topology = apiDbTopology({ dbWorkers: 16 })
    const { result } = runChaosExperiment(
      topology,
      createTrafficSpikeExperiment(topology, { multiplier: 2 })
    )
    expect(result.verdict).toBe('passed')
  })

  it('refuses a workload without a steady base', () => {
    const topology = apiDbTopology()
    topology.workload!.pattern = 'diurnal'
    expect(() => createTrafficSpikeExperiment(topology)).toThrow(/steady base workload/)
  })
})

describe('preset registry', () => {
  it('lists the three presets and reports unavailability as a reason, not an exception', () => {
    expect(CHAOS_PRESETS.map((p) => p.id)).toEqual([
      'cache-stampede',
      'db-failover',
      'traffic-spike'
    ])
    const missing = tryBuildPreset(apiDbTopology(), 'db-failover')
    expect(missing).toEqual({ ok: false, reason: expect.stringMatching(/needs a replica/) })
    expect(tryBuildPreset(apiDbTopology(), 'traffic-spike').ok).toBe(true)
  })
})
