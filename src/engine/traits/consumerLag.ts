import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const CONSUMER_LAG_COMPONENT_TYPES = ['stream'] as const satisfies readonly ComponentType[]

export const consumerLagTrait: NodeBehaviourTrait = {
  name: 'stream.consumer-lag',
  beforeArrival: ({ nodeState }) => ({
    action: 'continue',
    payload: {
      consumerLag: nodeState?.totalInSystem ?? 0,
      metricCounters: {
        consumerLagSamples: 1,
        consumerLagAccumulated: nodeState?.totalInSystem ?? 0
      }
    }
  })
}

export const consumerLagCapabilityModule: NodeCapabilityModule = {
  name: 'stream.consumer-lag',
  appliesTo: CONSUMER_LAG_COMPONENT_TYPES,
  hooks: consumerLagTrait,
  config: {
    sections: [
      {
        id: 'consumer-lag',
        title: 'Consumers',
        fields: [],
        note: 'This stream reports consumer lag as items still buffered in the broker after warmup. Watch final lag and peak lag in the results view when producers outpace consumers.',
        noteTone: 'info'
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['consumerLagSamples', 'consumerLagAccumulated']
  },
  honesty: {
    simulates: ['broker backlog as consumer lag when producers outrun consumers'],
    notModeled: ['consumer groups, partition rebalancing, offset commits']
  }
}
