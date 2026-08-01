import { describe, expect, it } from 'vitest'
import type { ComponentCategory, ComponentType, TopologyJSON } from '../core/types'
import { evaluateStructuralRules } from './structural'

function node(
  id: string,
  componentType: ComponentType,
  category: ComponentCategory,
  role?: TopologyJSON['nodes'][number]['role'],
  replicas?: number
): TopologyJSON['nodes'][number] {
  return {
    id,
    type: componentType,
    category,
    ...(role ? { role } : {}),
    label: id,
    position: { x: 0, y: 0 },
    ...(replicas ? { resources: { cpu: 1, memory: 512, replicas } } : {})
  }
}

function edge(id: string, source: string, target: string): TopologyJSON['edges'][number] {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: {
      distribution: { type: 'constant', value: 1 },
      pathType: 'same-dc'
    },
    bandwidth: 1000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(overrides: Partial<TopologyJSON> = {}): TopologyJSON {
  return {
    id: 'structural-topology',
    name: 'Structural Topology',
    version: '2.0.0',
    global: {
      simulationDuration: 1000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1000
    },
    nodes: [
      node('client', 'api-endpoint', 'compute', 'source'),
      node('api', 'microservice', 'compute', 'processor', 2),
      node('db', 'relational-db', 'storage-and-data', 'storage')
    ],
    edges: [edge('client-api', 'client', 'api'), edge('api-db', 'api', 'db')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 10,
      requestDistribution: [{ type: 'read', weight: 1, sizeBytes: 128 }]
    },
    ...overrides
  }
}

describe('evaluateStructuralRules', () => {
  it('passes core component, source, path, connectivity, and redundancy rules', () => {
    const result = evaluateStructuralRules(topology(), [
      {
        id: 'need-api',
        description: 'Includes an application service',
        kind: 'requires_component',
        componentType: 'microservice'
      },
      {
        id: 'single-source',
        description: 'Has one request source',
        kind: 'requires_single_source'
      },
      {
        id: 'path-to-db',
        description: 'Gateway traffic reaches storage',
        kind: 'requires_path',
        fromType: 'api-endpoint',
        toType: 'relational-db'
      },
      {
        id: 'connected',
        description: 'Graph stays connected',
        kind: 'requires_connected_graph'
      },
      {
        id: 'api-ha',
        description: 'Application layer is redundant',
        kind: 'requires_redundancy',
        componentType: 'microservice',
        minReplicas: 2
      }
    ])

    expect(result.passed).toBe(true)
    expect(result.checks.every((check) => check.passed)).toBe(true)
  })

  it('fails with deterministic details for missing components and disconnected nodes', () => {
    const result = evaluateStructuralRules(
      topology({
        nodes: [
          node('client', 'api-endpoint', 'compute', 'source'),
          node('api', 'microservice', 'compute', 'processor'),
          node('orphan-cache', 'in-memory-cache', 'storage-and-data', 'storage')
        ],
        edges: [edge('client-api', 'client', 'api')]
      }),
      [
        {
          id: 'need-db',
          description: 'Includes durable storage',
          kind: 'requires_component',
          componentType: 'relational-db'
        },
        {
          id: 'connected',
          description: 'Graph stays connected',
          kind: 'requires_connected_graph'
        }
      ]
    )

    expect(result.passed).toBe(false)
    expect(result.checks).toEqual([
      {
        id: 'need-db',
        description: 'Includes durable storage',
        passed: false,
        detail: 'expected at least 1 relational-db component, found 0.'
      },
      {
        id: 'connected',
        description: 'Graph stays connected',
        passed: false,
        detail: 'disconnected node ids: orphan-cache.'
      }
    ])
  })
})
