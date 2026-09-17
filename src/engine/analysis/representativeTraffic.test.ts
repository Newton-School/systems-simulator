import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import { evaluateFluidModel } from './fluidModel'
import { generateRepresentativeTraffic } from './representativeTraffic'

function server(id: string, capacityRps: number): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    config: { capacityRps }
  }
}

function edge(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 5 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 2_000_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function flashSale(serverCount: number, offeredRps = 1_000_000): TopologyJSON {
  const servers = Array.from({ length: serverCount }, (_, i) => server(`srv-${i}`, 100_000))
  return {
    id: 't',
    name: 't',
    version: '1',
    global: {
      simulationDuration: 5000,
      seed: 's',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30000
    },
    nodes: [
      { id: 'users', type: 'client', category: 'client', label: 'Users', position: { x: 0, y: 0 } },
      {
        id: 'lb',
        type: 'load-balancer',
        category: 'network',
        label: 'LB',
        position: { x: 0, y: 0 }
      },
      ...servers
    ],
    edges: [edge('users', 'lb'), ...servers.map((s) => edge('lb', s.id))],
    workload: {
      sourceNodeId: 'users',
      pattern: 'constant',
      baseRps: offeredRps,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1 }]
    }
  }
}

describe('generateRepresentativeTraffic', () => {
  it('caps the number of dots regardless of the 1M-rps load', () => {
    const topo = flashSale(13)
    const { events } = generateRepresentativeTraffic(topo, evaluateFluidModel(topo), {
      maxEvents: 4000
    })
    expect(events.length).toBeGreaterThan(0)
    expect(events.length).toBeLessThanOrEqual(4000)
  })

  it('reports a requestsPerDot scale so the animation can be labelled', () => {
    const topo = flashSale(13)
    const { requestsPerDot } = generateRepresentativeTraffic(topo, evaluateFluidModel(topo))
    // Millions of req/s across ~14 edges, 40 dots/s → each dot is worth many reqs.
    expect(requestsPerDot).toBeGreaterThan(1000)
  })

  it('is deterministic', () => {
    const topo = flashSale(13)
    const a = generateRepresentativeTraffic(topo, evaluateFluidModel(topo))
    const b = generateRepresentativeTraffic(topo, evaluateFluidModel(topo))
    expect(a).toEqual(b)
  })

  it('spaces dot start times within the simulation window', () => {
    const topo = flashSale(13)
    const { events } = generateRepresentativeTraffic(topo, evaluateFluidModel(topo))
    for (const e of events) {
      expect(e.startedAtMs).toBeGreaterThanOrEqual(0)
      expect(e.startedAtMs).toBeLessThanOrEqual(5000)
      expect(e.completedAtMs).toBeCloseTo(e.startedAtMs + 5, 5) // 5ms edge latency
    }
    // Sorted by start time.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.startedAtMs).toBeGreaterThanOrEqual(events[i - 1]!.startedAtMs)
    }
  })

  it('marks a failure share on edges into an overloaded server', () => {
    // 8 servers → each server drops 20% (offered 125k > 100k capacity).
    const topo = flashSale(8)
    const { events } = generateRepresentativeTraffic(topo, evaluateFluidModel(topo))
    const intoServer = events.filter((e) => e.targetNodeId.startsWith('srv-'))
    const failures = intoServer.filter((e) => e.status === 'edge-error')
    expect(failures.length).toBeGreaterThan(0)
    // Roughly a fifth of the dots into servers should be failures.
    expect(failures.length / intoServer.length).toBeCloseTo(0.2, 1)
  })

  it('emits nothing when there is no flow', () => {
    const topo = flashSale(13, 0)
    const { events, requestsPerDot } = generateRepresentativeTraffic(topo, evaluateFluidModel(topo))
    expect(events).toHaveLength(0)
    expect(requestsPerDot).toBe(0)
  })
})
