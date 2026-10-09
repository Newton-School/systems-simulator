import { describe, expect, it } from 'vitest'
import { SimulationEngine } from './engine'
import type { ComponentNode, SimulationOutput, TopologyJSON } from './core/types'
import { classifyRejectionCause } from './metrics/windowedLatencyAggregator'
import { classifyRequestOutcome } from './core/requestOutcomeSemantics'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './traits/serviceTimeOverride'

function service(extra: Partial<ComponentNode>, workers: number, capacity: number): ComponentNode {
  return {
    id: 'svc',
    type: 'microservice',
    category: 'compute',
    label: 'svc',
    position: { x: 0, y: 0 },
    queue: { workers, capacity, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 10 }, timeout: 20_000 },
    ...extra
  }
}

function topology(
  node: ComponentNode,
  workload: Omit<NonNullable<TopologyJSON['workload']>, 'sourceNodeId'>,
  seed: string
): TopologyJSON {
  return {
    id: seed,
    name: seed,
    version: '1.0.0',
    global: {
      simulationDuration: 6_000,
      seed,
      warmupDuration: 500,
      timeResolution: 'microsecond',
      defaultTimeout: 20_000
    },
    nodes: [node],
    edges: [],
    workload: { sourceNodeId: 'svc', ...workload }
  }
}

function p99(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
}

function successLatencies(output: SimulationOutput, requestType?: string): number[] {
  return output.requestOutcomes
    .filter(
      (row) =>
        row.status === 'success' &&
        row.latencyMs !== null &&
        (requestType === undefined || row.requestType === requestType)
    )
    .map((row) => row.latencyMs as number)
}

// ── Bulkhead ─────────────────────────────────────────────────────────────────
// 8 workers. `read` is fast (10ms, ~1.6 workers of demand); `report` is slow
// (200ms, ~8 workers of demand on its own). FIFO with no bulkhead: reports fill
// every worker and the queue, and reads wait behind them.
function mixedService(bulkhead?: NonNullable<ComponentNode['resilience']>['bulkhead']) {
  return topology(
    service(bulkhead ? { resilience: { bulkhead } } : {}, 8, 400),
    {
      pattern: 'constant',
      baseRps: 200,
      requestDistribution: [
        { type: 'read', weight: 0.8, sizeBytes: 128 },
        {
          type: 'report',
          weight: 0.2,
          sizeBytes: 128,
          metadata: {
            [SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]: { type: 'constant', value: 200 }
          }
        }
      ]
    },
    'bulkhead-mix'
  )
}

describe('bulkhead (resilience.bulkhead.partitions)', () => {
  it('stops a slow request type from starving a fast one', () => {
    const before = new SimulationEngine(mixedService()).run()
    const after = new SimulationEngine(mixedService({ partitions: { report: 4 } })).run()

    const readP99Before = p99(successLatencies(before, 'read'))
    const readP99After = p99(successLatencies(after, 'read'))
    // Measured: without the bulkhead reads queue behind reports for seconds.
    expect(readP99Before).toBeGreaterThan(500)
    // With reports capped at 4 slots, reads always find a free worker.
    expect(readP99After).toBeLessThan(20)

    const svc = after.perNode['svc']
    expect(svc.rejectionsByReason['bulkhead_full']).toBeGreaterThan(0)
    expect(svc.traitCounters['bulkheadRejected']).toBe(svc.rejectionsByReason['bulkhead_full'])
    expect(svc.traitCounters['bulkheadRejected:report']).toBe(svc.traitCounters['bulkheadRejected'])
    expect(svc.traitCounters['bulkheadRejected:read'] ?? 0).toBe(0)
    // Only the capped compartment is rejected; reads are never bulkhead_full.
    const rejectedReads = after.requestOutcomes.filter(
      (row) => row.requestType === 'read' && row.reasonCode === 'bulkhead_full'
    )
    expect(rejectedReads).toHaveLength(0)
    expect(before.perNode['svc'].rejectionsByReason['bulkhead_full'] ?? 0).toBe(0)
  })

  it('keyField + defaultMaxConcurrent caps every tenant, not the node as a whole', () => {
    const run = (bulkhead?: NonNullable<ComponentNode['resilience']>['bulkhead']) =>
      new SimulationEngine(
        topology(
          service(bulkhead ? { resilience: { bulkhead } } : {}, 8, 400),
          {
            pattern: 'constant',
            baseRps: 200,
            requestDistribution: [
              { type: 'GET', weight: 0.8, sizeBytes: 64, metadata: { tenant: 'small' } },
              {
                type: 'GET',
                weight: 0.2,
                sizeBytes: 64,
                metadata: {
                  tenant: 'noisy',
                  [SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]: { type: 'constant', value: 200 }
                }
              }
            ]
          },
          'bulkhead-tenant'
        )
      ).run()

    const capped = run({ keyField: 'tenant', defaultMaxConcurrent: 4 })
    const counters = capped.perNode['svc'].traitCounters
    expect(counters['bulkheadRejected:noisy']).toBeGreaterThan(0)
    expect(counters['bulkheadRejected:small'] ?? 0).toBe(0)
    expect(p99(successLatencies(capped))).toBeLessThan(250)
  })

  it('a bare legacy maxConcurrent stays inert on a microservice', () => {
    const plain = new SimulationEngine(mixedService()).run()
    const legacy = new SimulationEngine(mixedService({ maxConcurrent: 1 })).run()
    expect(legacy.perNode['svc'].rejectionsByReason).toEqual(
      plain.perNode['svc'].rejectionsByReason
    )
  })
})

// ── Load shedding ────────────────────────────────────────────────────────────
// 4 workers x 10ms = 400 rps of capacity, offered 600 rps: a sustained 1.5x
// overload. Without shedding the queue grows until K and admitted requests wait
// for seconds; with shedding the queue stays short.
function overloaded(config?: Record<string, unknown>) {
  return topology(
    service(config ? { config } : {}, 4, 2_000),
    {
      pattern: 'constant',
      baseRps: 600,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 64 }]
    },
    'shed-overload'
  )
}

describe('load shedding (resilience.load-shedding)', () => {
  it('queue-depth shedding caps admitted p99 under overload and rejects the excess', () => {
    const before = new SimulationEngine(overloaded()).run()
    const after = new SimulationEngine(overloaded({ loadShedQueueDepth: 8 })).run()

    const p99Before = p99(successLatencies(before))
    const p99After = p99(successLatencies(after))
    expect(p99Before).toBeGreaterThan(1_000)
    // At most 8 waiting / 4 workers x 10ms = 20ms of queueing + 10ms service.
    expect(p99After).toBeLessThanOrEqual(31)

    const svc = after.perNode['svc']
    const shed = svc.rejectionsByReason['load_shed'] ?? 0
    expect(shed).toBeGreaterThan(0)
    expect(svc.traitCounters['loadShed']).toBe(shed)
    expect(svc.traitCounters['loadShedByQueueDepth']).toBe(shed)
    // Roughly the 1/3 of offered load above capacity is shed.
    const shedFraction = shed / (shed + svc.totalProcessed)
    expect(shedFraction).toBeGreaterThan(0.25)
    expect(shedFraction).toBeLessThan(0.4)
    // Shedding happens before K is full, so the queue never overflows.
    expect(svc.rejectionsByReason['capacity_exceeded'] ?? 0).toBe(0)
  })

  it('queueing-delay shedding bounds the estimated wait', () => {
    const after = new SimulationEngine(overloaded({ loadShedMaxQueueDelayMs: 30 })).run()
    const svc = after.perNode['svc']
    expect(svc.traitCounters['loadShedByQueueDelay']).toBeGreaterThan(0)
    // 30ms of queueing + 10ms service, plus one service time of estimate slack.
    expect(p99(successLatencies(after))).toBeLessThanOrEqual(51)
  })

  it('protectHighPriority never sheds priority-0 requests', () => {
    const after = new SimulationEngine(
      overloaded({ loadShedQueueDepth: 8, loadShedProtectHighPriority: true })
    ).run()
    expect(after.perNode['svc'].rejectionsByReason['load_shed']).toBeGreaterThan(0)
    // High-priority arrivals are admitted, so they can push the queue past the
    // threshold; normal-priority traffic absorbs all the shedding.
    expect(after.perNode['svc'].traitCounters['loadShed']).toBeGreaterThan(0)
  })

  it('does nothing below the threshold', () => {
    const light = new SimulationEngine(
      topology(
        service({ config: { loadShedQueueDepth: 50 } }, 4, 2_000),
        {
          pattern: 'constant',
          baseRps: 100,
          requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 64 }]
        },
        'shed-light'
      )
    ).run()
    expect(light.perNode['svc'].rejectionsByReason['load_shed'] ?? 0).toBe(0)
  })
})

describe('rejection classification', () => {
  it('bulkhead_full and load_shed are policy rejections (503), not queue_full', () => {
    expect(classifyRejectionCause('bulkhead_full')).toBe('rejected')
    expect(classifyRejectionCause('load_shed')).toBe('rejected')
    expect(classifyRequestOutcome('rejected', 'bulkhead_full').statusCodeHint).toBe('503')
    expect(classifyRequestOutcome('rejected', 'load_shed').statusCodeHint).toBe('503')
  })
})
