import { describe, expect, it } from 'vitest'
import type { RequestSpan } from './core/events'
import type { NodeState } from './core/types'
import type { CompletedRequest } from './metrics'
import { MetricsCollector } from './metrics'

function makeSpan(
  nodeId: string,
  arrivalTimeUs: bigint,
  queueWaitUs: bigint,
  serviceTimeUs: bigint
): RequestSpan {
  return {
    nodeId,
    arrivalTime: arrivalTimeUs,
    queueWait: queueWaitUs,
    serviceTime: serviceTimeUs,
    departureTime: arrivalTimeUs + queueWaitUs + serviceTimeUs
  }
}

function makeRequest(overrides: Partial<CompletedRequest> = {}): CompletedRequest {
  const createdAt = overrides.createdAt ?? 0n
  return {
    id: overrides.id ?? 'req-1',
    status: overrides.status ?? 'success',
    totalLatency: overrides.totalLatency ?? 0,
    path: overrides.path ?? [],
    spans: overrides.spans ?? [],
    createdAt,
    completedAt: overrides.completedAt ?? createdAt + 1_000n
  }
}

function makeSnapshot(overrides: Partial<NodeState> = {}): NodeState {
  return {
    id: overrides.id ?? 'node-a',
    status: overrides.status ?? 'idle',
    activeWorkers: overrides.activeWorkers ?? 0,
    queueLength: overrides.queueLength ?? 0,
    utilization: overrides.utilization ?? 0,
    totalInSystem: overrides.totalInSystem ?? 0
  }
}

describe('MetricsCollector', () => {
  it('computes warmup-filtered latency percentiles and throughput', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    metrics.recordRequest(
      makeRequest({ id: 'pre', createdAt: 50_000n, totalLatency: 999, status: 'success' })
    )
    metrics.recordRequest(
      makeRequest({ id: 'r1', createdAt: 150_000n, totalLatency: 300, status: 'success' })
    )
    metrics.recordRequest(
      makeRequest({ id: 'r2', createdAt: 200_000n, totalLatency: 100, status: 'success' })
    )
    metrics.recordRequest(
      makeRequest({ id: 'r3', createdAt: 250_000n, totalLatency: 400, status: 'success' })
    )
    metrics.recordRequest(
      makeRequest({ id: 'r4', createdAt: 300_000n, totalLatency: 200, status: 'success' })
    )

    const latency = metrics.getLatencyPercentiles()
    expect(latency).toEqual({
      p50: 200,
      p90: 300,
      p95: 300,
      p99: 300,
      min: 100,
      max: 400,
      mean: 250
    })

    const summary = metrics.generateSummary(1_000)
    expect(summary.totalRequests).toBe(5)
    expect(summary.successfulRequests).toBe(5)
    expect(summary.throughput).toBeCloseTo(4 / 0.9, 8)
  })

  it('tracks per-node arrivals and warmup gating for rejections/timeouts', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    metrics.recordRequest(
      makeRequest({
        id: 'success-post',
        status: 'success',
        createdAt: 150_000n,
        totalLatency: 5,
        spans: [makeSpan('node-a', 150_000n, 2_000n, 3_000n)]
      })
    )
    metrics.recordRequest(
      makeRequest({
        id: 'success-pre',
        status: 'success',
        createdAt: 50_000n,
        totalLatency: 2,
        spans: [makeSpan('node-a', 50_000n, 1_000n, 1_000n)]
      })
    )

    metrics.recordRejection('node-a', 'capacity', {
      requestCreatedAt: 150_000n,
      nodeArrivalTime: 150_000n
    })
    metrics.recordTimeout('req-timeout', 'node-a', {
      requestCreatedAt: 50_000n,
      nodeArrivalTime: 50_000n
    })
    metrics.recordNodeSnapshot(
      'node-a',
      makeSnapshot({ queueLength: 2, totalInSystem: 3, utilization: 0.4 }),
      0n
    )
    metrics.recordNodeSnapshot(
      'node-a',
      makeSnapshot({ queueLength: 4, totalInSystem: 1, utilization: 1.2 }),
      10_000n
    )

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    expect(perNode).toMatchObject({
      totalArrived: 4,
      postWarmupArrived: 2,
      totalProcessed: 2,
      totalRejected: 1,
      totalTimedOut: 1,
      avgQueueLength: 3,
      avgQueueWait: 1.5,
      avgServiceTime: 2,
      avgTimeInSystem: 3.5,
      avgInSystem: 2,
      utilization: 0.7,
      throughput: 1 / 0.9,
      errorRate: 0.5,
      availability: 0.5,
      latencyP99: 2
    })

    const summary = metrics.generateSummary(1_000)
    expect(summary.postWarmupTotalRequests).toBe(2)
    expect(summary.errorRate).toBe(0.5)
  })

  it('uses requestCreatedAt for summary gating and nodeArrivalTime for per-node post-warmup gating', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    metrics.recordRejection('node-a', 'node_error_rate', {
      requestCreatedAt: 50_000n,
      nodeArrivalTime: 90_000n
    })
    metrics.recordTimeout('req-timeout', 'node-a', {
      requestCreatedAt: 50_000n,
      nodeArrivalTime: 90_000n
    })

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    expect(perNode?.totalArrived).toBe(2)
    expect(perNode?.postWarmupArrived).toBe(0)
    expect(perNode?.postWarmupRejected).toBe(0)
    expect(perNode?.postWarmupTimedOut).toBe(0)

    const summary = metrics.generateSummary(1_000)
    expect(summary.totalRequests).toBe(2)
    expect(summary.postWarmupTotalRequests).toBe(0)
  })

  it('does not count edge-observed failures as node arrivals', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    metrics.recordRejection('node-a', 'edge_error_rate', {
      requestCreatedAt: 150_000n,
      observationPoint: 'edge'
    })
    metrics.recordTimeout('req-timeout', 'node-a', {
      requestCreatedAt: 150_000n,
      observationPoint: 'edge'
    })

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeUndefined()

    const summary = metrics.generateSummary(1_000)
    expect(summary.totalRequests).toBe(2)
    expect(summary.postWarmupTotalRequests).toBe(2)
    expect(summary.failedRequests).toBe(2)
    expect(summary.rejectedRequests).toBe(1)
    expect(summary.timedOutRequests).toBe(1)
  })

  it('counts post-warmup arrivals when only path data is available', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })
    metrics.recordRequest(
      makeRequest({
        id: 'path-only',
        status: 'error',
        createdAt: 200_000n,
        path: ['node-a'],
        spans: []
      })
    )

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    expect(perNode?.totalArrived).toBe(1)
    expect(perNode?.postWarmupArrived).toBe(1)
  })

  it('tracks cache hit and miss counters per node', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    metrics.recordNodeTraitCounters('cache-a', { cacheHits: 8, cacheMisses: 2 })

    const perNode = metrics.getPerNodeMetrics(1_000).get('cache-a')
    expect(perNode).toBeDefined()
    expect(perNode?.cacheHits).toBe(8)
    expect(perNode?.cacheMisses).toBe(2)
    expect(perNode?.cacheHitRatio).toBe(0.8)
  })

  it('keeps rejections distinguishable by reason instead of collapsing them into one count', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    metrics.recordRejection('gw', 'rate_limited', { requestCreatedAt: 0n, nodeArrivalTime: 0n })
    metrics.recordRejection('gw', 'rate_limited', { requestCreatedAt: 0n, nodeArrivalTime: 0n })
    metrics.recordRejection('gw', 'capacity_exceeded', {
      requestCreatedAt: 0n,
      nodeArrivalTime: 0n
    })

    const perNode = metrics.getPerNodeMetrics(1_000).get('gw')
    expect(perNode?.totalRejected).toBe(3)
    expect(perNode?.rejectionsByReason).toEqual({ rate_limited: 2, capacity_exceeded: 1 })
  })

  it('records any trait-reported counter generically, not just cache', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    metrics.recordNodeTraitCounters('gw', { tokensExhausted: 1 })
    metrics.recordNodeTraitCounters('gw', { tokensExhausted: 1 })

    const perNode = metrics.getPerNodeMetrics(1_000).get('gw')
    expect(perNode?.traitCounters).toEqual({ tokensExhausted: 2 })
  })

  it('postWarmupAvgInSystem only integrates snapshots after warmup', () => {
    // warmupDuration = 100ms = 100_000µs
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    // Pre-warmup snapshot (t = 50ms): totalInSystem = 10 — should NOT count
    metrics.recordNodeSnapshot(
      'node-a',
      makeSnapshot({ totalInSystem: 10 }),
      50_000n // 50ms in µs
    )
    // Post-warmup snapshot (t = 150ms): totalInSystem = 2 — should count
    metrics.recordNodeSnapshot(
      'node-a',
      makeSnapshot({ totalInSystem: 2 }),
      150_000n // 150ms in µs
    )
    // Post-warmup snapshot (t = 200ms): totalInSystem = 4 — should count
    metrics.recordNodeSnapshot(
      'node-a',
      makeSnapshot({ totalInSystem: 4 }),
      200_000n // 200ms in µs
    )

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    // all-time avgInSystem = (10 + 2 + 4) / 3 = 5.333…
    expect(perNode?.avgInSystem).toBeCloseTo(16 / 3, 5)
    // post-warmup avgInSystem = (2 + 4) / 2 = 3
    expect(perNode?.postWarmupAvgInSystem).toBeCloseTo(3, 5)
  })

  it('postWarmupAvgTimeInSystem uses only post-warmup request spans', () => {
    // warmupDuration = 100ms = 100_000µs
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    // Pre-warmup request: queueWait=10ms, serviceTime=20ms → total=30ms — should NOT count in PW W
    metrics.recordRequest(
      makeRequest({
        id: 'pre-warmup',
        status: 'success',
        createdAt: 50_000n,
        totalLatency: 30,
        spans: [makeSpan('node-a', 50_000n, 10_000n, 20_000n)]
      })
    )
    // Post-warmup request: queueWait=2ms, serviceTime=3ms → total=5ms — should count
    metrics.recordRequest(
      makeRequest({
        id: 'post-warmup',
        status: 'success',
        createdAt: 150_000n,
        totalLatency: 5,
        spans: [makeSpan('node-a', 150_000n, 2_000n, 3_000n)]
      })
    )

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    // all-time avgTimeInSystem = (30 + 5) / 2 = 17.5ms
    expect(perNode?.avgTimeInSystem).toBeCloseTo(17.5, 5)
    // post-warmup avgTimeInSystem = 5ms (only the post-warmup request)
    expect(perNode?.postWarmupAvgTimeInSystem).toBeCloseTo(5, 5)
  })

  it('provides latencyP50 and latencyP95 per node', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    for (let i = 1; i <= 10; i++) {
      metrics.recordRequest(
        makeRequest({
          id: `r${i}`,
          status: 'success',
          createdAt: BigInt(i) * 10_000n,
          totalLatency: i * 10,
          spans: [makeSpan('node-a', BigInt(i) * 10_000n, 0n, BigInt(i) * 10_000n)]
        })
      )
    }

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    // sorted latencies: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    // p50 → index floor(0.5*9) = 4 → 50ms
    expect(perNode?.latencyP50).toBe(50)
    // p95 → index floor(0.95*9) = 8 → 90ms
    expect(perNode?.latencyP95).toBe(90)
    // p99 → index floor(0.99*9) = 8 → 90ms
    expect(perNode?.latencyP99).toBe(90)
  })
})
