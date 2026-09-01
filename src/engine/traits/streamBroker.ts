import type { ComponentType } from '../core/types'
import { ReplicatedLog } from '../semantics/v2StateMachines'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const STREAM_BROKER_COMPONENT_TYPES = ['stream'] as const satisfies readonly ComponentType[]

const DEFAULT_PARTITION_KEY_FIELD = 'partitionKey'
const LOG_STATE_KEY = 'streamBroker.log'

function log(node: { config?: Record<string, unknown> }, state: TraitStateStore | undefined) {
  const existing = state?.get<ReplicatedLog>(LOG_STATE_KEY)
  if (existing) return existing
  const configuredRetention = node.config?.['retentionMs']
  const created = new ReplicatedLog(
    partitionCount(node.config),
    typeof configuredRetention === 'number' && configuredRetention >= 0
      ? configuredRetention
      : 86_400_000
  )
  state?.set(LOG_STATE_KEY, created)
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
  beforeArrival: ({ node, request, state, clock }) => {
    if (node.config?.['streamBrokerEnabled'] !== true) return { action: 'continue' }
    const keyField = partitionKeyField(node.config)
    const rawKey = request.metadata[keyField]
    const key =
      typeof rawKey === 'string' || typeof rawKey === 'number' ? String(rawKey) : request.id
    const broker = log(node, state)
    const nowMs = Number(clock / 1000n)
    const expired = broker.expire(nowMs)
    const appended = broker.append(key, nowMs)
    const partition = appended.partition
    const nextOffset = appended.offset
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
        streamRetentionExpired: expired > 0,
        metricCounters: {
          streamAppends: 1,
          ...(expired > 0 ? { streamRetentionExpired: expired } : {})
        }
      }
    }
  },
  filterRoutes: ({ node, request, candidates, getNode }) => {
    if (node.config?.['streamBrokerEnabled'] !== true || candidates.length <= 1) {
      return { routes: candidates }
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
  afterTerminal: ({ node, request, state, status }) => {
    if (node.config?.['streamBrokerEnabled'] !== true || status !== 'success') return undefined
    const partition = request.metadata.__streamPartition
    const offset = request.metadata.__streamOffset
    if (typeof partition !== 'number' || typeof offset !== 'number') return undefined
    const groups = request.metadata.__streamConsumerGroups
    const consumerGroups =
      Array.isArray(groups) && groups.every((value) => typeof value === 'string')
        ? groups
        : ['default']
    const broker = log(node, state)
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
      'streamRetentionExpired'
    ]
  },
  honesty: {
    simulates: [
      'asynchronous producer acknowledgement, deterministic partition-affine routing, one delivery per configured consumer group, and successful per-group offset commits'
    ],
    notModeled: ['broker replication and rebalancing']
  }
}
