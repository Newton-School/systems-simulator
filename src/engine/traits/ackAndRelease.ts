import { msToMicro } from '../core/time'
import type { Request } from '../core/events'
import type { ComponentNode, ComponentType } from '../core/types'
import {
  normalizeQueueDeliverySemantics,
  type QueueDeliverySemantics
} from '../core/simulationSemantics'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const ACK_AND_RELEASE_COMPONENT_TYPES = ['queue'] as const satisfies readonly ComponentType[]

export interface QueueDeliveryConfig {
  deliverySemantics: QueueDeliverySemantics
  visibilityTimeoutUs: bigint
  maxReceiveCount: number
  dlqNodeId: string | null
}

export const DEFAULT_QUEUE_DELIVERY_SEMANTICS: QueueDeliverySemantics = 'at-most-once'
export const DEFAULT_QUEUE_MAX_RECEIVE_COUNT = 3
export const QUEUE_DELIVERY_ORIGIN_NODE_ID_KEY = '__queueDeliveryOriginNodeId'

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : null
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function readQueueDeliveryConfig(node: Pick<ComponentNode, 'config'>): QueueDeliveryConfig {
  const semantics = normalizeQueueDeliverySemantics(
    node.config?.['deliverySemantics'],
    DEFAULT_QUEUE_DELIVERY_SEMANTICS
  )

  const visibilityTimeoutMs = asNonNegativeNumber(node.config?.['visibilityTimeoutMs']) ?? 0
  const maxReceiveCount =
    asPositiveInteger(node.config?.['maxReceiveCount']) ?? DEFAULT_QUEUE_MAX_RECEIVE_COUNT

  return {
    deliverySemantics: semantics,
    visibilityTimeoutUs: msToMicro(visibilityTimeoutMs),
    maxReceiveCount,
    dlqNodeId: asNonEmptyString(node.config?.['dlqNodeId'])
  }
}

export function readQueueDeliveryOriginNodeId(request: Pick<Request, 'metadata'>): string | null {
  return asNonEmptyString(request.metadata[QUEUE_DELIVERY_ORIGIN_NODE_ID_KEY])
}

export function writeQueueDeliveryOriginNodeId(request: Request, nodeId: string): void {
  request.metadata[QUEUE_DELIVERY_ORIGIN_NODE_ID_KEY] = nodeId
}

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

export const ackAndReleaseCapabilityModule: NodeCapabilityModule = {
  name: 'queue.ack-and-release',
  appliesTo: ACK_AND_RELEASE_COMPONENT_TYPES,
  hooks: ackAndReleaseTrait,
  config: {
    sections: [
      {
        id: 'delivery',
        title: 'Delivery',
        fields: [
          {
            path: 'sim.deliverySemantics',
            type: 'select',
            label: 'Delivery mode',
            options: ['at-most-once', 'at-least-once', 'exactly-once'],
            why: 'Controls whether failed consumer attempts are dropped immediately or made visible for redelivery.'
          },
          {
            path: 'sim.visibilityTimeoutMs',
            type: 'input',
            label: 'Visibility timeout',
            unit: 'ms',
            step: 1,
            optional: true,
            placeholder: '0 = immediate redelivery',
            visible: (data) => data.sim?.deliverySemantics !== 'at-most-once',
            why: 'How long a failed consumer attempt stays hidden before the queue re-exposes it for another receive.'
          },
          {
            path: 'sim.maxReceiveCount',
            type: 'input',
            label: 'Max receives',
            step: 1,
            optional: true,
            placeholder: `${DEFAULT_QUEUE_MAX_RECEIVE_COUNT}`,
            visible: (data) => data.sim?.deliverySemantics !== 'at-most-once',
            why: 'After this many failed receives, the message is moved to the configured DLQ instead of being retried again.'
          },
          {
            path: 'sim.dlqNodeId',
            type: 'input',
            label: 'DLQ node ID',
            inputType: 'text',
            optional: true,
            placeholder: 'queue-dlq',
            visible: (data) => data.sim?.deliverySemantics !== 'at-most-once',
            why: 'Names the queue node that should receive messages once they exceed the receive budget.'
          }
        ],
        note: 'This queue acknowledges producers at enqueue time and processes consumers asynchronously. Leaving delivery mode unset preserves the legacy no-retry behavior.',
        noteTone: 'info'
      }
    ]
  },
  defaults: [
    {
      path: 'sim.deliverySemantics',
      value: DEFAULT_QUEUE_DELIVERY_SEMANTICS,
      rationale:
        'Keep existing queue behavior unchanged until the author explicitly turns on retries.'
    }
  ],
  metrics: {
    counters: ['queueRedeliveries', 'queueDlqMoves']
  },
  honesty: {
    simulates: [
      'producer ack at enqueue and async consumer processing',
      'at-least-once redelivery after a visibility timeout',
      'DLQ handoff after max receive count'
    ],
    notModeled: [
      'end-to-end exactly-once commit coordination',
      'broker replication and consumer groups',
      'a separate delete-ack step distinct from the simulated consumer attempt'
    ]
  }
}
