import { describe, expect, it } from 'vitest'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import {
  createEmptyEventCounts,
  projectToDebugEvent,
  type CanonicalEventRecord,
  type DebugEvent
} from '../../../../engine/core/event-stream'
import { fixtureRun } from '../../../../shared/commands/__tests__/fixtures'
import {
  buildSwimLanes,
  eventLogCoverage,
  groupEventsByNode,
  groupEventsByRequest,
  incidentEvents,
  indexEventsByRequest,
  indexOutcomes,
  sortByKey
} from './eventLogModel'

function record(
  sequence: number,
  type: CanonicalEventRecord['type'],
  fields: Partial<CanonicalEventRecord> = {}
): DebugEvent {
  return projectToDebugEvent({
    sequence,
    timestampUs: String(sequence * 1000),
    type,
    priority: 0,
    payload: {},
    ...fields
  })
}

const events: DebugEvent[] = [
  record(0, 'request-generated', { requestId: 'r1', nodeId: 'src' }),
  record(1, 'request-arrived', { requestId: 'r1', nodeId: 'api' }),
  record(2, 'request-arrived', { requestId: 'r1', nodeId: 'db' }),
  record(3, 'request-timed-out', { requestId: 'r1', nodeId: 'db', reasonCode: 'deadline' }),
  record(4, 'request-generated', { requestId: 'r2', nodeId: 'src' }),
  record(5, 'request-arrived', { requestId: 'r2', nodeId: 'api' }),
  record(6, 'request-rejected', { requestId: 'r2', nodeId: 'api', reasonCode: 'queue_full' }),
  record(7, 'node-failed', { nodeId: 'db' }),
  record(8, 'health-probed', {})
]

describe('eventLogCoverage', () => {
  it('says when the retained stream is a prefix of the run', () => {
    const counts = createEmptyEventCounts()
    counts['request-arrived'] = 100
    const output = {
      eventStream: [{ sequence: 0, timestampUs: '2000', type: 'request-arrived' }],
      eventCountsByType: counts,
      simulationDuration: 60_000
    } as unknown as SimulationOutput
    expect(eventLogCoverage(output)).toEqual({
      retained: 1,
      total: 100,
      truncated: true,
      firstMs: 2,
      lastMs: 2,
      runMs: 60_000
    })
  })

  it('reports a complete stream for the fixture run', () => {
    const output = fixtureRun()
    const coverage = eventLogCoverage(output)
    expect(coverage.retained).toBe(output.eventStream.length)
    expect(coverage.truncated).toBe(coverage.retained < coverage.total)
  })
})

describe('groupEventsByRequest', () => {
  it('builds hop trails from all retained events and falls back to the events for fate', () => {
    const visible = events.filter((event) => event.status === 'rejected')
    const groups = groupEventsByRequest(visible, indexEventsByRequest(events), new Map())
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      requestId: 'r2',
      eventCount: 3,
      visibleCount: 1,
      hops: ['src', 'api'],
      terminal: { status: 'rejected', nodeId: 'api', reasonCode: 'queue_full', source: 'events' }
    })
  })

  it('prefers the complete outcome ledger for terminal status', () => {
    const output = fixtureRun()
    const debugEvents = output.eventStream.map(projectToDebugEvent)
    const groups = groupEventsByRequest(
      debugEvents,
      indexEventsByRequest(debugEvents),
      indexOutcomes(output.requestOutcomes)
    )
    const rejected = groups.find((group) => group.terminal.status === 'rejected')
    expect(rejected?.terminal.source).toBe('ledger')
    expect(rejected?.hops.length).toBeGreaterThan(0)
  })
})

describe('groupEventsByNode / incidentEvents', () => {
  it('counts per node, busiest first', () => {
    const groups = groupEventsByNode(events)
    expect(groups.map((group) => group.nodeId)).toEqual(['api', 'db', 'src'])
    expect(groups[0]).toMatchObject({ eventCount: 3, rejected: 1 })
    expect(groups[1]).toMatchObject({ eventCount: 3, timedOut: 1, failures: 1 })
  })

  it('orders incidents failure, rejected, timeout', () => {
    expect(incidentEvents(events).map((event) => event.sequence)).toEqual([7, 6, 3])
  })
})

describe('buildSwimLanes', () => {
  it('bins events per node lane with the worst status per bucket', () => {
    const layout = buildSwimLanes(events, 4)
    expect(layout.lanes.map((lane) => lane.nodeId)).toEqual(['src', 'api', 'db', null])
    const db = layout.lanes.find((lane) => lane.nodeId === 'db')!
    expect(db.eventCount).toBe(3)
    expect(db.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3)
    const failed = db.buckets.find((bucket) => bucket.status === 'failure')!
    expect(events[failed.worstIndex].type).toBe('node-failed')
    for (const lane of layout.lanes)
      for (const bucket of lane.buckets) {
        expect(bucket.bucket).toBeGreaterThanOrEqual(0)
        expect(bucket.bucket).toBeLessThan(4)
      }
  })
})

describe('sortByKey', () => {
  it('sorts both ways, keeps ties stable and nulls last', () => {
    const rows = [
      { id: 'a', v: 2 },
      { id: 'b', v: null },
      { id: 'c', v: 1 },
      { id: 'd', v: 2 }
    ]
    expect(sortByKey(rows, (row) => row.v, 'asc').map((row) => row.id)).toEqual([
      'c',
      'a',
      'd',
      'b'
    ])
    expect(sortByKey(rows, (row) => row.v, 'desc').map((row) => row.id)).toEqual([
      'a',
      'd',
      'c',
      'b'
    ])
  })
})
