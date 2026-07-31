import { describe, expect, it } from 'vitest'
import { buildLatencyLensCard, getIdentityChip, getLensCard } from './nodePresentation'

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
})
