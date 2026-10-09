import { describe, expect, it } from 'vitest'
import type { FaultSpec, TopologyJSON, TopologyLocation } from './core/types'
import { faultDomainMemberIds } from './core/faultDomains'
import { runSimulation } from './runSimulation'
import { validateTopology } from './validation/validator'
import { runChaosExperiment } from './scenarios/chaosExperiment'
import { createAzOutageExperiment, tryBuildPreset } from './scenarios/presets'
import { edge, node, source, topology } from './scenarios/__tests__/fixtures'

const LOCATIONS: TopologyLocation[] = [
  { id: 'region', kind: 'region', label: 'us-east-1' },
  { id: 'az-a', kind: 'availability-zone', label: 'us-east-1a', parentId: 'region' },
  { id: 'az-b', kind: 'availability-zone', label: 'us-east-1b', parentId: 'region' },
  { id: 'subnet-a', kind: 'subnet', label: 'private-a', parentId: 'az-a' },
  { id: 'az-empty', kind: 'availability-zone', label: 'us-east-1c', parentId: 'region' }
]

function api(id: string) {
  return node(id, 'microservice', { workers: 16, capacity: 128, serviceMs: 2 })
}

/**
 * client -> lb (region, outside both zones) -> api-a (az-a) / api-b (az-b).
 * `db-a` sits in subnet-a and is placed ONLY by its subnet id, so its zone and
 * region come from the location parent chain. With `twoZones: false` the
 * balancer only knows api-a.
 */
function zonedTopology(opts: { twoZones?: boolean; faults?: FaultSpec[] } = {}): TopologyJSON {
  const twoZones = opts.twoZones ?? true
  const lb = node('lb', 'load-balancer', { workers: 64, capacity: 512, serviceMs: 0.2 })
  lb.role = 'router'
  lb.placement = { regionId: 'region' }
  const apiA = api('api-a')
  apiA.placement = { regionId: 'region', availabilityZoneId: 'az-a' }
  const apiB = api('api-b')
  apiB.placement = { regionId: 'region', availabilityZoneId: 'az-b' }
  const dbA = node('db-a', 'microservice', { workers: 16, capacity: 128, serviceMs: 1 })
  dbA.placement = { subnetId: 'subnet-a' }
  const base = topology(
    [source(), lb, apiA, ...(twoZones ? [apiB] : []), dbA],
    [
      edge('client', 'lb'),
      edge('lb', 'api-a'),
      ...(twoZones ? [edge('lb', 'api-b')] : []),
      edge('api-a', 'db-a')
    ],
    { baseRps: 100 }
  )
  return {
    ...base,
    locations: structuredClone(LOCATIONS),
    ...(opts.faults ? { faults: opts.faults } : {})
  }
}

function zoneFault(targetId: string, atMs: number, durationMs: number): FaultSpec {
  return {
    targetId,
    faultType: 'chaos',
    timing: 'deterministic',
    duration: 'fixed',
    params: { atMs, durationMs, mode: 'blackhole', inFlightPolicy: 'hang', recoveryPolicy: 'reset' }
  }
}

function windowsByNode(output: ReturnType<typeof runSimulation>) {
  return Object.fromEntries(output.statusTimeline.map((w) => [w.componentId, w]))
}

describe('fault-domain membership', () => {
  it('resolves nested placement through the location parent chain and skips the source', () => {
    const t = zonedTopology()
    t.nodes[0].placement = { availabilityZoneId: 'az-a' } // the client sits in az-a
    expect(faultDomainMemberIds(t, 'az-a')).toEqual(['api-a', 'db-a'])
    expect(faultDomainMemberIds(t, 'subnet-a')).toEqual(['db-a'])
    expect(faultDomainMemberIds(t, 'region')).toEqual(['lb', 'api-a', 'api-b', 'db-a'])
    expect(faultDomainMemberIds(t, 'az-empty')).toEqual([])
  })
})

describe('availability-zone outage', () => {
  it('fails exactly the contained nodes for the window, then recovers them', () => {
    const output = runSimulation(zonedTopology({ faults: [zoneFault('az-a', 3_000, 4_000)] }), {
      mode: 'discrete'
    })
    const windows = windowsByNode(output)
    expect(Object.keys(windows).sort()).toEqual(['api-a', 'db-a'])
    for (const id of ['api-a', 'db-a']) {
      expect(windows[id]).toMatchObject({
        mode: 'blackhole',
        startMs: 3_000,
        endMs: 7_000,
        faultDomain: { id: 'az-a', label: 'us-east-1a', kind: 'availability-zone' }
      })
    }
  })

  it('names the zone in the failure cascade and the event log', () => {
    const output = runSimulation(zonedTopology({ faults: [zoneFault('az-a', 3_000, 4_000)] }), {
      mode: 'discrete'
    })
    const roots = output.causalGraph?.rootCauses ?? []
    expect(roots.map((root) => root.nodeId).sort()).toEqual(['api-a', 'db-a'])
    expect(roots.every((root) => root.faultDomain?.label === 'us-east-1a')).toBe(true)
    const apiNode = output.causalGraph?.nodes?.find((entry) => entry.nodeId === 'api-a')
    expect(apiNode?.faultDomain?.id).toBe('az-a')
  })

  it('a design with replicas in two zones behind a health-aware LB stays up; a single-zone design fails', () => {
    const twoZones = zonedTopology()
    const twoZoneRun = runChaosExperiment(
      twoZones,
      createAzOutageExperiment(twoZones, { zoneId: 'az-a' })
    )
    expect(twoZoneRun.result.verdict).toBe('passed')
    const during = twoZoneRun.result.checks.find((check) => check.phase === 'verify')!
    expect(during.assertions[0].actual!).toBeLessThan(0.05)

    const oneZone = zonedTopology({ twoZones: false })
    const oneZoneDefinition = createAzOutageExperiment(oneZone, { zoneId: 'az-a' })
    expect(oneZoneDefinition.notes?.[0]).toMatch(/nothing outside the zone/)
    const oneZoneRun = runChaosExperiment(oneZone, oneZoneDefinition)
    expect(oneZoneRun.result.verdict).toBe('failed')
    const oneZoneDuring = oneZoneRun.result.checks.find((check) => check.phase === 'verify')!
    expect(oneZoneDuring.assertions[0].actual!).toBeGreaterThan(0.5)
    // Everything recovers once the zone is back.
    expect(oneZoneRun.result.checks.find((check) => check.phase === 'final')?.status).toBe('pass')
  })

  it('picks the most populated zone by default and says what is needed to pass', () => {
    const definition = createAzOutageExperiment(zonedTopology())
    expect(definition.steps[0]).toMatchObject({ type: 'inject', fault: { targetId: 'az-a' } })
    expect(definition.notes?.join(' ')).toMatch(/replica in another zone, behind a health-aware/)
  })

  it('explains when there is no populated zone', () => {
    const plain = topology([source(), api('api')], [edge('client', 'api')], { baseRps: 10 })
    expect(tryBuildPreset(plain, 'az-outage')).toEqual({
      ok: false,
      reason: expect.stringMatching(/Availability Zone containers/)
    })
  })
})

describe('nested and overlapping domains', () => {
  it('a region outage fails every zone inside it', () => {
    const output = runSimulation(zonedTopology({ faults: [zoneFault('region', 2_000, 2_000)] }), {
      mode: 'discrete'
    })
    expect(Object.keys(windowsByNode(output)).sort()).toEqual(['api-a', 'api-b', 'db-a', 'lb'])
  })

  it('a node stays down until every domain holding it has recovered', () => {
    const output = runSimulation(
      zonedTopology({
        faults: [zoneFault('region', 2_000, 2_000), zoneFault('az-a', 3_000, 4_000)]
      }),
      { mode: 'discrete' }
    )
    const windows = windowsByNode(output)
    // az-a outlives the region outage, so its members recover with the zone.
    expect(windows['api-a']).toMatchObject({ startMs: 2_000, endMs: 7_000 })
    expect(windows['db-a']).toMatchObject({ startMs: 2_000, endMs: 7_000 })
    // Outside az-a the region recovery applies.
    expect(windows['api-b']).toMatchObject({ startMs: 2_000, endMs: 4_000 })
  })

  it('a subnet outage fails only the subnet', () => {
    const output = runSimulation(zonedTopology({ faults: [zoneFault('subnet-a', 2_000, 1_000)] }), {
      mode: 'discrete'
    })
    expect(Object.keys(windowsByNode(output))).toEqual(['db-a'])
  })
})

describe('validation', () => {
  it('a fault on an empty container is a warning, and the run does not crash', () => {
    const t = zonedTopology({ faults: [zoneFault('az-empty', 2_000, 1_000)] })
    const result = validateTopology(t)
    expect(result.valid).toBe(true)
    expect(result.warnings?.join(' ')).toMatch(/availability zone us-east-1c fails nothing/)
    const output = runSimulation(t, { mode: 'discrete' })
    expect(output.statusTimeline).toEqual([])
  })

  it('accepts a populated zone as a fault target and rejects a cache flush on one', () => {
    expect(validateTopology(zonedTopology({ faults: [zoneFault('az-a', 1, 1)] })).valid).toBe(true)
    const flush = zonedTopology({
      faults: [{ ...zoneFault('az-a', 1, 1), faultType: 'cache-flush' }]
    })
    const result = validateTopology(flush)
    expect(result.valid).toBe(false)
    expect(result.errors?.map((error) => error.message).join(' ')).toMatch(/cache flush/)
  })
})
