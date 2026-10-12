import { describe, expect, it } from 'vitest'
import { evaluateQuestionSubmission } from '../../cli/questionEvaluate'
import type { ComponentNode, FaultSpec, TopologyJSON, TopologyLocation } from '../core/types'
import { SimulationEngine } from '../engine'
import { testEdge, testNode, testTopology } from '../__tests__/traitTestTopology'
import { FEATURE_RUBRIC_METRIC_IDS, getRubricMetricCapability } from './authoringCapabilities'
import type { SimulationOutput } from './output'
import { parseQuestionPackage } from './question'
import { resolveMetric } from './rubric'
import { projectToVerdict } from './verdict'

/**
 * Gradeable feature metrics: each family resolves to the measured value on a
 * design that uses the feature, stays unresolved (null, never 0) on one that
 * does not, and grades through the real question grader.
 */

function run(topology: TopologyJSON): SimulationOutput {
  return new SimulationEngine(topology).run()
}

function resolve(output: SimulationOutput, metric: string): number | null {
  return resolveMetric(projectToVerdict(output), metric)
}

function sumCounter(output: SimulationOutput, counter: string): number {
  return Object.values(output.perNode).reduce(
    (total, node) => total + (node.traitCounters[counter] ?? 0),
    0
  )
}

// ---- topologies -----------------------------------------------------------

function cacheTopology(opts: { collapsing?: boolean; cache?: boolean } = {}): TopologyJSON {
  const withCache = opts.cache ?? true
  const nodes = [
    testNode('api', 'microservice', 1),
    ...(withCache
      ? [
          testNode('cache', 'in-memory-cache', 0.2, {
            category: 'storage-and-data',
            config: {
              cacheModel: 'derived-lru',
              cacheRamMb: 10,
              valueSizeBytes: 1_000,
              cacheHitLatencyMs: 0.2,
              ...(opts.collapsing ? { requestCollapsing: true } : {})
            }
          } as never)
        ]
      : []),
    testNode('db', 'relational-db', 50, {
      category: 'storage-and-data',
      queue: { workers: 512, capacity: 50_000, discipline: 'fifo' },
      config: { storageReadMs: 50 }
    } as never)
  ]
  const edges = withCache
    ? [testEdge('src', 'api'), testEdge('api', 'cache'), testEdge('cache', 'db')]
    : [testEdge('src', 'api'), testEdge('api', 'db')]
  const topology = testTopology(nodes, edges, 1_000, 2_000)
  topology.workload!.requestDistribution = [
    { type: 'GET', weight: 1, sizeBytes: 256, keyspace: { field: 'postId', size: 50, skew: 1.2 } }
  ]
  return topology
}

function changeStreamTopology(opts: { ordering: boolean; consumerOrdering?: string }) {
  const consumer = testNode('c0', 'microservice', 10, {
    processing: { distribution: { type: 'exponential', lambda: 0.1 }, timeout: 5000 }
  } as never)
  const topology = testTopology(
    [
      testNode('cdc', 'stream', 0.5, {
        queue: { workers: 64, capacity: 10000, discipline: 'fifo' },
        config: {
          streamBrokerEnabled: true,
          partitionCount: 4,
          ...(opts.ordering ? { changeStreamOrdering: true } : {}),
          ...(opts.consumerOrdering ? { consumerOrdering: opts.consumerOrdering } : {})
        }
      } as never),
      consumer
    ],
    [testEdge('src', 'cdc'), testEdge('cdc', 'c0')],
    200,
    3000
  )
  topology.workload!.requestDistribution = [
    { type: 'UPDATE', weight: 1, sizeBytes: 256, keyspace: { field: 'orderId', size: 50 } }
  ]
  return topology
}

function telemetryTopology(collectorConfig: Record<string, unknown>) {
  return testTopology(
    [
      testNode('svc', 'microservice', 5),
      testNode('logs', 'centralized-logging', 20, {
        queue: { workers: 1, capacity: 4, discipline: 'fifo' },
        config: collectorConfig
      } as never)
    ],
    [testEdge('src', 'svc'), testEdge('svc', 'logs')],
    200,
    3000
  )
}

function clusterTopology(opts: { scheduled: boolean; machineFailureAtMs?: number }) {
  const cluster = testNode('k8s', 'kubernetes-cluster', 1, {
    category: 'orchestration-and-infra',
    resources: { instanceType: 'm5.large', instanceCount: 5 },
    config: {
      rescheduleDelayMs: 3000,
      podStartupMs: 1000,
      ...(opts.machineFailureAtMs !== undefined
        ? { machineFailureAtMs: opts.machineFailureAtMs }
        : {})
    }
  } as never)
  const api = testNode('api', 'microservice', 20, {
    resources: { instanceType: 'c5.large', instanceCount: 4, workloadKind: 'cpu-bound' },
    config: opts.scheduled ? { scheduledOn: 'k8s' } : {}
  } as never)
  return testTopology([cluster, api], [testEdge('src', 'api')], 300, 20_000)
}

function edgeTopology(edgeExtra: Record<string, unknown>, rps = 2_000) {
  return testTopology(
    [
      testNode('api', 'microservice', 1, { queue: { workers: 10_000, capacity: 100_000 } } as never)
    ],
    [testEdge('src', 'api', edgeExtra as never)],
    rps,
    3_000
  )
}

const LOCATIONS: TopologyLocation[] = [
  { id: 'region', kind: 'region', label: 'us-east-1' },
  { id: 'az-a', kind: 'availability-zone', label: 'us-east-1a', parentId: 'region' }
]

function zonedTopology(faults?: FaultSpec[]): TopologyJSON {
  const api = testNode('api', 'microservice', 2)
  api.placement = { regionId: 'region', availabilityZoneId: 'az-a' }
  const db = testNode('db', 'microservice', 1) as ComponentNode
  db.placement = { regionId: 'region', availabilityZoneId: 'az-a' }
  const topology = testTopology(
    [api, db],
    [testEdge('src', 'api'), testEdge('api', 'db')],
    100,
    10_000
  )
  return {
    ...topology,
    locations: structuredClone(LOCATIONS),
    ...(faults ? { faults } : {})
  }
}

function zoneFault(atMs: number, durationMs: number): FaultSpec {
  return {
    targetId: 'az-a',
    faultType: 'chaos',
    timing: 'deterministic',
    duration: 'fixed',
    params: { atMs, durationMs, mode: 'reject' }
  }
}

// ---- grader harness ---------------------------------------------------------

function gradeWith(topology: TopologyJSON, metric: string, op: string, value: number) {
  const question = parseQuestionPackage({
    version: '1.0',
    id: 'feature-metric-fixture',
    title: 'Feature metric fixture',
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'Fixture.',
      functionalRequirements: ['Serve requests'],
      nonFunctionalRequirements: []
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: { name: 'feature-suite', visibleToStudent: false, cases: [{ id: 'run' }] },
    rubric: {
      id: 'feature-rubric',
      passThreshold: 1,
      checks: [{ id: 'feature', kind: 'simulation', description: metric, metric, op, value }]
    }
  })
  const result = evaluateQuestionSubmission(question, topology, {
    simulatorVersion: 'test',
    attemptId: 'a',
    submissionId: 's',
    evaluatedAt: '2026-10-12T00:00:00.000Z'
  })
  const check = result.tests.find((test) => test.id.endsWith('feature'))
  return { status: result.status, check }
}

// ---- tests ------------------------------------------------------------------

describe('cache hit ratio metrics', () => {
  it('resolves the lookup-weighted ratio and the worst / best cache', () => {
    const output = run(cacheTopology())
    const cache = output.perNode.cache
    const lookups = cache.cacheHits + cache.cacheMisses
    expect(lookups).toBeGreaterThan(0)
    expect(resolve(output, 'cache.hitRatio')).toBeCloseTo(cache.cacheHits / lookups, 12)
    expect(resolve(output, 'cache.minHitRatio')).toBeCloseTo(cache.cacheHitRatio, 12)
    expect(resolve(output, 'cache.maxHitRatio')).toBeCloseTo(cache.cacheHitRatio, 12)
    expect(resolve(output, 'cache.lookups')).toBe(lookups)
    expect(resolve(output, 'cache.misses')).toBe(cache.cacheMisses)
  })

  it('is unresolved on a design with no cache', () => {
    const output = run(cacheTopology({ cache: false }))
    expect(resolve(output, 'cache.hitRatio')).toBeNull()
    expect(resolve(output, 'cache.misses')).toBeNull()
  })

  it('grades through the question grader', () => {
    expect(gradeWith(cacheTopology(), 'cache.hitRatio', '>', 0.5).status).toBe('passed')
    expect(gradeWith(cacheTopology(), 'cache.hitRatio', '>', 0.999).status).toBe('failed')
    // A cacheless design cannot pass `cache.misses == 0` vacuously.
    const absent = gradeWith(cacheTopology({ cache: false }), 'cache.misses', '==', 0)
    expect(absent.status).toBe('failed')
    expect(absent.check?.actual ?? null).toBeNull()
  })
})

describe('request collapsing metrics', () => {
  it('resolves the collapse counters on a collapsing cache', () => {
    const output = run(cacheTopology({ collapsing: true }))
    const leaders = resolve(output, 'collapse.leaders')
    const collapsed = resolve(output, 'collapse.collapsedMisses')
    expect(leaders).toBe(sumCounter(output, 'collapseLeaders'))
    expect(collapsed).toBe(sumCounter(output, 'collapsedMisses'))
    expect(collapsed).toBeGreaterThan(0)
    expect(resolve(output, 'collapse.followersServed')).toBe(
      sumCounter(output, 'collapsedFollowersServed')
    )
    expect(resolve(output, 'collapse.followersFailed')).toBe(0)
    expect(resolve(output, 'collapse.noKey')).toBe(0)
  })

  it('is unresolved when collapsing is off, even on a cache', () => {
    const output = run(cacheTopology({ collapsing: false }))
    expect(resolve(output, 'collapse.collapsedMisses')).toBeNull()
    expect(resolve(output, 'collapse.followersFailed')).toBeNull()
  })

  it('an enabled but idle collapsing cache grades 0, not unresolved', () => {
    const topology = cacheTopology({ collapsing: true })
    topology.workload!.baseRps = 0.0001
    const output = run(topology)
    expect(resolve(output, 'collapse.followersFailed')).toBe(0)
  })

  it('grades through the question grader', () => {
    const on = cacheTopology({ collapsing: true })
    expect(gradeWith(on, 'collapse.collapsedMisses', '>', 0).status).toBe('passed')
    expect(gradeWith(on, 'collapse.collapsedMisses', '==', 0).status).toBe('failed')
    expect(
      gradeWith(cacheTopology(), 'collapse.followersFailed', '==', 0).status,
      'collapsing off must not pass vacuously'
    ).toBe('failed')
  })
})

describe('change-stream ordering metrics', () => {
  it('resolves violations and held deliveries', () => {
    const parallel = run(changeStreamTopology({ ordering: true }))
    expect(resolve(parallel, 'changeStream.orderViolations')).toBe(
      parallel.perNode.cdc.traitCounters.changeOrderViolations
    )
    expect(resolve(parallel, 'changeStream.orderViolations')).toBeGreaterThan(0)
    const perKey = run(changeStreamTopology({ ordering: true, consumerOrdering: 'per-key' }))
    expect(resolve(perKey, 'changeStream.orderViolations')).toBe(0)
    expect(resolve(perKey, 'changeStream.waitedForOrder')).toBe(
      perKey.perNode.cdc.traitCounters.changeEventsWaitedForOrder
    )
    expect(resolve(perKey, 'changeStream.waitedForOrder')).toBeGreaterThan(0)
  })

  it('is unresolved when ordering is not tracked', () => {
    const output = run(changeStreamTopology({ ordering: false }))
    expect(resolve(output, 'changeStream.orderViolations')).toBeNull()
  })

  it('grades through the question grader', () => {
    const perKey = changeStreamTopology({ ordering: true, consumerOrdering: 'per-key' })
    const parallel = changeStreamTopology({ ordering: true })
    expect(gradeWith(perKey, 'changeStream.orderViolations', '==', 0).status).toBe('passed')
    expect(gradeWith(parallel, 'changeStream.orderViolations', '==', 0).status).toBe('failed')
    expect(
      gradeWith(changeStreamTopology({ ordering: false }), 'changeStream.orderViolations', '==', 0)
        .status
    ).toBe('failed')
  })
})

describe('telemetry sink metrics', () => {
  it('resolves dropped / sampled-out / ingested events and the drop rate', () => {
    const output = run(telemetryTopology({ telemetryAsyncIngest: true }))
    const counters = output.perNode.logs.traitCounters
    expect(resolve(output, 'telemetry.dropped')).toBe(counters.telemetryDropped)
    expect(resolve(output, 'telemetry.ingested')).toBe(counters.telemetryIngested)
    expect(resolve(output, 'telemetry.sampledOut')).toBe(0)
    expect(resolve(output, 'telemetry.dropRate')).toBeCloseTo(
      counters.telemetryDropped / (counters.telemetryDropped + counters.telemetryIngested),
      12
    )
    const sampled = run(telemetryTopology({ telemetryAsyncIngest: true, telemetrySampleRate: 0.2 }))
    expect(resolve(sampled, 'telemetry.sampledOut')).toBe(
      sampled.perNode.logs.traitCounters.telemetrySampledOut
    )
    expect(resolve(sampled, 'telemetry.sampledOut')).toBeGreaterThan(0)
  })

  it('is unresolved when the collector does not ingest async', () => {
    const output = run(telemetryTopology({}))
    expect(resolve(output, 'telemetry.dropped')).toBeNull()
    expect(resolve(output, 'telemetry.dropRate')).toBeNull()
  })

  it('grades through the question grader', () => {
    const on = telemetryTopology({ telemetryAsyncIngest: true })
    expect(gradeWith(on, 'telemetry.dropped', '>', 0).status).toBe('passed')
    expect(gradeWith(on, 'telemetry.dropped', '==', 0).status).toBe('failed')
    expect(gradeWith(telemetryTopology({}), 'telemetry.dropped', '==', 0).status).toBe('failed')
  })
})

describe('cluster scheduling metrics', () => {
  it('resolves time-weighted replicas, pods lost and recovery time', () => {
    const output = run(clusterTopology({ scheduled: true, machineFailureAtMs: 5000 }))
    const cluster = output.clusterProjection![0]
    const workload = cluster.workloads[0]
    expect(resolve(output, 'cluster.avgReadyReplicas')).toBeCloseTo(workload.avgReadyReplicas, 12)
    expect(resolve(output, 'cluster.readyRatio')).toBeCloseTo(
      workload.avgReadyReplicas / workload.avgDesiredReplicas,
      12
    )
    expect(resolve(output, 'cluster.minWorkloadReadyRatio')).toBeCloseTo(
      workload.avgReadyReplicas / workload.avgDesiredReplicas,
      12
    )
    expect(resolve(output, 'cluster.avgPendingPods')).toBeCloseTo(cluster.avgPendingPods, 12)
    expect(resolve(output, 'cluster.podsLost')).toBe(1)
    expect(resolve(output, 'cluster.podsUnrecovered')).toBe(0)
    expect(resolve(output, 'cluster.meanRecoveryMs')).toBe(cluster.meanRecoveryMs)
    expect(resolve(output, 'cluster.maxRecoveryMs')).toBe(cluster.maxRecoveryMs)
  })

  it('recovery time is unresolved until a pod recovers; everything is unresolved unscheduled', () => {
    const healthy = run(clusterTopology({ scheduled: true }))
    expect(resolve(healthy, 'cluster.podsLost')).toBe(0)
    expect(resolve(healthy, 'cluster.maxRecoveryMs')).toBeNull()
    const unscheduled = run(clusterTopology({ scheduled: false }))
    expect(resolve(unscheduled, 'cluster.podsLost')).toBeNull()
    expect(resolve(unscheduled, 'cluster.readyRatio')).toBeNull()
  })

  it('grades through the question grader', () => {
    const failing = clusterTopology({ scheduled: true, machineFailureAtMs: 5000 })
    expect(gradeWith(failing, 'cluster.maxRecoveryMs', '<', 5000).status).toBe('passed')
    expect(gradeWith(failing, 'cluster.maxRecoveryMs', '<', 1000).status).toBe('failed')
    expect(
      gradeWith(clusterTopology({ scheduled: false }), 'cluster.podsLost', '==', 0).status
    ).toBe('failed')
  }, 30_000)
})

describe('edge slot / connection / batching metrics', () => {
  it('sums slot waits and refusals across edges and maxes the peak line', () => {
    const output = run(
      edgeTopology({
        protocol: 'kafka',
        mode: 'asynchronous',
        latency: { distribution: { type: 'constant', value: 5 }, pathType: 'same-dc' },
        maxConcurrentRequests: 5
      })
    )
    const slots = output.perEdge['src->api'].slots!
    expect(slots.refused).toBeGreaterThan(0)
    expect(resolve(output, 'edges.slots.waited')).toBe(slots.waited)
    expect(resolve(output, 'edges.slots.refused')).toBe(slots.refused)
    expect(resolve(output, 'edges.slots.timedOutWaiting')).toBe(slots.timedOutWaiting)
    expect(resolve(output, 'edges.slots.maxPeakWaiting')).toBe(slots.peakWaiting)
  })

  it('a cap that never bound grades 0; connections and batching are unresolved unused', () => {
    const output = run(edgeTopology({}, 50))
    expect(output.perEdge['src->api'].slots).toBeUndefined()
    expect(resolve(output, 'edges.slots.refused')).toBe(0)
    expect(resolve(output, 'edges.connections.opened')).toBeNull()
    expect(resolve(output, 'edges.batching.meanRecordsPerBatch')).toBeNull()
  })

  it('resolves connection-model and batching counters when used', () => {
    // Service-to-service (gw -> api) has one connection pool, so keep-alive reuses.
    const keepAliveTopology = testTopology(
      [testNode('gw', 'microservice', 0.1), testNode('api', 'microservice', 1)],
      [
        testEdge('src', 'gw'),
        testEdge('gw', 'api', {
          latency: { distribution: { type: 'constant', value: 10 }, pathType: 'same-dc' },
          connection: { reuse: 'keep-alive', tls: '1.3' }
        } as never)
      ],
      50,
      3_000
    )
    const keepAlive = run(keepAliveTopology)
    const connections = keepAlive.perEdge['gw->api'].connections!
    expect(resolve(keepAlive, 'edges.connections.reused')).toBe(connections.reused)
    expect(resolve(keepAlive, 'edges.connections.reused')).toBeGreaterThan(0)
    expect(resolve(keepAlive, 'edges.connections.opened')).toBe(connections.opened)

    const batched = run(
      edgeTopology({
        protocol: 'kafka',
        mode: 'asynchronous',
        latency: { distribution: { type: 'constant', value: 5 }, pathType: 'same-dc' },
        maxConcurrentRequests: 5,
        batching: { lingerMs: 10 }
      })
    )
    const batching = batched.perEdge['src->api'].batching!
    expect(resolve(batched, 'edges.batching.batchesSent')).toBe(batching.batchesSent)
    expect(resolve(batched, 'edges.batching.meanRecordsPerBatch')).toBeCloseTo(
      batching.meanRecordsPerBatch,
      12
    )
  })

  it('grades through the question grader', () => {
    const capped = edgeTopology({
      protocol: 'kafka',
      mode: 'asynchronous',
      latency: { distribution: { type: 'constant', value: 5 }, pathType: 'same-dc' },
      maxConcurrentRequests: 5
    })
    expect(gradeWith(capped, 'edges.slots.refused', '==', 0).status).toBe('failed')
    expect(gradeWith(edgeTopology({}, 50), 'edges.slots.refused', '==', 0).status).toBe('passed')
    expect(
      gradeWith(edgeTopology({}, 50), 'edges.connections.waited', '==', 0).status,
      'no connection model must not pass vacuously'
    ).toBe('failed')
  })
})

describe('fault-domain metrics', () => {
  it('counts components a zone outage took down and their downtime', () => {
    const output = run(zonedTopology([zoneFault(2_000, 3_000)]))
    expect(resolve(output, 'faultDomains.componentsFailed')).toBe(2)
    expect(resolve(output, 'faultDomains.outages')).toBe(1)
    expect(resolve(output, 'faultDomains.componentDowntimeMs')).toBeCloseTo(6_000, 6)
  })

  it('is unresolved without a domain outage', () => {
    expect(resolve(run(zonedTopology()), 'faultDomains.componentsFailed')).toBeNull()
  })

  it('grades through the question grader', () => {
    const outage = zonedTopology([zoneFault(2_000, 3_000)])
    expect(gradeWith(outage, 'faultDomains.componentsFailed', '<=', 2).status).toBe('passed')
    // (the grader's comparison tolerance makes `< 2` pass at exactly 2)
    expect(gradeWith(outage, 'faultDomains.componentsFailed', '<', 1).status).toBe('failed')
    expect(gradeWith(zonedTopology(), 'faultDomains.componentsFailed', '==', 0).status).toBe(
      'failed'
    )
  })
})

describe('feature metric registry', () => {
  it('every feature id is registered with a label, description and unit', () => {
    expect(FEATURE_RUBRIC_METRIC_IDS.length).toBeGreaterThan(40)
    for (const id of FEATURE_RUBRIC_METRIC_IDS) {
      const capability = getRubricMetricCapability(id)
      expect(capability?.label, id).toBeTruthy()
      expect(capability?.description, id).toBeTruthy()
      expect(capability?.unit, id).toBeTruthy()
      expect(capability?.evidenceModes, id).toEqual(['discrete'])
    }
  })
})
