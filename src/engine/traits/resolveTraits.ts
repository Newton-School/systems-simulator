import { getComponentSpec } from '../catalog/componentSpecs'
import type { ComponentNode, ComponentType } from '../core/types'
import { TRAIT_CAPABILITY_MODULES } from './capabilityModules'
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

for (const module of TRAIT_CAPABILITY_MODULES) {
  if (!module.hooks || !module.appliesTo) {
    continue
  }

  for (const componentType of module.appliesTo) {
    appendDefaultTrait(componentType, module.hooks)
  }
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
