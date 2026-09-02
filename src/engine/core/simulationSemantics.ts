export const REQUEST_LIFECYCLE_STATES = [
  'generated',
  'admitted',
  'queued',
  'processing',
  'forwarded',
  'completed',
  'timed-out',
  'rejected',
  'in-flight'
] as const

export type RequestLifecycleState = (typeof REQUEST_LIFECYCLE_STATES)[number]

export const IDEMPOTENCY_DECISIONS = ['recorded', 'duplicate', 'no-key'] as const
export type IdempotencyDecision = (typeof IDEMPOTENCY_DECISIONS)[number]

export const LOCK_DECISIONS = [
  'attempting',
  'acquired',
  'contended',
  'held-by-request',
  'no-key'
] as const
export type LockDecision = (typeof LOCK_DECISIONS)[number]

export const RESERVATION_DECISIONS = ['committed', 'sold-out', 'oversold', 'no-key'] as const
export type ReservationDecision = (typeof RESERVATION_DECISIONS)[number]

export const DELIVERY_GUARANTEES = [
  'best-effort',
  'at-most-once',
  'at-least-once',
  'effectively-once',
  'exactly-once'
] as const

export type DeliveryGuarantee = (typeof DELIVERY_GUARANTEES)[number]

export const QUEUE_DELIVERY_SEMANTICS = ['at-most-once', 'at-least-once', 'exactly-once'] as const

export type QueueDeliverySemantics = (typeof QUEUE_DELIVERY_SEMANTICS)[number]

export const REQUEST_STATE_SCOPES = [
  'request',
  'delivery',
  'broker',
  'replication',
  'protocol',
  'idempotency',
  'commit-outcome',
  'lock',
  'reservation'
] as const

export type RequestStateScope = (typeof REQUEST_STATE_SCOPES)[number]

export const REQUEST_TIMELINE_STATES = [
  'generated',
  'admitted',
  'queued',
  'processing',
  'forwarded',
  'retry-scheduled',
  'completed',
  'timed-out',
  'rejected',
  'in-flight'
] as const

export type RequestTimelineState = (typeof REQUEST_TIMELINE_STATES)[number]

export const DELIVERY_TIMELINE_STATES = [
  'producer-acked',
  'released-to-consumer',
  'redelivery-scheduled',
  'dlq-routed'
] as const

export type DeliveryTimelineState = (typeof DELIVERY_TIMELINE_STATES)[number]

export const BROKER_TIMELINE_STATES = [
  'partition-assigned',
  'group-delivered',
  'offset-committed',
  'retention-expired',
  'broker-unavailable',
  'broker-recovered'
] as const

export type BrokerTimelineState = (typeof BROKER_TIMELINE_STATES)[number]

export const REPLICATION_TIMELINE_STATES = [
  'quorum-committed',
  'quorum-unavailable',
  'replica-read',
  'stale-read-possible',
  'leader-promoted',
  'failover-in-progress'
] as const
export type ReplicationTimelineState = (typeof REPLICATION_TIMELINE_STATES)[number]
export const PROTOCOL_TIMELINE_STATES = [
  'session-open',
  'session-closed',
  'http-acknowledged',
  'l7-rejected',
  'flow-controlled'
] as const
export type ProtocolTimelineState = (typeof PROTOCOL_TIMELINE_STATES)[number]

export const IDEMPOTENCY_TIMELINE_STATES = ['recorded', 'deduped', 'key-missing'] as const
export type IdempotencyTimelineState = (typeof IDEMPOTENCY_TIMELINE_STATES)[number]

export const COMMIT_OUTCOME_TIMELINE_STATES = [
  'intent-recorded',
  'commit-confirmed',
  'outcome-unknown',
  'replay-blocked'
] as const

export type CommitOutcomeTimelineState = (typeof COMMIT_OUTCOME_TIMELINE_STATES)[number]

export const LOCK_TIMELINE_STATES = [
  'attempting',
  'acquired',
  'contended',
  'held',
  'released',
  'key-missing'
] as const

export type LockTimelineState = (typeof LOCK_TIMELINE_STATES)[number]

export const RESERVATION_TIMELINE_STATES = [
  'committed',
  'sold-out',
  'oversold',
  'key-missing'
] as const

export type ReservationTimelineState = (typeof RESERVATION_TIMELINE_STATES)[number]

export type RequestStateValue =
  | RequestTimelineState
  | DeliveryTimelineState
  | BrokerTimelineState
  | ReplicationTimelineState
  | ProtocolTimelineState
  | IdempotencyTimelineState
  | CommitOutcomeTimelineState
  | LockTimelineState
  | ReservationTimelineState

export const REQUEST_STATE_TRANSITION_SOURCES = ['event', 'trait', 'engine'] as const

export type RequestStateTransitionSource = (typeof REQUEST_STATE_TRANSITION_SOURCES)[number]

export interface RequestStateTransition {
  scope: RequestStateScope
  state: RequestStateValue
  timestampUs: string
  source: RequestStateTransitionSource
  nodeId?: string
  detail?: string
  reasonCode?: string
}

export type RequestOutcomeStatusLike =
  | 'success'
  | 'timeout'
  | 'rejected'
  | 'connection_reset'
  | 'in-flight'

export interface QueueDeliverySemanticsInput {
  deliverySemantics: QueueDeliverySemantics
  maxReceiveCount?: number | null
  dlqNodeId?: string | null
}

export interface QueueDeliveryAssessment {
  configuredSemantics: QueueDeliverySemantics
  runtimeGuarantee: Exclude<DeliveryGuarantee, 'best-effort' | 'exactly-once'>
  duplicatePossible: boolean
  replayPossible: boolean
  lossPossible: boolean
  downgradedFromConfigured: boolean
  summary: string
}

export interface RequestSemanticsSnapshot {
  lifecycleState: RequestLifecycleState
  flowKind: 'direct' | 'queued'
  delivery: QueueDeliveryAssessment | null
  stateTags: string[]
  coordination: {
    idempotencyDecision: IdempotencyDecision | null
    lockDecision: LockDecision | null
    reservationDecision: ReservationDecision | null
  }
  notes: string[]
}

const DEFAULT_QUEUE_DELIVERY: QueueDeliverySemantics = 'at-most-once'
const IDEMPOTENCY_DECISION_METADATA_KEY = '__semanticsIdempotencyDecision'
const LOCK_DECISION_METADATA_KEY = '__semanticsLockDecision'
const RESERVATION_DECISION_METADATA_KEY = '__semanticsReservationDecision'

interface MetadataCarrier {
  metadata: Record<string, unknown>
}

interface StateTimelineCarrier {
  stateTimeline?: RequestStateTransition[]
}

interface RequestStateTransitionInput {
  scope: RequestStateScope
  state: RequestStateValue
  timestampUs: bigint | number | string
  source: RequestStateTransitionSource
  nodeId?: string | null
  detail?: string | null
  reasonCode?: string | null
}

interface RequestSemanticsContext {
  queueDelivery?: QueueDeliverySemanticsInput | null
  metadata?: Record<string, unknown> | null
  attempts?: number
}

function hasDlq(config: QueueDeliverySemanticsInput): boolean {
  return typeof config.dlqNodeId === 'string' && config.dlqNodeId.trim().length > 0
}

function normalizeTimestampUs(timestampUs: bigint | number | string): string {
  if (typeof timestampUs === 'bigint') {
    return timestampUs.toString()
  }

  if (typeof timestampUs === 'number') {
    if (!Number.isFinite(timestampUs) || timestampUs < 0) {
      throw new Error(`timestampUs must be a non-negative finite number: ${timestampUs}`)
    }
    return Math.trunc(timestampUs).toString()
  }

  if (!/^\d+$/.test(timestampUs)) {
    throw new Error(`timestampUs must be a non-negative integer string: ${timestampUs}`)
  }
  return timestampUs
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function maybeSetDetail(parts: Array<string | null | undefined>): string | undefined {
  const detail = parts.filter((part): part is string => typeof part === 'string' && part.length > 0)
  return detail.length > 0 ? detail.join(' • ') : undefined
}

function transitionsEqual(first: RequestStateTransition, second: RequestStateTransition): boolean {
  return (
    first.scope === second.scope &&
    first.state === second.state &&
    first.timestampUs === second.timestampUs &&
    first.source === second.source &&
    first.nodeId === second.nodeId &&
    first.detail === second.detail &&
    first.reasonCode === second.reasonCode
  )
}

export function cloneRequestStateTimeline(
  transitions: readonly RequestStateTransition[] | undefined
): RequestStateTransition[] | undefined {
  if (!transitions) {
    return undefined
  }

  return transitions.map((transition) => ({ ...transition }))
}

export function recordRequestStateTransition(
  carrier: StateTimelineCarrier,
  input: RequestStateTransitionInput
): RequestStateTransition {
  const timeline = carrier.stateTimeline ?? []
  const transition: RequestStateTransition = {
    scope: input.scope,
    state: input.state,
    timestampUs: normalizeTimestampUs(input.timestampUs),
    source: input.source,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {})
  }

  const last = timeline[timeline.length - 1]
  if (last && transitionsEqual(last, transition)) {
    carrier.stateTimeline = timeline
    return last
  }

  timeline.push(transition)
  carrier.stateTimeline = timeline
  return transition
}

export function deriveTraitStateTransitions(
  payload: Record<string, unknown>
): Array<Omit<RequestStateTransitionInput, 'timestampUs' | 'source' | 'nodeId'>> {
  const transitions: Array<Omit<RequestStateTransitionInput, 'timestampUs' | 'source' | 'nodeId'>> =
    []
  const reasonCode = asNonEmptyString(payload.reason)
  const resourceKey = asNonEmptyString(payload.resourceKey)
  const idempotencyKey = asNonEmptyString(payload.idempotencyKey)
  const firstCommitter = asNonEmptyString(payload.firstCommitter)

  if (payload.forkConsumerRequest === true) {
    transitions.push({
      scope: 'delivery',
      state: 'producer-acked',
      detail: 'Producer was acknowledged at enqueue time.'
    })
  }

  switch (payload.idempotencyDecision) {
    case 'recorded':
      transitions.push({
        scope: 'idempotency',
        state: 'recorded',
        detail: maybeSetDetail([idempotencyKey ? `key ${idempotencyKey}` : null])
      })
      break
    case 'duplicate':
      transitions.push({
        scope: 'idempotency',
        state: 'deduped',
        detail: maybeSetDetail([idempotencyKey ? `key ${idempotencyKey}` : null])
      })
      break
    case 'no-key':
      transitions.push({
        scope: 'idempotency',
        state: 'key-missing',
        detail: 'No idempotency key was present on the request.'
      })
      break
  }

  switch (payload.commitOutcomeDecision) {
    case 'intent-recorded':
      transitions.push({
        scope: 'commit-outcome',
        state: 'intent-recorded',
        detail: maybeSetDetail([idempotencyKey ? `key ${idempotencyKey}` : null])
      })
      break
    case 'commit-confirmed':
      transitions.push({
        scope: 'commit-outcome',
        state: 'commit-confirmed',
        detail: maybeSetDetail([idempotencyKey ? `key ${idempotencyKey}` : null])
      })
      break
    case 'outcome-unknown':
      transitions.push({
        scope: 'commit-outcome',
        state: 'outcome-unknown',
        detail: maybeSetDetail([idempotencyKey ? `key ${idempotencyKey}` : null]),
        reasonCode: reasonCode ?? undefined
      })
      break
    case 'replay-blocked':
      transitions.push({
        scope: 'commit-outcome',
        state: 'replay-blocked',
        detail: maybeSetDetail([idempotencyKey ? `key ${idempotencyKey}` : null]),
        reasonCode: 'commit_outcome_unknown'
      })
      break
  }

  if (typeof payload.streamPartition === 'number') {
    transitions.push({
      scope: 'broker',
      state: 'partition-assigned',
      detail: `partition ${payload.streamPartition}`
    })
  }
  if (typeof payload.consumerGroup === 'string') {
    transitions.push({
      scope: 'broker',
      state: 'group-delivered',
      detail: `group ${payload.consumerGroup}`
    })
  }
  if (payload.streamOffsetCommitted === true) {
    transitions.push({
      scope: 'broker',
      state: 'offset-committed',
      detail:
        typeof payload.streamOffset === 'number' ? `offset ${payload.streamOffset}` : undefined
    })
  }
  if (payload.streamRetentionExpired === true) {
    transitions.push({
      scope: 'broker',
      state: 'retention-expired',
      detail: 'Expired records were removed by retention.'
    })
  }
  if (payload.streamBrokerAvailable === false) {
    transitions.push({
      scope: 'broker',
      state: 'broker-unavailable',
      detail: 'Broker availability blocked stream append or delivery.'
    })
  } else if (payload.streamBrokerAvailable === true) {
    transitions.push({
      scope: 'broker',
      state: 'broker-recovered',
      detail: 'Broker availability resumed stream append or delivery.'
    })
  }
  if (payload.replicationWriteAck === 'quorum')
    transitions.push({ scope: 'replication', state: 'quorum-committed' })
  if (payload.replicationQuorumUnavailable === true)
    transitions.push({ scope: 'replication', state: 'quorum-unavailable' })
  if (payload.replicationFailoverInProgress === true)
    transitions.push({ scope: 'replication', state: 'failover-in-progress' })
  if (payload.replicationRead === 'replica')
    transitions.push({ scope: 'replication', state: 'replica-read' })
  if (typeof payload.replicationLagMs === 'number' && payload.replicationLagMs > 0)
    transitions.push({ scope: 'replication', state: 'stale-read-possible' })
  if (typeof payload.replicationLeader === 'string')
    transitions.push({
      scope: 'replication',
      state: 'leader-promoted',
      detail: payload.replicationLeader
    })

  switch (payload.lockDecision) {
    case 'attempting':
      transitions.push({
        scope: 'lock',
        state: 'attempting',
        detail: maybeSetDetail([resourceKey ? `key ${resourceKey}` : null])
      })
      break
    case 'acquired':
      transitions.push({
        scope: 'lock',
        state: 'acquired',
        detail: maybeSetDetail([resourceKey ? `key ${resourceKey}` : null])
      })
      break
    case 'contended':
      transitions.push({
        scope: 'lock',
        state: 'contended',
        detail: maybeSetDetail([resourceKey ? `key ${resourceKey}` : null, reasonCode]),
        ...(reasonCode ? { reasonCode } : {})
      })
      break
    case 'held-by-request':
      transitions.push({
        scope: 'lock',
        state: 'held',
        detail: maybeSetDetail([resourceKey ? `key ${resourceKey}` : null])
      })
      break
    case 'no-key':
      transitions.push({
        scope: 'lock',
        state: 'key-missing',
        detail: 'No lock key was present on the request.'
      })
      break
  }
  if (payload.protocolSessionOpen === true)
    transitions.push({ scope: 'protocol', state: 'session-open' })
  if (payload.protocolSessionClosed === true)
    transitions.push({ scope: 'protocol', state: 'session-closed' })
  if (typeof payload.protocolHttpAcknowledgement === 'string')
    transitions.push({
      scope: 'protocol',
      state: 'http-acknowledged',
      detail: payload.protocolHttpAcknowledgement
    })
  if (payload.protocolL7Rejected === true)
    transitions.push({ scope: 'protocol', state: 'l7-rejected' })
  if (payload.protocolFlowControlled === true)
    transitions.push({ scope: 'protocol', state: 'flow-controlled' })

  switch (payload.reservationDecision) {
    case 'committed':
      transitions.push({
        scope: 'reservation',
        state: 'committed',
        detail: maybeSetDetail([resourceKey ? `key ${resourceKey}` : null])
      })
      break
    case 'sold-out':
      transitions.push({
        scope: 'reservation',
        state: 'sold-out',
        detail: maybeSetDetail([resourceKey ? `key ${resourceKey}` : null])
      })
      break
    case 'oversold':
      transitions.push({
        scope: 'reservation',
        state: 'oversold',
        detail: maybeSetDetail([
          resourceKey ? `key ${resourceKey}` : null,
          firstCommitter ? `first committer ${firstCommitter}` : null
        ])
      })
      break
    case 'no-key':
      transitions.push({
        scope: 'reservation',
        state: 'key-missing',
        detail: 'No reservation key was present on the request.'
      })
      break
  }

  return transitions
}

export function isQueueDeliverySemantics(value: unknown): value is QueueDeliverySemantics {
  return value === 'at-most-once' || value === 'at-least-once' || value === 'exactly-once'
}

export function normalizeQueueDeliverySemantics(
  value: unknown,
  fallback: QueueDeliverySemantics = DEFAULT_QUEUE_DELIVERY
): QueueDeliverySemantics {
  return isQueueDeliverySemantics(value) ? value : fallback
}

function isIdempotencyDecision(value: unknown): value is IdempotencyDecision {
  return value === 'recorded' || value === 'duplicate' || value === 'no-key'
}

function isLockDecision(value: unknown): value is LockDecision {
  return (
    value === 'attempting' ||
    value === 'acquired' ||
    value === 'contended' ||
    value === 'held-by-request' ||
    value === 'no-key'
  )
}

function isReservationDecision(value: unknown): value is ReservationDecision {
  return value === 'committed' || value === 'sold-out' || value === 'oversold' || value === 'no-key'
}

function readDecision<T extends string>(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  guard: (value: unknown) => value is T
): T | null {
  const value = metadata?.[key]
  return guard(value) ? value : null
}

export function writeIdempotencyDecision(
  request: MetadataCarrier,
  decision: IdempotencyDecision
): void {
  request.metadata[IDEMPOTENCY_DECISION_METADATA_KEY] = decision
}

export function writeLockDecision(request: MetadataCarrier, decision: LockDecision): void {
  request.metadata[LOCK_DECISION_METADATA_KEY] = decision
}

export function writeReservationDecision(
  request: MetadataCarrier,
  decision: ReservationDecision
): void {
  request.metadata[RESERVATION_DECISION_METADATA_KEY] = decision
}

function buildCoordinationSnapshot(metadata: Record<string, unknown> | null | undefined): {
  idempotencyDecision: IdempotencyDecision | null
  lockDecision: LockDecision | null
  reservationDecision: ReservationDecision | null
} {
  return {
    idempotencyDecision: readDecision(
      metadata,
      IDEMPOTENCY_DECISION_METADATA_KEY,
      isIdempotencyDecision
    ),
    lockDecision: readDecision(metadata, LOCK_DECISION_METADATA_KEY, isLockDecision),
    reservationDecision: readDecision(
      metadata,
      RESERVATION_DECISION_METADATA_KEY,
      isReservationDecision
    )
  }
}

function buildStateTags(
  coordination: RequestSemanticsSnapshot['coordination'],
  flowKind: RequestSemanticsSnapshot['flowKind'],
  attempts: number
): string[] {
  const tags = new Set<string>()
  if (flowKind === 'queued') {
    tags.add('queued-delivery')
  }
  if (attempts > 1) {
    tags.add('retried')
  }
  if (coordination.idempotencyDecision) {
    tags.add(`idempotency:${coordination.idempotencyDecision}`)
  }
  if (coordination.lockDecision) {
    tags.add(`lock:${coordination.lockDecision}`)
  }
  if (coordination.reservationDecision) {
    tags.add(`reservation:${coordination.reservationDecision}`)
  }
  return [...tags]
}

function appendCoordinationNotes(
  notes: string[],
  coordination: RequestSemanticsSnapshot['coordination']
): void {
  switch (coordination.idempotencyDecision) {
    case 'duplicate':
      notes.push(
        'The idempotency guard suppressed a duplicate retry before downstream side effects.'
      )
      break
    case 'recorded':
      notes.push(
        'The idempotency guard recorded a first-seen key and allowed the write path to continue.'
      )
      break
    case 'no-key':
      notes.push(
        'The idempotency guard saw no key, so the request passed through without dedup protection.'
      )
      break
  }

  switch (coordination.lockDecision) {
    case 'acquired':
      notes.push('The request acquired the lock lease for its contended resource key.')
      break
    case 'contended':
      notes.push(
        'The request lost lock contention and was rejected before entering the critical section.'
      )
      break
    case 'held-by-request':
      notes.push(
        'The request already held the lock lease while continuing through the guarded path.'
      )
      break
    case 'attempting':
      notes.push('The request attempted lock acquisition but no later lock state was recorded.')
      break
    case 'no-key':
      notes.push('The lock guard saw no resource key, so the request passed through unlocked.')
      break
  }

  switch (coordination.reservationDecision) {
    case 'committed':
      notes.push('The reservation authority committed the resource key successfully.')
      break
    case 'sold-out':
      notes.push(
        'The reservation authority reported the resource key as already committed at the same authority.'
      )
      break
    case 'oversold':
      notes.push(
        'A second independent reservation authority also committed the same key, exposing an oversell.'
      )
      break
    case 'no-key':
      notes.push(
        'The reservation authority saw no resource key, so the request bypassed reservation logic.'
      )
      break
  }
}

export function classifyRequestLifecycleState(
  status: RequestOutcomeStatusLike
): RequestLifecycleState {
  switch (status) {
    case 'success':
      return 'completed'
    case 'timeout':
      return 'timed-out'
    case 'rejected':
    case 'connection_reset':
      return 'rejected'
    case 'in-flight':
      return 'in-flight'
  }
}

export function assessQueueDeliverySemantics(
  input: QueueDeliverySemanticsInput
): QueueDeliveryAssessment {
  const configuredSemantics = normalizeQueueDeliverySemantics(input.deliverySemantics)
  const lossPossibleWithoutDlq = !hasDlq(input) && (input.maxReceiveCount ?? null) !== null

  switch (configuredSemantics) {
    case 'at-most-once':
      return {
        configuredSemantics,
        runtimeGuarantee: 'at-most-once',
        duplicatePossible: false,
        replayPossible: false,
        lossPossible: true,
        downgradedFromConfigured: false,
        summary:
          'Dropped consumer attempts are not replayed. This is the current no-redelivery queue behavior.'
      }
    case 'at-least-once':
      return {
        configuredSemantics,
        runtimeGuarantee: 'at-least-once',
        duplicatePossible: true,
        replayPossible: true,
        lossPossible: lossPossibleWithoutDlq,
        downgradedFromConfigured: false,
        summary: hasDlq(input)
          ? 'Failed attempts are replayed and can move to a DLQ after the receive budget is exhausted.'
          : 'Failed attempts are replayed, duplicates are possible, and messages can still disappear after the receive budget is exhausted.'
      }
    case 'exactly-once':
      return {
        configuredSemantics,
        runtimeGuarantee: 'at-least-once',
        duplicatePossible: true,
        replayPossible: true,
        lossPossible: lossPossibleWithoutDlq,
        downgradedFromConfigured: true,
        summary: hasDlq(input)
          ? 'Configured exactly-once is currently downgraded to at-least-once runtime behavior; duplicates remain possible and exhausted messages move to a DLQ.'
          : 'Configured exactly-once is currently downgraded to at-least-once runtime behavior; duplicates remain possible and exhausted messages can still disappear.'
      }
  }
}

export function buildRequestSemanticsSnapshot(
  status: RequestOutcomeStatusLike,
  context: RequestSemanticsContext = {}
): RequestSemanticsSnapshot {
  const lifecycleState = classifyRequestLifecycleState(status)
  const flowKind = context.queueDelivery ? 'queued' : 'direct'
  const coordination = buildCoordinationSnapshot(context.metadata)
  const stateTags = buildStateTags(coordination, flowKind, context.attempts ?? 1)

  if (!context.queueDelivery) {
    const notes = ['No queue delivery contract was attached to this request path.']
    appendCoordinationNotes(notes, coordination)
    return {
      lifecycleState,
      flowKind,
      delivery: null,
      stateTags,
      coordination,
      notes
    }
  }

  const delivery = assessQueueDeliverySemantics(context.queueDelivery)
  const notes = [delivery.summary]
  if (delivery.downgradedFromConfigured) {
    notes.push(
      'Commit outcome coordination is not modeled yet, so true exactly-once is not proved.'
    )
  }
  if ((context.attempts ?? 1) > 1) {
    notes.push('This request was replayed at least once after an earlier delivery attempt.')
  }
  appendCoordinationNotes(notes, coordination)

  return {
    lifecycleState,
    flowKind,
    delivery,
    stateTags,
    coordination,
    notes
  }
}
