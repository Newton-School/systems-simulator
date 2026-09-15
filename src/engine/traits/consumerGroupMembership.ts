import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

/**
 * Node types that typically subscribe to a broker or stream and can therefore
 * belong to a consumer group. The field is display/authoring only — the actual
 * grouping is read from `config.consumerGroup` by the broker's consumer-group
 * delivery (`broadcastFanout`) and the stream broker.
 */
export const CONSUMER_GROUP_MEMBER_COMPONENT_TYPES = [
  'microservice',
  'batch-worker',
  'serverless-function'
] as const satisfies readonly ComponentType[]

/**
 * No runtime hook: this module only surfaces the `consumerGroup` authoring field.
 * A subscriber declares which group it competes in; brokers in consumer-group
 * mode deliver each message to one member per group.
 */
export const consumerGroupMembershipTrait: NodeBehaviourTrait = {
  name: 'messaging.consumer-group-membership'
}

export const consumerGroupMembershipCapabilityModule: NodeCapabilityModule = {
  name: 'messaging.consumer-group-membership',
  appliesTo: CONSUMER_GROUP_MEMBER_COMPONENT_TYPES,
  hooks: consumerGroupMembershipTrait,
  config: {
    sections: [
      {
        id: 'consumer-group',
        title: 'Consumer group',
        note: 'When this node subscribes to a broker or stream running in consumer-group mode, its group name decides how messages are shared. Members sharing a name compete — each message goes to one of them. Leave empty to receive every message independently.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.consumerGroup',
            type: 'input',
            inputType: 'text',
            label: 'Group name',
            placeholder: 'e.g. order-workers (empty = its own group)',
            why: 'Subscribers with the same group name share a broker/stream in consumer-group mode: one member handles each message. Empty means this subscriber forms its own group and receives every message.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['consumer-group membership used by broker/stream competing-consumer delivery'],
    notModeled: ['dynamic group membership changes mid-run beyond node health rebalancing']
  }
}
