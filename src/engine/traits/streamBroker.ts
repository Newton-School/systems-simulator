import type { ComponentType } from '../core/types'
import { ReplicatedLog } from '../semantics/v2StateMachines'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const STREAM_BROKER_COMPONENT_TYPES = ['stream'] as const satisfies readonly ComponentType[]

const DEFAULT_PARTITION_KEY_FIELD = 'partitionKey'
const STREAM_LOG_STATE_PREFIX = 'streamBroker.log'
const STREAM_BROKER_AVAILABLE_PREFIX = 'streamBroker.available'

export function streamBrokerLogStateKey(nodeId: string): string {
  return `${STREAM_LOG_STATE_PREFIX}:${nodeId}`
}

export function streamBrokerAvailabilityStateKey(nodeId: string): string {
  return `${STREAM_BROKER_AVAILABLE_PREFIX}:${nodeId}`
}

export function readStreamPartitionCount(config: Record<string, unknown> | undefined): number {
  return partitionCount(config)
}

export function readStreamRetentionMs(config: Record<string, unknown> | undefined): number {
  const configuredRetention = config?.['retentionMs']
  return typeof configuredRetention === 'number' && configuredRetention >= 0
    ? configuredRetention
    : 86_400_000
}

function log(
  node: { id: string; config?: Record<string, unknown> },
  state: TraitStateStore | undefined
) {
  const key = streamBrokerLogStateKey(node.id)
  const existing = state?.get<ReplicatedLog>(key)
  if (existing) return existing
  const created = new ReplicatedLog(partitionCount(node.config), readStreamRetentionMs(node.config))
  state?.set(key, created)
  return created
}

function partitionCount(config: Record<string, unknown> | undefined): number {
  const value = config?.['partitionCount']
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1
}

function partitionKeyField(config: Record<string, unknown> | undefined): string {
  const value = config?.['partitionKeyField']
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_PARTITION_KEY_FIELD
}

function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

/**
 * A minimal Kafka-like stream contract. Producers are acknowledged at append;
 * consumer routing is partition-affine. Full offsets and retention remain a
 * separate broker state layer rather than being implied by a generic queue.
 */
export const streamBrokerTrait: NodeBehaviourTrait = {
  name: 'stream.partitioned-broker',
  beforeArrival: ({ node, request, state, sharedState, clock }) => {
    if (node.config?.['streamBrokerEnabled'] !== true) return { action: 'continue' }
    const runtimeState = sharedState ?? state
    if (runtimeState?.get<boolean>(streamBrokerAvailabilityStateKey(node.id)) === false) {
      return {
        action: 'rejected',
        reason: 'broker_unavailable',
        payload: {
          streamBrokerAvailable: false,
          metricCounters: { streamBrokerUnavailable: 1 }
        }
      }
    }
    const keyField = partitionKeyField(node.config)
    const rawKey = request.metadata[keyField]
    const key =
      typeof rawKey === 'string' || typeof rawKey === 'number' ? String(rawKey) : request.id
    const broker = log(node, runtimeState)
    const nowMs = Number(clock / 1000n)
    const appended = broker.append(key, nowMs)
    const partition = appended.partition
    const nextOffset = appended.offset
    const retentionDeadlineMs = nowMs + readStreamRetentionMs(node.config)
    request.metadata.__streamPartition = partition
    request.metadata.__streamOffset = nextOffset
    return {
      action: 'handled',
      latencyUs: 0n,
      payload: {
        forkConsumerRequest: true,
        streamPartition: partition,
        streamOffset: nextOffset,
        partitionKey: key,
        streamRetentionDeadlineMs: retentionDeadlineMs,
        metricCounters: {
          streamAppends: 1
        }
      }
    }
  },
  filterRoutes: ({ node, request, candidates, getNode, state, sharedState }) => {
    if (node.config?.['streamBrokerEnabled'] !== true || candidates.length <= 1) {
      return { routes: candidates }
    }
    const runtimeState = sharedState ?? state
    if (runtimeState?.get<boolean>(streamBrokerAvailabilityStateKey(node.id)) === false) {
      return {
        routes: [],
        decision: 'broker-unavailable',
        rejectionReason: 'broker_unavailable',
        payload: {
          streamBrokerAvailable: false,
          metricCounters: { streamBrokerUnavailable: 1 }
        }
      }
    }
    const partition = request.metadata.__streamPartition
    if (typeof partition !== 'number') return { routes: candidates }
    const ordered = [...candidates].sort((left, right) =>
      left.targetNodeId.localeCompare(right.targetNodeId)
    )
    if (node.config?.['consumerGroupMode'] === true) {
      const byGroup = new Map<string, typeof ordered>()
      for (const candidate of ordered) {
        const groupValue = getNode?.(candidate.targetNodeId)?.config?.['consumerGroup']
        const group =
          typeof groupValue === 'string' && groupValue.trim()
            ? groupValue.trim()
            : candidate.targetNodeId
        const entries = byGroup.get(group) ?? []
        entries.push(candidate)
        byGroup.set(group, entries)
      }
      const routes = [...byGroup.entries()].flatMap(([group, groupCandidates]) => {
        const selected = groupCandidates[hash(`${group}:${partition}`) % groupCandidates.length]
        return [{ ...selected, edge: { ...selected.edge, mode: 'asynchronous' as const } }]
      })
      request.metadata.__streamConsumerGroups = [...byGroup.keys()]
      return {
        routes,
        decision: 'consumer-group-delivery',
        payload: {
          streamPartition: partition,
          consumerGroup: [...byGroup.keys()].join(','),
          metricCounters: { streamGroupDeliveries: routes.length }
        }
      }
    }
    const selected = ordered[partition % ordered.length]
    return {
      routes: [selected],
      decision: 'partition-affine',
      payload: {
        streamPartition: partition,
        targetNodeId: selected.targetNodeId,
        metricCounters: { streamPartitionRoutes: 1 }
      }
    }
  },
  afterTerminal: ({ node, request, state, sharedState, status }) => {
    if (node.config?.['streamBrokerEnabled'] !== true || status !== 'success') return undefined
    const partition = request.metadata.__streamPartition
    const offset = request.metadata.__streamOffset
    if (typeof partition !== 'number' || typeof offset !== 'number') return undefined
    const groups = request.metadata.__streamConsumerGroups
    const consumerGroups =
      Array.isArray(groups) && groups.every((value) => typeof value === 'string')
        ? groups
        : ['default']
    const broker = log(node, sharedState ?? state)
    for (const group of consumerGroups) {
      broker.commit(group, partition, offset)
    }
    return {
      streamPartition: partition,
      streamOffset: offset,
      streamOffsetCommitted: true,
      consumerGroup: consumerGroups.join(','),
      metricCounters: { streamOffsetCommits: consumerGroups.length }
    }
  }
}

export const streamBrokerCapabilityModule: NodeCapabilityModule = {
  name: 'stream.partitioned-broker',
  appliesTo: STREAM_BROKER_COMPONENT_TYPES,
  hooks: streamBrokerTrait,
  config: {
    sections: [
      {
        id: 'stream-broker',
        title: 'Stream Broker',
        note: 'When enabled, producers are acknowledged on append, the same key stays partition-affine, successful consumers commit a per-group partition offset, and expired records are removed before later appends. Replication and rebalancing remain out of scope.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.streamBrokerEnabled',
            type: 'boolean',
            label: 'Partitioned broker',
            altitude: 'primary',
            why: 'Turns the Event Stream into an asynchronous append-and-consume boundary.'
          },
          {
            path: 'sim.partitionCount',
            type: 'input',
            label: 'Partitions',
            inputType: 'number',
            min: 1,
            step: 1,
            altitude: 'primary',
            placeholder: '1',
            why: 'Controls deterministic key-to-partition routing.'
          },
          {
            path: 'sim.partitionKeyField',
            type: 'input',
            label: 'Partition key',
            inputType: 'text',
            altitude: 'advanced',
            placeholder: DEFAULT_PARTITION_KEY_FIELD,
            why: 'Requests sharing this metadata key use the same partition route.'
          },
          {
            path: 'sim.retentionMs',
            type: 'input',
            label: 'Retention',
            unit: 'ms',
            inputType: 'number',
            min: 0,
            altitude: 'advanced',
            why: 'Records older than this are expired before subsequent appends.'
          },
          {
            path: 'sim.streamReplayIntervalMs',
            type: 'input',
            label: 'Replay interval',
            unit: 'ms',
            inputType: 'number',
            min: 0,
            altitude: 'advanced',
            optional: true,
            why: 'Schedules deterministic replay reads from each consumer group committed offset.'
          },
          {
            path: 'sim.brokerFailureAtMs',
            type: 'input',
            label: 'Broker failure at',
            unit: 'ms',
            inputType: 'number',
            min: 0,
            altitude: 'advanced',
            optional: true,
            why: 'Pauses stream appends and partition delivery from this broker at a deterministic time.'
          },
          {
            path: 'sim.brokerRecoveryAtMs',
            type: 'input',
            label: 'Broker recovery at',
            unit: 'ms',
            inputType: 'number',
            min: 0,
            altitude: 'advanced',
            optional: true,
            why: 'Resumes stream appends and partition delivery after a scheduled broker failure.'
          },
          {
            path: 'sim.consumerGroupMode',
            type: 'boolean',
            label: 'Consumer groups',
            altitude: 'advanced',
            why: 'Delivers one copy to each configured consumer group and one partition-affine member within that group. Consumer nodes use sim.consumerGroup as their group name.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
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
    ]
  },
  honesty: {
    simulates: [
      'asynchronous producer acknowledgement, deterministic partition-affine routing, one delivery per configured consumer group, successful per-group offset commits, retention expiry, replay from committed offsets, consumer-group rebalancing, and broker availability'
    ],
    notModeled: ['multi-broker replication across physical machines']
  }
}
