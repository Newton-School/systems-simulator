import { describe, expect, it } from 'vitest'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import { reservationStoreTrait } from './reservationStore'
import type { TraitStateStore } from './types'

function makeNode(id: string, config: Record<string, unknown> = {}) {
  return { id, type: 'reservation-store', config } as const
}

function makeRequest(id: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    type: 'book',
    sizeBytes: 512,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata
  } as const
}

function makeState(): TraitStateStore {
  const store = new Map<string, unknown>()
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value)
    }
  }
}

describe('reservationStoreTrait', () => {
  it('commits the first booking for a seat and sells out later ones at the same authority', () => {
    const node = makeNode('reservation')
    const state = makeState()
    const shared = makeState()
    const firstRequest = makeRequest('req-1', { seatId: 'seatId-7' })

    const first = reservationStoreTrait.beforeArrival?.({
      node,
      request: firstRequest,
      clock: 0n,
      state,
      sharedState: shared
    })
    expect(first).toMatchObject({
      action: 'continue',
      payload: { reservationDecision: 'committed', metricCounters: { reservationCommits: 1 } }
    })
    expect(firstRequest.metadata.__semanticsReservationDecision).toBe('committed')

    const soldOutRequest = makeRequest('req-2', { seatId: 'seatId-7' })
    const soldOut = reservationStoreTrait.beforeArrival?.({
      node,
      request: soldOutRequest,
      clock: 10n,
      state,
      sharedState: shared
    })
    expect(soldOut).toMatchObject({
      action: 'handled',
      payload: { reservationDecision: 'sold-out', metricCounters: { reservationConflicts: 1 } }
    })
    expect(soldOutRequest.metadata.__semanticsReservationDecision).toBe('sold-out')
    // A sold-out response is a fast success, not an oversell.
    expect(soldOut).not.toMatchObject({ payload: { metricCounters: { reservationOversells: 1 } } })
  })

  it('detects an oversell when two independent authorities commit the same seat', () => {
    const shared = makeState()
    const stateA = makeState()
    const stateB = makeState()
    const requestA = makeRequest('req-1', { seatId: 'seatId-3' })

    const committedAtA = reservationStoreTrait.beforeArrival?.({
      node: makeNode('reservation-a'),
      request: requestA,
      clock: 0n,
      state: stateA,
      sharedState: shared
    })
    expect(committedAtA).toMatchObject({
      payload: { reservationDecision: 'committed', metricCounters: { reservationCommits: 1 } }
    })
    expect(requestA.metadata.__semanticsReservationDecision).toBe('committed')

    // Same seat reaches a *different* reservation node that never saw it locally.
    const requestB = makeRequest('req-2', { seatId: 'seatId-3' })
    const oversold = reservationStoreTrait.beforeArrival?.({
      node: makeNode('reservation-b'),
      request: requestB,
      clock: 5n,
      state: stateB,
      sharedState: shared
    })
    expect(oversold).toMatchObject({
      action: 'continue',
      payload: {
        reservationDecision: 'oversold',
        firstCommitter: 'reservation-a',
        metricCounters: { reservationCommits: 1, reservationOversells: 1 }
      }
    })
    expect(requestB.metadata.__semanticsReservationDecision).toBe('oversold')
  })

  it('passes keyless requests through unreserved while charging the reserve latency', () => {
    const request = makeRequest('req-1')
    const decision = reservationStoreTrait.beforeArrival?.({
      node: makeNode('reservation', { reserveLookupMs: 4 }),
      request,
      clock: 0n,
      state: makeState(),
      sharedState: makeState()
    })
    expect(decision).toMatchObject({
      action: 'continue',
      payload: { reservationDecision: 'no-key', metricCounters: { reservationKeyless: 1 } }
    })
    expect(request.metadata.__semanticsReservationDecision).toBe('no-key')
    expect(request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]).toEqual({
      type: 'constant',
      value: 4
    })
  })
})
