import type { ComponentNode, ComponentType } from '../core/types'
import type { ResolveRoute } from '../routing'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const KEY_BASED_ROUTING_COMPONENT_TYPES = [
  'sharding',
  'hashing'
] as const satisfies readonly ComponentType[]

const DEFAULT_ROUTING_KEY_FIELD = 'shardKey'

function stableHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function readRoutingKeyField(node: ComponentNode): string {
  const raw = node.config?.['routingKeyField']
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_ROUTING_KEY_FIELD
}

function pickRouteForKey(routes: ResolveRoute[], key: string): ResolveRoute {
  const sorted = [...routes].sort((a, b) => a.targetNodeId.localeCompare(b.targetNodeId))
  return sorted[stableHash(key) % sorted.length]
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

    const selected = pickRouteForKey(candidates, routingKey)
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
    simulates: ['deterministic same-key routing to the same downstream shard'],
    notModeled: ['ring rebalancing cost', 'virtual-node skew analysis']
  }
}
