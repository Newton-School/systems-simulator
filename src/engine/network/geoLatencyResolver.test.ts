import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import { GeoLatencyResolver, greatCircleDistanceKm } from './geoLatencyResolver'

const node = (id: string, type: ComponentNode['type'], regionId?: string): ComponentNode => ({
  id,
  type,
  category: type === 'global-traffic-manager' ? 'network-and-edge' : 'compute',
  role: type === 'global-traffic-manager' ? 'router' : 'processor',
  label: id,
  position: { x: 0, y: 0 },
  placement: regionId ? { regionId } : undefined
})

const edge = (id: string, target: string, derived = true): EdgeDefinition => ({
  id,
  source: 'gtm',
  target,
  mode: 'synchronous',
  protocol: 'https',
  latency: {
    distribution: { type: 'constant', value: 42 },
    pathType: 'cross-region',
    derivedFromPathType: derived
  },
  bandwidth: 1000,
  maxConcurrentRequests: 1000,
  packetLossRate: 0,
  errorRate: 0
})

const request: Request = {
  id: 'request-1',
  type: 'GET',
  sizeBytes: 100,
  priority: 0,
  createdAt: 0n,
  deadline: 10_000_000n,
  path: [],
  spans: [],
  metadata: {},
  origin: {
    originId: 'virginia-users',
    label: 'Virginia users',
    location: { kind: 'region', regionId: 'us-east' }
  }
}

function topology(): TopologyJSON {
  return {
    id: 'geo-test',
    name: 'Geo test',
    version: '2.1.0',
    global: {
      simulationDuration: 1000,
      warmupDuration: 0,
      seed: 'geo',
      timeResolution: 'millisecond',
      defaultTimeout: 1000
    },
    locations: [
      {
        id: 'us-east',
        kind: 'region',
        label: 'US East',
        provider: 'aws',
        providerCode: 'us-east-1',
        coordinates: { latitude: 38.95, longitude: -77.45 }
      },
      {
        id: 'ap-south',
        kind: 'region',
        label: 'AP South',
        provider: 'aws',
        providerCode: 'ap-south-1',
        coordinates: { latitude: 19.08, longitude: 72.88 }
      }
    ],
    networkModel: { mode: 'geo-aware', catalogueVersion: 'test' },
    nodes: [
      node('source', 'api-endpoint'),
      node('gtm', 'global-traffic-manager'),
      node('us-api', 'microservice', 'us-east'),
      node('ap-api', 'microservice', 'ap-south')
    ],
    edges: [edge('us', 'us-api'), edge('ap', 'ap-api')],
    workload: {
      sourceNodeId: 'source',
      pattern: 'constant',
      baseRps: 1,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  }
}

describe('GeoLatencyResolver', () => {
  it('computes stable great-circle distance', () => {
    expect(
      greatCircleDistanceKm(
        { latitude: 38.95, longitude: -77.45 },
        { latitude: 19.08, longitude: 72.88 }
      )
    ).toBeGreaterThan(12_000)
  })

  it('makes the client-near serving region faster for an unplaced global router', () => {
    const model = topology()
    const resolver = new GeoLatencyResolver(model)
    const us = resolver.estimateEdgeLatencyMs(model.edges[0]!, request)
    const ap = resolver.estimateEdgeLatencyMs(model.edges[1]!, request)

    expect(us).toBeLessThan(ap)
    expect(ap - us).toBeGreaterThan(50)
  })

  it('keeps explicit edge latency authoritative', () => {
    const model = topology()
    model.edges[0] = edge('manual', 'us-api', false)
    expect(new GeoLatencyResolver(model).estimateEdgeLatencyMs(model.edges[0], request)).toBe(42)
  })

  it('uses a configured region-pair override before distance estimation', () => {
    const model = topology()
    model.networkModel = {
      mode: 'geo-aware',
      regionPairOverrides: [
        {
          fromRegionId: 'us-east',
          toRegionId: 'ap-south',
          distribution: { type: 'constant', value: 123 },
          source: 'user'
        }
      ]
    }
    expect(new GeoLatencyResolver(model).estimateEdgeLatencyMs(model.edges[1], request)).toBe(123)
  })
})
