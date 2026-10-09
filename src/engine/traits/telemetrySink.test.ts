import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine'
import { testEdge, testNode, testTopology } from '../__tests__/traitTestTopology'

// 200 rps into a service that writes a log line per request to a collector
// with one worker at 20 ms (50 events/s) and room for 4 events.
function run(collectorConfig: Record<string, unknown>) {
  const topology = testTopology(
    [
      testNode('svc', 'microservice', 5),
      testNode('db', 'relational-db', 5),
      testNode('logs', 'centralized-logging', 20, {
        queue: { workers: 1, capacity: 4, discipline: 'fifo' },
        config: collectorConfig
      } as never)
    ],
    [testEdge('src', 'svc'), testEdge('svc', 'db'), testEdge('svc', 'logs')],
    200,
    3000
  )
  return new SimulationEngine(topology).run()
}

describe('telemetrySink trait', () => {
  it('off: a full collector rejects events and they count as failed requests', () => {
    const out = run({})
    expect(out.perNode.logs.rejectionsByReason.capacity_exceeded).toBe(446)
    expect(out.summary.failedRequests).toBe(446)
  })

  it('fire-and-forget: the same overload drops events, measured, with no failed requests', () => {
    const out = run({ telemetryAsyncIngest: true })
    const logs = out.perNode.logs
    expect(out.summary.failedRequests).toBe(0)
    expect(logs.traitCounters.telemetryDropped).toBe(446)
    expect(logs.traitCounters.telemetryDroppedBufferFull).toBe(446)
    expect(logs.traitCounters.telemetryIngested).toBe(153)
    // Dropped events are not work the collector did.
    expect(logs.postWarmupProcessed).toBe(149)
  })

  it('an ingest ceiling drops the excess; sampling keeps unexported events off the collector', () => {
    const ceiling = run({ telemetryAsyncIngest: true, telemetryIngestRps: 30 })
    expect(ceiling.perNode.logs.traitCounters.telemetryDroppedOverIngest).toBeGreaterThan(450)
    expect(ceiling.perNode.logs.utilization).toBeLessThan(0.3)

    const sampled = run({ telemetryAsyncIngest: true, telemetrySampleRate: 0.2 })
    const counters = sampled.perNode.logs.traitCounters
    expect(counters.telemetrySampledOut).toBe(471)
    expect(counters.telemetryOffered).toBe(128)
    expect(counters.telemetryDropped).toBe(2)
  })
})
