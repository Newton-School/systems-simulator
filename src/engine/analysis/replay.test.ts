import { describe, expect, it } from 'vitest'
import type { CanonicalEventRecord } from '../core/event-stream'
import { replayEventStream } from './replay'

function event(
  sequence: number,
  timestampUs: string,
  priority: number,
  type: CanonicalEventRecord['type'],
  requestId: string,
  nodeId?: string
): CanonicalEventRecord {
  return {
    sequence,
    timestampUs,
    priority,
    type,
    requestId,
    nodeId,
    payload: {}
  }
}

describe('replayEventStream', () => {
  it('rebuilds a golden request lifecycle from stored events only', () => {
    const result = replayEventStream([
      event(0, '0', 1, 'request-generated', 'req-1', 'source'),
      event(1, '0', 3, 'request-forwarded', 'req-1', 'source'),
      event(2, '1000', 1, 'request-arrived', 'req-1', 'worker'),
      event(3, '1000', 2, 'processing-started', 'req-1', 'worker'),
      event(4, '3000', 2, 'processing-completed', 'req-1', 'worker'),
      event(5, '3000', 2, 'request-completed', 'req-1', 'worker')
    ])

    expect(result.lifecycleByRequestId['req-1']).toMatchObject({
      requestId: 'req-1',
      status: 'success',
      path: ['worker'],
      startedAtMs: 0,
      completedAtMs: 3
    })
    expect(result.lifecycleByRequestId['req-1'].events.map((entry) => entry.type)).toEqual([
      'request-generated',
      'request-forwarded',
      'request-arrived',
      'processing-started',
      'processing-completed',
      'request-completed'
    ])
    expect(result.eventCountsByType['request-completed']).toBe(1)
    expect(result.terminalStatusByRequestId['req-1']).toBe('success')
  })

  it('sorts replay by timestamp, priority, then sequence', () => {
    const result = replayEventStream([
      event(3, '1000', 2, 'processing-started', 'req-1', 'worker'),
      event(1, '1000', 1, 'request-arrived', 'req-1', 'worker'),
      event(2, '1000', 1, 'request-queued', 'req-1', 'worker')
    ])

    expect(result.lifecycleByRequestId['req-1'].events.map((entry) => entry.type)).toEqual([
      'request-arrived',
      'request-queued',
      'processing-started'
    ])
  })
})
