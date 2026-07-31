import { describe, expect, it } from 'vitest'
import {
  buildContainerLocations,
  pathTypeFromContainers,
  resolveEdgeLatencyDistribution
} from './useTopologySerializer'

describe('container-derived edge pathType', () => {
  // region > az(a|b) > subnet(1|2); plus a bare node outside any container
  const nodes = [
    { id: 'region', parentNode: undefined, data: { templateId: 'vpc-region' } },
    { id: 'azA', parentNode: 'region', data: { templateId: 'availability-zone' } },
    { id: 'azB', parentNode: 'region', data: { templateId: 'availability-zone' } },
    { id: 'sub1', parentNode: 'azA', data: { templateId: 'subnet' } },
    { id: 'sub2', parentNode: 'azA', data: { templateId: 'subnet' } },
    { id: 'app1', parentNode: 'sub1', data: { templateId: 'backend-server' } },
    { id: 'app1b', parentNode: 'sub1', data: { templateId: 'backend-server' } },
    { id: 'app2', parentNode: 'sub2', data: { templateId: 'backend-server' } },
    { id: 'appB', parentNode: 'azB', data: { templateId: 'backend-server' } },
    { id: 'outside', parentNode: undefined, data: { templateId: 'client-user' } }
  ]
  const loc = buildContainerLocations(nodes)

  it('resolves full ancestry (subnet → az → region)', () => {
    expect(loc.get('app1')).toEqual({ region: 'region', az: 'azA', subnet: 'sub1' })
  })

  it('same subnet → same-rack', () => {
    expect(pathTypeFromContainers(loc, 'app1', 'app1b')).toEqual({ pathType: 'same-rack' })
  })

  it('same AZ, different subnet → same-dc', () => {
    expect(pathTypeFromContainers(loc, 'app1', 'app2')).toEqual({ pathType: 'same-dc' })
  })

  it('same region, different AZ → cross-zone', () => {
    expect(pathTypeFromContainers(loc, 'app1', 'appB')).toEqual({ pathType: 'cross-zone' })
  })

  it('endpoint outside all containers → null (leave pathType untouched)', () => {
    expect(pathTypeFromContainers(loc, 'app1', 'outside')).toBeNull()
  })

  it('different regions → cross-region, carrying the region-pair hint for future distance-awareness', () => {
    const twoRegions = [
      { id: 'us', parentNode: undefined, data: { templateId: 'vpc-region' } },
      { id: 'ap', parentNode: undefined, data: { templateId: 'vpc-region' } },
      { id: 'a', parentNode: 'us', data: { templateId: 'backend-server' } },
      { id: 'b', parentNode: 'ap', data: { templateId: 'backend-server' } }
    ]
    const twoLoc = buildContainerLocations(twoRegions)
    expect(pathTypeFromContainers(twoLoc, 'a', 'b')).toEqual({
      pathType: 'cross-region',
      regionPair: ['us', 'ap']
    })
  })
})

const SAME_DC_PROFILE = { type: 'log-normal' as const, mu: 0, sigma: 0.4 }

describe('resolveEdgeLatencyDistribution', () => {
  it('serializes an explicit constant edge latency as a constant distribution', () => {
    expect(
      resolveEdgeLatencyDistribution(
        {
          latencyDistributionType: 'constant',
          latencyValue: 12
        },
        SAME_DC_PROFILE
      )
    ).toEqual({
      distribution: { type: 'constant', value: 12 },
      derivedFromPathType: false
    })
  })

  it('preserves explicit log-normal mu values, including negative ones', () => {
    expect(
      resolveEdgeLatencyDistribution(
        {
          latencyDistributionType: 'log-normal',
          latencyMu: -1.2,
          latencySigma: 0.3
        },
        SAME_DC_PROFILE
      )
    ).toEqual({
      distribution: { type: 'log-normal', mu: -1.2, sigma: 0.3 },
      derivedFromPathType: false
    })
  })
})
