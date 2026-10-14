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
  id:
    | 'collapse'
    | 'changeStream'
    | 'telemetry'
    | 'queue'
    | 'stream'
    | 'partners'
    | 'sharding'
    | 'storage'
    | 'contentRouting'
  counters: readonly string[]
  /** True when this feature is switched on for the node (given its resolved traits). */
  enabledOn(node: ComponentNode, traits: readonly NodeBehaviourTrait[]): boolean
  /** Optional non-zero gauges/config values to seed alongside the family counters. */
  seedValues?: (node: ComponentNode) => Readonly<Record<string, number>>
}

const hasTrait = (traits: readonly NodeBehaviourTrait[], name: string): boolean =>
  traits.some((trait) => trait.name === name)

export const FEATURE_COUNTER_FAMILIES: readonly FeatureCounterFamily[] = [
  {
    id: 'queue',
    counters: ['queueAccepted', 'queueRedeliveries', 'queueDlqMoves'],
    enabledOn: (_node, traits) => hasTrait(traits, 'queue.ack-and-release')
  },
  {
    id: 'stream',
    counters: [
      'streamAppends',
      'streamPartitionRoutes',
      'streamGroupDeliveries',
      'streamOffsetCommits',
      'streamRetentionExpired',
      'streamReplayReads',
      'streamConsumerRebalances',
      'streamBrokerFailures',
      'streamBrokerRecoveries',
      'streamBrokerUnavailable'
    ],
    enabledOn: (node, traits) =>
      hasTrait(traits, 'stream.partitioned-broker') && node.config?.['streamBrokerEnabled'] === true
  },
  {
    id: 'partners',
    counters: [
      'partnerRequests',
      'partnerQueuedForAvailability',
      'partnerAssignments',
      'partnerAssignmentFailures',
      'partnerWaits',
      'partnerWaitMs'
    ],
    enabledOn: (node, traits) =>
      hasTrait(traits, 'delivery.partner-pool') && node.config?.['partnerPoolEnabled'] === true
  },
  {
    id: 'sharding',
    counters: [
      'shardRoutingAttempts',
      'shardRoutedRequests',
      'shardDistinctKeys',
      'shardMissingKeys',
      'shardFallbackRoutes',
      'shardMissingKeyRejects',
      'hotShardDetections',
      'shardRebalances',
      'shardSplits',
      'shardKeysMigrated'
    ],
    enabledOn: (_node, traits) => hasTrait(traits, 'routing.key-based')
  },
  {
    id: 'storage',
    counters: [
      'storageCapacityGb',
      'storageInitialUsedGb',
      'storageWriteAttempts',
      'storageWritesCommitted',
      'storageBytesWritten',
      'storageWriteFailures',
      'storageFullRejects'
    ],
    enabledOn: (_node, traits) => hasTrait(traits, 'storage.capacity'),
    seedValues: (node) => ({
      storageCapacityGb:
        typeof node.config?.['storageCapacityGb'] === 'number'
          ? node.config['storageCapacityGb']
          : 0,
      storageInitialUsedGb:
        typeof node.config?.['initialStorageGb'] === 'number' ? node.config['initialStorageGb'] : 0
    })
  },
  {
    id: 'contentRouting',
    counters: [
      'contentRouteAttempts',
      'contentRouteMatched',
      'contentRouteUnmatched',
      'contentRouteFallbacks',
      'contentRouteTargetUnavailable',
      'contentRouteRejects'
    ],
    enabledOn: (node, traits) =>
      hasTrait(traits, 'routing.content') &&
      Array.isArray(node.config?.['routingRules']) &&
      node.config['routingRules'].length > 0
  },
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
    Object.assign(seeds, family.seedValues?.(node))
  }
  return seeds
}
