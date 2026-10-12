import { describe, expect, it } from 'vitest'
import type { RequestTrace } from '../../../../engine/tracer'
import { buildTraceWaterfall, indexTraces, waterfallAxisTicks } from './traceWaterfall'

function phaseTrace(
  requestId: string,
  status: RequestTrace['status'],
  nodes: NonNullable<RequestTrace['phaseRecord']>['nodes'],
  terminal?: NonNullable<RequestTrace['phaseRecord']>['terminal']
): RequestTrace {
  return {
    requestId,
    status,
    totalLatency: 0,
    spans: [],
    phaseRecord: { bornAtUs: 1_000_000n, nodes, edges: [], terminal }
  }
}

describe('buildTraceWaterfall', () => {
  it('splits each hop into edge gap, queue wait and service from the phase record', () => {
    const waterfall = buildTraceWaterfall(
      phaseTrace(
        'r1',
        'success',
        [
          {
            nodeId: 'api',
            nodeArrivalUs: 1_002_000n,
            serviceStartUs: 1_005_000n,
            departureUs: 1_013_000n
          },
          {
            nodeId: 'db',
            nodeArrivalUs: 1_015_000n,
            serviceStartUs: 1_015_000n,
            departureUs: 1_020_000n
          }
        ],
        { timeUs: 1_022_000n, cause: 'completed', locus: 'client', locusKind: 'node' }
      )
    )
    expect(waterfall.exact).toBe(true)
    expect(waterfall.hops).toEqual([
      {
        nodeId: 'api',
        startMs: 2,
        queueMs: 3,
        serviceMs: 8,
        endMs: 13,
        edgeBeforeMs: 2,
        outcome: 'departed'
      },
      {
        nodeId: 'db',
        startMs: 15,
        queueMs: 0,
        serviceMs: 5,
        endMs: 20,
        edgeBeforeMs: 2,
        outcome: 'departed'
      }
    ])
    expect(waterfall.totalMs).toBe(22)
  })

  it('marks a hop rejected before processing with zero queue and service', () => {
    const waterfall = buildTraceWaterfall(
      phaseTrace('r2', 'rejected', [{ nodeId: 'db', nodeArrivalUs: 1_004_000n }], {
        timeUs: 1_004_000n,
        cause: 'node_failed',
        locus: 'db',
        locusKind: 'node'
      })
    )
    expect(waterfall.hops[0]).toMatchObject({
      queueMs: 0,
      serviceMs: 0,
      outcome: 'rejected-before-processing'
    })
    expect(waterfall.terminal).toEqual({
      atMs: 4,
      cause: 'node_failed',
      locus: 'db',
      locusKind: 'node'
    })
  })

  it('extends the failing hop to the terminal time (timed out while waiting or in service)', () => {
    const queued = buildTraceWaterfall(
      phaseTrace('r3', 'timeout', [{ nodeId: 'db', nodeArrivalUs: 1_010_000n }], {
        timeUs: 1_260_000n,
        cause: 'timeout',
        locus: 'db',
        locusKind: 'node'
      })
    )
    expect(queued.hops[0]).toMatchObject({ queueMs: 250, endMs: 260, outcome: 'ended-in-queue' })
    expect(queued.totalMs).toBe(260)

    const inService = buildTraceWaterfall(
      phaseTrace(
        'r4',
        'timeout',
        [{ nodeId: 'db', nodeArrivalUs: 1_010_000n, serviceStartUs: 1_020_000n }],
        { timeUs: 1_260_000n, cause: 'timeout', locus: 'db', locusKind: 'node' }
      )
    )
    expect(inService.hops[0]).toMatchObject({
      queueMs: 10,
      serviceMs: 240,
      outcome: 'ended-in-service'
    })
  })

  it('falls back to spans when no phase record was retained', () => {
    const waterfall = buildTraceWaterfall({
      requestId: 'r5',
      status: 'success',
      totalLatency: 12,
      spans: [{ nodeId: 'api', start: 2, end: 12, queueWait: 1, serviceTime: 9, edgeLatency: 2 }]
    })
    expect(waterfall.exact).toBe(false)
    expect(waterfall.terminal).toBeNull()
    expect(waterfall.totalMs).toBe(12)
    expect(waterfall.hops[0]).toMatchObject({ queueMs: 1, serviceMs: 9, outcome: 'departed' })
  })
})

describe('buildTraceWaterfall terminal locus', () => {
  it('marks a hop that processed the request and then ended it', () => {
    const waterfall = buildTraceWaterfall(
      phaseTrace(
        'r6',
        'rejected',
        [
          {
            nodeId: 'sidecar',
            nodeArrivalUs: 1_000_500n,
            serviceStartUs: 1_000_500n,
            departureUs: 1_004_500n
          }
        ],
        { timeUs: 1_004_500n, cause: 'rejected', locus: 'sidecar', locusKind: 'node' }
      )
    )
    expect(waterfall.hops[0].outcome).toBe('ended-after-processing')
    expect(waterfall.totalMs).toBe(4.5)
  })
})

describe('waterfallAxisTicks', () => {
  it('picks readable steps for short and long traces', () => {
    expect(waterfallAxisTicks(10)).toEqual([0, 5, 10])
    expect(waterfallAxisTicks(2000)).toEqual([0, 500, 1000, 1500, 2000])
    expect(waterfallAxisTicks(0.3)).toEqual([0, 0.1, 0.2, 0.3])
    expect(waterfallAxisTicks(0)).toEqual([0])
  })
})

describe('indexTraces', () => {
  it('orders traces slowest first and lists failed ones', () => {
    const traces: RequestTrace[] = [
      { requestId: 'a', status: 'success', totalLatency: 10, spans: [] },
      { requestId: 'b', status: 'timeout', totalLatency: 50, spans: [] },
      { requestId: 'c', status: 'success', totalLatency: 30, spans: [] }
    ]
    const index = indexTraces(traces)
    expect(index.all.map((i) => index.waterfalls[i].requestId)).toEqual(['b', 'c', 'a'])
    expect(index.failed.map((i) => index.waterfalls[i].requestId)).toEqual(['b'])
    expect(index.slowestIndex).toBe(1)
    expect(indexTraces([]).slowestIndex).toBeNull()
  })
})
