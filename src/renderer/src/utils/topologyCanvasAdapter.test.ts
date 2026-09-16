import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../../../engine/core/types'
import orderTopology from '../../../../order-topology.json'
import { isTopologyJsonLike, topologyToCanvasFileData } from './topologyCanvasAdapter'

const SERVERLESS_COLD_START: TopologyJSON = {
  id: 'serverless-cold-start',
  name: 'Serverless Cold Start',
  version: '2.0.0',
  global: {
    simulationDuration: 20_000,
    warmupDuration: 2_000,
    seed: 'cold-start-seed',
    defaultTimeout: 5_000,
    timeResolution: 'millisecond',
    traceSampleRate: 0.01
  },
  nodes: [
    {
      id: 'client',
      type: 'api-endpoint',
      category: 'compute',
      role: 'source',
      label: 'Client App',
      position: { x: 0, y: 0 }
    },
    {
      id: 'lambda',
      type: 'serverless-function',
      category: 'compute',
      role: 'processor',
      label: 'Checkout Function',
      position: { x: 260, y: 0 },
      queue: { workers: 4, capacity: 20, discipline: 'fifo' },
      processing: {
        distribution: { type: 'exponential', lambda: 1 / 20 },
        timeout: 2_000
      },
      config: {
        coldStartLatency: { type: 'exponential', lambda: 1 / 220 },
        idleTimeoutMs: 4_000,
        maxConcurrency: 2
      }
    }
  ],
  edges: [
    {
      id: 'client-lambda',
      source: 'client',
      target: 'lambda',
      mode: 'synchronous',
      protocol: 'https',
      latency: {
        distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
        pathType: 'same-dc'
      },
      bandwidth: 100,
      maxConcurrentRequests: 100,
      packetLossRate: 0,
      errorRate: 0
    }
  ],
  workload: {
    sourceNodeId: 'client',
    pattern: 'bursty',
    baseRps: 2,
    bursty: { burstRps: 18, burstDuration: 2_000, normalDuration: 5_000 },
    requestDistribution: [{ type: 'invoke', weight: 1, sizeBytes: 1_024 }]
  }
}

const ROUTER_ENTRYPOINT_TOPOLOGY: TopologyJSON = {
  id: 'router-entrypoint',
  name: 'Router Entrypoint',
  version: '2.0.0',
  global: {
    simulationDuration: 30_000,
    warmupDuration: 5_000,
    seed: 'router-seed',
    defaultTimeout: 5_000,
    timeResolution: 'millisecond',
    traceSampleRate: 0.01
  },
  nodes: [
    {
      id: 'api-gw',
      type: 'api-gateway',
      category: 'network-and-edge',
      role: 'router',
      label: 'API Gateway',
      position: { x: 0, y: 0 }
    },
    {
      id: 'service',
      type: 'microservice',
      category: 'compute',
      role: 'processor',
      label: 'Orders',
      position: { x: 260, y: 0 }
    }
  ],
  edges: [
    {
      id: 'api-service',
      source: 'api-gw',
      target: 'service',
      mode: 'synchronous',
      protocol: 'https',
      latency: {
        distribution: { type: 'constant', value: 5 },
        pathType: 'same-dc'
      },
      bandwidth: 100,
      maxConcurrentRequests: 100,
      packetLossRate: 0,
      errorRate: 0
    }
  ],
  workload: {
    sourceNodeId: 'api-gw',
    pattern: 'poisson',
    baseRps: 60,
    requestDistribution: [{ type: 'GET /orders', weight: 1, sizeBytes: 1024 }]
  }
}

const ORDER_TOPOLOGY = orderTopology as TopologyJSON

describe('topologyCanvasAdapter', () => {
  it('recognizes topology-json shaped inputs', () => {
    expect(isTopologyJsonLike(SERVERLESS_COLD_START)).toBe(true)
    expect(isTopologyJsonLike({ nodes: [], edges: [] })).toBe(false)
  })

  it('converts a topology into canvas file data', () => {
    const canvas = topologyToCanvasFileData(SERVERLESS_COLD_START)

    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.scenario).toMatchObject({
      selectedSourceNodeId: 'client',
      global: {
        simulationDuration: SERVERLESS_COLD_START.global.simulationDuration,
        warmupDuration: SERVERLESS_COLD_START.global.warmupDuration,
        seed: SERVERLESS_COLD_START.global.seed
      }
    })

    const lambda = canvas.nodes.find((node) => node.id === 'lambda')
    expect(lambda?.data).toMatchObject({
      componentType: 'serverless-function',
      label: 'Checkout Function',
      sim: expect.objectContaining({
        maxConcurrency: 2,
        idleTimeoutMs: 4_000
      })
    })
  })

  it('preserves explicit constant edge latency when converting topology data', () => {
    const canvas = topologyToCanvasFileData({
      ...SERVERLESS_COLD_START,
      edges: [
        {
          ...SERVERLESS_COLD_START.edges[0],
          latency: {
            distribution: { type: 'constant', value: 12 },
            pathType: 'same-dc'
          }
        }
      ]
    })

    expect(canvas.edges[0]?.data).toMatchObject({
      latencyDistributionType: 'constant',
      latencyValue: 12
    })
  })

  it('hydrates an authored per-edge route override', () => {
    const canvas = topologyToCanvasFileData({
      ...SERVERLESS_COLD_START,
      edges: [
        {
          ...SERVERLESS_COLD_START.edges[0],
          presentation: { routingStyle: 'bezier' }
        }
      ]
    })

    expect(canvas.edges[0]?.data).toMatchObject({ routingStyle: 'bezier' })
  })

  it('hydrates workload overlay state onto non-source components', () => {
    const canvas = topologyToCanvasFileData(ROUTER_ENTRYPOINT_TOPOLOGY)
    const apiGateway = canvas.nodes.find((node) => node.id === 'api-gw')

    expect(apiGateway?.data).toMatchObject({
      componentType: 'api-gateway',
      profile: 'router',
      source: {
        defaultWorkload: {
          pattern: 'poisson',
          baseRps: 60
        }
      }
    })
    expect(canvas.scenario.selectedSourceNodeId).toBe('api-gw')
  })

  it('reconstructs serialized region placement and traffic origins as nested canvas data', () => {
    const canvas = topologyToCanvasFileData({
      ...SERVERLESS_COLD_START,
      version: '2.1.0',
      locations: [
        {
          id: 'region-us',
          kind: 'region',
          label: 'US East',
          provider: 'aws',
          providerCode: 'us-east-1',
          coordinates: { latitude: 38.95, longitude: -77.45 },
          position: { x: 100, y: 50 },
          size: { width: 600, height: 400 }
        }
      ],
      networkModel: { mode: 'geo-aware', catalogueVersion: 'test' },
      nodes: SERVERLESS_COLD_START.nodes.map((node) =>
        node.id === 'lambda' ? { ...node, placement: { regionId: 'region-us' } } : node
      ),
      workload: {
        ...SERVERLESS_COLD_START.workload!,
        origins: [
          {
            id: 'east-coast',
            label: 'East coast',
            weight: 1,
            location: { kind: 'region', regionId: 'region-us' }
          }
        ]
      }
    })

    const region = canvas.nodes.find((node) => node.id === 'region-us')
    const lambda = region?.nodes?.find((node) => node.id === 'lambda')
    const client = canvas.nodes.find((node) => node.id === 'client')

    expect(region?.data).toMatchObject({
      templateId: 'vpc-region',
      label: 'US East',
      sim: {
        locationProvider: 'aws',
        locationId: 'us-east-1',
        locationLatitude: 38.95,
        locationLongitude: -77.45
      }
    })
    expect(lambda).toBeDefined()
    expect(client?.data.source?.defaultWorkload.origins).toEqual([
      expect.objectContaining({ id: 'east-coast', weight: 1 })
    ])
  })

  it('hydrates partitioned stream-broker config fields onto the canvas', () => {
    const canvas = topologyToCanvasFileData({
      ...SERVERLESS_COLD_START,
      nodes: [
        ...SERVERLESS_COLD_START.nodes,
        {
          id: 'events',
          type: 'stream',
          category: 'messaging-and-streaming',
          role: 'processor',
          label: 'Event Stream',
          position: { x: 520, y: 0 },
          queue: { workers: 1, capacity: 100, discipline: 'fifo' },
          processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
          config: {
            streamBrokerEnabled: true,
            partitionCount: 6,
            partitionKeyField: 'orderId',
            retentionMs: 60_000,
            streamReplayIntervalMs: 5_000,
            brokerFailureAtMs: 10_000,
            brokerRecoveryAtMs: 15_000,
            consumerGroupMode: true
          }
        }
      ]
    })

    const events = canvas.nodes.find((node) => node.id === 'events')
    expect(events?.data.sim).toMatchObject({
      streamBrokerEnabled: true,
      partitionCount: 6,
      partitionKeyField: 'orderId',
      retentionMs: 60_000,
      streamReplayIntervalMs: 5_000,
      brokerFailureAtMs: 10_000,
      brokerRecoveryAtMs: 15_000,
      consumerGroupMode: true
    })
  })

  it('synthesizes default handles for topology edges that do not carry canvas metadata', () => {
    const canvas = topologyToCanvasFileData(ROUTER_ENTRYPOINT_TOPOLOGY)

    expect(canvas.edges[0]).toMatchObject({
      sourceHandle: 'right-1-source',
      targetHandle: 'left-1-target'
    })
  })

  it('hydrates the real order topology sample into a valid canvas shape', () => {
    const canvas = topologyToCanvasFileData(ORDER_TOPOLOGY)
    const sourceNode = canvas.nodes.find((node) => node.id === canvas.scenario.selectedSourceNodeId)

    expect(sourceNode?.data.profile).toBe('router')
    expect(sourceNode?.data.source).toBeTruthy()
    expect(canvas.edges.every((edge) => edge.sourceHandle && edge.targetHandle)).toBe(true)
  })
})
