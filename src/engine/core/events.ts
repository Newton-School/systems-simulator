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

export interface Request {
  id: string
  type: string // e.g., "GET", "POST", "DB_QUERY"
  sizeBytes: number
  priority: number // 0 = high, 1 = normal, 2 = low
  createdAt: bigint // timestamp when generated
  deadline: bigint // absolute timeout timestamp
  path: string[] // nodeIds visited so far
  spans: RequestSpan[] // tracing data per node
  retryCount: number
  metadata: Record<string, unknown>
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
