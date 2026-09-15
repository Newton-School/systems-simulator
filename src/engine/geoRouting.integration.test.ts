import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON, TrafficOrigin } from './core/types'
import { SimulationEngine } from './engine'

function runtimeNode(
  id: string,
  type: ComponentNode['type'],
  regionId?: string,
  config?: Record<string, unknown>
): ComponentNode {
  return {
    id,
    type,
    category: type === 'global-traffic-manager' ? 'network-and-edge' : 'compute',
    role: type === 'global-traffic-manager' ? 'router' : 'processor',
    label: id,
    position: { x: 0, y: 0 },
    placement: regionId ? { regionId } : undefined,
    queue: { workers: 10, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1000 },
    config
  }
}

function connection(
  id: string,
  source: string,
  target: string,
  derivedFromPathType: boolean
): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: {
      distribution: { type: 'constant', value: 1 },
      pathType: derivedFromPathType ? 'cross-region' : 'same-dc',
      derivedFromPathType
    },
    bandwidth: 10_000,
    maxConcurrentRequests: 10_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(origin: TrafficOrigin): TopologyJSON {
  return {
    id: 'geo-routing',
    name: 'Geo routing',
    version: '2.1.0',
    global: {
      simulationDuration: 1000,
      warmupDuration: 0,
      seed: 'geo-routing',
      defaultTimeout: 1000,
      timeResolution: 'millisecond'
    },
    locations: [
      {
        id: 'virginia',
        kind: 'region',
        label: 'Virginia',
        provider: 'aws',
        providerCode: 'us-east-1',
        coordinates: { latitude: 38.95, longitude: -77.45 }
      },
      {
        id: 'mumbai',
        kind: 'region',
        label: 'Mumbai',
        provider: 'aws',
        providerCode: 'ap-south-1',
        coordinates: { latitude: 19.08, longitude: 72.88 }
      }
    ],
    networkModel: { mode: 'geo-aware', catalogueVersion: 'test' },
    nodes: [
      runtimeNode('source', 'api-endpoint'),
      runtimeNode('global', 'global-traffic-manager', undefined, {
        dnsRoutingPolicy: 'latency-based'
      }),
      runtimeNode('us-api', 'microservice', 'virginia'),
      runtimeNode('in-api', 'microservice', 'mumbai')
    ],
    edges: [
      connection('source-global', 'source', 'global', false),
      connection('global-us', 'global', 'us-api', true),
      connection('global-in', 'global', 'in-api', true)
    ],
    workload: {
      sourceNodeId: 'source',
      pattern: 'constant',
      baseRps: 10,
      origins: [origin],
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  }
}

describe('geo-aware simulation routing', () => {
  it('routes the same workload to the closest region and reports it by origin', () => {
    const us = new SimulationEngine(
      topology({
        id: 'us-users',
        label: 'US users',
        weight: 1,
        location: { kind: 'region', regionId: 'virginia' }
      })
    ).run()
    const india = new SimulationEngine(
      topology({
        id: 'india-users',
        label: 'India users',
        weight: 1,
        location: { kind: 'region', regionId: 'mumbai' }
      })
    ).run()

    expect(us.perNode['us-api']?.postWarmupArrived).toBeGreaterThan(0)
    expect(us.perNode['in-api']?.postWarmupArrived).toBe(0)
    expect(india.perNode['in-api']?.postWarmupArrived).toBeGreaterThan(0)
    expect(india.perNode['us-api']?.postWarmupArrived).toBe(0)
    expect(us.perOrigin[0]).toMatchObject({
      originId: 'us-users',
      servingRegions: { virginia: 10 }
    })
    expect(india.perOrigin[0]).toMatchObject({
      originId: 'india-users',
      servingRegions: { mumbai: 10 }
    })
    expect(us.perOrigin[0]!.latency.p50).toBeLessThan(india.perOrigin[0]!.latency.p50! + 1)
  })
})
