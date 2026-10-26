import { PALETTE_TEMPLATES } from '../catalog/paletteTemplates'
import type { ComponentCategory, ComponentType } from '../core/types'
import type { SemanticCriterion } from './gradingCriteria'
import type { CheckOp, RubricCheckKind } from './rubric'
import type { StructuralRule } from './structural'
import { getComponentCategorySupport, type SupportTier } from './supportLedger'

export type AuthoringEvidenceMode = 'question' | 'discrete' | 'analytic'
export type AuthoringCapabilityCategory = 'structural' | 'semantic' | 'rubric'
export type AuthoringFieldControl =
  | 'text'
  | 'number'
  | 'component'
  | 'component-list'
  | 'category'
  | 'metric'
  | 'operator'
  | 'state-transition'

export interface AuthoringFieldDefinition {
  key: string
  label: string
  control: AuthoringFieldControl
  required: boolean
}

export interface AuthoringCapabilityDefinition {
  id: string
  label: string
  category: AuthoringCapabilityCategory
  supportTier: SupportTier
  evidenceModes: readonly AuthoringEvidenceMode[]
  fields: readonly AuthoringFieldDefinition[]
  compile<T extends Record<string, unknown>>(draft: T): T
  decompile<T extends Record<string, unknown>>(compiled: T): T
}

interface CapabilitySeed {
  label: string
  supportTier: SupportTier
  evidenceModes: readonly AuthoringEvidenceMode[]
  fields: readonly AuthoringFieldDefinition[]
}

const field = (
  key: string,
  label: string,
  control: AuthoringFieldControl,
  required = true
): AuthoringFieldDefinition => ({ key, label, control, required })

const STRUCTURAL_CAPABILITY_SEEDS = {
  requires_component: {
    label: 'Require a component',
    fields: [
      field('componentType', 'Component', 'component'),
      field('minCount', 'Minimum', 'number', false)
    ]
  },
  requires_category: {
    label: 'Require a component category',
    fields: [
      field('category', 'Category', 'category'),
      field('minCount', 'Minimum', 'number', false)
    ]
  },
  requires_edge: {
    label: 'Require a direct connection',
    fields: [field('fromType', 'From', 'component'), field('toType', 'To', 'component')]
  },
  max_component_count: {
    label: 'Limit a component count',
    fields: [
      field('componentType', 'Component', 'component'),
      field('maxCount', 'Maximum', 'number')
    ]
  },
  requires_redundancy: {
    label: 'Require redundant instances',
    fields: [
      field('componentType', 'Component', 'component'),
      field('minReplicas', 'Minimum replicas', 'number')
    ]
  },
  forbids_component: {
    label: 'Forbid a component',
    fields: [field('componentType', 'Component', 'component')]
  },
  requires_connected_graph: {
    label: 'Require a connected design',
    fields: []
  },
  requires_single_source: {
    label: 'Require exactly one traffic source',
    fields: []
  },
  min_node_count: {
    label: 'Require a minimum node count',
    fields: [field('count', 'Minimum nodes', 'number')]
  },
  max_node_count: {
    label: 'Limit the node count',
    fields: [field('count', 'Maximum nodes', 'number')]
  },
  requires_path: {
    label: 'Require a reachable path',
    fields: [field('fromType', 'From', 'component'), field('toType', 'To', 'component')]
  }
} satisfies Record<StructuralRule['kind'], Pick<CapabilitySeed, 'label' | 'fields'>>

const SEMANTIC_CAPABILITY_SEEDS = {
  componentPresence: {
    label: 'Require a configured component',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('componentType', 'Component', 'component'),
      field('minCount', 'Minimum count', 'number')
    ]
  },
  componentProperty: {
    label: 'Configuration requirement',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('parentId', 'Parent component requirement', 'text'),
      field('property', 'Property', 'text'),
      field('expected', 'Expected value', 'text')
    ]
  },
  placement: {
    label: 'Place a component in the correct path',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [field('componentType', 'Component', 'component')]
  },
  guardedPath: {
    label: 'Require traffic through a guard',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('from', 'From', 'component'),
      field('guard', 'Guard', 'component'),
      field('to', 'To', 'component', false)
    ]
  },
  fanout: {
    label: 'Require independent fan-out',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [field('broker', 'Broker', 'component'), field('minConsumers', 'Consumers', 'number')]
  },
  storageFit: {
    label: 'Require a store fit',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('accessPattern', 'Access pattern', 'text'),
      field('accept', 'Accepted stores', 'component-list')
    ]
  },
  forbidUnjustified: {
    label: 'Forbid an unjustified component',
    supportTier: 'guided',
    evidenceModes: ['question'],
    fields: [field('componentType', 'Component', 'component')]
  },
  stateTransition: {
    label: 'Require a runtime state transition',
    supportTier: 'guided',
    evidenceModes: ['discrete'],
    fields: [field('match', 'Transition', 'state-transition')]
  },
  stateSequence: {
    label: 'Require a runtime state sequence',
    supportTier: 'guided',
    evidenceModes: ['discrete'],
    fields: [field('sequence', 'Transitions', 'state-transition')]
  }
} satisfies Record<SemanticCriterion['kind'], CapabilitySeed>

function identity<T extends Record<string, unknown>>(value: T): T {
  return value
}

function capability(
  category: Exclude<AuthoringCapabilityCategory, 'rubric'>,
  id: string,
  seed: Pick<CapabilitySeed, 'label' | 'fields'> & Partial<CapabilitySeed>
): AuthoringCapabilityDefinition {
  return {
    id,
    label: seed.label,
    category,
    supportTier: seed.supportTier ?? 'first-class',
    evidenceModes: seed.evidenceModes ?? ['question'],
    fields: seed.fields,
    compile: identity,
    decompile: identity
  }
}

export const STRUCTURAL_AUTHORING_CAPABILITIES = Object.entries(STRUCTURAL_CAPABILITY_SEEDS).map(
  ([id, seed]) => capability('structural', id, seed)
)

export function getStructuralAuthoringCapability(
  id: StructuralRule['kind']
): AuthoringCapabilityDefinition | undefined {
  return STRUCTURAL_AUTHORING_CAPABILITIES.find(
    (capabilityDefinition) => capabilityDefinition.id === id
  )
}

export const SEMANTIC_AUTHORING_CAPABILITIES = Object.entries(SEMANTIC_CAPABILITY_SEEDS).map(
  ([id, seed]) => capability('semantic', id, seed)
)

export type RubricMetricUnit =
  | 'ms'
  | 'ratio'
  | 'req/s'
  | 'count'
  | 'GB'
  | 'replicas'
  | 'pods'
  | 'pod-s'

export type RubricMetricGroup =
  | 'latency'
  | 'requests'
  | 'perNode'
  | 'coordination'
  | 'resilience'
  | 'security'
  | 'apiRouting'
  | 'queue'
  | 'partners'
  | 'stream'
  | 'sharding'
  | 'storage'
  | 'consistency'
  | 'topology'
  | 'cache'
  | 'collapse'
  | 'changeStream'
  | 'telemetry'
  | 'cluster'
  | 'edges'
  | 'faultDomains'
  | 'invariants'

/** Picker order and headings for the metric groups. */
export const RUBRIC_METRIC_GROUP_LABELS: Readonly<Record<RubricMetricGroup, string>> = {
  latency: 'Latency',
  requests: 'Requests and errors',
  perNode: 'Per-node worst case',
  coordination: 'Reservations and locks',
  resilience: 'Retries and rate limits',
  security: 'Authentication and authorization',
  apiRouting: 'API and content routing',
  queue: 'Queue conservation',
  partners: 'Delivery-partner capacity',
  stream: 'Stream partitions and lag',
  sharding: 'Shard distribution and rebalance',
  storage: 'Storage capacity and growth',
  consistency: 'Read consistency',
  topology: 'Topology size and capacity',
  cache: 'Cache hit ratio',
  collapse: 'Request collapsing',
  changeStream: 'Change-stream ordering',
  telemetry: 'Telemetry ingest',
  cluster: 'Cluster scheduling',
  edges: 'Edge slots, connections and batching',
  faultDomains: 'Fault-domain outages',
  invariants: 'Invariants'
}

export interface RubricMetricCapability {
  id: string
  label: string
  kind: RubricCheckKind
  supportTier: SupportTier
  evidenceModes: readonly AuthoringEvidenceMode[]
  operators: readonly CheckOp[]
  group: RubricMetricGroup
  unit: RubricMetricUnit
  /**
   * What the number measures and when it is absent. Feature metrics (cache,
   * collapsing, change streams, telemetry, cluster, edges, fault domains) do
   * not resolve on a design that does not use the feature, so a `== 0` check
   * never passes vacuously.
   */
  description?: string
}

const ALL_OPERATORS = ['<', '<=', '>', '>=', '==', '!='] as const satisfies readonly CheckOp[]

function metricLabel(metric: string): string {
  return metric
    .replaceAll('.', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
}

function legacyGroup(id: string): RubricMetricGroup {
  if (id.startsWith('topology.')) return 'topology'
  if (id.startsWith('summary.latency.')) return 'latency'
  if (id.startsWith('summary.')) return 'requests'
  if (id.startsWith('perNode.')) return 'perNode'
  if (id.startsWith('reservations.') || id.startsWith('locks.')) return 'coordination'
  if (id.startsWith('retries.') || id.startsWith('rateLimit.')) return 'resilience'
  if (id.startsWith('authentication.')) return 'security'
  if (id.startsWith('consistency.')) return 'consistency'
  return 'invariants'
}

function legacyUnit(id: string): RubricMetricUnit {
  if (id.startsWith('summary.latency.') || id === 'perNode.maxLatencyP99') return 'ms'
  if (id === 'consistency.catchUpWaitMs') return 'ms'
  if (id === 'summary.throughput') return 'req/s'
  if (id === 'summary.errorRate' || id === 'perNode.maxErrorRate') return 'ratio'
  if (id === 'perNode.maxUtilization') return 'ratio'
  return 'count'
}

function metric(
  id: string,
  kind: RubricMetricCapability['kind'],
  evidenceModes: readonly AuthoringEvidenceMode[]
): RubricMetricCapability {
  return {
    id,
    label: metricLabel(id),
    kind,
    supportTier: 'first-class',
    evidenceModes,
    operators: ALL_OPERATORS,
    group: legacyGroup(id),
    unit: legacyUnit(id)
  }
}

const SIMULATION_METRIC_IDS = [
  'summary.latency.p50',
  'summary.latency.p90',
  'summary.latency.p95',
  'summary.latency.p99',
  'summary.latency.min',
  'summary.latency.max',
  'summary.latency.mean',
  'summary.errorRate',
  'summary.throughput',
  'summary.totalRequests',
  'summary.successfulRequests',
  'summary.failedRequests',
  'summary.rejectedRequests',
  'summary.timedOutRequests',
  'summary.connectionResetRequests',
  'perNode.maxUtilization',
  'perNode.maxErrorRate',
  'perNode.maxLatencyP99',
  'reservations.commits',
  'reservations.conflicts',
  'reservations.oversells',
  'locks.acquires',
  'locks.contentions',
  'locks.keyless',
  'retries.attempts',
  'retries.budgetExhausted',
  'rateLimit.admitted',
  'rateLimit.rejected',
  'rateLimit.breaches',
  'rateLimit.keyless',
  'authentication.attempts',
  'authentication.succeeded',
  'authentication.missingCredentials',
  'authentication.invalidCredentials',
  'authentication.expiredCredentials',
  'authentication.forbidden',
  'consistency.reads',
  'consistency.writes',
  'consistency.staleReads',
  'consistency.readYourWritesViolations',
  'consistency.monotonicReadViolations',
  'consistency.catchUpWaits',
  'consistency.catchUpWaitMs',
  'consistency.sessionlessReads',
  'consistency.linearizabilityKeysChecked',
  'consistency.linearizabilityViolations',
  'consistency.linearizabilityOpsChecked',
  'consistency.linearizabilityOpsNotChecked',
  'consistency.linearizableVerified'
] as const

const TOPOLOGY_METRIC_IDS = [
  'topology.totalNodes',
  'topology.totalEdges',
  'topology.totalWorkers'
] as const

type FeatureMetricSeed = readonly [
  id: string,
  label: string,
  unit: RubricMetricUnit,
  description: string
]

const CACHE_ABSENT = 'Unresolved when no cache lookup happened.'
const COLLAPSE_ABSENT = 'Unresolved unless a cache has request collapsing on.'
const CHANGE_ABSENT = 'Unresolved unless an Event Stream has change-stream ordering on.'
const TELEMETRY_ABSENT = 'Unresolved unless a collector has async telemetry ingest on.'
const CLUSTER_ABSENT = 'Unresolved unless a workload is scheduled onto a Kubernetes Cluster.'
const SLOTS_ABSENT = 'Every edge carries an in-flight cap, so 0 means it never bound.'
const CONN_ABSENT = 'Unresolved unless an edge with a connection model carried traffic.'
const BATCH_ABSENT = 'Unresolved unless an edge with producer batching sent a batch.'
const DOMAIN_ABSENT = 'Unresolved unless a Region / AZ / Subnet outage took a component down.'
const QUEUE_ABSENT = 'Unresolved unless an asynchronous Queue is present.'
const PARTNER_ABSENT = 'Unresolved unless a service enables the delivery-partner pool.'
const STREAM_ABSENT = 'Unresolved unless an Event Stream enables partitioned-broker behavior.'
const SHARD_ABSENT = 'Unresolved unless a Sharding or Hashing router is present.'
const STORAGE_ABSENT = 'Unresolved unless a datastore has finite storage capacity configured.'
const API_ROUTING_ABSENT =
  'Unresolved unless an API Gateway, L7 load balancer, or ingress has content-routing rules.'

/**
 * Gradeable metrics for opt-in simulator features. Each resolves against the
 * matching optional verdict section (see verdict.ts), which is absent when the
 * feature is not in use. Discrete evidence only: the analytic fluid tier does
 * not model these mechanisms.
 */
const FEATURE_METRIC_SEEDS: Readonly<Record<RubricMetricGroup, readonly FeatureMetricSeed[]>> = {
  latency: [],
  requests: [],
  perNode: [],
  coordination: [],
  resilience: [],
  security: [],
  apiRouting: [
    ['apiRouting.attempts', 'Content route attempts', 'count', API_ROUTING_ABSENT],
    ['apiRouting.matched', 'Matched API routes', 'count', API_ROUTING_ABSENT],
    ['apiRouting.unmatched', 'Unmatched API routes', 'count', API_ROUTING_ABSENT],
    ['apiRouting.fallbacks', 'Generic routing fallbacks', 'count', API_ROUTING_ABSENT],
    ['apiRouting.targetUnavailable', 'Unavailable configured targets', 'count', API_ROUTING_ABSENT],
    ['apiRouting.rejects', 'Content route rejects', 'count', API_ROUTING_ABSENT],
    ['apiRouting.matchCoverage', 'API route match coverage', 'ratio', API_ROUTING_ABSENT],
    ['apiRouting.routedTargets', 'Backends reached by rules', 'count', API_ROUTING_ABSENT],
    ['apiRouting.busiestTargetRequests', 'Busiest routed backend', 'count', API_ROUTING_ABSENT]
  ],
  queue: [
    [
      'queue.accepted',
      'Accepted queued work',
      'count',
      `Producer-acknowledged queue entries. ${QUEUE_ABSENT}`
    ],
    [
      'queue.delivered',
      'Delivered queued work',
      'count',
      `Accepted work completed by a consumer. ${QUEUE_ABSENT}`
    ],
    [
      'queue.pending',
      'Pending queued work',
      'count',
      `Accepted work still retained or in flight at cutoff. ${QUEUE_ABSENT}`
    ],
    [
      'queue.dlqRouted',
      'Work routed to DLQ',
      'count',
      `Failed deliveries transferred to a dead-letter queue. ${QUEUE_ABSENT}`
    ],
    [
      'queue.lost',
      'Lost accepted work',
      'count',
      `Final failed deliveries with no retry or DLQ retention. ${QUEUE_ABSENT}`
    ],
    [
      'queue.redeliveries',
      'Queue redeliveries',
      'count',
      `Delivery attempts rescheduled after failure. ${QUEUE_ABSENT}`
    ],
    [
      'queue.noLoss',
      'No-loss verdict',
      'count',
      `1 when no accepted queue entry was lost; 0 otherwise. ${QUEUE_ABSENT}`
    ],
    [
      'queue.maxQueueDepth',
      'Peak queue depth',
      'count',
      `Largest observed queue backlog. ${QUEUE_ABSENT}`
    ],
    [
      'queue.maxAvgQueueLength',
      'Worst average queue length',
      'count',
      `Largest time-averaged queue backlog. ${QUEUE_ABSENT}`
    ],
    [
      'queue.capacityRejected',
      'Queue capacity rejects',
      'count',
      `Work rejected because queue or memory capacity was exhausted. ${QUEUE_ABSENT}`
    ]
  ],
  partners: [
    ['partners.requests', 'Partner assignment requests', 'count', PARTNER_ABSENT],
    ['partners.queuedForAvailability', 'Orders waiting for partners', 'count', PARTNER_ABSENT],
    ['partners.assignments', 'Successful partner assignments', 'count', PARTNER_ABSENT],
    ['partners.assignmentFailures', 'Partner assignment failures', 'count', PARTNER_ABSENT],
    ['partners.waits', 'Assignments that waited', 'count', PARTNER_ABSENT],
    ['partners.waitMs', 'Total partner wait', 'ms', PARTNER_ABSENT]
  ],
  stream: [
    ['stream.brokers', 'Partitioned stream brokers', 'count', STREAM_ABSENT],
    ['stream.consumerGroupBrokers', 'Brokers using consumer groups', 'count', STREAM_ABSENT],
    ['stream.appends', 'Stream appends', 'count', STREAM_ABSENT],
    ['stream.partitions', 'Stream partitions', 'count', STREAM_ABSENT],
    ['stream.consumerGroups', 'Independent consumer groups', 'count', STREAM_ABSENT],
    ['stream.consumerMembers', 'Consumer group members', 'count', STREAM_ABSENT],
    ['stream.consumerGroupAppends', 'Events offered to consumer groups', 'count', STREAM_ABSENT],
    ['stream.expectedGroupDeliveries', 'Expected independent deliveries', 'count', STREAM_ABSENT],
    ['stream.groupsWithDeliveries', 'Groups receiving events', 'count', STREAM_ABSENT],
    ['stream.groupDeliveries', 'Consumer-group deliveries', 'count', STREAM_ABSENT],
    ['stream.minGroupDeliveries', 'Least group deliveries', 'count', STREAM_ABSENT],
    ['stream.maxGroupDeliveries', 'Most group deliveries', 'count', STREAM_ABSENT],
    ['stream.groupFanoutCoverage', 'Independent group fanout coverage', 'ratio', STREAM_ABSENT],
    ['stream.retainedRecords', 'Retained stream records', 'count', STREAM_ABSENT],
    ['stream.totalLag', 'Total consumer lag', 'count', STREAM_ABSENT],
    ['stream.maxPartitionLag', 'Worst partition lag', 'count', STREAM_ABSENT],
    ['stream.offsetCommits', 'Offset commits', 'count', STREAM_ABSENT],
    ['stream.rebalances', 'Consumer rebalances', 'count', STREAM_ABSENT],
    ['stream.replayReads', 'Replay reads', 'count', STREAM_ABSENT],
    ['stream.retentionExpired', 'Expired records', 'count', STREAM_ABSENT],
    ['stream.unavailable', 'Unavailable broker decisions', 'count', STREAM_ABSENT]
  ],
  sharding: [
    ['sharding.routingAttempts', 'Shard routing attempts', 'count', SHARD_ABSENT],
    ['sharding.routedRequests', 'Shard-routed requests', 'count', SHARD_ABSENT],
    ['sharding.distinctKeys', 'Distinct shard keys', 'count', SHARD_ABSENT],
    ['sharding.missingKeys', 'Requests missing shard key', 'count', SHARD_ABSENT],
    ['sharding.fallbackRoutes', 'Keyless fallback routes', 'count', SHARD_ABSENT],
    ['sharding.missingKeyRejects', 'Missing-key rejects', 'count', SHARD_ABSENT],
    ['sharding.keyCoverage', 'Shard-key coverage', 'ratio', SHARD_ABSENT],
    ['sharding.shardTargets', 'Active shard targets', 'count', SHARD_ABSENT],
    ['sharding.maxShardRequests', 'Busiest shard requests', 'count', SHARD_ABSENT],
    ['sharding.minShardRequests', 'Least-busy shard requests', 'count', SHARD_ABSENT],
    ['sharding.skewRatio', 'Shard load skew', 'ratio', SHARD_ABSENT],
    ['sharding.hotDetections', 'Hot-shard detections', 'count', SHARD_ABSENT],
    ['sharding.rebalances', 'Shard rebalances', 'count', SHARD_ABSENT],
    ['sharding.splits', 'Virtual shard splits', 'count', SHARD_ABSENT],
    ['sharding.migratedKeys', 'Migrated hot keys', 'count', SHARD_ABSENT]
  ],
  storage: [
    ['storage.nodes', 'Capacity-limited storage nodes', 'count', STORAGE_ABSENT],
    ['storage.capacityGb', 'Total storage capacity', 'GB', STORAGE_ABSENT],
    ['storage.initialUsedGb', 'Initial stored data', 'GB', STORAGE_ABSENT],
    ['storage.usedGb', 'Stored data at cutoff', 'GB', STORAGE_ABSENT],
    ['storage.freeGb', 'Free storage at cutoff', 'GB', STORAGE_ABSENT],
    ['storage.utilization', 'Fleet storage utilization', 'ratio', STORAGE_ABSENT],
    ['storage.maxNodeUtilization', 'Fullest node utilization', 'ratio', STORAGE_ABSENT],
    ['storage.writeAttempts', 'Storage write attempts', 'count', STORAGE_ABSENT],
    ['storage.writesCommitted', 'Committed storage writes', 'count', STORAGE_ABSENT],
    ['storage.writtenGb', 'Data written during run', 'GB', STORAGE_ABSENT],
    ['storage.writeFailures', 'Incomplete storage writes', 'count', STORAGE_ABSENT],
    ['storage.fullRejects', 'Storage-full rejects', 'count', STORAGE_ABSENT]
  ],
  consistency: [],
  invariants: [],
  topology: [],
  cache: [
    [
      'cache.hitRatio',
      'Cache hit ratio (all caches)',
      'ratio',
      `Hits / lookups summed over every cache for the whole run (lookup-weighted, not a point sample). ${CACHE_ABSENT}`
    ],
    [
      'cache.minHitRatio',
      'Worst cache hit ratio',
      'ratio',
      `Lowest hits / lookups of any single cache that served a lookup. ${CACHE_ABSENT}`
    ],
    [
      'cache.maxHitRatio',
      'Best cache hit ratio',
      'ratio',
      `Highest hits / lookups of any single cache that served a lookup. ${CACHE_ABSENT}`
    ],
    [
      'cache.lookups',
      'Cache lookups',
      'count',
      `Hits plus misses across every cache. ${CACHE_ABSENT}`
    ],
    ['cache.hits', 'Cache hits', 'count', `Lookups answered from cache. ${CACHE_ABSENT}`],
    [
      'cache.misses',
      'Cache misses',
      'count',
      `Lookups that went to the backing store (or waited behind a collapse leader). ${CACHE_ABSENT}`
    ]
  ],
  collapse: [
    [
      'collapse.leaders',
      'Collapse leaders (downstream fetches)',
      'count',
      `Misses that made the single downstream fetch for their key. ${COLLAPSE_ABSENT}`
    ],
    [
      'collapse.collapsedMisses',
      'Collapsed misses',
      'count',
      `Misses that waited behind an in-flight leader instead of calling downstream. ${COLLAPSE_ABSENT}`
    ],
    [
      'collapse.followersServed',
      'Collapsed followers served',
      'count',
      `Waiting misses completed by their leader's successful fetch. ${COLLAPSE_ABSENT}`
    ],
    [
      'collapse.followersFailed',
      'Collapsed followers failed',
      'count',
      `Waiting misses failed because their leader's fetch failed. ${COLLAPSE_ABSENT}`
    ],
    [
      'collapse.noKey',
      'Misses not collapsed (no key)',
      'count',
      `Misses that could not collapse because the request carried no key. ${COLLAPSE_ABSENT}`
    ]
  ],
  changeStream: [
    [
      'changeStream.orderViolations',
      'Change ordering violations',
      'count',
      `Times a consumer applied an older change for an entity after a newer one. ${CHANGE_ABSENT}`
    ],
    [
      'changeStream.waitedForOrder',
      'Deliveries held for ordering',
      'count',
      `Deliveries held by per-partition or per-key ordered consumption until the earlier one finished. ${CHANGE_ABSENT}`
    ],
    [
      'changeStream.applied',
      'Change events applied',
      'count',
      `Change events a consumer applied successfully. ${CHANGE_ABSENT}`
    ],
    [
      'changeStream.captured',
      'Change events captured',
      'count',
      `Change events the stream numbered per entity. ${CHANGE_ABSENT}`
    ],
    [
      'changeStream.noKey',
      'Change events without an entity key',
      'count',
      `Events that reached the stream without an entity key (not ordered). ${CHANGE_ABSENT}`
    ],
    [
      'changeStream.failed',
      'Change events failed',
      'count',
      `Consumer deliveries of a change event that failed. ${CHANGE_ABSENT}`
    ]
  ],
  telemetry: [
    [
      'telemetry.dropped',
      'Telemetry events dropped',
      'count',
      `Events dropped past the ingest ceiling or a full collector buffer. ${TELEMETRY_ABSENT}`
    ],
    [
      'telemetry.dropRate',
      'Telemetry drop rate',
      'ratio',
      `Dropped / offered (ingested + dropped); unresolved when nothing was offered. ${TELEMETRY_ABSENT}`
    ],
    [
      'telemetry.ingested',
      'Telemetry events ingested',
      'count',
      `Events the collector accepted. ${TELEMETRY_ABSENT}`
    ],
    [
      'telemetry.sampledOut',
      'Telemetry events sampled out',
      'count',
      `Events head sampling kept off the collector (never exported). ${TELEMETRY_ABSENT}`
    ],
    [
      'telemetry.offered',
      'Telemetry events offered',
      'count',
      `Events that reached the ingest check (ingested + dropped). ${TELEMETRY_ABSENT}`
    ],
    [
      'telemetry.droppedOverIngest',
      'Dropped: over ingest ceiling',
      'count',
      `Drops because the events/s ingest ceiling was reached. ${TELEMETRY_ABSENT}`
    ],
    [
      'telemetry.droppedBufferFull',
      'Dropped: collector buffer full',
      'count',
      `Drops because the collector buffer was full. ${TELEMETRY_ABSENT}`
    ]
  ],
  cluster: [
    [
      'cluster.readyRatio',
      'Ready / desired replicas (time-weighted)',
      'ratio',
      `Time-weighted mean ready replicas over time-weighted mean desired, all workloads. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.minWorkloadReadyRatio',
      'Worst workload ready ratio',
      'ratio',
      `Lowest time-weighted ready / desired of any scheduled workload. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.avgReadyReplicas',
      'Ready replicas (time-weighted mean)',
      'replicas',
      `Integral of ready replicas over the run / duration, summed over workloads. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.avgDesiredReplicas',
      'Desired replicas (time-weighted mean)',
      'replicas',
      `Integral of desired replicas over the run / duration, summed over workloads. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.avgPendingPods',
      'Pending pods (time-weighted mean)',
      'pods',
      `Integral of unschedulable pods over the run / duration, summed over clusters. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.peakPendingPods',
      'Peak pending pods',
      'pods',
      `Most pods pending at once in any cluster. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.pendingPodSeconds',
      'Pending pod-seconds',
      'pod-s',
      `Total time pods spent pending, summed over workloads. ${CLUSTER_ABSENT}`
    ],
    ['cluster.podsLost', 'Pods lost', 'count', `Pods lost to machine failures. ${CLUSTER_ABSENT}`],
    [
      'cluster.podsRecovered',
      'Pods recovered',
      'count',
      `Lost pods whose replacement became ready. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.podsUnrecovered',
      'Pods not recovered',
      'count',
      `Lost pods with no ready replacement by the end of the run. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.meanRecoveryMs',
      'Mean pod recovery time',
      'ms',
      `Mean time from a machine failure to the replacement pod being ready; unresolved until a pod recovers. ${CLUSTER_ABSENT}`
    ],
    [
      'cluster.maxRecoveryMs',
      'Worst pod recovery time',
      'ms',
      `Longest time from a machine failure to the replacement pod being ready; unresolved until a pod recovers. ${CLUSTER_ABSENT}`
    ]
  ],
  edges: [
    [
      'edges.slots.waited',
      'Requests that waited for an edge slot',
      'count',
      `Post-warmup, summed over edges. ${SLOTS_ABSENT}`
    ],
    [
      'edges.slots.refused',
      'Requests refused at a full edge',
      'count',
      `Every slot busy and the pending line full, summed over edges (post-warmup). ${SLOTS_ABSENT}`
    ],
    [
      'edges.slots.timedOutWaiting',
      'Requests timed out waiting for an edge slot',
      'count',
      `Deadline passed while waiting for a slot, summed over edges (post-warmup). ${SLOTS_ABSENT}`
    ],
    [
      'edges.slots.maxPeakWaiting',
      'Most requests waiting on one edge',
      'count',
      `Peak queue for slots on the worst edge (a peak, not a mean). ${SLOTS_ABSENT}`
    ],
    [
      'edges.connections.opened',
      'Connections opened',
      'count',
      `New connections opened, summed over edges (post-warmup). ${CONN_ABSENT}`
    ],
    [
      'edges.connections.reused',
      'Requests on a reused connection',
      'count',
      `Requests that reused a warm connection, summed over edges (post-warmup). ${CONN_ABSENT}`
    ],
    [
      'edges.connections.waited',
      'Requests that waited for a connection',
      'count',
      `Requests that waited for a free pooled connection or stream, summed over edges (post-warmup). ${CONN_ABSENT}`
    ],
    [
      'edges.connections.resumed',
      'TLS sessions resumed',
      'count',
      `Opened connections that resumed a TLS session, summed over edges (post-warmup). ${CONN_ABSENT}`
    ],
    [
      'edges.connections.closedIdle',
      'Connections closed idle',
      'count',
      `Keep-alive connections closed after idling, summed over edges (post-warmup). ${CONN_ABSENT}`
    ],
    [
      'edges.batching.batchesSent',
      'Producer batches sent',
      'count',
      `Batches sent across every batching edge (post-warmup). ${BATCH_ABSENT}`
    ],
    [
      'edges.batching.recordsSent',
      'Records sent in batches',
      'count',
      `Records carried by those batches (post-warmup). ${BATCH_ABSENT}`
    ],
    [
      'edges.batching.meanRecordsPerBatch',
      'Records per batch',
      'count',
      `Records sent / batches sent across every batching edge (a per-batch mean). ${BATCH_ABSENT}`
    ]
  ],
  faultDomains: [
    [
      'faultDomains.componentsFailed',
      'Components failed by a domain outage',
      'count',
      `Distinct components a Region / AZ / Subnet outage took down. ${DOMAIN_ABSENT}`
    ],
    [
      'faultDomains.outages',
      'Domain outages',
      'count',
      `Distinct Region / AZ / Subnet locations that went down. ${DOMAIN_ABSENT}`
    ],
    [
      'faultDomains.componentDowntimeMs',
      'Component downtime from domain outages',
      'ms',
      `Summed length of the failure windows those outages opened. ${DOMAIN_ABSENT}`
    ]
  ]
}

const FEATURE_METRIC_CAPABILITIES: readonly RubricMetricCapability[] = Object.entries(
  FEATURE_METRIC_SEEDS
).flatMap(([group, seeds]) =>
  seeds.map(([id, label, unit, description]) => ({
    id,
    label,
    kind: 'simulation' as const,
    supportTier: 'first-class' as const,
    evidenceModes: ['discrete'] as const,
    operators: ALL_OPERATORS,
    group: group as RubricMetricGroup,
    unit,
    description
  }))
)

/** Every feature metric id (cache, collapsing, change stream, telemetry, cluster, edges, fault domains). */
export const FEATURE_RUBRIC_METRIC_IDS: readonly string[] = FEATURE_METRIC_CAPABILITIES.map(
  (capabilityDefinition) => capabilityDefinition.id
)

const INVARIANT_METRIC_IDS = [
  'invariantViolations.count',
  'sloBreaches.count',
  'slo.maxBurnRate',
  'slo.budgetsExceeded.count',
  'conservation.unbalanced',
  'littlesLaw.violations'
] as const

export const RUBRIC_METRIC_CAPABILITIES: readonly RubricMetricCapability[] = [
  ...TOPOLOGY_METRIC_IDS.map((id) => metric(id, 'topology', ['discrete', 'analytic'])),
  ...SIMULATION_METRIC_IDS.map((id) => metric(id, 'simulation', ['discrete', 'analytic'])),
  ...FEATURE_METRIC_CAPABILITIES,
  ...INVARIANT_METRIC_IDS.map((id) => metric(id, 'invariant', ['discrete', 'analytic']))
]

export function getRubricMetricCapability(id: string): RubricMetricCapability | undefined {
  return RUBRIC_METRIC_CAPABILITIES.find((capabilityDefinition) => capabilityDefinition.id === id)
}

export const SIMULATION_RUBRIC_METRICS: ReadonlySet<string> = new Set([
  ...SIMULATION_METRIC_IDS,
  ...FEATURE_RUBRIC_METRIC_IDS
])
export const TOPOLOGY_RUBRIC_METRICS: ReadonlySet<string> = new Set(TOPOLOGY_METRIC_IDS)
export const INVARIANT_RUBRIC_METRICS: ReadonlySet<string> = new Set(INVARIANT_METRIC_IDS)

export const NFR_METRIC_TO_RUBRIC_METRIC: Readonly<Record<string, string>> = {
  latency_p99: 'summary.latency.p99',
  latency_p50: 'summary.latency.p50',
  error_rate: 'summary.errorRate',
  throughput: 'summary.throughput'
}

export interface AuthoringComponentCapability {
  id: ComponentType
  label: string
  category: ComponentCategory
  supportTier: SupportTier
  supportSummary: string
  /**
   * Alternate palette names that resolve to this same componentType (e.g.
   * "Traffic Source" and "Client App" both map to `api-endpoint`). One row is
   * shown per componentType because grading targets the resolved type, but
   * these aliases keep every palette name searchable.
   */
  aliases: readonly string[]
}

function buildComponentCapabilities(): AuthoringComponentCapability[] {
  const byType = new Map<ComponentType, AuthoringComponentCapability>()
  const aliasesByType = new Map<ComponentType, Set<string>>()
  for (const template of Object.values(PALETTE_TEMPLATES)) {
    // Composite location/container templates are canvas primitives, not
    // component choices that grading rules can target.
    if (!template.componentType || !template.category) continue
    const aliases = aliasesByType.get(template.componentType) ?? new Set<string>()
    if (template.label) aliases.add(template.label)
    if (template.subLabel) aliases.add(template.subLabel)
    aliasesByType.set(template.componentType, aliases)
    if (byType.has(template.componentType)) continue
    const support = getComponentCategorySupport(template.category)
    byType.set(template.componentType, {
      id: template.componentType,
      label: template.label,
      category: template.category,
      supportTier: support.tier,
      supportSummary: support.summary,
      aliases: []
    })
  }
  return [...byType.values()]
    .map((capability) => ({
      ...capability,
      aliases: [...(aliasesByType.get(capability.id) ?? [])].filter(
        (alias) => alias !== capability.label
      )
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export const AUTHORING_COMPONENT_CAPABILITIES = buildComponentCapabilities()

/**
 * Canonical palette template per component type: the first template of each
 * type, matching how {@link buildComponentCapabilities} picks the single
 * authoring row a component type is chosen by. The learner palette uses this so
 * that a question's `allowedNodeTypes` surfaces exactly the item the author
 * selected — not every same-type template (e.g. allowing `microservice` shows
 * "API Server" only, not also "ID Generator", "Service", "My Service").
 */
function buildCanonicalTemplateIds(): Record<string, string> {
  const byType: Record<string, string> = {}
  for (const template of Object.values(PALETTE_TEMPLATES)) {
    if (!template.componentType || !template.category) continue
    if (byType[template.componentType]) continue
    byType[template.componentType] = template.id
  }
  return byType
}

export const CANONICAL_TEMPLATE_ID_BY_COMPONENT_TYPE: Readonly<Record<string, string>> =
  buildCanonicalTemplateIds()

export const AUTHORING_OBLIGATION_CAPABILITIES: readonly AuthoringCapabilityDefinition[] = [
  ...STRUCTURAL_AUTHORING_CAPABILITIES,
  ...SEMANTIC_AUTHORING_CAPABILITIES
]
