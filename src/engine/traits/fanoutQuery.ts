import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const FANOUT_QUERY_COMPONENT_TYPES = [
  'search-service',
  'search-index'
] as const satisfies readonly ComponentType[]

const DEFAULT_SHARD_COUNT = 4
const DEFAULT_PER_SHARD_LATENCY_MS = 10

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function addPenalty(request: { metadata: Record<string, unknown> }, ms: number): void {
  const existing =
    typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
      ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
      : 0
  request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existing + ms
}

/**
 * Scatter-gather tail latency. A query fans out to N shards in parallel and can
 * only finish when the **slowest** shard responds, so its latency is the maximum
 * of N per-shard samples — which grows with shard count (≈ perShard × ln N).
 * More shards ≠ faster; past a point they inflate the tail.
 *
 * The engine routes one request down one path (no true parallel dispatch), so
 * this models the *consequence* — the tail — by adding a latency penalty drawn
 * as the max of `shardCount` exponential samples (mean `perShardLatencyMs`),
 * using the seeded RNG so it stays deterministic.
 */
export const fanoutQueryTrait: NodeBehaviourTrait = {
  name: 'search.fanout-query',
  beforeArrival: ({ node, request, random }) => {
    const shardCount = asPositiveNumber(node.config?.['shardCount'])
    const perShardMs = asPositiveNumber(node.config?.['perShardLatencyMs'])
    if (shardCount === null || perShardMs === null || shardCount <= 1) {
      return { action: 'continue' }
    }

    const n = Math.round(shardCount)
    const draw = random ?? ((): number => 0.5)
    let tailMs = 0
    for (let i = 0; i < n; i++) {
      // Exponential inverse-CDF sample (mean = perShardMs); take the running max.
      const u = Math.min(0.999999, Math.max(0, draw()))
      const sample = -perShardMs * Math.log(1 - u)
      if (sample > tailMs) {
        tailMs = sample
      }
    }
    addPenalty(request, tailMs)
    return {
      action: 'continue',
      payload: {
        fanoutShards: n,
        tailLatencyMs: tailMs,
        metricCounters: { fanoutQueries: 1, shardsQueried: n }
      }
    }
  }
}

export const fanoutQueryCapabilityModule: NodeCapabilityModule = {
  name: 'search.fanout-query',
  appliesTo: FANOUT_QUERY_COMPONENT_TYPES,
  hooks: fanoutQueryTrait,
  config: {
    sections: [
      {
        id: 'fanout-query',
        title: 'Scatter-Gather',
        note: 'A query fans out to N shards and waits for the slowest, so latency is the max of N per-shard samples and grows with shard count. Models the tail, not the parallel dispatch.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.shardCount',
            type: 'input',
            inputType: 'number',
            label: 'Shards',
            unit: 'shards',
            min: 1,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_SHARD_COUNT}`,
            why: 'Number of shards a query scatters to; the tail is the max over these, growing ≈ ln(shards).'
          },
          {
            path: 'sim.perShardLatencyMs',
            type: 'input',
            inputType: 'number',
            label: 'Per-shard latency',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_PER_SHARD_LATENCY_MS}ms`,
            why: 'Mean latency of a single shard; the query waits for the slowest of N.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['fanoutQueries', 'shardsQueried'] },
  honesty: {
    simulates: [
      'scatter-gather tail latency as the max of N per-shard samples (grows with shard count)'
    ],
    notModeled: [
      'true parallel sub-request dispatch/join, partial results, or per-shard skew and hedging'
    ]
  }
}
