import { getComponentSpec } from '../catalog/componentSpecs'
import type { ComponentNode, ComponentType } from '../core/types'
import { ACK_AND_RELEASE_COMPONENT_TYPES, ackAndReleaseTrait } from './ackAndRelease'
import { CACHE_COMPONENT_TYPES, cacheTrait } from './cache'
import { CONTENT_ROUTING_COMPONENT_TYPES, contentRoutingTrait } from './contentRouting'
import {
  HEALTH_AWARE_COMPONENT_TYPES,
  healthAwareRoutingTrait
} from './healthAwareRouting'
import { RATE_LIMITER_COMPONENT_TYPES, rateLimiterTrait } from './rateLimiter'
import { READ_ONLY_COMPONENT_TYPES, readOnlyTrait } from './readOnly'
import { READ_WRITE_SPLIT_COMPONENT_TYPES, readWriteSplitTrait } from './readWriteSplit'
import type { NodeBehaviourTrait, TraitResolver } from './types'

export type TraitRegistry = Partial<Record<ComponentType, readonly NodeBehaviourTrait[]>>

const ROUND_ROBIN_ROUTING_TRAIT: NodeBehaviourTrait = Object.freeze({
  name: 'routing.round-robin',
  routingStrategyHint: 'round-robin'
})

const DEFAULT_TRAIT_REGISTRY: TraitRegistry = {}

function appendDefaultTrait(componentType: ComponentType, trait: NodeBehaviourTrait): void {
  const current = DEFAULT_TRAIT_REGISTRY[componentType] ?? []
  DEFAULT_TRAIT_REGISTRY[componentType] = [...current, trait]
}

// Rate limiting gates admission before any routing decision runs for the
// same request, so it is registered first even though today no other
// beforeArrival trait shares a component type with it.
for (const componentType of RATE_LIMITER_COMPONENT_TYPES) {
  appendDefaultTrait(componentType, rateLimiterTrait)
}

// Content routing must resolve the target before health-aware filtering narrows
// candidates to whichever backends are currently healthy — otherwise a routing
// rule's target could be silently swapped for an unrelated healthy backend
// instead of correctly failing when its intended target is down.
for (const componentType of CONTENT_ROUTING_COMPONENT_TYPES) {
  appendDefaultTrait(componentType, contentRoutingTrait)
}

for (const componentType of HEALTH_AWARE_COMPONENT_TYPES) {
  appendDefaultTrait(componentType, healthAwareRoutingTrait)
}

for (const componentType of CACHE_COMPONENT_TYPES) {
  appendDefaultTrait(componentType, cacheTrait)
}

// Both traits are registered for every relational-db node since "Primary DB"
// and "Read Replica" share that component type; each no-ops unless the
// node's explicit replicationRole config matches what it handles.
for (const componentType of READ_ONLY_COMPONENT_TYPES) {
  appendDefaultTrait(componentType, readOnlyTrait)
}

for (const componentType of READ_WRITE_SPLIT_COMPONENT_TYPES) {
  appendDefaultTrait(componentType, readWriteSplitTrait)
}

for (const componentType of ACK_AND_RELEASE_COMPONENT_TYPES) {
  appendDefaultTrait(componentType, ackAndReleaseTrait)
}

export function createTraitResolver(registry: TraitRegistry = {}): TraitResolver {
  const mergedRegistry: TraitRegistry = {
    ...DEFAULT_TRAIT_REGISTRY,
    ...registry
  }

  return (node: ComponentNode): readonly NodeBehaviourTrait[] => {
    const traits: NodeBehaviourTrait[] = []
    const componentSpec = getComponentSpec(node.type)

    // Ordering is deterministic: foundational routing hints first, then
    // component-specific traits from the registry in declaration order.
    if (componentSpec?.routingStrategy === 'round-robin') {
      traits.push(ROUND_ROBIN_ROUTING_TRAIT)
    }

    const registeredTraits = mergedRegistry[node.type]
    if (registeredTraits) {
      traits.push(...registeredTraits)
    }

    return traits
  }
}

export const resolveTraits = createTraitResolver()
