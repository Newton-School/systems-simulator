import type { EventType, SimulationEvent } from './events'
import { microToMs } from './time'
import type { ComponentNode, EdgeDefinition, NodeState, TopologyJSON } from './types'
import type { RequestTrace, RequestTraceSpan } from '../tracer'

export interface NodeSnapshot {
  status: 'idle' | 'busy' | 'saturated' | 'failed'
  activeWorkers: number
  maxWorkers: number
  queueLength: number
  capacity: number
  utilization: number
  totalInSystem: number
}

export interface DebugEvent {
  index: number
  timestampMs: number
  type: EventType
  nodeId: string
  requestId: string
  status: 'info' | 'success' | 'warn' | 'danger'
  reason: string | null
  edgeId: string | null
  message: string
  nodeState: NodeSnapshot | null
  priority: number
}

export interface PhaseTiming {
  queueWaitMs: number
  serviceTimeMs: number
  edgeLatencyMs: number
  totalMs: number
  startMs: number
  endMs: number
}

export interface LifecyclePhase {
  name: string
  hopIndex: number
  event: DebugEvent
  timing: PhaseTiming | null
  result: 'passed' | 'rejected' | 'timeout' | 'arrived'
}

export interface ExpectedPath {
  nodeIds: string[]
  edgeIds: string[]
  deterministic: boolean
}

export interface RequestLifecycle {
  requestId: string
  phases: LifecyclePhase[]
  terminalStatus: 'success' | 'rejected' | 'timeout' | 'in-flight'
  terminalNode: string | null
  terminalReason: string | null
  totalLatencyMs: number
  expectedPath: ExpectedPath
  actualPath: string[]
}

export interface AdmissionDecision {
  nodeId: string
  outcome: 'admitted' | 'rejected'
  rule: 'capacity' | 'node_failed' | 'security_blocked'
  nodeState: NodeSnapshot
  slots: {
    activeWorkerSlots: number
    queuedSlots: number
    availableSlots: number
  }
  equation: {
    left: number
    operator: '>=' | '<'
    right: number
    result: boolean
  }
}

const STATUS_BY_EVENT_TYPE: Record<EventType, DebugEvent['status']> = {
  'request-generated': 'info',
  'request-arrival': 'info',
  'processing-start': 'info',
  'processing-complete': 'success',
  'request-forwarded': 'success',
  'request-complete': 'success',
  'request-timeout': 'warn',
  'request-rejected': 'danger',
  'node-failure': 'danger',
  'node-recovery': 'success',
  'network-partition': 'danger',
  'latency-spike': 'warn',
  'scale-up': 'success',
  'scale-down': 'warn',
  'circuit-breaker-open': 'danger',
  'circuit-breaker-close': 'success',
  'health-check': 'info',
  'cache-hit': 'success',
  'cache-miss': 'info',
  'db-failover': 'warn'
}

const LIFECYCLE_EVENT_RANK: Partial<Record<EventType, number>> = {
  'request-arrival': 0,
  'processing-complete': 1,
  'request-forwarded': 2,
  'request-complete': 3,
  'request-timeout': 4,
  'request-rejected': 5
}

function toNodeSnapshot(
  nodeState: NodeState | null,
  nodeConfig: ComponentNode | null
): NodeSnapshot | null {
  if (!nodeState || !nodeConfig?.queue) {
    return null
  }

  return {
    status: nodeState.status,
    activeWorkers: nodeState.activeWorkers,
    maxWorkers: nodeConfig.queue.workers,
    queueLength: nodeState.queueLength,
    capacity: nodeConfig.queue.capacity,
    utilization: nodeState.utilization,
    totalInSystem: nodeState.totalInSystem
  }
}

function deriveReason(event: SimulationEvent): string | null {
  const raw = event.data.reason
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

function deriveEdgeId(event: SimulationEvent): string | null {
  const edge = event.data.edge as EdgeDefinition | undefined
  if (edge?.id) {
    return edge.id
  }

  const edgeId = event.data.edgeId
  return typeof edgeId === 'string' && edgeId.length > 0 ? edgeId : null
}

function formatEventMessage(
  event: SimulationEvent,
  nodeLabel: string,
  reason: string | null,
  edgeId: string | null
): string {
  switch (event.type) {
    case 'request-generated':
      return `Generated request at ${nodeLabel}`
    case 'request-arrival':
      return edgeId ? `Arrived at ${nodeLabel} via ${edgeId}` : `Arrived at ${nodeLabel}`
    case 'processing-start':
      return `Started processing at ${nodeLabel}`
    case 'processing-complete':
      return `Completed processing at ${nodeLabel}`
    case 'request-forwarded': {
      const targetNodeId =
        typeof event.data.targetNodeId === 'string' ? event.data.targetNodeId : null
      if (targetNodeId && edgeId) {
        return `Forwarded from ${nodeLabel} to ${targetNodeId} via ${edgeId}`
      }
      if (targetNodeId) {
        return `Forwarded from ${nodeLabel} to ${targetNodeId}`
      }
      return `Forwarded from ${nodeLabel}`
    }
    case 'request-complete':
      return `Completed request at ${nodeLabel}`
    case 'request-timeout':
      return reason ? `Timed out at ${nodeLabel}: ${reason}` : `Timed out at ${nodeLabel}`
    case 'request-rejected':
      return reason ? `Rejected at ${nodeLabel}: ${reason}` : `Rejected at ${nodeLabel}`
    case 'node-failure':
      return `Node failed: ${nodeLabel}`
    case 'node-recovery':
      return `Node recovered: ${nodeLabel}`
    case 'network-partition':
      return `Network partition at ${nodeLabel}`
    case 'latency-spike':
      return `Latency spike at ${nodeLabel}`
    case 'scale-up':
      return `Scaled up ${nodeLabel}`
    case 'scale-down':
      return `Scaled down ${nodeLabel}`
    case 'circuit-breaker-open':
      return `Circuit breaker opened at ${nodeLabel}`
    case 'circuit-breaker-close':
      return `Circuit breaker closed at ${nodeLabel}`
    case 'health-check':
      return `Health check at ${nodeLabel}`
    case 'cache-hit':
      return `Cache hit at ${nodeLabel}`
    case 'cache-miss':
      return `Cache miss at ${nodeLabel}`
    case 'db-failover':
      return `Database failover at ${nodeLabel}`
    default: {
      const exhaustiveCheck: never = event.type
      return exhaustiveCheck
    }
  }
}

function derivePhaseResult(eventType: EventType): LifecyclePhase['result'] {
  switch (eventType) {
    case 'request-rejected':
      return 'rejected'
    case 'request-timeout':
      return 'timeout'
    case 'processing-complete':
    case 'request-forwarded':
    case 'request-complete':
      return 'passed'
    default:
      return 'arrived'
  }
}

function isLifecycleEvent(eventType: EventType): boolean {
  return eventType in LIFECYCLE_EVENT_RANK
}

function promoteLifecycleEvent(current: DebugEvent, candidate: DebugEvent): boolean {
  const currentRank = LIFECYCLE_EVENT_RANK[current.type] ?? -1
  const candidateRank = LIFECYCLE_EVENT_RANK[candidate.type] ?? -1
  return candidateRank >= currentRank
}

function toPhaseTiming(span: RequestTraceSpan): PhaseTiming {
  return {
    queueWaitMs: span.queueWait,
    serviceTimeMs: span.serviceTime,
    edgeLatencyMs: span.edgeLatency,
    totalMs: span.queueWait + span.serviceTime + span.edgeLatency,
    startMs: span.start,
    endMs: span.end
  }
}

function buildExpectedPath(topology: TopologyJSON, startNodeId: string | null): ExpectedPath {
  if (!startNodeId) {
    return { nodeIds: [], edgeIds: [], deterministic: false }
  }

  const nodeIds = [startNodeId]
  const edgeIds: string[] = []
  const visited = new Set<string>()
  let deterministic = true
  let current = startNodeId

  while (!visited.has(current)) {
    visited.add(current)

    const outgoing = topology.edges.filter((edge) => edge.source === current)
    if (outgoing.length === 0) {
      break
    }

    if (
      outgoing.length > 1 ||
      outgoing.some((edge) => edge.mode === 'asynchronous' || edge.mode === 'conditional')
    ) {
      deterministic = false
    }

    const preferred = [...outgoing].sort((left, right) => {
      const weightDelta = (right.weight ?? 1) - (left.weight ?? 1)
      if (weightDelta !== 0) return weightDelta
      return left.id.localeCompare(right.id)
    })[0]

    edgeIds.push(preferred.id)
    current = preferred.target
    nodeIds.push(current)
  }

  return { nodeIds, edgeIds, deterministic }
}

export function projectToDebugEvent(
  event: SimulationEvent,
  index: number,
  nodeState: NodeState | null,
  nodeConfig: ComponentNode | null,
  nodeLabels: Map<string, string>
): DebugEvent {
  const reason = deriveReason(event)
  const edgeId = deriveEdgeId(event)
  const nodeLabel = nodeLabels.get(event.nodeId) ?? event.nodeId

  return {
    index,
    timestampMs: microToMs(event.timestamp),
    type: event.type,
    nodeId: event.nodeId,
    requestId: event.requestId,
    status: STATUS_BY_EVENT_TYPE[event.type],
    reason,
    edgeId,
    message: formatEventMessage(event, nodeLabel, reason, edgeId),
    nodeState: toNodeSnapshot(nodeState, nodeConfig),
    priority: event.priority
  }
}

export function buildRequestLifecycle(
  requestId: string,
  events: DebugEvent[],
  trace: RequestTrace | null,
  topology: TopologyJSON,
  nodeLabels: Map<string, string>
): RequestLifecycle | null {
  const orderedEvents = [...events]
    .filter((event) => event.requestId === requestId)
    .sort((left, right) => left.index - right.index)

  if (orderedEvents.length === 0) {
    return null
  }

  const phaseEvents: Array<{ event: DebugEvent; result: LifecyclePhase['result'] }> = []
  for (const event of orderedEvents) {
    if (!isLifecycleEvent(event.type)) {
      continue
    }

    const current = phaseEvents[phaseEvents.length - 1]
    if (!current || event.type === 'request-arrival' || current.event.nodeId !== event.nodeId) {
      phaseEvents.push({ event, result: derivePhaseResult(event.type) })
      continue
    }

    if (promoteLifecycleEvent(current.event, event)) {
      current.event = event
    }
    current.result = derivePhaseResult(event.type)
  }

  const spans = trace?.spans ?? []
  let spanCursor = 0
  const phases: LifecyclePhase[] = phaseEvents.map((phase, hopIndex) => {
    let matchedSpan: RequestTraceSpan | null = null
    while (spanCursor < spans.length) {
      const candidate = spans[spanCursor]
      spanCursor++
      if (candidate.nodeId === phase.event.nodeId) {
        matchedSpan = candidate
        break
      }
    }

    return {
      name: nodeLabels.get(phase.event.nodeId) ?? phase.event.nodeId,
      hopIndex,
      event: phase.event,
      timing: matchedSpan ? toPhaseTiming(matchedSpan) : null,
      result: phase.result
    }
  })

  const lastEvent = orderedEvents[orderedEvents.length - 1]
  const terminalStatus: RequestLifecycle['terminalStatus'] =
    lastEvent.type === 'request-complete'
      ? 'success'
      : lastEvent.type === 'request-rejected'
        ? 'rejected'
        : lastEvent.type === 'request-timeout'
          ? 'timeout'
          : 'in-flight'

  const actualPath = orderedEvents
    .filter((event) => event.type === 'request-arrival')
    .map((event) => event.nodeId)

  const fallbackLatencyMs = Math.max(0, lastEvent.timestampMs - orderedEvents[0].timestampMs)
  const totalLatencyMs = trace?.totalLatency ?? fallbackLatencyMs

  return {
    requestId,
    phases,
    terminalStatus,
    terminalNode:
      terminalStatus === 'success' || terminalStatus === 'in-flight' ? null : lastEvent.nodeId,
    terminalReason:
      terminalStatus === 'success' || terminalStatus === 'in-flight' ? null : lastEvent.reason,
    totalLatencyMs,
    expectedPath: buildExpectedPath(topology, actualPath[0] ?? orderedEvents[0]?.nodeId ?? null),
    actualPath
  }
}
