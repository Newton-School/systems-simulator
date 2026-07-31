/**
 * All possible event types that drive the simulation state.
 */
export type EventType =
  | 'request-generated'
  | 'request-arrival'
  | 'processing-start'
  | 'processing-complete'
  | 'request-forwarded'
  | 'request-complete'
  | 'request-timeout'
  | 'request-rejected'
  | 'node-failure'
  | 'node-recovery'
  | 'network-partition'
  | 'latency-spike'
  | 'scale-up'
  | 'scale-down'
  | 'circuit-breaker-open'
  | 'circuit-breaker-close'
  | 'health-check'
  | 'cache-hit'
  | 'cache-miss'
  | 'db-failover'

/**
 * Priorities for tie-breaking when two events share the same timestamp.
 * Lower number = higher priority. (At runtime)
 */
export const EventPriority = {
  SYSTEM: 0, // health checks, config changes, node failures
  ARRIVAL: 1, // request arrivals
  PROCESSING: 2, // processing start/complete
  DEPARTURE: 3, // request forwarding
  TIMEOUT: 4 // timeouts (process last — give the request a chance to complete)
} as const

export interface SimulationEvent {
  timestamp: bigint // microseconds
  type: EventType
  nodeId: string
  requestId: string
  data: Record<string, unknown> // event-specific payload
  priority: number // derived from EventPriority
}

export interface RequestSpan {
  nodeId: string
  arrivalTime: bigint
  queueWait: bigint
  serviceTime: bigint
  departureTime: bigint
}

/** One node visit in a request's first-class phase record. */
export interface RequestNodePhase {
  nodeId: string
  nodeArrivalUs: bigint
  serviceStartUs?: bigint
  departureUs?: bigint
}

/**
 * One successful edge traversal in a request's phase timeline. `edgeIn` is when
 * the request entered the edge (left the upstream component); `edgeOut` is when
 * it arrived downstream. `edgeOut − edgeIn` is that hop's transit latency —
 * the piece of end-to-end latency that lives on the network rather than a node.
 */
export interface EdgeHop {
  edgeId: string
  source: string
  target: string
  edgeInUs: bigint
  edgeOutUs: bigint
}

/** One edge attempt in a request's first-class phase record. */
export interface RequestEdgePhase {
  edgeId: string
  source: string
  target: string
  edgeInUs: bigint
  edgeOutUs?: bigint
}

export type RequestTerminalCause =
  | 'completed'
  | 'queue_full'
  | 'node_failed'
  | 'network_error'
  | 'timeout'
  | 'connection_reset'
  | 'rejected'

/** Terminal truth for a request — who ended it, when, and why. */
export interface RequestTerminalPhase {
  timeUs: bigint
  cause: RequestTerminalCause
  locus: string
  locusKind: 'node' | 'edge'
}

/**
 * First-class per-request microsecond timeline. Every projected latency in the
 * engine/UI is a subtraction over this one structure.
 */
export interface RequestPhaseRecord {
  bornAtUs: bigint
  nodes: RequestNodePhase[]
  edges: RequestEdgePhase[]
  terminal?: RequestTerminalPhase
}

export interface Request {
  id: string
  type: string // e.g., "GET", "POST", "DB_QUERY"
  sizeBytes: number
  priority: number // 0 = high, 1 = normal, 2 = low
  createdAt: bigint // timestamp when generated
  deadline: bigint // absolute timeout timestamp
  path: string[] // nodeIds visited so far
  spans: RequestSpan[] // tracing data per node
  hops?: EdgeHop[] // successful edge traversals, for phase-timeline decomposition
  phaseRecord?: RequestPhaseRecord
  retryCount: number
  metadata: Record<string, unknown>
  /**
   * Lazy-tombstone generation for this request's SERVICE_COMPLETE
   * (`processing-complete`) events. Every such event snapshots this value at
   * schedule time; on pop, a mismatch means the event was superseded (e.g. by a
   * failure transition) and must be discarded silently. Separate from
   * `timeoutSeq` so failure onset can cancel a completion without touching the
   * request's live timeout, and vice versa. Defaults to 0 on creation.
   */
  completionSeq?: number
  /**
   * Lazy-tombstone generation for this request's TIMEOUT_FIRE
   * (`request-timeout`) events. See {@link Request.completionSeq}. Defaults to 0.
   */
  timeoutSeq?: number
}

export type EdgeFlowStatus = 'success' | 'edge-error' | 'packet-loss' | 'timeout'
export type EdgeFailureCause =
  | 'connection_refused'
  | 'edge_error_rate'
  | 'packet_loss'
  | 'deadline_exceeded'

export interface EdgeFlowEvent {
  sequence: number
  requestId: string
  edgeId: string
  sourceNodeId: string
  targetNodeId: string
  startedAtMs: number
  completedAtMs: number
  latencyMs: number
  status: EdgeFlowStatus
  failureCause?: EdgeFailureCause
}

/**
 * Internal helper to resolve the default priority based on EventType. (At runtime)
 */
function getDefaultPriority(type: EventType): number {
  switch (type) {
    case 'request-generated':
    case 'request-arrival':
      return EventPriority.ARRIVAL

    case 'processing-start':
    case 'processing-complete':
    case 'request-complete':
    case 'request-rejected':
    case 'cache-hit':
    case 'cache-miss':
      return EventPriority.PROCESSING

    case 'request-forwarded':
      return EventPriority.DEPARTURE

    case 'request-timeout':
      return EventPriority.TIMEOUT

    case 'node-failure':
    case 'node-recovery':
    case 'network-partition':
    case 'latency-spike':
    case 'scale-up':
    case 'scale-down':
    case 'circuit-breaker-open':
    case 'circuit-breaker-close':
    case 'health-check':
    case 'db-failover':
      return EventPriority.SYSTEM

    default: {
      const _exhaustiveCheck: never = type
      throw new Error(`Unhandled event type in getDefaultPriority: ${_exhaustiveCheck}`)
    }
  }
}

export function cloneRequestPhaseRecord(
  phaseRecord: RequestPhaseRecord | undefined
): RequestPhaseRecord | undefined {
  if (!phaseRecord) {
    return undefined
  }

  return {
    bornAtUs: phaseRecord.bornAtUs,
    nodes: phaseRecord.nodes.map((phase) => ({ ...phase })),
    edges: phaseRecord.edges.map((phase) => ({ ...phase })),
    terminal: phaseRecord.terminal ? { ...phaseRecord.terminal } : undefined
  }
}

/**
 * Factory function to generate standard simulation events.
 * Auto-assigns the correct tie-breaking priority if not explicitly provided. (At run time)
 */
export function createEvent(
  type: EventType,
  nodeId: string,
  requestId: string,
  data: Record<string, unknown>,
  timestamp: bigint,
  priority?: number
): SimulationEvent {
  return {
    timestamp,
    type,
    nodeId,
    requestId,
    data,
    priority: priority ?? getDefaultPriority(type)
  }
}
