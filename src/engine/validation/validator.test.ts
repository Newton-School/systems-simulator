import { describe, expect, it } from 'vitest'
import { mockArchitecture } from '../__mocks__/sampleTopology'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import { validateTopology } from './validator'

function cloneMockArchitecture(): TopologyJSON {
  return structuredClone(mockArchitecture) as TopologyJSON
}

function makeSourceNode(id: string, label = id): ComponentNode {
  return {
    id,
    type: 'api-endpoint',
    category: 'compute',
    role: 'source',
    label,
    position: { x: 0, y: 0 }
  }
}

function makeProcessorNode(id: string, label = id): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: {
      distribution: { type: 'constant', value: 5 },
      timeout: 1_000
    }
  }
}

function makeSinkNode(id: string, label = id): ComponentNode {
  return {
    id,
    type: 'third-party-api-connector',
    category: 'external-and-integration',
    role: 'sink',
    label,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: {
      distribution: { type: 'constant', value: 5 },
      timeout: 1_000
    }
  }
}

function makeEdge(id: string, source: string, target: string): EdgeDefinition {
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
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function makeTopology({
  nodes,
  edges,
  sourceNodeId
}: {
  nodes: ComponentNode[]
  edges: EdgeDefinition[]
  sourceNodeId: string
}): TopologyJSON {
  const topology = cloneMockArchitecture()

  return {
    ...topology,
    nodes,
    edges,
    workload: {
      sourceNodeId,
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  }
}

describe('validateTopology workload fields', () => {
  it('preserves bursty workload settings after validation', () => {
    const topology = cloneMockArchitecture()
    topology.workload = {
      ...topology.workload!,
      pattern: 'bursty',
      bursty: {
        burstRps: 1500,
        burstDuration: 2500,
        normalDuration: 7500
      }
    }

    const result = validateTopology(topology)

    expect(result.valid).toBe(true)
    expect(result.data?.workload?.pattern).toBe('bursty')
    expect(result.data?.workload?.bursty).toEqual({
      burstRps: 1500,
      burstDuration: 2500,
      normalDuration: 7500
    })
  })

  it('preserves sawtooth workload settings after validation', () => {
    const topology = cloneMockArchitecture()
    topology.workload = {
      ...topology.workload!,
      pattern: 'sawtooth',
      sawtooth: {
        peakRps: 1200,
        rampDuration: 10000
      }
    }

    const result = validateTopology(topology)

    expect(result.valid).toBe(true)
    expect(result.data?.workload?.pattern).toBe('sawtooth')
    expect(result.data?.workload?.sawtooth).toEqual({
      peakRps: 1200,
      rampDuration: 10000
    })
  })

  it('accepts and preserves global traceSampleRate', () => {
    const topology = cloneMockArchitecture()
    topology.global = {
      ...topology.global,
      traceSampleRate: 0.25
    }

    const result = validateTopology(topology)

    expect(result.valid).toBe(true)
    expect(result.data?.global.traceSampleRate).toBe(0.25)
  })

  it('accepts path-type-derived latency metadata on edges', () => {
    const topology = makeTopology({
      nodes: [makeSourceNode('source'), makeProcessorNode('worker')],
      edges: [
        {
          ...makeEdge('source-to-worker', 'source', 'worker'),
          latency: {
            distribution: { type: 'constant', value: 1 },
            pathType: 'cross-region',
            derivedFromPathType: true
          }
        }
      ],
      sourceNodeId: 'source'
    })

    const result = validateTopology(topology)

    expect(result.valid).toBe(true)
    expect(result.data?.edges[0].latency).toMatchObject({
      pathType: 'cross-region',
      derivedFromPathType: true
    })
  })

  it('accepts a node with only a latency SLO target', () => {
    const topology = cloneMockArchitecture()
    topology.nodes[0] = {
      ...topology.nodes[0],
      slo: { latencyP99: 99 }
    }

    const result = validateTopology(topology)

    expect(result.valid).toBe(true)
    expect(result.data?.nodes[0].slo).toEqual({ latencyP99: 99 })
  })

  it('rejects an empty SLO object', () => {
    const topology = cloneMockArchitecture()
    topology.nodes[0] = {
      ...topology.nodes[0],
      slo: {}
    }

    const result = validateTopology(topology)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'nodes.0.slo',
          message: 'At least one SLO target must be set.'
        })
      ])
    )
  })
})

describe('validateTopology active-source validation', () => {
  it('fails a source-only topology', () => {
    const source = makeSourceNode('client', 'Client App')

    const result = validateTopology(
      makeTopology({
        nodes: [source],
        edges: [],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'workload.sourceNodeId',
          message: expect.stringContaining('Client App')
        })
      ])
    )
  })

  it('fails when the selected source is isolated even if another source is runnable', () => {
    const selectedSource = makeSourceNode('client-a', 'Client A')
    const alternateSource = makeSourceNode('client-b', 'Client B')
    const service = makeProcessorNode('orders', 'Order Service')

    const result = validateTopology(
      makeTopology({
        nodes: [selectedSource, alternateSource, service],
        edges: [makeEdge('client-b-orders', alternateSource.id, service.id)],
        sourceNodeId: selectedSource.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'workload.sourceNodeId',
          message: expect.stringContaining('Client A')
        })
      ])
    )
  })

  it('fails when the selected source reaches only other source nodes', () => {
    const selectedSource = makeSourceNode('client-a', 'Client A')
    const secondarySource = makeSourceNode('client-b', 'Client B')

    const result = validateTopology(
      makeTopology({
        nodes: [selectedSource, secondarySource],
        edges: [makeEdge('client-a-client-b', selectedSource.id, secondarySource.id)],
        sourceNodeId: selectedSource.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'workload.sourceNodeId',
          message: expect.stringContaining(
            'is not connected to any downstream component that can be simulated'
          )
        })
      ])
    )
  })

  it('accepts a direct source-to-sink path', () => {
    const source = makeSourceNode('client', 'Client App')
    const sink = makeSinkNode('vendor', 'Third-Party API')

    const result = validateTopology(
      makeTopology({
        nodes: [source, sink],
        edges: [makeEdge('client-vendor', source.id, sink.id)],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(true)
  })

  it('accepts a direct source-to-service path', () => {
    const source = makeSourceNode('client', 'Client App')
    const service = makeProcessorNode('orders', 'Order Service')

    const result = validateTopology(
      makeTopology({
        nodes: [source, service],
        edges: [makeEdge('client-orders', source.id, service.id)],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(true)
  })

  it('rejects self-loop edges', () => {
    const source = makeSourceNode('client', 'Client App')
    const service = makeProcessorNode('orders', 'Order Service')

    const result = validateTopology(
      makeTopology({
        nodes: [source, service],
        edges: [
          makeEdge('client-orders', source.id, service.id),
          makeEdge('orders-self', service.id, service.id)
        ],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'edges[1].target',
          message: expect.stringContaining("Edge 'orders-self' forms a self-loop")
        })
      ])
    )
  })

  it('warns on disconnected side branches without blocking a runnable topology', () => {
    const source = makeSourceNode('client', 'Client App')
    const service = makeProcessorNode('orders', 'Order Service')
    const disconnected = makeProcessorNode('audit', 'Audit Worker')

    const result = validateTopology(
      makeTopology({
        nodes: [source, service, disconnected],
        edges: [makeEdge('client-orders', source.id, service.id)],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`Node '${disconnected.label}' is disconnected`)
      ])
    )
  })

  it('warns on source-to-source edges when the topology is otherwise runnable', () => {
    const selectedSource = makeSourceNode('client-a', 'Client A')
    const secondarySource = makeSourceNode('client-b', 'Client B')
    const service = makeProcessorNode('orders', 'Order Service')

    const result = validateTopology(
      makeTopology({
        nodes: [selectedSource, secondarySource, service],
        edges: [
          makeEdge('client-a-client-b', selectedSource.id, secondarySource.id),
          makeEdge('client-b-orders', secondarySource.id, service.id)
        ],
        sourceNodeId: selectedSource.id
      })
    )

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Edge 'client-a-client-b' connects source node 'Client A' to source node 'Client B'."
        )
      ])
    )
  })
})

describe('validateTopology node config validation', () => {
  it('rejects non-boolean healthCheckEnabled values', () => {
    const source = makeSourceNode('client', 'Client')
    const router: ComponentNode = {
      ...makeProcessorNode('lb', 'Load Balancer'),
      type: 'load-balancer',
      category: 'network-and-edge',
      role: 'router',
      config: { healthCheckEnabled: 'yes' as unknown as boolean }
    }
    const service = makeProcessorNode('service', 'Service')

    const result = validateTopology(
      makeTopology({
        nodes: [source, router, service],
        edges: [
          makeEdge('client-lb', source.id, router.id),
          makeEdge('lb-service', router.id, service.id)
        ],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('config.healthCheckEnabled'),
          message: 'healthCheckEnabled must be a boolean.'
        })
      ])
    )
  })

  it('rejects routingRules on an L4 load balancer with the L4 enforcement message', () => {
    const source = makeSourceNode('client', 'Client')
    const l4: ComponentNode = {
      ...makeProcessorNode('l4', 'L4 Load Balancer'),
      type: 'load-balancer-l4',
      category: 'network-and-edge',
      role: 'router',
      config: {
        routingRules: [{ matchField: 'type', matchValue: 'write', targetNodeId: 'service' }]
      }
    }
    const service = makeProcessorNode('service', 'Service')

    const result = validateTopology(
      makeTopology({
        nodes: [source, l4, service],
        edges: [makeEdge('client-l4', source.id, l4.id), makeEdge('l4-service', l4.id, service.id)],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('config.routingRules'),
          code: 'l4_content_routing_forbidden',
          message: expect.stringContaining('L4 operates at the transport layer')
        })
      ])
    )
  })

  it('accepts routingRules on an L7 load balancer and validates rule shape', () => {
    const source = makeSourceNode('client', 'Client')
    const l7: ComponentNode = {
      ...makeProcessorNode('l7', 'L7 Load Balancer'),
      type: 'load-balancer-l7',
      category: 'network-and-edge',
      role: 'router',
      config: {
        routingRules: [{ matchField: 'type', matchValue: 'write', targetNodeId: 'service' }]
      }
    }
    const service = makeProcessorNode('service', 'Service')

    const result = validateTopology(
      makeTopology({
        nodes: [source, l7, service],
        edges: [makeEdge('client-l7', source.id, l7.id), makeEdge('l7-service', l7.id, service.id)],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(true)
  })

  it('rejects a malformed routingRules entry', () => {
    const source = makeSourceNode('client', 'Client')
    const l7: ComponentNode = {
      ...makeProcessorNode('l7', 'L7 Load Balancer'),
      type: 'load-balancer-l7',
      category: 'network-and-edge',
      role: 'router',
      config: {
        routingRules: [{ matchField: 'header', matchValue: '', targetNodeId: '' }]
      }
    }
    const service = makeProcessorNode('service', 'Service')

    const result = validateTopology(
      makeTopology({
        nodes: [source, l7, service],
        edges: [makeEdge('client-l7', source.id, l7.id), makeEdge('l7-service', l7.id, service.id)],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('routingRules[0].matchField') }),
        expect.objectContaining({ path: expect.stringContaining('routingRules[0].matchValue') }),
        expect.objectContaining({ path: expect.stringContaining('routingRules[0].targetNodeId') })
      ])
    )
  })
})

describe('validateTopology advanced trait validation', () => {
  it('preserves request-distribution metadata', () => {
    const topology = cloneMockArchitecture()
    topology.workload = {
      ...topology.workload!,
      requestDistribution: [
        { type: 'lookup', weight: 1, sizeBytes: 256, metadata: { shardKey: 'tenant-a' } }
      ]
    }

    const result = validateTopology(topology)

    expect(result.valid).toBe(true)
    expect(result.data?.workload?.requestDistribution[0]?.metadata).toEqual({
      shardKey: 'tenant-a'
    })
  })

  it('accepts cold-start config fields on serverless nodes', () => {
    const source = makeSourceNode('client', 'Client')
    const lambda: ComponentNode = {
      id: 'lambda',
      type: 'serverless-function',
      category: 'compute',
      role: 'processor',
      label: 'Lambda',
      position: { x: 0, y: 0 },
      queue: { workers: 2, capacity: 10, discipline: 'fifo' },
      processing: {
        distribution: { type: 'constant', value: 10 },
        timeout: 1_000
      },
      config: {
        coldStartLatency: { type: 'constant', value: 200 },
        idleTimeoutMs: 15_000,
        maxConcurrency: 4
      }
    }

    const result = validateTopology(
      makeTopology({
        nodes: [source, lambda],
        edges: [makeEdge('client-lambda', source.id, lambda.id)],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(true)
  })

  it('accepts dns, routing-key, and circuit-breaker config fields', () => {
    const source = makeSourceNode('client', 'Client')
    const dns: ComponentNode = {
      ...makeProcessorNode('dns', 'Resolver'),
      type: 'internal-dns',
      category: 'dns-and-certs',
      role: 'router',
      config: {
        dnsRoutingPolicy: 'weighted',
        dnsCacheTtlSeconds: 30,
        dnsGeoTargets: [{ origin: 'eu-west', targetNodeId: 'router' }]
      }
    }
    const router: ComponentNode = {
      ...makeProcessorNode('router', 'Shard Router'),
      type: 'sharding',
      category: 'auxiliary',
      role: 'router',
      config: { routingKeyField: 'tenantId' }
    }
    const sidecar: ComponentNode = {
      ...makeProcessorNode('sidecar', 'Sidecar'),
      type: 'sidecar',
      category: 'compute',
      role: 'processor',
      config: {
        circuitBreaker: {
          failureThreshold: 0.5,
          failureCount: 4,
          recoveryTimeout: 2_000,
          halfOpenRequests: 1
        }
      }
    }

    const result = validateTopology(
      makeTopology({
        nodes: [source, dns, router, sidecar],
        edges: [
          makeEdge('client-dns', source.id, dns.id),
          makeEdge('dns-router', dns.id, router.id),
          makeEdge('router-sidecar', router.id, sidecar.id)
        ],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(true)
  })

  it('rejects conditional edges without a condition', () => {
    const source = makeSourceNode('client', 'Client')
    const service = makeProcessorNode('service', 'Service')

    const result = validateTopology(
      makeTopology({
        nodes: [source, service],
        edges: [{ ...makeEdge('client-service', source.id, service.id), mode: 'conditional' }],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'edges[0].condition',
          message: 'Conditional edges must define a condition expression.'
        })
      ])
    )
  })

  it('rejects purely synchronous cycles without an exit', () => {
    const source = makeSourceNode('client', 'Client')
    const a = makeProcessorNode('service-a', 'Service A')
    const b = makeProcessorNode('service-b', 'Service B')

    const result = validateTopology(
      makeTopology({
        nodes: [source, a, b],
        edges: [
          makeEdge('client-a', source.id, a.id),
          makeEdge('a-b', a.id, b.id),
          makeEdge('b-a', b.id, a.id)
        ],
        sourceNodeId: source.id
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Purely synchronous cycle without an exit detected')
        })
      ])
    )
  })
})
