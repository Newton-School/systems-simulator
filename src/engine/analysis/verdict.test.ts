import { describe, expect, it } from 'vitest'
import type { RequestSpan } from '../core/events'
import type { GlobalConfig } from '../core/types'
import type { CompletedRequest } from '../metrics'
import { MetricsCollector } from '../metrics'
import { RequestTracer } from '../tracer'
import { generateSimulationOutput } from './output'
import { SIMULATION_VERDICT_VERSION, projectToVerdict } from './verdict'

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

describe('projectToVerdict', () => {
  it('projects a grading-safe subset of SimulationOutput', () => {
    const metrics = new MetricsCollector({ warmupDuration: 0, nodes: [{ id: 'node-a', label: 'API' }] })
    const tracer = new RequestTracer({ sampleRate: 0 })

    metrics.recordNodeArrival('node-a', 0n)
    metrics.recordRequest(
      makeCompletedRequest({
        id: 'req-1',
        status: 'success',
        createdAt: 0n,
        totalLatency: 5,
        spans: [makeSpan('node-a', 0n, 2_000n, 3_000n)]
      })
    )

    const config: GlobalConfig = {
      simulationDuration: 1_000,
      seed: 'verdict-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000
    }

    const output = generateSimulationOutput(
      metrics,
      tracer,
      [],
      null,
      [
        {
          invariantId: 'inv-1',
          invariantName: 'No drops',
          violatedAt: 123,
          details: 'Dropped packets detected.',
          rootCause: 'edge-failure',
          affectedComponents: ['edge-a']
        }
      ],
      config,
      12
    )

    output.sloBreaches.push({
      nodeId: 'node-a',
      nodeLabel: 'API',
      metric: 'latencyP99',
      target: 10,
      actual: 12,
      severity: 'warning'
    })

    const verdict = projectToVerdict(output)

    expect(verdict.version).toBe(SIMULATION_VERDICT_VERSION)
    expect(verdict.meta).toEqual({
      seed: 'verdict-seed',
      simulationDurationMs: 1_000,
      warmupDurationMs: 0,
      eventsProcessed: 12,
      reproducible: true
    })
    expect(verdict.summary.totalRequests).toBe(output.summary.totalRequests)
    expect(verdict.summary.postWarmupTotalRequests).toBe(output.summary.postWarmupTotalRequests)
    expect(verdict.summary.latency.mean).toBe(output.summary.latency.mean)
    expect(verdict.perNode['node-a']).toMatchObject({
      nodeLabel: 'API',
      totalArrived: 1,
      totalProcessed: 1,
      totalRejected: 0,
      totalTimedOut: 0,
      totalConnectionReset: 0
    })
    expect(verdict.sloTargetCount).toBe(output.sloTargetCount)
    expect(verdict.sloBreaches).toEqual(output.sloBreaches)
    expect(verdict.invariantViolations).toEqual(output.invariantViolations)
    expect(verdict.conservation).toEqual([
      {
        nodeId: 'node-a',
        nodeLabel: 'API',
        arrived: 1,
        processed: 1,
        rejected: 0,
        timedOut: 0,
        connectionReset: 0,
        inFlight: 0,
        balanced: true
      }
    ])
    expect(verdict.littlesLaw).toEqual(
      output.littlesLawCheck.map((check) => ({
        nodeId: check.nodeId,
        observedL: check.observedL,
        expectedL: check.expectedL,
        error: check.error,
        withinTolerance: check.withinTolerance,
        lambda: check.lambda,
        wSeconds: check.wSeconds
      }))
    )
  })
})
