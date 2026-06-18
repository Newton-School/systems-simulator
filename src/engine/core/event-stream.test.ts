import { describe, expect, it, vi } from 'vitest'
import { createEvent } from './events'
import {
  EventStreamRecorder,
  eventInputFromSimulationEvent,
  projectToDebugEvent
} from './event-stream'

describe('EventStreamRecorder', () => {
  it('assigns append-only sequences and counts events by canonical type', () => {
    const recorder = new EventStreamRecorder()

    recorder.append({
      timestampUs: 10n,
      type: 'request-generated',
      priority: 1,
      requestId: 'req-1',
      nodeId: 'source'
    })
    recorder.append({
      timestampUs: 20n,
      type: 'request-rejected',
      priority: 2,
      requestId: 'req-1',
      nodeId: 'worker',
      reasonCode: 'capacity_exceeded'
    })

    expect(recorder.getEvents().map((event) => event.sequence)).toEqual([0, 1])
    expect(recorder.getCountsByType()['request-generated']).toBe(1)
    expect(recorder.getCountsByType()['request-rejected']).toBe(1)
    expect(recorder.getCountsByType()['request-completed']).toBe(0)
  })

  it('stores JSON-safe timestamps and payloads', () => {
    const recorder = new EventStreamRecorder()

    const record = recorder.append({
      timestampUs: 12_345n,
      type: 'request-arrived',
      priority: 1,
      requestId: 'req-1',
      payload: {
        createdAt: 10n,
        nested: { deadline: 99n },
        values: [1n, Number.POSITIVE_INFINITY, undefined]
      }
    })

    expect(record.timestampUs).toBe('12345')
    expect(record.payload).toEqual({
      createdAt: '10',
      nested: { deadline: '99' },
      values: ['1', null, null]
    })
    expect(() => JSON.stringify(record)).not.toThrow()
  })

  it('compacts request payloads instead of storing full mutable request state', () => {
    const recorder = new EventStreamRecorder()

    const record = recorder.append({
      timestampUs: 1n,
      type: 'request-generated',
      priority: 1,
      requestId: 'req-1',
      payload: {
        request: {
          id: 'req-1',
          type: 'GET',
          sizeBytes: 128,
          priority: 1,
          createdAt: 0n,
          deadline: 1_000n,
          path: ['api'],
          spans: [
            {
              nodeId: 'api',
              arrivalTime: 0n,
              queueWait: 0n,
              serviceTime: 10n,
              departureTime: 10n
            }
          ],
          retryCount: 0,
          metadata: { largeDebugBlob: 'not replay critical' }
        }
      }
    })

    expect(record.payload.request).toEqual({
      id: 'req-1',
      type: 'GET',
      sizeBytes: 128,
      priority: 1,
      createdAt: '0',
      deadline: '1000',
      path: ['api'],
      retryCount: 0,
      terminal: null
    })
  })

  it('projects canonical records to renderer-safe debug events', () => {
    const recorder = new EventStreamRecorder()
    const record = recorder.append({
      timestampUs: 12_500n,
      type: 'request-rejected',
      priority: 2,
      requestId: 'req-1',
      nodeId: 'worker',
      reasonCode: 'capacity_exceeded'
    })

    expect(projectToDebugEvent(record)).toMatchObject({
      sequence: 0,
      timestampUs: '12500',
      timestampMs: 12.5,
      type: 'request-rejected',
      status: 'rejected',
      message: 'request req-1 rejected at worker (capacity_exceeded)'
    })
  })

  it('notifies subscribers with canonical records', () => {
    const onRecord = vi.fn()
    const recorder = new EventStreamRecorder({ onRecord })

    recorder.append({
      timestampUs: 1n,
      type: 'request-completed',
      priority: 2,
      requestId: 'req-1'
    })

    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ type: 'request-completed' }))
  })

  it('caps retained replay records while preserving full aggregate counts', () => {
    const recorder = new EventStreamRecorder({ maxRetainedEvents: 2 })

    recorder.append({
      timestampUs: 1n,
      type: 'request-generated',
      priority: 1,
      requestId: 'req-1'
    })
    recorder.append({
      timestampUs: 2n,
      type: 'request-forwarded',
      priority: 3,
      requestId: 'req-1'
    })
    recorder.append({
      timestampUs: 3n,
      type: 'request-completed',
      priority: 2,
      requestId: 'req-1'
    })

    expect(recorder.getEvents().map((record) => record.type)).toEqual([
      'request-generated',
      'request-forwarded'
    ])
    expect(recorder.getCountsByType()['request-completed']).toBe(1)
    expect(recorder.getTotalRecordedEvents()).toBe(3)
    expect(recorder.isTruncated()).toBe(true)
  })

  it('maps existing simulation events to canonical stream inputs', () => {
    const input = eventInputFromSimulationEvent(
      createEvent(
        'request-forwarded',
        'source',
        'req-1',
        {
          edge: { id: 'edge-1', source: 'source', target: 'target' }
        },
        42n
      )
    )

    expect(input).toMatchObject({
      timestampUs: 42n,
      type: 'request-forwarded',
      priority: 3,
      requestId: 'req-1',
      nodeId: 'source',
      edgeId: 'edge-1',
      sourceNodeId: 'source',
      targetNodeId: 'target'
    })
  })

  it('ignores simulation events outside the canonical event contract', () => {
    expect(
      eventInputFromSimulationEvent(createEvent('health-check', 'worker', '', {}, 1n))
    ).toBeNull()
  })
})
