import { describe, it, expect } from 'vitest'
import type { EdgeHop, RequestPhaseRecord, RequestSpan } from '../core/events'
import { decomposeLatency, decomposePhaseRecord, edgeTransitUs, nodeLocalUs } from './phaseTimeline'

function hop(edgeId: string, source: string, target: string, inUs: bigint, outUs: bigint): EdgeHop {
  return { edgeId, source, target, edgeInUs: inUs, edgeOutUs: outUs }
}

function span(nodeId: string, arrival: bigint, queue: bigint, service: bigint): RequestSpan {
  return {
    nodeId,
    arrivalTime: arrival,
    queueWait: queue,
    serviceTime: service,
    departureTime: arrival + queue + service
  }
}

describe('decomposeLatency', () => {
  it('splits end-to-end into edge transit, queue, and service — summing exactly', () => {
    // born=0 → edge0 (290ms) → api arrival=290ms → queue 5ms → service 8ms → done=303ms.
    const created = 0n
    const hops = [hop('client-api', 'client', 'api', 0n, 290_000n)]
    const spans = [span('api', 290_000n, 5_000n, 8_000n)]
    const terminal = 303_000n

    const contributions = decomposeLatency(created, hops, spans, terminal)
    const total = contributions.reduce((sum, c) => sum + c.us, 0n)
    // Exact conservation: contributions reconstruct end-to-end with no residual.
    expect(total).toBe(terminal - created)

    const byKind = Object.fromEntries(contributions.map((c) => [`${c.kind}:${c.component}`, c.us]))
    expect(byKind['edge:client-api']).toBe(290_000n)
    expect(byKind['queue:api']).toBe(5_000n)
    expect(byKind['service:api']).toBe(8_000n)
    // The edge dominates — the bottleneck-locator verdict.
    const edge = contributions.find((c) => c.kind === 'edge')!
    expect(Number(edge.us) / Number(terminal - created)).toBeGreaterThan(0.95)
  })

  it('surfaces unattributed time rather than dropping it', () => {
    // 10ms of end-to-end is not covered by any hop or span.
    const contributions = decomposeLatency(
      0n,
      [hop('e', 'a', 'b', 0n, 5_000n)],
      [span('b', 5_000n, 0n, 5_000n)],
      20_000n
    )
    const unattributed = contributions.find((c) => c.kind === 'unattributed')
    expect(unattributed?.us).toBe(10_000n)
    expect(contributions.reduce((s, c) => s + c.us, 0n)).toBe(20_000n)
  })

  it('labels edges by source→target and multi-hop paths sum correctly', () => {
    const hops = [
      hop('e1', 'client', 'lb', 0n, 100_000n),
      hop('e2', 'lb', 'api', 110_000n, 150_000n)
    ]
    const spans = [span('lb', 100_000n, 0n, 10_000n), span('api', 150_000n, 2_000n, 8_000n)]
    const contributions = decomposeLatency(0n, hops, spans, 160_000n)
    const edgeLabels = contributions.filter((c) => c.kind === 'edge').map((c) => c.label)
    expect(edgeLabels).toEqual(['client→lb', 'lb→api'])
    expect(edgeTransitUs(hops)).toBe(140_000n) // 100 + 40
    expect(nodeLocalUs(spans)).toBe(20_000n) // (0+10) + (2+8)
  })

  it('handles empty hops/spans (e.g. a request that never left the source)', () => {
    expect(decomposeLatency(0n, [], [], 0n)).toEqual([])
    expect(edgeTransitUs([])).toBe(0n)
    expect(nodeLocalUs([])).toBe(0n)
  })
})

describe('decomposePhaseRecord', () => {
  it('uses explicit node/edge phase timestamps as the single latency truth', () => {
    const phaseRecord: RequestPhaseRecord = {
      bornAtUs: 0n,
      nodes: [
        {
          nodeId: 'api',
          nodeArrivalUs: 290_000n,
          serviceStartUs: 295_000n,
          departureUs: 303_000n
        }
      ],
      edges: [
        {
          edgeId: 'client-api',
          source: 'client',
          target: 'api',
          edgeInUs: 0n,
          edgeOutUs: 290_000n
        }
      ],
      terminal: {
        timeUs: 303_000n,
        cause: 'completed',
        locus: 'api',
        locusKind: 'node'
      }
    }

    const contributions = decomposePhaseRecord(phaseRecord)
    const total = contributions.reduce((sum, contribution) => sum + contribution.us, 0n)
    const byKind = Object.fromEntries(
      contributions.map((contribution) => [
        `${contribution.kind}:${contribution.component}`,
        contribution.us
      ])
    )

    expect(total).toBe(303_000n)
    expect(byKind['edge:client-api']).toBe(290_000n)
    expect(byKind['queue:api']).toBe(5_000n)
    expect(byKind['service:api']).toBe(8_000n)
  })

  it('surfaces residual terminal time as unattributed when the record is partial', () => {
    const contributions = decomposePhaseRecord({
      bornAtUs: 0n,
      nodes: [
        {
          nodeId: 'api',
          nodeArrivalUs: 5_000n,
          serviceStartUs: 5_000n,
          departureUs: 10_000n
        }
      ],
      edges: [
        {
          edgeId: 'client-api',
          source: 'client',
          target: 'api',
          edgeInUs: 0n
        }
      ],
      terminal: {
        timeUs: 20_000n,
        cause: 'timeout',
        locus: 'api',
        locusKind: 'node'
      }
    })

    const unattributed = contributions.find((contribution) => contribution.kind === 'unattributed')
    expect(unattributed?.us).toBe(15_000n)
    expect(contributions.reduce((sum, contribution) => sum + contribution.us, 0n)).toBe(20_000n)
  })
})
