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

interface RequestSemanticsContext {
  queueDelivery?: QueueDeliverySemanticsInput | null
  metadata?: Record<string, unknown> | null
  attempts?: number
}

function hasDlq(config: QueueDeliverySemanticsInput): boolean {
  return typeof config.dlqNodeId === 'string' && config.dlqNodeId.trim().length > 0
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
