import { describe, expect, it } from 'vitest'
import type { ComponentCategory, ComponentType, TopologyJSON } from '../core/types'
import { detectSinglePointsOfFailure } from './singlePointOfFailure'

function node(
  id: string,
  componentType: ComponentType,
  category: ComponentCategory,
  role?: TopologyJSON['nodes'][number]['role'],
  instances?: number
): TopologyJSON['nodes'][number] {
  return {
    id,
    type: componentType,
    category,
    ...(role ? { role } : {}),
    label: id,
    position: { x: 0, y: 0 },
    ...(instances ? { resources: { cpu: 1, memory: 512, instanceCount: instances } } : {})
  }
}

function edge(id: string, source: string, target: string): TopologyJSON['edges'][number] {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(nodes: TopologyJSON['nodes'], edges: TopologyJSON['edges']): TopologyJSON {
  return {
    id: 't',
    name: 'T',
    version: '2.0.0',
    global: {
      simulationDuration: 1000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1000
    },
    nodes,
    edges,
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 10,
      requestDistribution: [{ type: 'read', weight: 1, sizeBytes: 128 }]
    }
  }
}

const ids = (t: TopologyJSON): string[] =>
  detectSinglePointsOfFailure(t)
    .map((f) => f.nodeId)
    .sort()

describe('detectSinglePointsOfFailure', () => {
  it('flags a lone load balancer as a cut-node SPOF (it fronts otherwise-redundant servers)', () => {
    const t = topology(
      [
        node('client', 'api-endpoint', 'compute', 'source'),
        node('lb', 'load-balancer', 'network-and-edge', 'router', 1),
        node('api', 'microservice', 'compute', 'processor', 2),
        node('db', 'relational-db', 'storage-and-data', 'storage', 2)
      ],
      [edge('e1', 'client', 'lb'), edge('e2', 'lb', 'api'), edge('e3', 'api', 'db')]
    )
    const findings = detectSinglePointsOfFailure(t)
    expect(findings.map((f) => f.nodeId)).toEqual(['lb'])
    // Losing the LB orphans both the API tier and the DB behind it.
    expect(findings[0].orphansIfLost).toEqual(['api', 'db'])
  })

  it('flags a single database (a leaf dependency with no peer) as a SPOF', () => {
    const t = topology(
      [
        node('client', 'api-endpoint', 'compute', 'source'),
        node('api', 'microservice', 'compute', 'processor', 2),
        node('db', 'relational-db', 'storage-and-data', 'storage', 1)
      ],
      [edge('e1', 'client', 'api'), edge('e2', 'api', 'db')]
    )
    expect(ids(t)).toEqual(['db'])
  })

  it('clears everything when the critical nodes run >=2 instances', () => {
    const t = topology(
      [
        node('client', 'api-endpoint', 'compute', 'source'),
        node('lb', 'load-balancer', 'network-and-edge', 'router', 2),
        node('api', 'microservice', 'compute', 'processor', 2),
        node('db', 'relational-db', 'storage-and-data', 'storage', 2)
      ],
      [edge('e1', 'client', 'lb'), edge('e2', 'lb', 'api'), edge('e3', 'api', 'db')]
    )
    expect(ids(t)).toEqual([])
  })

  it('clears a single-instance leaf when a same-type peer exists on an alternate path', () => {
    const t = topology(
      [
        node('client', 'api-endpoint', 'compute', 'source'),
        node('api', 'microservice', 'compute', 'processor', 2),
        node('db-a', 'relational-db', 'storage-and-data', 'storage', 1),
        node('db-b', 'relational-db', 'storage-and-data', 'storage', 1)
      ],
      [edge('e1', 'client', 'api'), edge('e2', 'api', 'db-a'), edge('e3', 'api', 'db-b')]
    )
    expect(ids(t)).toEqual([])
  })

  it('flags a single-instance service tier that sits between the LB and the store', () => {
    const t = topology(
      [
        node('client', 'api-endpoint', 'compute', 'source'),
        node('api', 'microservice', 'compute', 'processor', 1),
        node('db', 'relational-db', 'storage-and-data', 'storage', 2)
      ],
      [edge('e1', 'client', 'api'), edge('e2', 'api', 'db')]
    )
    // api is a cut node (orphans db); db is redundant so not flagged.
    expect(ids(t)).toEqual(['api'])
  })
})
