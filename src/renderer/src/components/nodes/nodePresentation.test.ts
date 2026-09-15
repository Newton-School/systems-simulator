import { describe, expect, it } from 'vitest'
import type { AnyNodeData } from '@renderer/types/ui'
import {
  buildLatencyLensCard,
  describeNodeEffects,
  getIdentityChip,
  getLensCard,
  isBroadcastFanoutData
} from './nodePresentation'

describe('isBroadcastFanoutData', () => {
  it('is true for broadcast broker component types', () => {
    expect(isBroadcastFanoutData({ componentType: 'pub-sub' } as AnyNodeData)).toBe(true)
    expect(isBroadcastFanoutData({ componentType: 'event-bus' } as AnyNodeData)).toBe(true)
    expect(isBroadcastFanoutData({ componentType: 'message-broker' } as AnyNodeData)).toBe(true)
  })

  it('is true when routing strategy is explicitly broadcast', () => {
    expect(
      isBroadcastFanoutData({
        componentType: 'load-balancer-l7',
        routingStrategy: 'broadcast'
      } as AnyNodeData)
    ).toBe(true)
  })

  it('is false for load balancers and datastores', () => {
    expect(isBroadcastFanoutData({ componentType: 'load-balancer-l7' } as AnyNodeData)).toBe(false)
    expect(isBroadcastFanoutData({ componentType: 'relational-db' } as AnyNodeData)).toBe(false)
    expect(isBroadcastFanoutData({} as AnyNodeData)).toBe(false)
  })
})

const EMPTY_LATENCY = {
  p50: null,
  p90: null,
  p95: null,
  p99: null,
  min: null,
  max: null,
  mean: null
} as const

const EMPTY_TTE = {
  queue_full: { count: 0, errorRate: 0, shareOfErrors: 0, p50: null, p95: null, p99: null },
  oom: { count: 0, errorRate: 0, shareOfErrors: 0, p50: null, p95: null, p99: null },
  node_failed: { count: 0, errorRate: 0, shareOfErrors: 0, p50: null, p95: null, p99: null },
  network_error: { count: 0, errorRate: 0, shareOfErrors: 0, p50: null, p95: null, p99: null },
  timeout: { count: 0, errorRate: 0, shareOfErrors: 0, p50: null, p95: null, p99: null },
  connection_reset: {
    count: 0,
    errorRate: 0,
    shareOfErrors: 0,
    p50: null,
    p95: null,
    p99: null
  },
  rejected: { count: 0, errorRate: 0, shareOfErrors: 0, p50: null, p95: null, p99: null }
} as const

describe('buildLatencyLensCard', () => {
  it('shows N/A instead of 0ms when a node had no successful requests', () => {
    const card = buildLatencyLensCard(undefined, {
      latencyP50: 0,
      latencyP95: 0,
      latencyP99: 0,
      latencyNodeLocal: EMPTY_LATENCY,
      successLatencySamples: 0,
      latencyWindowErrorRate: 1,
      errorRate: 100,
      timeToErrorByCause: {
        ...EMPTY_TTE,
        node_failed: { count: 600, errorRate: 1, shareOfErrors: 1, p50: 0, p95: 0, p99: 0 }
      }
    })

    expect(card).toMatchObject({
      value: 'N/A',
      limit: 'p95',
      glyph: '✕',
      tone: 'critical'
    })
    expect(card?.why).toContain('no successful requests')
    expect(card?.why).toContain('100.0% failed')
    expect(card?.why).toContain('mostly Node Failed')
  })

  it('flags heavily survivor-biased latency when most requests failed', () => {
    const card = buildLatencyLensCard(12, {
      latencyNodeLocal: {
        p50: 8.01,
        p90: 8.02,
        p95: 8.03,
        p99: 8.04,
        min: 8,
        max: 8.04,
        mean: 8.02
      },
      successLatencySamples: 120,
      latencyWindowErrorRate: 0.88,
      errorRate: 88,
      timeToErrorByCause: {
        ...EMPTY_TTE,
        queue_full: { count: 880, errorRate: 0.88, shareOfErrors: 1, p50: 4, p95: 7, p99: 8 }
      }
    })

    expect(card).toMatchObject({
      value: '8.03ms',
      glyph: '✕',
      tone: 'critical'
    })
    expect(card?.why).toContain('success-only latency')
    expect(card?.why).toContain('88.0% failed')
    expect(card?.why).toContain('mostly Queue Full')
  })
})

describe('getLensCard', () => {
  it('treats timeouts as failures in the errors lens copy', () => {
    const card = getLensCard('errors', { componentType: 'compute-service' } as never, {
      errorRate: 100,
      postWarmupRejected: 0,
      postWarmupTimedOut: 38,
      postWarmupConnectionReset: 0,
      totalRejected: 0,
      timeToErrorByCause: {
        ...EMPTY_TTE,
        timeout: { count: 38, errorRate: 1, shareOfErrors: 1, p50: 95, p95: 98, p99: 99 }
      }
    })

    expect(card).toMatchObject({
      value: '100.0%',
      limit: '38 failed',
      glyph: '✕',
      tone: 'critical',
      glyphTooltip: expect.objectContaining({
        title: 'Errors: failure-heavy'
      })
    })
    expect(card?.why).toContain('38 timed out')
    expect(card?.why).toContain('mostly Timed Out')
    expect(card?.why).not.toContain('no rejections')
  })
})

describe('getIdentityChip', () => {
  it('shows workload identity for workload-overlay entrypoints without changing their profile', () => {
    const chip = getIdentityChip({
      profile: 'router',
      structuralRole: 'router',
      componentType: 'api-gateway',
      source: {
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }],
        defaultWorkload: {
          pattern: 'poisson',
          baseRps: 80
        }
      }
    } as never)

    expect(chip).toEqual({
      label: 'Workload',
      value: 'poisson · 80.0 rps'
    })
  })

  it('shows the distribution mechanism for distributor nodes', () => {
    const chip = (data: Partial<AnyNodeData>) => getIdentityChip(data as never)

    expect(chip({ componentType: 'load-balancer', routingStrategy: 'weighted' })).toEqual({
      label: 'Distributes',
      value: 'weighted'
    })
    expect(chip({ componentType: 'load-balancer', routingStrategy: 'sticky' })).toEqual({
      label: 'Distributes',
      value: 'sticky · sessionId'
    })
    expect(
      chip({
        componentType: 'load-balancer',
        routingStrategy: 'sticky',
        sim: { stickyKeyField: 'tenant' }
      })
    ).toEqual({ label: 'Distributes', value: 'sticky · tenant' })
    expect(chip({ componentType: 'pub-sub' })).toEqual({
      label: 'Distributes',
      value: 'broadcast · all subscribers'
    })
    expect(chip({ componentType: 'message-broker', sim: { consumerGroupMode: true } })).toEqual({
      label: 'Distributes',
      value: 'consumer groups · one per group'
    })
    expect(chip({ componentType: 'sharding', sim: { routingKeyField: 'userId' } })).toEqual({
      label: 'Distributes',
      value: 'by userId · consistent hash'
    })
    expect(
      chip({
        componentType: 'stream',
        sim: { streamBrokerEnabled: true, partitionCount: 6 }
      })
    ).toEqual({ label: 'Distributes', value: '6 partitions' })
    expect(
      chip({
        componentType: 'load-balancer-l7',
        sim: { routingRules: [{ matchField: 'path', matchValue: '/a', targetNodeId: 't' }] }
      })
    ).toEqual({ label: 'Distributes', value: 'content routing · 1 rule' })
    // Default LB with no explicit strategy still reads as round-robin.
    expect(chip({ componentType: 'load-balancer' })).toEqual({
      label: 'Distributes',
      value: 'round-robin'
    })
    // A caching reverse-proxy still reads as a cache, not a balancer.
    expect(chip({ componentType: 'reverse-proxy', sim: { cacheHitRate: 0.9 } })).toEqual({
      label: 'Cache',
      value: 'hit 90%'
    })
  })
})

describe('describeNodeEffects', () => {
  it('surfaces hidden node effects from trait counters', () => {
    // cacheHitRatio arrives already scaled to a percentage (WorkspaceLayout maps
    // the engine's 0-1 ratio to 0-100 before it reaches the card).
    expect(describeNodeEffects({ cacheHits: 120, cacheHitRatio: 85 })).toEqual(['⚡ cache 85%'])
    expect(describeNodeEffects({ traitCounters: { retryAttempts: 7 } })).toEqual(['↻ 7 retries'])
    expect(describeNodeEffects({ traitCounters: { replicationQuorumWrites: 3 } })).toEqual([
      '⇉ replicated'
    ])
    expect(describeNodeEffects({ traitCounters: { fanoutQueries: 5 } })).toEqual([
      '⋔ scatter/gather'
    ])
    expect(describeNodeEffects({ traitCounters: { idempotencyDuplicateHits: 4 } })).toEqual([
      '⊘ 4 dupes blocked'
    ])
  })

  it('returns nothing when no defining effect fired, and caps at three', () => {
    expect(describeNodeEffects({})).toEqual([])
    expect(describeNodeEffects({ traitCounters: { rateRejected: 10 } })).toEqual([]) // drops shown elsewhere
    const many = describeNodeEffects({
      cacheHits: 1,
      cacheHitRatio: 50,
      traitCounters: {
        retryAttempts: 2,
        replicationQuorumWrites: 1,
        fanoutQueries: 1,
        idempotencyDuplicateHits: 1
      }
    })
    expect(many).toHaveLength(3)
    expect(many[0]).toBe('⚡ cache 50%')
  })
})
