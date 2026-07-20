import { describe, expect, it } from 'vitest'
import { buildLatencyLensCard } from './nodePresentation'

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
