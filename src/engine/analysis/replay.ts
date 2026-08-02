import {
  CanonicalEventRecord,
  EventCountsByType,
  RequestLifecycle,
  TerminalRequestStatus,
  createEmptyEventCounts,
  projectToDebugEvent
} from '../core/event-stream'
import { canonicalChecksum } from './stableHash'

export interface ReplayResult {
  lifecycles: RequestLifecycle[]
  lifecycleByRequestId: Record<string, RequestLifecycle>
  eventCountsByType: EventCountsByType
  terminalStatusByRequestId: Record<string, TerminalRequestStatus>
}

const TERMINAL_STATUSES: readonly TerminalRequestStatus[] = [
  'success',
  'timeout',
  'rejected',
  'connection_reset'
]

/**
 * A bounded summary of a case's replay — small enough to persist in every
 * evaluation envelope. The full per-request replay can be huge, so the digest
 * captures counts plus an `eventStreamChecksum` that binds the exact event
 * stream it came from, letting the full trace be attached (and verified) later
 * without storing it inline.
 */
export interface ReplayDigest {
  lifecycleCount: number
  eventCountsByType: EventCountsByType
  terminalStatusCounts: Record<TerminalRequestStatus, number>
  eventStreamChecksum: string
}

/** Builds a bounded replay digest from a canonical event stream. */
export function buildReplayDigest(events: CanonicalEventRecord[]): ReplayDigest {
  return buildReplayDigestFromResult(replayEventStream(events))
}

/** Builds a replay digest from an already-computed replay result. */
export function buildReplayDigestFromResult(replay: ReplayResult): ReplayDigest {
  const terminalStatusCounts = TERMINAL_STATUSES.reduce(
    (counts, status) => {
      counts[status] = 0
      return counts
    },
    {} as Record<TerminalRequestStatus, number>
  )

  for (const status of Object.values(replay.terminalStatusByRequestId)) {
    terminalStatusCounts[status] += 1
  }

  return {
    lifecycleCount: replay.lifecycles.length,
    eventCountsByType: { ...replay.eventCountsByType },
    terminalStatusCounts,
    eventStreamChecksum: canonicalChecksum(replay.lifecycles)
  }
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
