import { describe, expect, it } from 'vitest'
import { getComponentSpec } from './componentSpecs'
import type { CanvasNodeDataV2 } from './nodeSpecTypes'
import { validationMessage } from '../validation/validationCopy'

function makeRelationalDbData(sim: CanvasNodeDataV2['sim']): CanvasNodeDataV2 {
  return {
    schemaVersion: 2,
    templateId: 'primary-db',
    componentType: 'relational-db',
    structuralRole: 'storage',
    profile: 'datastore',
    rendererType: 'serviceNode',
    label: 'Primary DB',
    iconKey: 'database',
    sim
  }
}

function makeNodeData(
  componentType: CanvasNodeDataV2['componentType'],
  sim: CanvasNodeDataV2['sim'],
  overrides: Partial<CanvasNodeDataV2> = {}
): CanvasNodeDataV2 {
  return {
    schemaVersion: 2,
    templateId: componentType ?? 'node',
    componentType,
    structuralRole: 'processor',
    profile: 'compute-service',
    rendererType: 'serviceNode',
    label: 'Node',
    iconKey: 'server',
    sim,
    ...overrides
  }
}

const RAW_VALIDATION_COPY_FRAGMENTS = [
  'queue.',
  'processing.',
  'nodeErrorRate',
  'healthCheckEnabled',
  'cacheHitRate',
  'cacheHitLatencyMs',
  'ttlSeconds',
  'readLatencyMs',
  'writeLatencyMs',
  'replicationRole',
  'maxTokens',
  'refillRatePerSecond',
  'coldStartLatency',
  'idleTimeoutMs',
  'maxConcurrency',
  'workingSetRatio',
  'workingSetPenaltyMs',
  'gcPressureStartRatio',
  'gcPauseMs',
  'lockKeyField',
  'acquireMs',
  'leaseMs',
  'routingKeyField',
  'dnsRoutingPolicy',
  'dnsCacheTtlSeconds',
  'circuitBreaker.',
  'retry.',
  'routingRules[',
  'matchField',
  'matchValue',
  'targetNodeId',
  'requestDistribution',
  'baseRps',
  'blockRate',
  'droppedPackets'
] as const

function expectHumanReadableValidationCopy(errors: readonly string[]): void {
  for (const error of errors) {
    expect(
      RAW_VALIDATION_COPY_FRAGMENTS.filter((fragment) => error.includes(fragment)),
      error
    ).toEqual([])
  }
}

describe('component spec validation copy', () => {
  it('uses editor labels for runtime validation messages', () => {
    const spec = getComponentSpec('api-gateway')!
    const errors = spec.validateCanvas(
      makeNodeData('api-gateway', {
        queue: { workers: 0, capacity: 0, discipline: 'fifo' },
        processing: { distribution: undefined, timeout: 0 } as unknown as NonNullable<
          CanvasNodeDataV2['sim']
        >['processing'],
        nodeErrorRate: 2,
        healthCheckEnabled: 'yes' as unknown as boolean,
        cacheHitRate: 2,
        cacheHitLatencyMs: 0,
        ttlSeconds: -1,
        maxTokens: 0,
        refillRatePerSecond: -1,
        coldStartLatency: { type: 'bad' } as unknown as NonNullable<
          CanvasNodeDataV2['sim']
        >['coldStartLatency'],
        coldStartLatencyMs: 0,
        idleTimeoutMs: 0,
        maxConcurrency: 0,
        workingSetRatio: 0,
        workingSetPenaltyMs: 0,
        gcPressureStartRatio: 2,
        gcPauseMs: 0,
        routingKeyField: '',
        dnsRoutingPolicy: 'invalid' as unknown as NonNullable<
          CanvasNodeDataV2['sim']
        >['dnsRoutingPolicy'],
        dnsCacheTtlSeconds: -1,
        circuitBreaker: {
          failureThreshold: 2,
          failureCount: 0,
          recoveryTimeout: 0,
          halfOpenRequests: 0
        }
      })
    )

    expect(errors).toEqual(
      expect.arrayContaining([
        'Max concurrent requests must be a whole number of 1 or more.',
        'Request queue limit must be a whole number of 1 or more.',
        'Please choose a distribution model.',
        'Timeout must be greater than 0 ms.',
        'Inject failure must be between 0 and 1 (0-100%).',
        'Health checks must be either on or off.',
        'Cache hit rate must be between 0 and 1 (0-100%).',
        'Cache hit latency must be greater than 0 ms.',
        'TTL must be 0 seconds or greater.',
        'Bucket size must be greater than 0.',
        'Refill rate must be 0 tokens/s or greater.',
        'Cold start latency must be a valid distribution.',
        'Cold start latency must be greater than 0 ms.',
        'Idle timeout must be greater than 0 ms.',
        'Max concurrency must be greater than 0.',
        'Working-set ratio must be greater than 0.',
        'Working-set miss penalty must be greater than 0 ms.',
        'GC pressure threshold must be between 0 and 1 (0-100%).',
        'Max GC pause must be greater than 0 ms.',
        'Routing key field cannot be empty.',
        'DNS routing policy must be Simple, Weighted, Failover, Latency-based, or Geolocation.',
        'Cache TTL must be 0 seconds or greater.',
        'Failure threshold must be between 0 and 1 (0-100%).',
        'Window size must be greater than 0.',
        'Recovery timeout must be greater than 0 ms.',
        'Half-open probes must be greater than 0.'
      ])
    )
    expectHumanReadableValidationCopy(errors)
  })

  it('uses queue labels that match specialized editor copy', () => {
    const spec = getComponentSpec('relational-db')!
    const errors = spec.validateCanvas(
      makeRelationalDbData({
        queue: { workers: 4, capacity: 2, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 }
      })
    )

    expect(errors).toContain('Query queue limit must be at least as large as Connection pool size.')
    expectHumanReadableValidationCopy(errors)
  })

  it('uses plain copy for read/write, routing-rule, source, and security validation', () => {
    const relationalDbErrors = getComponentSpec('relational-db')!.validateCanvas(
      makeRelationalDbData({
        queue: { workers: 1, capacity: 1, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        readLatency: { type: 'bad' } as unknown as NonNullable<
          CanvasNodeDataV2['sim']
        >['readLatency'],
        writeLatency: { type: 'bad' } as unknown as NonNullable<
          CanvasNodeDataV2['sim']
        >['writeLatency'],
        readLatencyMs: 0,
        writeLatencyMs: 0,
        replicationRole: 'secondary' as unknown as NonNullable<
          CanvasNodeDataV2['sim']
        >['replicationRole']
      })
    )

    const routingErrors = getComponentSpec('load-balancer-l7')!.validateCanvas(
      makeNodeData('load-balancer-l7', {
        queue: { workers: 1, capacity: 1, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
        routingRules: [
          {
            matchField: 'header',
            matchValue: '',
            targetNodeId: ''
          }
        ] as unknown as NonNullable<CanvasNodeDataV2['sim']>['routingRules']
      })
    )

    const sourceErrors = getComponentSpec('api-endpoint')!.validateCanvas({
      schemaVersion: 2,
      templateId: 'api-endpoint',
      componentType: 'api-endpoint',
      structuralRole: 'source',
      profile: 'source',
      rendererType: 'serviceNode',
      label: 'Client',
      iconKey: 'globe',
      source: {
        requestDistribution: [],
        defaultWorkload: {
          sourceNodeId: 'client',
          pattern: undefined,
          baseRps: 0,
          duration: 1
        } as unknown as NonNullable<CanvasNodeDataV2['source']>['defaultWorkload']
      }
    })

    const securityErrors = getComponentSpec('waf')!.validateCanvas(
      makeNodeData(
        'waf',
        {
          queue: { workers: 1, capacity: 1, discipline: 'fifo' },
          processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 }
        },
        { profile: 'security-filter' }
      )
    )

    const allErrors = [...relationalDbErrors, ...routingErrors, ...sourceErrors, ...securityErrors]

    expect(allErrors).toEqual(
      expect.arrayContaining([
        'Read latency must be a valid distribution.',
        'Write latency must be a valid distribution.',
        'Read latency must be greater than 0 ms.',
        'Write latency must be greater than 0 ms.',
        'Replication role must be either Primary or Replica.',
        'Routing rule 1 uses an unsupported match field. Choose Type, Method, Path, Host.',
        'Routing rule 1 needs a match value.',
        'Routing rule 1 needs a target node.',
        validationMessage('requestDistributionEmpty'),
        validationMessage('workloadPatternRequired'),
        'Base RPS must be greater than 0.',
        validationMessage('missingSecurityPolicy')
      ])
    )

    expectHumanReadableValidationCopy(allErrors)
  })

  it('uses human copy for retry-policy and lock-lease validation', () => {
    const retryErrors = getComponentSpec('microservice')!.validateCanvas(
      makeNodeData('microservice', {
        queue: { workers: 1, capacity: 1, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
        retry: {
          maxAttempts: 0,
          baseDelay: 0,
          maxDelay: 0,
          multiplier: 0
        }
      })
    )

    const lockErrors = getComponentSpec('distributed-lock')!.validateCanvas(
      makeNodeData(
        'distributed-lock',
        {
          queue: { workers: 1, capacity: 1, discipline: 'fifo' },
          processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
          lockKeyField: '',
          acquireMs: 0,
          leaseMs: 0
        },
        {
          profile: 'control-plane',
          label: 'Distributed Lock'
        }
      )
    )

    const allErrors = [...retryErrors, ...lockErrors]

    expect(allErrors).toEqual(
      expect.arrayContaining([
        'Max attempts must be greater than 0.',
        'Base delay must be greater than 0 ms.',
        'Max delay must be greater than 0 ms.',
        'Multiplier must be greater than 0.',
        'Lock key field must be a non-empty string.',
        'Acquire latency must be greater than 0 ms.',
        'Lease TTL must be greater than 0 ms.'
      ])
    )
    expectHumanReadableValidationCopy(allErrors)
  })
})

describe('default simulation config resources', () => {
  it('seeds new microservice nodes from the curated compute defaults', () => {
    const spec = getComponentSpec('microservice')!
    const sim = spec.createDefaultSimulationConfig()

    expect(sim.resources).toMatchObject({
      instanceType: 'c5.large',
      instanceCount: 1,
      workloadKind: 'cpu-bound',
      perRequestMemMb: 16
    })
  })

  it('seeds first-class defaults for rate limiting, breakers, and locks', () => {
    expect(getComponentSpec('rate-limiter')!.createDefaultSimulationConfig()).toMatchObject({
      maxTokens: 100,
      refillRatePerSecond: 50
    })

    expect(
      getComponentSpec('circuit-breaker-controller')!.createDefaultSimulationConfig()
    ).toMatchObject({
      circuitBreaker: {
        failureThreshold: 0.5,
        failureCount: 10,
        recoveryTimeout: 15_000,
        halfOpenRequests: 1
      }
    })

    expect(getComponentSpec('distributed-lock')!.createDefaultSimulationConfig()).toMatchObject({
      lockKeyField: 'seatId',
      acquireMs: 2,
      leaseMs: 5_000,
      fencing: true
    })
  })
})

describe('relational-db serializeCanvas readLatencyMs/writeLatencyMs', () => {
  it('converts mean-latency inputs into exponential distributions', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        readLatencyMs: 4,
        writeLatencyMs: 10
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.config?.readLatency).toEqual({ type: 'exponential', lambda: 1 / 4 })
    expect(node?.config?.writeLatency).toEqual({ type: 'exponential', lambda: 1 / 10 })
  })

  it('lets an explicit distribution config win over the mean-latency shortcut', () => {
    const spec = getComponentSpec('relational-db')!
    const explicit = { type: 'log-normal' as const, mu: 1, sigma: 0.2 }
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        readLatency: explicit,
        readLatencyMs: 4
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.config?.readLatency).toEqual(explicit)
  })

  it('omits readLatency/writeLatency entirely when neither is configured', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 }
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.config?.readLatency).toBeUndefined()
    expect(node?.config?.writeLatency).toBeUndefined()
  })

  it('serializes partial SLO targets without requiring the full object', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        slo: { latencyP99: 99 }
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.slo).toEqual({ latencyP99: 99 })
  })

  it('serializes memory-pressure config fields onto node.config', () => {
    const spec = getComponentSpec('in-memory-cache')!
    const node = spec.serializeCanvas(
      makeNodeData(
        'in-memory-cache',
        {
          queue: { workers: 8, capacity: 100, discipline: 'fifo' },
          processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
          workingSetRatio: 1.6,
          workingSetPenaltyMs: 12,
          gcPressureStartRatio: 0.75,
          gcPauseMs: 30
        },
        {
          structuralRole: 'storage',
          profile: 'datastore',
          label: 'Cache'
        }
      ),
      { nodeId: 'cache', position: { x: 0, y: 0 } }
    )

    expect(node?.config).toMatchObject({
      workingSetRatio: 1.6,
      workingSetPenaltyMs: 12,
      gcPressureStartRatio: 0.75,
      gcPauseMs: 30
    })
  })

  it('derives error budget from availability target when only availability is configured', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        slo: { availabilityTarget: 0.999 }
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.slo?.availabilityTarget).toBe(0.999)
    expect(node?.slo?.errorBudget).toBeCloseTo(0.001, 9)
  })

  it('serializes retry policy onto resilience.retry for caller-owned backoff', () => {
    const spec = getComponentSpec('microservice')!
    const node = spec.serializeCanvas(
      makeNodeData('microservice', {
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        retry: {
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 500,
          multiplier: 2,
          jitter: true
        }
      }),
      { nodeId: 'svc', position: { x: 0, y: 0 } }
    )

    expect(node?.resilience?.retry).toEqual({
      maxAttempts: 3,
      baseDelay: 100,
      maxDelay: 500,
      multiplier: 2,
      jitter: true
    })
  })

  it('serializes distributed-lock fields onto node.config', () => {
    const spec = getComponentSpec('distributed-lock')!
    const node = spec.serializeCanvas(
      makeNodeData(
        'distributed-lock',
        {
          queue: { workers: 8, capacity: 100, discipline: 'fifo' },
          processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
          lockKeyField: 'inventoryKey',
          acquireMs: 4,
          leaseMs: 2_000,
          fencing: false
        },
        {
          profile: 'control-plane',
          label: 'Distributed Lock'
        }
      ),
      { nodeId: 'lock', position: { x: 0, y: 0 } }
    )

    expect(node?.config).toMatchObject({
      lockKeyField: 'inventoryKey',
      acquireMs: 4,
      leaseMs: 2_000,
      fencing: false
    })
  })
})
