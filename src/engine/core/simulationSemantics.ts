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

export const DELIVERY_GUARANTEES = [
  'best-effort',
  'at-most-once',
  'at-least-once',
  'effectively-once',
  'exactly-once'
] as const

export type DeliveryGuarantee = (typeof DELIVERY_GUARANTEES)[number]

export const QUEUE_DELIVERY_SEMANTICS = [
  'at-most-once',
  'at-least-once',
  'exactly-once'
] as const

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
  notes: string[]
}

const DEFAULT_QUEUE_DELIVERY: QueueDeliverySemantics = 'at-most-once'

function hasDlq(config: QueueDeliverySemanticsInput): boolean {
  return typeof config.dlqNodeId === 'string' && config.dlqNodeId.trim().length > 0
}

export function isQueueDeliverySemantics(value: unknown): value is QueueDeliverySemantics {
  return (
    value === 'at-most-once' || value === 'at-least-once' || value === 'exactly-once'
  )
}

export function normalizeQueueDeliverySemantics(
  value: unknown,
  fallback: QueueDeliverySemantics = DEFAULT_QUEUE_DELIVERY
): QueueDeliverySemantics {
  return isQueueDeliverySemantics(value) ? value : fallback
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
  queueDelivery?: QueueDeliverySemanticsInput | null
): RequestSemanticsSnapshot {
  const lifecycleState = classifyRequestLifecycleState(status)

  if (!queueDelivery) {
    return {
      lifecycleState,
      flowKind: 'direct',
      delivery: null,
      notes: ['No queue delivery contract was attached to this request path.']
    }
  }

  const delivery = assessQueueDeliverySemantics(queueDelivery)
  const notes = [delivery.summary]
  if (delivery.downgradedFromConfigured) {
    notes.push('Commit outcome coordination is not modeled yet, so true exactly-once is not proved.')
  }

  return {
    lifecycleState,
    flowKind: 'queued',
    delivery,
    notes
  }
}
