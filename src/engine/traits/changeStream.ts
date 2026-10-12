import type { ComponentNode, ComponentType } from '../core/types'
import type { Request } from '../core/events'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

/** Change-data streams: the partitioned Event Stream carrying CDC / change events. */
export const CHANGE_STREAM_COMPONENT_TYPES = ['stream'] as const satisfies readonly ComponentType[]

export type ConsumerOrdering = 'parallel' | 'per-partition' | 'per-key'
export const CONSUMER_ORDERING_MODES: readonly ConsumerOrdering[] = [
  'parallel',
  'per-partition',
  'per-key'
]

/** Request metadata stamped on a change event at the stream. */
export const CHANGE_KEY_META = '__changeKey'
export const CHANGE_SEQ_META = '__changeSeq'
export const CHANGE_STREAM_NODE_META = '__changeStreamNodeId'
export const CHANGE_ORDERING_META = '__changeOrdering'
/** The ordering lane a held / released delivery occupies at its consumer (engine-owned). */
export const ORDERING_LANE_META = '__orderingLane'

const SEQ_STATE_KEY = 'changeStream.seqByKey'
const APPLIED_STATE_KEY = 'changeStream.appliedByConsumerKey'

export function isChangeStreamEnabled(node: Pick<ComponentNode, 'config'>): boolean {
  return (
    node.config?.['changeStreamOrdering'] === true && node.config?.['streamBrokerEnabled'] === true
  )
}

export function readConsumerOrdering(
  config: Record<string, unknown> | undefined
): ConsumerOrdering {
  const value = config?.['consumerOrdering']
  return CONSUMER_ORDERING_MODES.includes(value as ConsumerOrdering)
    ? (value as ConsumerOrdering)
    : 'parallel'
}

function changeKeyOf(node: ComponentNode, request: Request): string | null {
  const field = node.config?.['changeKeyField']
  const raw =
    typeof field === 'string' && field.trim()
      ? request.metadata[field.trim()]
      : (request.metadata.__key ?? request.metadata[partitionKeyField(node)])
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null
}

function partitionKeyField(node: ComponentNode): string {
  const value = node.config?.['partitionKeyField']
  return typeof value === 'string' && value.trim() ? value.trim() : 'partitionKey'
}

function mapState<V>(state: TraitStateStore | undefined, key: string): Map<string, V> {
  const existing = state?.get<Map<string, V>>(key)
  if (existing) return existing
  const created = new Map<string, V>()
  state?.set(key, created)
  return created
}

/**
 * The ordering lane a consumer must respect for this delivery, or null when
 * deliveries run in parallel. `per-partition` is a Kafka consumer's poll loop
 * (one record of a partition at a time); `per-key` is a key-ordered parallel
 * consumer (one in-flight change per entity, parallel across entities).
 */
export function orderingLaneOf(request: Request, consumerNodeId: string): string | null {
  const mode = request.metadata[CHANGE_ORDERING_META]
  if (mode === 'per-partition') {
    const partition = request.metadata.__streamPartition
    return typeof partition === 'number' ? `${consumerNodeId}|p${partition}` : null
  }
  if (mode === 'per-key') {
    const key = request.metadata[CHANGE_KEY_META]
    return typeof key === 'string' ? `${consumerNodeId}|k${key}` : null
  }
  return null
}

/**
 * Change-stream ordering. On a partitioned Event Stream, each change event for
 * an entity is stamped with its position in that entity's change order (the
 * order the stream received them, i.e. commit order from CDC). When a consumer
 * delivery completes, its change is applied downstream; applying a change older
 * than one already applied for the same entity is an ordering violation (a stale
 * write overwrote a newer one). Violations are counted, not prevented: they
 * happen when one entity's changes are processed concurrently, either because
 * the partition key is not the entity key (its changes land on different
 * partitions and consumers) or because a consumer works a partition in
 * parallel. `consumerOrdering` sets how consumers take deliveries.
 */
export const changeStreamTrait: NodeBehaviourTrait = {
  name: 'stream.change-ordering',
  isEnabledFor: isChangeStreamEnabled,
  beforeArrival: ({ node, request, state }) => {
    const key = changeKeyOf(node, request)
    if (key === null) {
      return { action: 'continue', payload: { metricCounters: { changeEventsNoKey: 1 } } }
    }
    const seqByKey = mapState<number>(state, SEQ_STATE_KEY)
    const seq = (seqByKey.get(key) ?? 0) + 1
    seqByKey.set(key, seq)
    request.metadata[CHANGE_KEY_META] = key
    request.metadata[CHANGE_SEQ_META] = seq
    request.metadata[CHANGE_STREAM_NODE_META] = node.id
    request.metadata[CHANGE_ORDERING_META] = readConsumerOrdering(node.config)
    return { action: 'continue', payload: { metricCounters: { changeEventsCaptured: 1 } } }
  },
  afterTerminal: ({ node, request, state, status, getNode }) => {
    const key = request.metadata[CHANGE_KEY_META]
    const seq = request.metadata[CHANGE_SEQ_META]
    if (typeof key !== 'string' || typeof seq !== 'number') return undefined
    // Only a consumer delivery applies the change: it reached a node after the stream.
    const at = request.path.indexOf(node.id)
    const consumerId = at >= 0 ? request.path[at + 1] : undefined
    if (consumerId === undefined) return undefined
    if (status !== 'success') {
      return { metricCounters: { changeEventsFailed: 1 } }
    }
    // The order is judged per subscriber of the stream: without consumer groups
    // every consumer shares one partition-affine group (they write the same
    // downstream state); with them, each group (or ungrouped consumer) is its own.
    const group = getNode?.(consumerId)?.config?.['consumerGroup']
    const applier =
      node.config?.['consumerGroupMode'] !== true
        ? 'default'
        : typeof group === 'string' && group.trim()
          ? `group:${group.trim()}`
          : consumerId
    const applied = mapState<number>(state, APPLIED_STATE_KEY)
    const slot = `${applier}|${key}`
    const latest = applied.get(slot) ?? 0
    if (seq < latest) {
      return {
        changeOrderViolation: true,
        changeKey: key,
        appliedSeq: seq,
        newerSeqAlreadyApplied: latest,
        metricCounters: { changeEventsApplied: 1, changeOrderViolations: 1 }
      }
    }
    applied.set(slot, seq)
    return { metricCounters: { changeEventsApplied: 1 } }
  }
}

function enabled(data: CanvasNodeDataV2): boolean {
  return data.sim?.changeStreamOrdering === true
}

export const changeStreamCapabilityModule: NodeCapabilityModule = {
  name: 'stream.change-ordering',
  appliesTo: CHANGE_STREAM_COMPONENT_TYPES,
  hooks: changeStreamTrait,
  config: {
    sections: [
      {
        id: 'change-stream',
        title: 'Change Ordering',
        note: (data) =>
          !data.sim?.streamBrokerEnabled
            ? 'Needs the partitioned broker (Stream Broker section) to be on.'
            : enabled(data)
              ? 'Each change is numbered per entity as the stream receives it. A consumer applying an older change after a newer one for the same entity counts as an ordering violation (a stale overwrite). Parallel consumers or a partition key that is not the entity key cause them; per-partition or per-key consumption prevents them at a throughput cost.'
              : 'Turn on to number changes per entity (CDC) and count out-of-order applies at consumers.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.changeStreamOrdering',
            type: 'boolean',
            label: 'Track change order',
            altitude: 'primary',
            why: 'Counts consumers applying an entity’s changes out of order, the classic CDC bug where an older update overwrites a newer one.'
          },
          {
            path: 'sim.consumerOrdering',
            type: 'select',
            label: 'Consumer ordering',
            options: CONSUMER_ORDERING_MODES,
            altitude: 'primary',
            visible: enabled,
            placeholder: 'parallel',
            why: 'parallel: a consumer works deliveries concurrently (fast, may reorder). per-partition: one record per partition at a time, like a Kafka poll loop (ordered within a partition only). per-key: one in-flight change per entity (ordered per entity, parallel across entities).'
          },
          {
            path: 'sim.changeKeyField',
            type: 'input',
            inputType: 'text',
            label: 'Entity key field',
            altitude: 'advanced',
            visible: enabled,
            placeholder: 'request key',
            why: 'Request metadata field naming the changed row or entity. Defaults to the request key from the source keyspace.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'changeEventsCaptured',
      'changeEventsApplied',
      'changeOrderViolations',
      'changeEventsFailed',
      'changeEventsNoKey',
      'changeEventsWaitedForOrder'
    ]
  },
  honesty: {
    simulates: [
      'per-entity change numbering in stream receive order and an ordering-violation count when a consumer applies an older change after a newer one',
      'per-partition and per-key ordered consumption that holds later deliveries until the earlier one finishes (throughput cost measured as consumer wait)'
    ],
    notModeled: [
      'CDC capture lag from the database log (changes are stamped when the stream receives them)',
      'producer-side reordering before the stream (retries, multiple producers for one key)',
      'idempotent or version-checked writes that would reject a stale change',
      'transaction boundaries spanning several entities'
    ]
  }
}
