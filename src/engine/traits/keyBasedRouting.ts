import type { ComponentNode, ComponentType } from '../core/types'
import { pickOnHashRing } from '../core/hashRing'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const KEY_BASED_ROUTING_COMPONENT_TYPES = [
  'sharding',
  'hashing'
] as const satisfies readonly ComponentType[]

const DEFAULT_ROUTING_KEY_FIELD = 'shardKey'

function readRoutingKeyField(node: ComponentNode): string {
  const raw = node.config?.['routingKeyField']
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_ROUTING_KEY_FIELD
}

export const keyBasedRoutingTrait: NodeBehaviourTrait = {
  name: 'routing.key-based',
  filterRoutes: ({ node, request, candidates }) => {
    if (candidates.length <= 1) {
      return { routes: candidates, decision: 'single-target' }
    }

    const keyField = readRoutingKeyField(node)
    const rawKey = request.metadata[keyField]
    const routingKey =
      typeof rawKey === 'string' || typeof rawKey === 'number' ? String(rawKey) : request.id

    // Consistent-hash ring (not modulo): adding or removing a shard reassigns
    // only that shard's ~1/N of keys, instead of remapping almost everything.
    const selected = pickOnHashRing(candidates, routingKey)
    return {
      routes: [selected],
      decision: 'key-routed',
      payload: {
        routingKeyField: keyField,
        routingKey,
        targetNodeId: selected.targetNodeId,
        metricCounters: { keyRoutedRequests: 1 }
      }
    }
  }
}

export const keyBasedRoutingCapabilityModule: NodeCapabilityModule = {
  name: 'routing.key-based',
  appliesTo: KEY_BASED_ROUTING_COMPONENT_TYPES,
  hooks: keyBasedRoutingTrait,
  config: {
    sections: [
      {
        id: 'key-routing',
        title: 'Key Routing',
        fields: [
          {
            path: 'sim.routingKeyField',
            type: 'input',
            inputType: 'text',
            label: 'Routing key field',
            placeholder: DEFAULT_ROUTING_KEY_FIELD,
            why: 'Reads the shard key from request metadata so the same key lands on the same shard.'
          }
        ]
      }
    ]
  },
  defaults: [
    {
      path: 'sim.routingKeyField',
      value: DEFAULT_ROUTING_KEY_FIELD,
      rationale: 'Shard-aware requests usually carry an explicit key such as tenantId or shardKey.'
    }
  ],
  metrics: {
    counters: ['keyRoutedRequests']
  },
  honesty: {
    simulates: [
      'deterministic same-key routing to the same downstream shard',
      'consistent-hash ring (64 virtual nodes/shard): adding or removing a shard reassigns only ~1/N of keys'
    ],
    notModeled: ['the data-movement cost/time of a rebalance', 'weighted or heterogeneous shards']
  }
}
