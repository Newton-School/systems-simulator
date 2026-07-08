import { describe, expect, it } from 'vitest'
import { ackAndReleaseTrait } from './ackAndRelease'

describe('ackAndReleaseTrait', () => {
  it('always acknowledges immediately and asks the engine to fork a consumer lifecycle', () => {
    const result = ackAndReleaseTrait.beforeArrival?.({
      node: {
        id: 'queue',
        type: 'queue',
        category: 'messaging-and-streaming',
        label: 'Message Queue',
        position: { x: 0, y: 0 }
      },
      request: {
        id: 'req-1',
        type: 'GET',
        sizeBytes: 100,
        priority: 1,
        createdAt: 0n,
        deadline: 1_000_000n,
        path: [],
        spans: [],
        retryCount: 0,
        metadata: {}
      },
      clock: 0n
    })

    expect(result).toEqual({
      action: 'handled',
      latencyUs: 0n,
      payload: { forkConsumerRequest: true }
    })
  })
})
