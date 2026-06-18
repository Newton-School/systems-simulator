import {
  CanonicalEventRecord,
  EventCountsByType,
  RequestLifecycle,
  TerminalRequestStatus,
  createEmptyEventCounts,
  projectToDebugEvent
} from '../core/event-stream'

export interface ReplayResult {
  lifecycles: RequestLifecycle[]
  lifecycleByRequestId: Record<string, RequestLifecycle>
  eventCountsByType: EventCountsByType
  terminalStatusByRequestId: Record<string, TerminalRequestStatus>
}

export function replayEventStream(events: CanonicalEventRecord[]): ReplayResult {
  const sortedEvents = [...events].sort(compareCanonicalEvents)
  const lifecycleByRequestId: Record<string, RequestLifecycle> = {}
  const terminalStatusByRequestId: Record<string, TerminalRequestStatus> = {}
  const eventCountsByType = createEmptyEventCounts()

  for (const event of sortedEvents) {
    eventCountsByType[event.type]++

    if (!event.requestId) {
      continue
    }

    const lifecycle =
      lifecycleByRequestId[event.requestId] ??
      (lifecycleByRequestId[event.requestId] = {
        requestId: event.requestId,
        events: [],
        path: []
      })

    const debugEvent = projectToDebugEvent(event)
    lifecycle.events.push(debugEvent)

    if (lifecycle.startedAtMs === undefined) {
      lifecycle.startedAtMs = debugEvent.timestampMs
    }
    lifecycle.completedAtMs = debugEvent.timestampMs

    if (event.type === 'request-arrived' && event.nodeId) {
      lifecycle.path.push(event.nodeId)
    }

    const terminalStatus = terminalStatusForEvent(event)
    if (terminalStatus) {
      lifecycle.status = terminalStatus
      terminalStatusByRequestId[event.requestId] = terminalStatus
    }
  }

  return {
    lifecycles: Object.values(lifecycleByRequestId).sort((a, b) =>
      a.requestId.localeCompare(b.requestId)
    ),
    lifecycleByRequestId,
    eventCountsByType,
    terminalStatusByRequestId
  }
}

function compareCanonicalEvents(a: CanonicalEventRecord, b: CanonicalEventRecord): number {
  const timestampDelta = BigInt(a.timestampUs) - BigInt(b.timestampUs)
  if (timestampDelta < 0n) return -1
  if (timestampDelta > 0n) return 1

  if (a.priority !== b.priority) {
    return a.priority - b.priority
  }

  return a.sequence - b.sequence
}

function terminalStatusForEvent(event: CanonicalEventRecord): TerminalRequestStatus | null {
  switch (event.type) {
    case 'request-completed':
      return 'success'
    case 'request-timed-out':
      return 'timeout'
    case 'request-rejected':
      return 'rejected'
    default:
      return null
  }
}
