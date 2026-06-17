import { describe, expect, it } from 'vitest'
import type { RequestSpan } from './core/events'
import { RequestTracer } from './tracer'

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

describe('RequestTracer', () => {
  it('keeps sampling decisions deterministic for the same request id', () => {
    const tracer = new RequestTracer({ sampleRate: 0.5 })
    const first = tracer.shouldTrace('req-deterministic')

    for (let i = 0; i < 10; i++) {
      expect(tracer.shouldTrace('req-deterministic')).toBe(first)
    }

    const otherTracer = new RequestTracer({ sampleRate: 0.5 })
    expect(otherTracer.shouldTrace('req-deterministic')).toBe(first)
  })

  it('does not emit traces for unsampled requests', () => {
    const tracer = new RequestTracer({ sampleRate: 0 })
    tracer.recordSpan('req-never-sampled', makeSpan('node-a', 0n, 1_000n, 2_000n))
    tracer.markStatus('req-never-sampled', 'timeout')

    expect(tracer.getTraces()).toEqual([])
  })

  it('can force tracing for a specific request regardless of sample rate', () => {
    const tracer = new RequestTracer({ sampleRate: 0 })

    tracer.forceTrace('req-forced')
    tracer.setRequestCreatedAt('req-forced', 0n)
    tracer.recordSpan('req-forced', makeSpan('node-a', 0n, 1_000n, 2_000n))
    tracer.markStatus('req-forced', 'success')

    const traces = tracer.getTraces()
    expect(traces).toHaveLength(1)
    expect(traces[0].requestId).toBe('req-forced')
  })

  it('calculates edge latency and total latency for sequential spans', () => {
    const tracer = new RequestTracer({ sampleRate: 1 })

    tracer.setRequestCreatedAt('req-sequential', 1_000n)
    tracer.recordSpan('req-sequential', makeSpan('node-a', 2_000n, 1_000n, 2_000n))
    tracer.recordSpan('req-sequential', makeSpan('node-b', 6_000n, 500n, 1_000n))

    const traces = tracer.getTraces()
    expect(traces).toHaveLength(1)
    expect(traces[0].spans.map((s) => s.edgeLatency)).toEqual([1, 1])
    expect(traces[0].totalLatency).toBeCloseTo(6.5, 8)
  })

  it('uses max span end for total latency when spans overlap', () => {
    const tracer = new RequestTracer({ sampleRate: 1 })

    tracer.setRequestCreatedAt('req-overlap', 0n)
    tracer.recordSpan('req-overlap', makeSpan('node-a', 0n, 0n, 10_000n))
    tracer.recordSpan('req-overlap', makeSpan('node-b', 2_000n, 0n, 1_000n))
    tracer.recordSpan('req-overlap', makeSpan('node-c', 12_000n, 0n, 1_000n))

    const traces = tracer.getTraces()
    expect(traces).toHaveLength(1)
    expect(traces[0].spans.map((s) => s.edgeLatency)).toEqual([0, 0, 2])
    expect(traces[0].totalLatency).toBe(13)
  })
})
