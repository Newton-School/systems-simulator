import type { EventType, SimulationEvent } from './events'

export const CANONICAL_EVENT_TYPES = [
  'request-generated',
  'request-arrived',
  'request-queued',
  'processing-started',
  'processing-completed',
  'trait-evaluated',
  'request-forwarded',
  'request-completed',
  'request-timed-out',
  'request-rejected',
  'node-failed',
  'node-recovered',
  'health-probed',
  'circuit-breaker-open',
  'circuit-breaker-close'
] as const

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number]

export type TerminalRequestStatus = 'success' | 'timeout' | 'rejected'
export type AdmissionDecisionStatus = 'accepted' | 'queued' | 'rejected' | 'timed-out'
export type DebugEventStatus = 'info' | 'success' | 'timeout' | 'rejected' | 'failure'

export type JsonSafeValue =
  | string
  | number
  | boolean
  | null
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue }

export type EventCountsByType = Record<CanonicalEventType, number>

export interface NodeSnapshot {
  nodeId: string
  timestampUs: string
  status: string
  queueLength: number
  activeWorkers: number
  utilization: number
  totalInSystem?: number
  workers?: number
  capacity?: number
}

export interface CanonicalEventRecord {
  sequence: number
  timestampUs: string
  type: CanonicalEventType
  priority: number
  requestId?: string
  nodeId?: string
  edgeId?: string
  sourceNodeId?: string
  targetNodeId?: string
  reasonCode?: string
  payload: Record<string, JsonSafeValue>
  nodeSnapshot?: NodeSnapshot
}

export interface AppendEventInput {
  timestampUs: bigint | number | string
  type: CanonicalEventType
  priority: number
  requestId?: string
  nodeId?: string
  edgeId?: string
  sourceNodeId?: string
  targetNodeId?: string
  reasonCode?: string
  payload?: Record<string, unknown>
  nodeSnapshot?: NodeSnapshot
}

export interface AdmissionDecision {
  sequence?: number
  timestampUs: string
  requestId: string
  nodeId: string
  decision: AdmissionDecisionStatus
  reasonCode?: string
  nodeSnapshot?: NodeSnapshot
  payload?: Record<string, JsonSafeValue>
}

export interface DebugEvent {
  sequence: number
  timestampUs: string
  timestampMs: number
  type: CanonicalEventType
  priority: number
  requestId?: string
  nodeId?: string
  edgeId?: string
  sourceNodeId?: string
  targetNodeId?: string
  reasonCode?: string
  status: DebugEventStatus
  message: string
  payload: Record<string, JsonSafeValue>
  nodeSnapshot?: NodeSnapshot
}

export interface RequestLifecycle {
  requestId: string
  status?: TerminalRequestStatus
  events: DebugEvent[]
  path: string[]
  startedAtMs?: number
  completedAtMs?: number
}

interface EventStreamRecorderOptions {
  maxRetainedEvents?: number
  onRecord?: (record: CanonicalEventRecord) => void
}

export class EventStreamRecorder {
  private readonly events: CanonicalEventRecord[] = []
  private countsByType: EventCountsByType = createEmptyEventCounts()
  private nextSequence = 0
  private maxRetainedEvents: number
  private truncated = false

  constructor(private readonly options: EventStreamRecorderOptions = {}) {
    this.maxRetainedEvents = normalizeMaxRetainedEvents(options.maxRetainedEvents)
  }

  append(input: AppendEventInput): CanonicalEventRecord {
    const record: CanonicalEventRecord = {
      sequence: this.nextSequence++,
      timestampUs: normalizeTimestampUs(input.timestampUs),
      type: input.type,
      priority: input.priority,
      requestId: normalizeOptionalString(input.requestId),
      nodeId: normalizeOptionalString(input.nodeId),
      edgeId: normalizeOptionalString(input.edgeId),
      sourceNodeId: normalizeOptionalString(input.sourceNodeId),
      targetNodeId: normalizeOptionalString(input.targetNodeId),
      reasonCode: normalizeOptionalString(input.reasonCode),
      payload: toJsonSafeRecord(input.payload ?? {}),
      nodeSnapshot: input.nodeSnapshot
    }

    if (this.events.length < this.maxRetainedEvents) {
      this.events.push(record)
    } else {
      this.truncated = true
    }
    this.countsByType[record.type]++
    this.options.onRecord?.(record)

    return record
  }

  getEvents(): CanonicalEventRecord[] {
    return [...this.events]
  }

  getCountsByType(): EventCountsByType {
    return { ...this.countsByType }
  }

  getTotalRecordedEvents(): number {
    return this.nextSequence
  }

  isTruncated(): boolean {
    return this.truncated
  }

  setMaxRetainedEvents(maxRetainedEvents: number): void {
    this.maxRetainedEvents = normalizeMaxRetainedEvents(maxRetainedEvents)
  }

  clear(): void {
    this.events.length = 0
    this.countsByType = createEmptyEventCounts()
    this.nextSequence = 0
    this.truncated = false
  }
}

export function createEmptyEventCounts(): EventCountsByType {
  return Object.fromEntries(CANONICAL_EVENT_TYPES.map((type) => [type, 0])) as EventCountsByType
}

export function toCanonicalEventType(type: EventType): CanonicalEventType | null {
  switch (type) {
    case 'request-generated':
      return 'request-generated'
    case 'request-arrival':
      return 'request-arrived'
    case 'processing-start':
      return 'processing-started'
    case 'processing-complete':
      return 'processing-completed'
    case 'request-forwarded':
      return 'request-forwarded'
    case 'request-complete':
      return 'request-completed'
    case 'request-timeout':
      return 'request-timed-out'
    case 'request-rejected':
      return 'request-rejected'
    case 'node-failure':
      return 'node-failed'
    case 'node-recovery':
      return 'node-recovered'
    case 'health-check':
      return 'health-probed'
    case 'circuit-breaker-open':
      return 'circuit-breaker-open'
    case 'circuit-breaker-close':
      return 'circuit-breaker-close'
    default:
      return null
  }
}

export function eventInputFromSimulationEvent(event: SimulationEvent): AppendEventInput | null {
  const type = toCanonicalEventType(event.type)
  if (!type) {
    return null
  }

  return {
    timestampUs: event.timestamp,
    type,
    priority: event.priority,
    requestId: event.requestId,
    nodeId: event.nodeId,
    edgeId: extractEdgeId(event.data),
    sourceNodeId: extractSourceNodeId(event.data),
    targetNodeId: extractTargetNodeId(event.data),
    reasonCode: extractReasonCode(event.data),
    payload: event.data
  }
}

export function projectToDebugEvent(record: CanonicalEventRecord): DebugEvent {
  return {
    sequence: record.sequence,
    timestampUs: record.timestampUs,
    timestampMs: Number(record.timestampUs) / 1000,
    type: record.type,
    priority: record.priority,
    requestId: record.requestId,
    nodeId: record.nodeId,
    edgeId: record.edgeId,
    sourceNodeId: record.sourceNodeId,
    targetNodeId: record.targetNodeId,
    reasonCode: record.reasonCode,
    status: deriveDebugStatus(record.type),
    message: buildDebugMessage(record),
    payload: record.payload,
    nodeSnapshot: record.nodeSnapshot
  }
}

function deriveDebugStatus(type: CanonicalEventType): DebugEventStatus {
  switch (type) {
    case 'request-completed':
      return 'success'
    case 'request-timed-out':
      return 'timeout'
    case 'request-rejected':
      return 'rejected'
    case 'node-failed':
      return 'failure'
    case 'circuit-breaker-open':
      return 'failure'
    default:
      return 'info'
  }
}

function buildDebugMessage(record: CanonicalEventRecord): string {
  const subject = record.requestId ? `request ${record.requestId}` : 'simulation'
  const nodeSuffix = record.nodeId ? ` at ${record.nodeId}` : ''
  const reasonSuffix = record.reasonCode ? ` (${record.reasonCode})` : ''

  switch (record.type) {
    case 'request-generated':
      return `${subject} generated${nodeSuffix}`
    case 'request-arrived':
      return `${subject} arrived${nodeSuffix}`
    case 'request-queued':
      return `${subject} queued${nodeSuffix}`
    case 'processing-started':
      return `${subject} started processing${nodeSuffix}`
    case 'processing-completed':
      return `${subject} completed processing${nodeSuffix}`
    case 'trait-evaluated': {
      const traitName =
        typeof record.payload.traitName === 'string' ? record.payload.traitName : 'unknown-trait'
      const hook = typeof record.payload.hook === 'string' ? record.payload.hook : 'unknown-hook'
      const decision =
        typeof record.payload.decision === 'string' ? record.payload.decision : 'unknown-decision'
      return `${traitName} ${hook} decided ${decision}${nodeSuffix}`
    }
    case 'request-forwarded':
      return `${subject} forwarded${nodeSuffix}`
    case 'request-completed':
      return `${subject} completed${nodeSuffix}`
    case 'request-timed-out':
      return `${subject} timed out${nodeSuffix}${reasonSuffix}`
    case 'request-rejected':
      return `${subject} rejected${nodeSuffix}${reasonSuffix}`
    case 'node-failed':
      return `node ${record.nodeId ?? 'unknown'} failed${reasonSuffix}`
    case 'node-recovered':
      return `node ${record.nodeId ?? 'unknown'} recovered`
    case 'health-probed': {
      const probedHealthy = record.payload.probedHealthy === true
      return `health probe of ${record.nodeId ?? 'unknown'} reported ${probedHealthy ? 'healthy' : 'unhealthy'}`
    }
    case 'circuit-breaker-open':
      return `circuit breaker opened at ${record.nodeId ?? 'unknown'}`
    case 'circuit-breaker-close':
      return `circuit breaker closed at ${record.nodeId ?? 'unknown'}`
  }
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

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined
}

function normalizeMaxRetainedEvents(maxRetainedEvents: number | undefined): number {
  if (maxRetainedEvents === undefined || maxRetainedEvents === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }

  if (!Number.isFinite(maxRetainedEvents) || maxRetainedEvents < 0) {
    throw new Error(`maxRetainedEvents must be a non-negative finite number: ${maxRetainedEvents}`)
  }

  return Math.floor(maxRetainedEvents)
}

function toJsonSafeRecord(value: Record<string, unknown>): Record<string, JsonSafeValue> {
  return toJsonSafeValue(value) as Record<string, JsonSafeValue>
}

function toJsonSafeValue(value: unknown): JsonSafeValue {
  if (value === null) {
    return null
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSafeValue)
  }

  if (typeof value === 'object') {
    if (isRequestRecord(value)) {
      return toJsonSafeRequest(value)
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        toJsonSafeValue(nested)
      ])
    )
  }

  return null
}

function isRequestRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.priority === 'number' &&
    typeof value.createdAt === 'bigint' &&
    typeof value.deadline === 'bigint' &&
    Array.isArray(value.path) &&
    Array.isArray(value.spans)
  )
}

function toJsonSafeRequest(request: Record<string, unknown>): Record<string, JsonSafeValue> {
  const metadata = isRecord(request.metadata) ? request.metadata : {}
  const terminal = metadata.__terminal

  return {
    id: toJsonSafeValue(request.id),
    type: toJsonSafeValue(request.type),
    sizeBytes: toJsonSafeValue(request.sizeBytes),
    priority: toJsonSafeValue(request.priority),
    createdAt: toJsonSafeValue(request.createdAt),
    deadline: toJsonSafeValue(request.deadline),
    path: toJsonSafeValue(request.path),
    retryCount: toJsonSafeValue(request.retryCount),
    terminal: typeof terminal === 'string' ? terminal : null
  }
}

function extractReasonCode(data: Record<string, unknown>): string | undefined {
  const reason = data.reason ?? data.reasonCode
  return typeof reason === 'string' && reason.length > 0 ? reason : undefined
}

function extractEdgeId(data: Record<string, unknown>): string | undefined {
  const edgeId = data.edgeId
  if (typeof edgeId === 'string' && edgeId.length > 0) {
    return edgeId
  }

  const edge = data.edge
  if (isRecord(edge) && typeof edge.id === 'string' && edge.id.length > 0) {
    return edge.id
  }

  return undefined
}

function extractSourceNodeId(data: Record<string, unknown>): string | undefined {
  const sourceNodeId = data.sourceNodeId
  if (typeof sourceNodeId === 'string' && sourceNodeId.length > 0) {
    return sourceNodeId
  }

  const edge = data.edge
  if (isRecord(edge) && typeof edge.source === 'string' && edge.source.length > 0) {
    return edge.source
  }

  return undefined
}

function extractTargetNodeId(data: Record<string, unknown>): string | undefined {
  const targetNodeId = data.targetNodeId
  if (typeof targetNodeId === 'string' && targetNodeId.length > 0) {
    return targetNodeId
  }

  const edge = data.edge
  if (isRecord(edge) && typeof edge.target === 'string' && edge.target.length > 0) {
    return edge.target
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
