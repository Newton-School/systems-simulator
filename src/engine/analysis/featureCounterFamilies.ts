import type { ComponentNode } from '../core/types'
import { requestCollapsingEnabled } from '../traits/cache'
import type { NodeBehaviourTrait } from '../traits/types'

/**
 * Opt-in features whose run-wide counters are gradeable (`collapse.*`,
 * `changeStream.*`, `telemetry.*`). Their trait counters only appear once the
 * feature acts on a request, so a design that never enabled the feature and a
 * design that enabled it but saw no activity would both report nothing. To keep
 * the two apart, the engine seeds every counter of a family at zero on each node
 * where the feature is switched on; the verdict then projects a family only
 * when at least one node carries one of its counters. A check like
 * `collapse.collapsedMisses == 0` therefore resolves to 0 on an enabled-but-idle
 * cache, and stays unresolved (never passes vacuously) on a design without it.
 */
export interface FeatureCounterFamily {
  id: 'collapse' | 'changeStream' | 'telemetry'
  counters: readonly string[]
  /** True when this feature is switched on for the node (given its resolved traits). */
  enabledOn(node: ComponentNode, traits: readonly NodeBehaviourTrait[]): boolean
}

const hasTrait = (traits: readonly NodeBehaviourTrait[], name: string): boolean =>
  traits.some((trait) => trait.name === name)

export const FEATURE_COUNTER_FAMILIES: readonly FeatureCounterFamily[] = [
  {
    id: 'collapse',
    counters: [
      'collapseLeaders',
      'collapsedMisses',
      'collapsedFollowersServed',
      'collapsedFollowersFailed',
      'collapseNoKey'
    ],
    enabledOn: (node, traits) => hasTrait(traits, 'cache') && requestCollapsingEnabled(node.config)
  },
  {
    id: 'changeStream',
    counters: [
      'changeEventsCaptured',
      'changeEventsApplied',
      'changeOrderViolations',
      'changeEventsWaitedForOrder',
      'changeEventsFailed',
      'changeEventsNoKey'
    ],
    enabledOn: (_node, traits) => hasTrait(traits, 'stream.change-ordering')
  },
  {
    id: 'telemetry',
    counters: [
      'telemetryOffered',
      'telemetryIngested',
      'telemetryDropped',
      'telemetryDroppedOverIngest',
      'telemetryDroppedBufferFull',
      'telemetrySampledOut'
    ],
    enabledOn: (_node, traits) => hasTrait(traits, 'observability.telemetry-sink')
  }
]

/** Zero seeds for every gradeable feature family enabled on this node, or null. */
export function featureCounterSeeds(
  node: ComponentNode,
  traits: readonly NodeBehaviourTrait[]
): Record<string, number> | null {
  let seeds: Record<string, number> | null = null
  for (const family of FEATURE_COUNTER_FAMILIES) {
    if (!family.enabledOn(node, traits)) continue
    seeds ??= {}
    for (const counter of family.counters) seeds[counter] = 0
  }
  return seeds
}
