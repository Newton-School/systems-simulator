import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait } from './types'

export const ACK_AND_RELEASE_COMPONENT_TYPES = ['queue'] as const satisfies readonly ComponentType[]

/**
 * Acknowledges the producer immediately on enqueue — the producer's request
 * completes at enqueue time, never waiting on consumer processing. The
 * engine reads `forkConsumerRequest` off the payload to spawn an independent
 * lifecycle that enters the queue's own G/G/c/K model (its `queue.workers`/
 * `processing.distribution` represent consumer concurrency and processing
 * time) — this is what makes backlog growth visible when consumers are slow.
 */
export const ackAndReleaseTrait: NodeBehaviourTrait = {
  name: 'queue.ack-and-release',
  beforeArrival: () => ({
    action: 'handled',
    latencyUs: 0n,
    payload: { forkConsumerRequest: true }
  })
}
