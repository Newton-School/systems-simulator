import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const BROADCAST_FANOUT_COMPONENT_TYPES = [
  'message-broker',
  'pub-sub',
  'event-bus'
] as const satisfies readonly ComponentType[]

/** Deterministic FNV-1a hash for competing-consumer member selection. */
function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

/**
 * Marks broker-style nodes whose defining behavior is one-to-many delivery.
 * The routing table consumes the `broadcast` strategy hint and returns every
 * eligible downstream route instead of picking a single winner.
 *
 * When `consumerGroupMode` is enabled, the broker instead delivers one copy per
 * distinct consumer group and exactly one member within each group (competing
 * consumers) — the queue-vs-topic distinction. Subscribers declare their group
 * via `consumerGroup`; a subscriber with no group is its own group, so it still
 * receives every message (pure pub/sub). Member selection is
 * `hash(group:messageKey) % members`, keyed on the request's canonical `__key`
 * (falling back to the request id) so the same message deterministically lands on
 * one member. Unlike the partitioned stream broker, there are no partitions or
 * offsets here — this models fan-out and work-sharing, not a replayable log.
 */
export const broadcastFanoutTrait: NodeBehaviourTrait = {
  name: 'routing.broadcast-fanout',
  routingStrategyHint: 'broadcast',
  filterRoutes: ({ node, request, candidates, getNode }) => {
    if (node.config?.['consumerGroupMode'] !== true || candidates.length <= 1) {
      return { routes: candidates }
    }

    const messageKey =
      typeof request.metadata.__key === 'string' ? request.metadata.__key : request.id

    const byGroup = new Map<string, typeof candidates>()
    for (const candidate of candidates) {
      const groupValue = getNode?.(candidate.targetNodeId)?.config?.['consumerGroup']
      const group =
        typeof groupValue === 'string' && groupValue.trim()
          ? groupValue.trim()
          : candidate.targetNodeId
      byGroup.set(group, [...(byGroup.get(group) ?? []), candidate])
    }

    const routes = [...byGroup.entries()].map(([group, members]) => {
      const ordered = [...members].sort((a, b) => a.targetNodeId.localeCompare(b.targetNodeId))
      return ordered[hash(`${group}:${messageKey}`) % ordered.length]!
    })

    return {
      routes,
      decision: 'consumer-group-delivery',
      payload: {
        consumerGroup: [...byGroup.keys()].join(','),
        metricCounters: { brokerGroupDeliveries: routes.length }
      }
    }
  }
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
        note: 'By default this broker fans one published event out to every eligible downstream subscriber (topic/pub-sub). Enable consumer groups to switch to competing consumers: one copy per group, one member within each group shares the work. Subscribers set their group name below; ungrouped subscribers each form their own group and still receive every message.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.consumerGroupMode',
            type: 'boolean',
            label: 'Consumer groups',
            why: 'Off = broadcast to all subscribers (topic). On = one delivery per consumer group and one member within it (queue / competing consumers). Members share a group via their sim.consumerGroup.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['brokerGroupDeliveries']
  },
  honesty: {
    simulates: [
      'topic fan-out: one published event to every subscriber',
      'consumer groups: one delivery per group and one competing-consumer member within each group'
    ],
    notModeled: [
      'subscription filters',
      'delivery guarantees (at-least-once / exactly-once)',
      'partitions, offsets, or replay (use the partitioned stream broker for those)'
    ]
  }
}
