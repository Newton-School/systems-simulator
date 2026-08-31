import { describe, expect, it } from 'vitest'
import {
  assessQueueDeliverySemantics,
  buildRequestSemanticsSnapshot,
  classifyRequestLifecycleState,
  normalizeQueueDeliverySemantics
} from './simulationSemantics'

describe('simulation semantics', () => {
  it('normalizes unsupported queue delivery values to at-most-once', () => {
    expect(normalizeQueueDeliverySemantics('sometimes')).toBe('at-most-once')
  })

  it('downgrades configured exactly-once to current runtime truth', () => {
    const assessment = assessQueueDeliverySemantics({
      deliverySemantics: 'exactly-once',
      maxReceiveCount: 3
    })

    expect(assessment.runtimeGuarantee).toBe('at-least-once')
    expect(assessment.downgradedFromConfigured).toBe(true)
    expect(assessment.duplicatePossible).toBe(true)
  })

  it('treats at-least-once with a DLQ as replayable without silent loss', () => {
    const assessment = assessQueueDeliverySemantics({
      deliverySemantics: 'at-least-once',
      maxReceiveCount: 3,
      dlqNodeId: 'queue-dlq'
    })

    expect(assessment.replayPossible).toBe(true)
    expect(assessment.lossPossible).toBe(false)
  })

  it('classifies terminal statuses into lifecycle states', () => {
    expect(classifyRequestLifecycleState('success')).toBe('completed')
    expect(classifyRequestLifecycleState('timeout')).toBe('timed-out')
    expect(classifyRequestLifecycleState('connection_reset')).toBe('rejected')
  })

  it('builds a direct-path semantics snapshot when no queue delivery exists', () => {
    expect(buildRequestSemanticsSnapshot('in-flight')).toMatchObject({
      lifecycleState: 'in-flight',
      flowKind: 'direct',
      delivery: null
    })
  })

  it('includes coordination markers and retry tags in queued semantics snapshots', () => {
    const snapshot = buildRequestSemanticsSnapshot('rejected', {
      queueDelivery: {
        deliverySemantics: 'exactly-once',
        maxReceiveCount: 3,
        dlqNodeId: 'queue-dlq'
      },
      metadata: {
        __semanticsIdempotencyDecision: 'duplicate',
        __semanticsLockDecision: 'contended',
        __semanticsReservationDecision: 'oversold'
      },
      attempts: 2
    })

    expect(snapshot.stateTags).toEqual(
      expect.arrayContaining([
        'queued-delivery',
        'retried',
        'idempotency:duplicate',
        'lock:contended',
        'reservation:oversold'
      ])
    )
    expect(snapshot.coordination).toMatchObject({
      idempotencyDecision: 'duplicate',
      lockDecision: 'contended',
      reservationDecision: 'oversold'
    })
    expect(snapshot.notes.join(' ')).toContain('true exactly-once is not proved')
  })
})
