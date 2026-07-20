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
  const totalLatency = overrides.totalLatency ?? 0
  return {
    id: overrides.id ?? 'req-1',
    status: overrides.status ?? 'success',
    totalLatency,
    path: overrides.path ?? [],
    spans: overrides.spans ?? [],
    createdAt,
    // Keep completedAt consistent with totalLatency so the windowed aggregator
    // (which derives latency from completedAt − createdAt) sees the same value.
    completedAt: overrides.completedAt ?? createdAt + BigInt(Math.round(totalLatency * 1000))
  }
}

/** Assert a nullable ms percentile is within 1% of the exact array value. */
function expectWithin1Pct(actual: number | null, expected: number): void {
  expect(actual).not.toBeNull()
  expect(Math.abs((actual as number) - expected) / expected).toBeLessThanOrEqual(0.01)
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

    // Created and terminated during warmup (50ms → 90ms, warmup is 100ms) → excluded.
    metrics.recordRequest(
      makeRequest({ id: 'pre', createdAt: 50_000n, totalLatency: 40, status: 'success' })
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

    // Sourced from the windowed HDR aggregator (≤1% bucket error), gated on the
    // post-warmup requests: latencies 300, 100, 400, 200 ms.
    const latency = metrics.getLatencyPercentiles()
    expectWithin1Pct(latency.p50, 200)
    expectWithin1Pct(latency.p90, 300)
    expectWithin1Pct(latency.p95, 300)
    expectWithin1Pct(latency.p99, 300)
    expectWithin1Pct(latency.min, 100)
    expectWithin1Pct(latency.max, 400)
    // Mean is an exact integer-µs computation.
    expect(latency.mean).toBeCloseTo(250, 6)

    const summary = metrics.generateSummary(1_000)
    expect(summary.totalRequests).toBe(5)
    expect(summary.successfulRequests).toBe(5)
    expect(summary.throughput).toBeCloseTo(4 / 0.9, 8)
  })

  it('returns null latency percentiles when there are no successful samples (never 0)', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })
    metrics.recordTimeout('r1', 'node-a', {
      requestCreatedAt: 0n,
      terminationTimeUs: 250_000n
    })

    const latency = metrics.getLatencyPercentiles()
    expect(latency.p50).toBeNull()
    expect(latency.p90).toBeNull()
    expect(latency.p99).toBeNull()
    expect(latency.min).toBeNull()
    expect(latency.max).toBeNull()
    expect(latency.mean).toBeNull()

    // The summary carries the same null latency through — the API/UI shows N/A.
    expect(metrics.generateSummary(1_000).latency.p50).toBeNull()
  })

  it('keeps time-to-error split by closed cause instead of blending failures', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    // A full queue (overload) and a dead node are different causes — this is the
    // dead-vs-overloaded discriminator, previously blended into one "rejected".
    metrics.recordRejection('node-a', 'capacity_exceeded', {
      requestCreatedAt: 0n,
      nodeArrivalTime: 0n,
      terminationTimeUs: 48_000n
    })
    metrics.recordRejection('node-a', 'node_failed', {
      requestCreatedAt: 5_000n,
      nodeArrivalTime: 5_000n,
      terminationTimeUs: 14_000n
    })
    // An edge drop must not masquerade as a node rejection.
    metrics.recordRejection('node-a', 'edge_error_rate', {
      requestCreatedAt: 8_000n,
      nodeArrivalTime: 8_000n,
      observationPoint: 'edge',
      terminationTimeUs: 12_000n
    })
    // A policy refusal stays in the residual "rejected" bucket.
    metrics.recordRejection('node-a', 'rate_limited', {
      requestCreatedAt: 9_000n,
      nodeArrivalTime: 9_000n,
      terminationTimeUs: 11_000n
    })
    metrics.recordTimeout('t1', 'node-a', {
      requestCreatedAt: 10_000n,
      nodeArrivalTime: 10_000n,
      terminationTimeUs: 260_000n
    })
    metrics.recordConnectionReset('r1', 'node-a', {
      requestCreatedAt: 20_000n,
      nodeArrivalTime: 20_000n,
      terminationTimeUs: 720_000n
    })

    const summary = metrics.generateSummary(1_000)
    const tte = summary.timeToErrorByCause
    expect(tte.queue_full.count).toBe(1)
    expect(tte.node_failed.count).toBe(1)
    expect(tte.network_error.count).toBe(1)
    expect(tte.rejected.count).toBe(1)
    expect(tte.timeout.count).toBe(1)
    expect(tte.connection_reset.count).toBe(1)
    expect(tte.node_failed.shareOfErrors).toBeCloseTo(1 / 6, 8)
    expect(summary.successLatencySamples).toBe(0)
    expect(summary.timeToErrorSamples).toBe(6)
    expect(summary.latencyWindowErrorRate).toBe(1)
    // Each cause reports its own distinct time-to-error, never blended.
    expectWithin1Pct(tte.queue_full.p50, 48)
    expectWithin1Pct(tte.node_failed.p50, 9)
    expectWithin1Pct(tte.timeout.p95, 250)
    expectWithin1Pct(tte.connection_reset.p99, 700)
  })

  it('scopes latency and time-to-error per node via that node’s own aggregator', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    // node-a serves a request (node-local 10ms) then it continues and completes.
    metrics.recordRequest(
      makeRequest({
        id: 'ok',
        status: 'success',
        createdAt: 0n,
        totalLatency: 300, // end-to-end dominated by the edge
        spans: [makeSpan('node-a', 5_000n, 2_000n, 8_000n)] // node-local 10ms
      })
    )
    // node-b is dead: it kills a request with node_failed, node-local 9ms.
    metrics.recordRejection('node-b', 'node_failed', {
      requestCreatedAt: 0n,
      nodeArrivalTime: 291_000n,
      terminationTimeUs: 300_000n,
      locus: 'node-b',
      locusKind: 'node'
    })

    const perNode = metrics.getPerNodeMetrics(1_000)
    const a = perNode.get('node-a')!
    const b = perNode.get('node-b')!

    // node-a's badge reads its OWN node-local latency (~10ms), not the 300ms E2E.
    expectWithin1Pct(a.latencyNodeLocal.p50, 10)
    expect(a.successLatencySamples).toBe(1)
    expect(a.timeToErrorSamples).toBe(0)
    expect(a.latencyWindowErrorRate).toBe(0)
    // node-a saw no failures.
    expect(a.timeToErrorByCause.node_failed.count).toBe(0)

    // node-b has no successful passes → N/A latency, and its failure is scoped here.
    expect(b.latencyNodeLocal.p50).toBeNull()
    expect(b.successLatencySamples).toBe(0)
    expect(b.timeToErrorSamples).toBe(1)
    expect(b.latencyWindowErrorRate).toBe(1)
    expect(b.timeToErrorByCause.node_failed.count).toBe(1)
    expectWithin1Pct(b.timeToErrorByCause.node_failed.p50, 9) // node-local time-to-error
  })

  it('groups failures by terminating component (node vs edge) and reconciles with the error total', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    // Two nodes and one edge terminate requests with distinct causes.
    metrics.recordRejection('api', 'node_failed', {
      requestCreatedAt: 0n,
      terminationTimeUs: 5_000n,
      locus: 'api',
      locusKind: 'node'
    })
    metrics.recordRejection('api', 'node_failed', {
      requestCreatedAt: 1_000n,
      terminationTimeUs: 6_000n,
      locus: 'api',
      locusKind: 'node'
    })
    metrics.recordRejection('api', 'edge_error_rate', {
      requestCreatedAt: 2_000n,
      terminationTimeUs: 7_000n,
      observationPoint: 'edge',
      locus: 'client-to-api',
      locusKind: 'edge'
    })
    metrics.recordConnectionReset('r1', 'db', {
      requestCreatedAt: 3_000n,
      terminationTimeUs: 8_000n,
      locus: 'db',
      locusKind: 'node'
    })

    const summary = metrics.generateSummary(1_000)
    const pareto = summary.failuresByLocus

    // Bottleneck-first: the api node killed the most (2).
    expect(pareto[0]).toMatchObject({
      locus: 'api',
      locusKind: 'node',
      total: 2,
      dominantCause: 'node_failed'
    })
    // The edge drop is attributed to the edge, not the node it was heading to.
    const edge = pareto.find((p) => p.locusKind === 'edge')
    expect(edge?.locus).toBe('client-to-api')
    expect(edge?.byCause.network_error).toBe(1)

    // The Pareto reconciles exactly with the time-to-error population.
    const paretoTotal = pareto.reduce((sum, p) => sum + p.total, 0)
    expect(paretoTotal).toBe(summary.timeToErrorSamples)
    expect(paretoTotal).toBe(4)
  })

  it('tracks per-edge transit latency and edge-local time-to-error via the edge aggregator', () => {
    const metrics = new MetricsCollector({
      warmupDuration: 0,
      edges: [{ id: 'client-api', source: 'client', target: 'api' }]
    })

    metrics.recordEdgeTransit('client-api', 'client', 'api', 290_000n, 290_000n)
    metrics.recordRejection('api', 'edge_error_rate', {
      requestCreatedAt: 0n,
      observationPoint: 'edge',
      terminationTimeUs: 300_000n,
      edgeInTimeUs: 291_000n,
      edgeSourceNodeId: 'client',
      edgeTargetNodeId: 'api',
      locus: 'client-api',
      locusKind: 'edge'
    })

    const perEdge = metrics.getPerEdgeMetrics().get('client-api')
    expect(perEdge).toBeDefined()
    expect(perEdge?.edgeLabel).toBe('client→api')
    expect(perEdge?.sourceNodeId).toBe('client')
    expect(perEdge?.targetNodeId).toBe('api')
    expect(perEdge?.successLatencySamples).toBe(1)
    expect(perEdge?.timeToErrorSamples).toBe(1)
    expect(perEdge?.latencyWindowErrorRate).toBeCloseTo(0.5, 8)
    expectWithin1Pct(perEdge?.transitLatency.p50 ?? null, 290)
    expect(perEdge?.timeToErrorByCause.network_error.count).toBe(1)
    expectWithin1Pct(perEdge?.timeToErrorByCause.network_error.p50 ?? null, 9)
    expect(perEdge?.latencyWindows).toHaveLength(1)
    expect(perEdge?.latencyWindows[0]?.dominantErrorCause).toBe('network_error')
  })

  it('tracks per-node arrivals and warmup gating for rejections/timeouts', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    metrics.recordNodeArrival('node-a', 150_000n)
    metrics.recordRequest(
      makeRequest({
        id: 'success-post',
        status: 'success',
        createdAt: 150_000n,
        totalLatency: 5,
        spans: [makeSpan('node-a', 150_000n, 2_000n, 3_000n)]
      })
    )
    metrics.recordNodeArrival('node-a', 50_000n)
    metrics.recordRequest(
      makeRequest({
        id: 'success-pre',
        status: 'success',
        createdAt: 50_000n,
        totalLatency: 2,
        spans: [makeSpan('node-a', 50_000n, 1_000n, 1_000n)]
      })
    )

    metrics.recordNodeArrival('node-a', 150_000n)
    metrics.recordRejection('node-a', 'capacity', {
      requestCreatedAt: 150_000n,
      nodeArrivalTime: 150_000n
    })
    metrics.recordNodeArrival('node-a', 50_000n)
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
      // utilization now comes from the node's busy-area integral, not snapshots.
      throughput: 1 / 0.9,
      errorRate: 0.5,
      availability: 0.5
    })
    // Node-local latency is now post-warmup gated (via the node aggregator): the
    // pre-warmup 2ms span is excluded, leaving only the 5ms post-warmup pass.
    expect(perNode?.latencyP99).toBeGreaterThan(4.95)
    expect(perNode?.latencyP99).toBeLessThan(5.05)

    const summary = metrics.generateSummary(1_000)
    expect(summary.postWarmupTotalRequests).toBe(2)
    expect(summary.errorRate).toBe(0.5)
  })

  it('uses requestCreatedAt for summary gating and nodeArrivalTime for per-node post-warmup gating', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    metrics.recordNodeArrival('node-a', 90_000n)
    metrics.recordRejection('node-a', 'node_error_rate', {
      requestCreatedAt: 50_000n,
      nodeArrivalTime: 90_000n
    })
    metrics.recordNodeArrival('node-a', 90_000n)
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

  it('tracks node-local latency samples on the terminal window, not the arrival window', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    metrics.recordNodeArrival('node-a', 95_000n)
    metrics.recordRequest(
      makeRequest({
        id: 'crosses-warmup',
        status: 'success',
        createdAt: 95_000n,
        totalLatency: 15,
        spans: [makeSpan('node-a', 95_000n, 5_000n, 10_000n)]
      })
    )

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    // Arrival is pre-warmup, so the throughput/Little's-Law counters stay out.
    expect(perNode?.postWarmupArrived).toBe(0)
    expect(perNode?.postWarmupProcessed).toBe(0)
    // Departure is post-warmup, so the latency card's own histogram includes it.
    expect(perNode?.successLatencySamples).toBe(1)
    expect(perNode?.timeToErrorSamples).toBe(0)
    expect(perNode?.latencyWindowErrorRate).toBe(0)
    expectWithin1Pct(perNode!.latencyNodeLocal.p95, 15)
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

  it('counts in-flight arrivals directly from request-arrival events', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })
    metrics.recordNodeArrival('node-a', 200_000n)

    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(perNode).toBeDefined()
    expect(perNode?.totalArrived).toBe(1)
    expect(perNode?.postWarmupArrived).toBe(1)
  })

  it('reports offered vs delivered arrival CV from post-warmup inter-arrival gaps', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })

    for (const t of [100_000n, 110_000n, 120_000n, 130_000n]) {
      metrics.recordGeneratedRequest(t)
    }
    for (const t of [100_000n, 105_000n, 120_000n, 130_000n]) {
      metrics.recordNodeArrival('node-a', t)
    }

    const summary = metrics.generateSummary(1_000)
    const perNode = metrics.getPerNodeMetrics(1_000).get('node-a')

    expect(summary.offeredArrivalCV).not.toBeNull()
    expect(summary.offeredArrivalCV).toBeCloseTo(0, 10)
    expect(perNode?.arrivalCV).not.toBeNull()
    expect(perNode?.arrivalCV).toBeCloseTo(0.408248290463863, 10)
  })

  it('preserves upstream processed spans for edge-observed failures', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    metrics.recordNodeArrival('lb', 0n)
    metrics.recordRejection('dst', 'edge_error_rate', {
      requestCreatedAt: 0n,
      observationPoint: 'edge',
      completedSpans: [makeSpan('lb', 0n, 0n, 1_000n)]
    })

    const lb = metrics.getPerNodeMetrics(1_000).get('lb')
    expect(lb).toBeDefined()
    expect(lb).toMatchObject({
      totalArrived: 1,
      postWarmupArrived: 1,
      totalProcessed: 1,
      postWarmupProcessed: 1,
      totalRejected: 0,
      totalTimedOut: 0
    })
    expect(metrics.getPerNodeMetrics(1_000).get('dst')).toBeUndefined()
  })

  it('does not count the terminal node span as processed for node-observed failures', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })

    metrics.recordNodeArrival('node-a', 0n)
    metrics.recordRejection('node-a', 'node_error_rate', {
      requestCreatedAt: 0n,
      nodeArrivalTime: 0n,
      observationPoint: 'node',
      completedSpans: [makeSpan('node-a', 0n, 0n, 1_000n)]
    })

    const node = metrics.getPerNodeMetrics(1_000).get('node-a')
    expect(node).toBeDefined()
    expect(node).toMatchObject({
      totalArrived: 1,
      postWarmupArrived: 1,
      totalProcessed: 0,
      postWarmupProcessed: 0,
      totalRejected: 1,
      postWarmupRejected: 1
    })
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

    metrics.recordNodeArrival('gw', 0n)
    metrics.recordRejection('gw', 'rate_limited', { requestCreatedAt: 0n, nodeArrivalTime: 0n })
    metrics.recordNodeArrival('gw', 0n)
    metrics.recordRejection('gw', 'rate_limited', { requestCreatedAt: 0n, nodeArrivalTime: 0n })
    metrics.recordNodeArrival('gw', 0n)
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
    // sorted node-local latencies: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 ms.
    // Now sourced from the node's histogram aggregator (≤1% bucket error).
    expectWithin1Pct(perNode!.latencyP50, 50) // floor(0.5*9)=4 → 50ms
    expectWithin1Pct(perNode!.latencyP95, 90) // floor(0.95*9)=8 → 90ms
    expectWithin1Pct(perNode!.latencyP99, 90) // floor(0.99*9)=8 → 90ms

    // The node-local latency object carries the same values, null-capable.
    expectWithin1Pct(perNode!.latencyNodeLocal.p50, 50)
    expect(perNode!.latencyNodeLocal.p50).not.toBeNull()
  })
})
