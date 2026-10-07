import { describe, expect, it } from 'vitest'
import { mockArchitecture } from '../__mocks__/sampleTopology'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import { EDGE_FIELD_LABELS, edgeFieldTitle } from '../defaults/edgeFieldLabels'
import {
  edgeFieldLabel,
  globalFieldLabel,
  humanizeFieldKey,
  nodeFieldLabel,
  workloadFieldLabel
} from './fieldLabels'
import { subjectForPath } from './issueMessages'
import { validateTopology } from './validator'

/** A raw config key (`queue.workers`, `maxConcurrentRequests`, `nodes[2]`) leaking into copy. */
const RAW_KEY = /\b[a-z]+[A-Z][A-Za-z]*\b|\b[a-zA-Z]+\.[a-zA-Z]+\b|\[\d+\]|\b(nodes|edges)\.\d/

function sourceNode(): ComponentNode {
  return {
    id: 'client',
    type: 'api-endpoint',
    category: 'compute',
    role: 'source',
    label: 'Client',
    position: { x: 0, y: 0 }
  }
}

function gatewayNode(overrides: Partial<ComponentNode> = {}): ComponentNode {
  return {
    id: 'gateway',
    type: 'api-gateway',
    category: 'network-and-edge',
    role: 'router',
    label: 'Main Gateway',
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 40, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 2 }, timeout: 1_000 },
    ...overrides
  }
}

function serviceNode(overrides: Partial<ComponentNode> = {}): ComponentNode {
  return {
    id: 'api',
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: 'API Server',
    position: { x: 0, y: 0 },
    queue: { workers: 2, capacity: 20, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 },
    ...overrides
  }
}

function edge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<EdgeDefinition> = {}
): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0,
    ...overrides
  }
}

function topology(
  overrides: {
    gateway?: Partial<ComponentNode>
    service?: Partial<ComponentNode>
    edge?: Partial<EdgeDefinition>
    workload?: Partial<NonNullable<TopologyJSON['workload']>>
    global?: Partial<TopologyJSON['global']>
  } = {}
): TopologyJSON {
  const base = structuredClone(mockArchitecture) as TopologyJSON
  return {
    ...base,
    global: { ...base.global, ...overrides.global },
    nodes: [sourceNode(), gatewayNode(overrides.gateway), serviceNode(overrides.service)],
    edges: [
      edge('client-gateway', 'client', 'gateway'),
      edge('gateway-api', 'gateway', 'api', overrides.edge)
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }],
      ...overrides.workload
    }
  }
}

function messages(input: unknown): string[] {
  const result = validateTopology(input)
  return [...(result.errors ?? []).map((error) => error.message), ...(result.warnings ?? [])]
}

describe('field labels come from the editor field definitions', () => {
  it('uses the per-component queue labels for workers and capacity', () => {
    expect(nodeFieldLabel('queue.workers', { componentType: 'api-gateway' })).toBe(
      'Max concurrent requests'
    )
    expect(nodeFieldLabel('queue.capacity', { componentType: 'relational-db' })).toBe(
      'Query queue limit'
    )
    expect(nodeFieldLabel('queue.workers', { componentType: 'microservice' })).toBe('Workers')
  })

  it('maps engine config, resilience and nested paths onto properties-panel labels', () => {
    expect(nodeFieldLabel('config.cacheHitRate', { componentType: 'in-memory-cache' })).toBe(
      'Cache hit rate'
    )
    expect(nodeFieldLabel('config.nodeErrorRate')).toBe('Inject failure')
    expect(nodeFieldLabel('processing.timeout')).toBe('Timeout')
    expect(nodeFieldLabel('processing.distribution.sigma')).toBe('Sigma')
    expect(nodeFieldLabel('slo.latencyP99')).toBe('Latency target (p99)')
    expect(nodeFieldLabel('resilience.retry.maxAttempts')).toBe('Max attempts')
    expect(nodeFieldLabel('config.circuitBreaker.failureCount')).toBe('Window size')
    expect(nodeFieldLabel('config.replicationRole', { componentType: 'relational-db' })).toBe(
      'Database role'
    )
  })

  it('resolves component-specific label functions', () => {
    expect(nodeFieldLabel('resources.instanceCount', { componentType: 'relational-db' })).toBe(
      'Node instances'
    )
    expect(nodeFieldLabel('resources.instanceCount', { componentType: 'microservice' })).toBe(
      'Service instances'
    )
  })

  it('humanizes keys the editor never shows instead of leaking them', () => {
    expect(nodeFieldLabel('resources.workersPerInstance')).toBe('Workers per instance')
    expect(nodeFieldLabel('config.someNewSettingMs')).toBe('Some new setting')
    expect(humanizeFieldKey('maxReceiveCount')).toBe('Max receive count')
  })

  it('labels edge, workload and global fields the way their panels do', () => {
    expect(edgeFieldLabel('maxConcurrentRequests')).toBe(
      EDGE_FIELD_LABELS.maxConcurrentRequests.label
    )
    expect(edgeFieldLabel('latency.distribution.sigma')).toBe('Jitter sigma')
    expect(edgeFieldLabel('latency.pathType')).toBe('Path type')
    expect(edgeFieldTitle('bandwidth')).toBe('Bandwidth (Mbps)')
    expect(workloadFieldLabel('baseRps')).toBe('Base RPS')
    expect(workloadFieldLabel('bursty.burstDuration')).toBe('Burst duration')
    expect(globalFieldLabel('simulationDuration')).toBe('Run duration')
  })

  // The canvas validator (componentSpecs.validateSimulationNode) words its messages with
  // these labels; keep them identical to what the properties panel shows.
  it.each([
    ['sim.processing.timeout', 'Timeout'],
    ['sim.nodeErrorRate', 'Inject failure'],
    ['sim.healthCheckEnabled', 'Health checks'],
    ['sim.cacheHitRate', 'Cache hit rate'],
    ['sim.cacheHitLatencyMs', 'Cache hit latency'],
    ['sim.ttlSeconds', 'TTL'],
    ['sim.readLatencyMs', 'Read latency'],
    ['sim.writeLatencyMs', 'Write latency'],
    ['sim.dedupWindowMs', 'Dedup window'],
    ['sim.storeLookupMs', 'Lookup latency'],
    ['sim.workingSetRatio', 'Working-set ratio'],
    ['sim.gcPauseMs', 'Max GC pause'],
    ['sim.gcPressureStartRatio', 'GC pressure threshold'],
    ['sim.dedupKeyField', 'Metadata key'],
    ['sim.lockKeyField', 'Lock key field'],
    ['sim.acquireMs', 'Acquire latency'],
    ['sim.leaseMs', 'Lease TTL'],
    ['sim.replicationRole', 'Database role'],
    ['sim.maxTokens', 'Bucket size'],
    ['sim.refillRatePerSecond', 'Refill rate'],
    ['sim.retry.maxAttempts', 'Max attempts'],
    ['sim.retry.baseDelay', 'Base delay'],
    ['sim.retry.maxDelay', 'Max delay'],
    ['sim.coldStartLatencyMs', 'Cold start latency'],
    ['sim.idleTimeoutMs', 'Idle timeout'],
    ['sim.maxConcurrency', 'Max concurrency'],
    ['sim.routingKeyField', 'Routing key field'],
    ['sim.dnsRoutingPolicy', 'DNS routing policy'],
    ['sim.dnsCacheTtlSeconds', 'Cache TTL'],
    ['sim.circuitBreaker.failureThreshold', 'Failure threshold'],
    ['sim.circuitBreaker.recoveryTimeout', 'Recovery timeout'],
    ['sim.circuitBreaker.halfOpenRequests', 'Half-open probes']
  ])('canvas field %s is labelled %s in the properties panel', (canvasPath, label) => {
    const relative = canvasPath.replace(/^sim\./, 'config.')
    expect(nodeFieldLabel(relative)).toBe(label)
  })
})

describe('Run blocked / Run warning copy', () => {
  it('rewords structural errors with the component name and UI label', () => {
    expect(
      messages(topology({ gateway: { queue: { ...gatewayNode().queue!, workers: 1.5 } } }))
    ).toContain('Main Gateway: Max concurrent requests must be a whole number.')

    expect(
      messages(
        topology({
          service: {
            processing: { distribution: { type: 'log-normal', mu: 1, sigma: 0 }, timeout: 1_000 }
          }
        })
      )
    ).toContain('API Server: Sigma must be greater than 0.')

    const missingTimeout = topology()
    delete (missingTimeout.nodes[2].processing as { timeout?: number }).timeout
    expect(messages(missingTimeout)).toContain('API Server: Timeout is missing.')
  })

  it('names connections by their endpoints and uses the edge panel labels', () => {
    expect(messages(topology({ edge: { maxConcurrentRequests: 0 } }))).toContain(
      'Main Gateway -> API Server: Max concurrent requests must be greater than 0.'
    )
    expect(messages(topology({ edge: { packetLossRate: 2 } }))).toContain(
      'Main Gateway -> API Server: Packet loss must be between 0 and 1 (0-100%).'
    )
    expect(messages(topology({ edge: { label: 'orders', protocol: 'smtp' as never } }))).toContain(
      'orders: Protocol must be https, grpc, tcp, udp, websocket, amqp, or kafka.'
    )
  })

  it('attributes workload and global errors to the source and the run settings', () => {
    expect(messages(topology({ workload: { baseRps: -5 } }))).toContain(
      'Client: Base RPS must be greater than 0.'
    )
    expect(
      messages(
        topology({ workload: { requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 0 }] } })
      )
    ).toContain('Client: Payload size on request template 1 must be greater than 0.')
    expect(
      messages(topology({ global: { simulationDuration: 1_000, warmupDuration: 5_000 } }))
    ).toContain('Simulation settings: Run duration must be longer than Warmup duration.')
  })

  it('words the edge-constraint warnings with the connection name', () => {
    expect(messages(topology({ edge: { maxConcurrentRequests: 50_000 } }))).toContain(
      'Main Gateway -> API Server: Max concurrent requests above 10,000 is unusually high and may hide connection-pool bottlenecks.'
    )
  })

  it('never exposes raw config keys or paths in a message', () => {
    const cases: TopologyJSON[] = [
      topology({ gateway: { queue: { ...gatewayNode().queue!, workers: 0 } } }),
      topology({ gateway: { queue: { ...gatewayNode().queue!, capacity: 1 } } }),
      topology({ service: { config: { cacheHitRate: 3, nodeErrorRate: -1, ttlSeconds: -1 } } }),
      topology({ service: { config: { circuitBreaker: { failureThreshold: 2 } } } }),
      topology({
        service: { resources: { instanceType: 'c5.large', instanceCount: 9, maxInstances: 2 } }
      }),
      topology({ service: { resources: { instanceType: 'c5.large', workersPerInstance: 8 } } }),
      topology({ edge: { maxConcurrentRequests: 50_000, bandwidth: 1, packetLossRate: 0.5 } }),
      topology({ edge: { mode: 'conditional' } }),
      topology({ workload: { stopCondition: { mode: 'requestBudget' } } }),
      topology({
        workload: {
          pattern: 'bursty',
          bursty: { burstRps: 1, burstDuration: 0, normalDuration: 0 }
        }
      }),
      topology({ global: { simulationDuration: -1 } })
    ]
    const all = cases.flatMap(messages)
    expect(all.length).toBeGreaterThan(cases.length)
    for (const message of all) {
      // Subjects are user-authored labels; only check the copy after them.
      const copy = message.replace(/^[^:]+: /, '')
      expect(copy, message).not.toMatch(RAW_KEY)
      expect(message, message).not.toContain('—')
    }
  })
})

describe('subjectForPath', () => {
  const input = topology()

  it('resolves a component by its position in the serialized topology', () => {
    expect(subjectForPath('nodes[1].queue.workers', input)).toBe('Main Gateway')
    expect(subjectForPath('nodes.2.processing.timeout', input)).toBe('API Server')
  })

  it('resolves connections, the workload, and run settings', () => {
    expect(subjectForPath('edges.1.bandwidth', input)).toBe('Main Gateway -> API Server')
    expect(subjectForPath('workload.baseRps', input)).toBe('Client')
    expect(subjectForPath('global.seed', input)).toBe('Simulation settings')
    expect(subjectForPath('nodes', input)).toBeNull()
  })
})
