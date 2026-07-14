import { describe, expect, it } from 'vitest'
import type { RequestSpan } from '../core/events'
import type { GlobalConfig } from '../core/types'
import {
  createEmptyEventCounts,
  type CanonicalEventRecord,
  type DebugEvent,
  type RequestLifecycle
} from '../core/event-stream'
import type { CompletedRequest } from '../metrics'
import { MetricsCollector } from '../metrics'
import { RequestTracer } from '../tracer'
import { generateSimulationOutput } from './output'

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

function makeCompletedRequest(overrides: Partial<CompletedRequest> = {}): CompletedRequest {
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

describe('generateSimulationOutput', () => {
  it("computes Little's Law output using post-warmup window for a simple synthetic node", () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })
    const tracer = new RequestTracer({ sampleRate: 0 })

    metrics.recordNodeArrival('node-a', 0n)
    metrics.recordRequest(
      makeCompletedRequest({
        id: 'req-little',
        status: 'success',
        createdAt: 0n,
        totalLatency: 5,
        spans: [makeSpan('node-a', 0n, 2_000n, 3_000n)]
      })
    )
    metrics.recordNodeSnapshot(
      'node-a',
      {
        id: 'node-a',
        status: 'idle',
        activeWorkers: 1,
        queueLength: 0,
        utilization: 0.2,
        totalInSystem: 0.005
      },
      0n
    )

    const config: GlobalConfig = {
      simulationDuration: 1_000,
      seed: 'test-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000
    }

    const output = generateSimulationOutput(metrics, tracer, [], null, [], config, 1)
    const little = output.littlesLawCheck.find((entry) => entry.nodeId === 'node-a')

    expect(little).toBeDefined()
    expect(little?.expectedL).toBeCloseTo(0.005, 8)
    expect(little?.observedL).toBeCloseTo(0.005, 8)
    expect(little?.withinTolerance).toBe(true)
    expect(little?.lambda).toBeGreaterThan(0)
    expect(little?.wSeconds).toBeGreaterThanOrEqual(0)
  })

  it('exposes simulationDuration and warmupDuration on the output', () => {
    const metrics = new MetricsCollector({ warmupDuration: 5_000 })
    const tracer = new RequestTracer({ sampleRate: 0 })

    const config: GlobalConfig = {
      simulationDuration: 60_000,
      seed: 'test-seed',
      warmupDuration: 5_000,
      timeResolution: 'millisecond',
      defaultTimeout: 5_000
    }

    const output = generateSimulationOutput(metrics, tracer, [], null, [], config, 0)
    expect(output.simulationDuration).toBe(60_000)
    expect(output.warmupDuration).toBe(5_000)
    expect(output.eventLog).toBeNull()
    expect(output.debuggedLifecycle).toBeNull()
  })

  it('passes through debug output payload when provided', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })
    const tracer = new RequestTracer({ sampleRate: 0 })

    const config: GlobalConfig = {
      simulationDuration: 1_000,
      seed: 'debug-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000
    }

    const eventLog: DebugEvent[] = [
      {
        sequence: 0,
        timestampUs: '0',
        timestampMs: 0,
        type: 'request-generated',
        nodeId: 'source',
        requestId: 'req-1',
        status: 'info',
        message: 'request req-1 generated at source',
        priority: 1,
        payload: {}
      }
    ]
    const lifecycle: RequestLifecycle = {
      requestId: 'req-1',
      status: 'success',
      events: eventLog,
      path: ['source'],
      startedAtMs: 0,
      completedAtMs: 0
    }

    const output = generateSimulationOutput(
      metrics,
      tracer,
      [],
      null,
      [],
      config,
      0,
      [],
      createEmptyEventCounts(),
      {
        eventLog,
        debuggedLifecycle: lifecycle
      }
    )

    expect(output.eventLog).toEqual(eventLog)
    expect(output.debuggedLifecycle).toEqual(lifecycle)
  })

  it('stores canonical event stream and event counts on the output', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })
    const tracer = new RequestTracer({ sampleRate: 0 })
    const config: GlobalConfig = {
      simulationDuration: 1_000,
      seed: 'test-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000
    }
    const eventStream: CanonicalEventRecord[] = [
      {
        sequence: 0,
        timestampUs: '0',
        type: 'request-generated',
        priority: 1,
        requestId: 'req-1',
        payload: {}
      }
    ]
    const eventCountsByType = createEmptyEventCounts()
    eventCountsByType['request-generated'] = 1

    const output = generateSimulationOutput(
      metrics,
      tracer,
      [],
      null,
      [],
      config,
      1,
      eventStream,
      eventCountsByType
    )

    expect(output.eventStream).toEqual(eventStream)
    expect(output.eventCountsByType['request-generated']).toBe(1)
  })

  it('conservation check flags nodes with large in-flight counts', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0 })
    const tracer = new RequestTracer({ sampleRate: 0 })

    // 100 arrived, 80 processed, 5 rejected, 5 timed out → 10 in-flight (10% > 5% threshold)
    for (let i = 0; i < 80; i++) {
      const ts = BigInt(i) * 1_000n
      metrics.recordNodeArrival('node-x', ts)
      metrics.recordRequest(
        makeCompletedRequest({
          id: `ok-${i}`,
          status: 'success',
          createdAt: ts,
          spans: [makeSpan('node-x', ts, 0n, 1_000n)]
        })
      )
    }
    for (let i = 0; i < 5; i++) {
      const ts = BigInt(i) * 1_000n
      metrics.recordNodeArrival('node-x', ts)
      metrics.recordRejection('node-x', 'capacity', {
        requestCreatedAt: ts,
        nodeArrivalTime: ts
      })
    }
    for (let i = 0; i < 5; i++) {
      const ts = BigInt(i) * 1_000n
      metrics.recordNodeArrival('node-x', ts)
      metrics.recordTimeout(`t-${i}`, 'node-x', {
        requestCreatedAt: ts,
        nodeArrivalTime: ts
      })
    }
    // 10 more arrivals that were never completed (in-flight)
    for (let i = 0; i < 10; i++) {
      metrics.recordNodeArrival('node-x', BigInt(i) * 1_000n)
    }

    const config: GlobalConfig = {
      simulationDuration: 1_000,
      seed: 'x',
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1_000
    }

    const output = generateSimulationOutput(metrics, tracer, [], null, [], config, 0)
    const cons = output.conservationCheck.find((c) => c.nodeId === 'node-x')
    expect(cons).toBeDefined()
    expect(cons?.inFlight).toBeGreaterThan(0)
    expect(cons?.balanced).toBe(false)
  })

  it('warmupAdequacy flags short warmup relative to p99', () => {
    const metrics = new MetricsCollector({ warmupDuration: 100 })
    const tracer = new RequestTracer({ sampleRate: 0 })

    // One post-warmup request with 200ms latency → recommendedWarmup = 10×200 = 2000ms
    metrics.recordNodeArrival('node-a', 200_000n)
    metrics.recordRequest(
      makeCompletedRequest({
        id: 'req-1',
        status: 'success',
        createdAt: 200_000n, // post-warmup
        totalLatency: 200,
        spans: [makeSpan('node-a', 200_000n, 100_000n, 100_000n)]
      })
    )

    const config: GlobalConfig = {
      simulationDuration: 10_000,
      seed: 'x',
      warmupDuration: 100,
      timeResolution: 'millisecond',
      defaultTimeout: 5_000
    }

    const output = generateSimulationOutput(metrics, tracer, [], null, [], config, 1)
    expect(output.warmupAdequacy.adequate).toBe(false)
    expect(output.warmupAdequacy.recommendedWarmupMs).toBe(2000)
  })
})
