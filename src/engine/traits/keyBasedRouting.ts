import type { ComponentNode, ComponentType } from '../core/types'
import { pickOnHashRing } from '../core/hashRing'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const KEY_BASED_ROUTING_COMPONENT_TYPES = [
  'sharding',
  'hashing'
] as const satisfies readonly ComponentType[]

const DEFAULT_ROUTING_KEY_FIELD = 'shardKey'
const LOADS_STATE_KEY = 'keyRouting.targetLoads'
const SPLITS_STATE_KEY = 'keyRouting.splits'
const HOT_TARGETS_STATE_KEY = 'keyRouting.hotTargets'
const DISTINCT_KEYS_STATE_KEY = 'keyRouting.distinctKeys'

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function mapState<T>(state: TraitStateStore | undefined, key: string): Map<string, T> {
  const existing = state?.get<Map<string, T>>(key)
  if (existing) return existing
  const created = new Map<string, T>()
  state?.set(key, created)
  return created
}

function setState(state: TraitStateStore | undefined, key: string): Set<string> {
  const existing = state?.get<Set<string>>(key)
  if (existing) return existing
  const created = new Set<string>()
  state?.set(key, created)
  return created
}

function readRoutingKeyField(node: ComponentNode): string {
  const raw = node.config?.['routingKeyField']
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_ROUTING_KEY_FIELD
}

function routingKeyValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null
}

function missingKeyPolicy(node: ComponentNode): 'fallback-request-id' | 'reject' {
  return node.config?.['missingRoutingKeyPolicy'] === 'reject' ? 'reject' : 'fallback-request-id'
}

export const keyBasedRoutingTrait: NodeBehaviourTrait = {
  name: 'routing.key-based',
  filterRoutes: ({ node, request, candidates, state }) => {
    if (candidates.length === 0) return { routes: candidates, decision: 'no-targets' }

    const keyField = readRoutingKeyField(node)
    const authoredRoutingKey = routingKeyValue(request.metadata[keyField])
    const missingKey = authoredRoutingKey === null
    const policy = missingKeyPolicy(node)
    const distinctKeys = setState(state, DISTINCT_KEYS_STATE_KEY)
    const newlyDistinct = authoredRoutingKey !== null && !distinctKeys.has(authoredRoutingKey)
    if (authoredRoutingKey !== null) distinctKeys.add(authoredRoutingKey)
    const keyCounters = {
      shardRoutingAttempts: 1,
      ...(missingKey ? { shardMissingKeys: 1 } : {}),
      ...(missingKey && policy === 'fallback-request-id' ? { shardFallbackRoutes: 1 } : {}),
      ...(newlyDistinct ? { shardDistinctKeys: 1 } : {})
    }

    if (missingKey && policy === 'reject') {
      return {
        routes: [],
        decision: 'missing-shard-key',
        rejectionReason: 'missing_shard_key',
        payload: {
          routingKeyField: keyField,
          missingRoutingKeyPolicy: policy,
          metricCounters: { ...keyCounters, shardMissingKeyRejects: 1 }
        }
      }
    }

    const routingKey = authoredRoutingKey ?? request.id

    if (candidates.length === 1) {
      const selected = candidates[0]
      const loads = mapState<number>(state, LOADS_STATE_KEY)
      loads.set(selected.targetNodeId, (loads.get(selected.targetNodeId) ?? 0) + 1)
      return {
        routes: candidates,
        decision: missingKey ? 'single-target-key-fallback' : 'single-target-key-routed',
        payload: {
          routingKeyField: keyField,
          routingKey,
          routingKeyPresent: !missingKey,
          missingRoutingKeyPolicy: policy,
          targetNodeId: selected.targetNodeId,
          metricCounters: {
            ...keyCounters,
            keyRoutedRequests: 1,
            shardRoutedRequests: 1,
            [`shardTarget:${selected.targetNodeId}`]: 1
          }
        }
      }
    }

    // Consistent-hash ring (not modulo): adding or removing a shard reassigns
    // only that shard's ~1/N of keys, instead of remapping almost everything.
    const baseline = pickOnHashRing(candidates, routingKey)
    const loads = mapState<number>(state, LOADS_STATE_KEY)
    const splits = mapState<{ baseline: string; alternative: string }>(state, SPLITS_STATE_KEY)
    const hotTargets = setState(state, HOT_TARGETS_STATE_KEY)
    const existingSplit = splits.get(routingKey)
    const splitKeyField =
      typeof node.config?.['shardSplitKeyField'] === 'string' &&
      node.config['shardSplitKeyField'].trim()
        ? node.config['shardSplitKeyField'].trim()
        : null
    const rawSplitKey = splitKeyField ? request.metadata[splitKeyField] : undefined
    const splitKey =
      typeof rawSplitKey === 'string' || typeof rawSplitKey === 'number'
        ? String(rawSplitKey)
        : request.id
    let selected = baseline
    if (existingSplit) {
      const splitCandidates = candidates.filter(
        (candidate) =>
          candidate.targetNodeId === existingSplit.baseline ||
          candidate.targetNodeId === existingSplit.alternative
      )
      if (splitCandidates.length > 1) {
        selected = pickOnHashRing(splitCandidates, `${routingKey}:${splitKey}`)
      }
    }
    const totalBefore = [...loads.values()].reduce((sum, value) => sum + value, 0)
    const projectedBaseline = (loads.get(baseline.targetNodeId) ?? 0) + 1
    const averageAfter = (totalBefore + 1) / candidates.length
    const threshold = positiveNumber(node.config?.['hotShardThresholdRatio'], 1.5)
    const minSamples = Math.max(
      candidates.length,
      Math.round(positiveNumber(node.config?.['hotShardMinSamples'], 20))
    )
    const hot = totalBefore + 1 >= minSamples && projectedBaseline > averageAfter * threshold
    const newlyHot = hot && !hotTargets.has(baseline.targetNodeId)
    if (newlyHot) hotTargets.add(baseline.targetNodeId)

    let rebalanced = false
    if (
      hot &&
      node.config?.['autoShardRebalance'] === true &&
      !existingSplit &&
      candidates.length > 1
    ) {
      const alternatives = candidates
        .filter((candidate) => candidate.targetNodeId !== baseline.targetNodeId)
        .sort(
          (left, right) =>
            (loads.get(left.targetNodeId) ?? 0) - (loads.get(right.targetNodeId) ?? 0) ||
            left.targetNodeId.localeCompare(right.targetNodeId)
        )
      const alternative = alternatives[0] ?? baseline
      splits.set(routingKey, {
        baseline: baseline.targetNodeId,
        alternative: alternative.targetNodeId
      })
      selected = pickOnHashRing([baseline, alternative], `${routingKey}:${splitKey}`)
      rebalanced = alternative.targetNodeId !== baseline.targetNodeId
    }
    loads.set(selected.targetNodeId, (loads.get(selected.targetNodeId) ?? 0) + 1)
    return {
      routes: [selected],
      decision: rebalanced ? 'hot-shard-rebalanced' : 'key-routed',
      payload: {
        routingKeyField: keyField,
        routingKey,
        routingKeyPresent: !missingKey,
        missingRoutingKeyPolicy: policy,
        targetNodeId: selected.targetNodeId,
        baselineTargetNodeId: baseline.targetNodeId,
        hotShardDetected: hot,
        shardRebalanced: rebalanced,
        metricCounters: {
          ...keyCounters,
          keyRoutedRequests: 1,
          shardRoutedRequests: 1,
          [`shardTarget:${selected.targetNodeId}`]: 1,
          ...(newlyHot ? { hotShardDetections: 1 } : {}),
          ...(rebalanced ? { shardRebalances: 1, shardSplits: 1, shardKeysMigrated: 1 } : {})
        }
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
          },
          {
            path: 'sim.missingRoutingKeyPolicy',
            type: 'select',
            label: 'Missing key policy',
            options: ['fallback-request-id', 'reject'],
            altitude: 'primary',
            why: 'Fallback preserves legacy behavior but scatters keyless requests by request ID. Reject enforces that every sharded request carries the selected shard key.'
          },
          {
            path: 'sim.hotShardThresholdRatio',
            type: 'input',
            inputType: 'number',
            label: 'Hot-shard threshold',
            unit: '× average',
            min: 1,
            step: 0.1,
            altitude: 'primary',
            why: 'Flags a shard when its routed load exceeds this multiple of the mean shard load.'
          },
          {
            path: 'sim.hotShardMinSamples',
            type: 'input',
            inputType: 'number',
            label: 'Detection samples',
            min: 1,
            step: 1,
            altitude: 'advanced',
            why: 'Prevents startup noise from being classified as a hot shard.'
          },
          {
            path: 'sim.autoShardRebalance',
            type: 'boolean',
            label: 'Auto split and rebalance',
            defaultValue: false,
            altitude: 'primary',
            why: 'Creates a stable two-target virtual split for a hot key using the split sub-key.'
          },
          {
            path: 'sim.shardSplitKeyField',
            type: 'input',
            inputType: 'text',
            label: 'Split sub-key field',
            placeholder: 'orderId (request id if empty)',
            altitude: 'advanced',
            visible: (data) => data.sim?.autoShardRebalance === true,
            why: 'Keeps each sub-key stable while distributing one hot parent key across the original and least-loaded shard.'
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
    },
    {
      path: 'sim.missingRoutingKeyPolicy',
      value: 'fallback-request-id',
      rationale:
        'Preserves existing topologies while still exposing missing-key and fallback counters.'
    },
    {
      path: 'sim.hotShardThresholdRatio',
      value: 1.5,
      rationale: 'A shard carrying more than 150% of mean load is meaningfully skewed.'
    },
    {
      path: 'sim.hotShardMinSamples',
      value: 20,
      rationale: 'Wait for enough routing evidence before declaring a hotspot.'
    },
    {
      path: 'sim.autoShardRebalance',
      value: false,
      rationale: 'Learners choose whether the architecture has automated hotspot remediation.'
    }
  ],
  metrics: {
    counters: [
      'keyRoutedRequests',
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
    rejectionReasons: ['missing_shard_key']
  },
  honesty: {
    simulates: [
      'deterministic same-key routing to the same downstream shard',
      'explicit missing-key policy with observable fallback or rejection',
      'exact distinct shard-key cardinality for the discrete run',
      'consistent-hash ring (64 virtual nodes/shard): adding or removing a shard reassigns only ~1/N of keys',
      'per-shard routed-load counters, hot-shard detection, and an optional stable two-target virtual split using a configurable sub-key'
    ],
    notModeled: [
      'physical provisioning of a brand-new database server (auto split uses an existing shard target)',
      'the byte-level data-copy time and dual-write cutover protocol of a rebalance',
      'cross-sub-key transactions after a hot parent key is split',
      'weighted or heterogeneous shards'
    ]
  }
}
