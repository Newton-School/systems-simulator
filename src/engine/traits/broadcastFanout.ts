import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const BROADCAST_FANOUT_COMPONENT_TYPES = [
  'message-broker',
  'pub-sub',
  'event-bus'
] as const satisfies readonly ComponentType[]

/**
 * Marks broker-style nodes whose defining behavior is one-to-many delivery.
 * The routing table consumes the `broadcast` strategy hint and returns every
 * eligible downstream route instead of picking a single winner.
 */
export const broadcastFanoutTrait: NodeBehaviourTrait = {
  name: 'routing.broadcast-fanout',
  routingStrategyHint: 'broadcast'
}

export const broadcastFanoutCapabilityModule: NodeCapabilityModule = {
  name: 'routing.broadcast-fanout',
  appliesTo: BROADCAST_FANOUT_COMPONENT_TYPES,
  hooks: broadcastFanoutTrait,
  config: {
    sections: [
      {
        id: 'delivery',
        title: 'Delivery',
        note: 'This broker fans one published event out to every eligible downstream subscriber. Add several consumers and each one receives its own branch during the run.',
        noteTone: 'info',
        fields: []
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['one published event fanning out to all downstream subscribers'],
    notModeled: ['subscription filters, consumer groups, delivery guarantees']
  }
}
