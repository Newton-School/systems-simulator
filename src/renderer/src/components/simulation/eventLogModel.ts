import type { SimulationOutput } from '../../../../engine/analysis/output'
import type {
  DebugEvent,
  DebugEventStatus,
  RequestOutcomeRecord
} from '../../../../engine/core/event-stream'

/**
 * Pure groupings behind the Results Tray Event Log display variants (#78). Every
 * view is a re-arrangement of `output.eventStream` (projected to `DebugEvent`);
 * nothing here estimates. The stream is a retained prefix on large runs, so
 * `eventLogCoverage` says exactly which window the views describe.
 */

export interface EventLogCoverage {
  retained: number
  total: number
  truncated: boolean
  /** Sim time (ms) of the first / last retained event; null when none were retained. */
  firstMs: number | null
  lastMs: number | null
  /** Total run length (ms, including warmup). */
  runMs: number
}

export function eventLogCoverage(output: SimulationOutput): EventLogCoverage {
  const total = Object.values(output.eventCountsByType).reduce((sum, count) => sum + count, 0)
  const stream = output.eventStream
  const first = stream[0]
  const last = stream[stream.length - 1]
  return {
    retained: stream.length,
    total: Math.max(total, stream.length),
    truncated: stream.length < total,
    firstMs: first ? Number(first.timestampUs) / 1000 : null,
    lastMs: last ? Number(last.timestampUs) / 1000 : null,
    runMs: output.simulationDuration
  }
}

// ─── Request-centric ─────────────────────────────────────────────────────────

export type RequestTerminalStatus = 'success' | 'rejected' | 'timeout' | 'connection_reset'

export interface RequestEventGroup {
  requestId: string
  /** Retained events for this request (all of them, not only the visible ones). */
  eventCount: number
  /** Visible (filter-matching) events for this request. */
  visibleCount: number
  firstMs: number
  lastMs: number
  /** First event index (into the visible list) for this request. */
  firstVisibleIndex: number
  /** Node ids in visit order, consecutive repeats collapsed. */
  hops: string[]
  /**
   * Terminal fate. `ledger` comes from the complete per-request outcome ledger, so
   * it is right even when the terminal event fell outside the retained window;
   * `events` means the ledger had no row and the retained events show the end;
   * `none` means neither recorded an end (still in flight, or truncated).
   */
  terminal: {
    status: RequestTerminalStatus | 'in-flight' | null
    nodeId: string | null
    reasonCode: string | null
    source: 'ledger' | 'events' | 'none'
  }
}

const TERMINAL_EVENT_STATUS: Partial<Record<DebugEvent['type'], RequestTerminalStatus>> = {
  'request-completed': 'success',
  'request-rejected': 'rejected',
  'request-timed-out': 'timeout'
}

/** Retained events per request id, in sequence order. Built once per run. */
export function indexEventsByRequest(events: readonly DebugEvent[]): Map<string, DebugEvent[]> {
  const byRequest = new Map<string, DebugEvent[]>()
  for (const event of events) {
    if (!event.requestId) continue
    const list = byRequest.get(event.requestId)
    if (list) list.push(event)
    else byRequest.set(event.requestId, [event])
  }
  return byRequest
}

export function indexOutcomes(
  outcomes: readonly RequestOutcomeRecord[]
): Map<string, RequestOutcomeRecord> {
  return new Map(outcomes.map((outcome) => [outcome.requestId, outcome]))
}

function hopTrail(events: readonly DebugEvent[]): string[] {
  const hops: string[] = []
  for (const event of events) {
    if (!event.nodeId) continue
    if (event.type !== 'request-generated' && event.type !== 'request-arrived') continue
    if (hops[hops.length - 1] !== event.nodeId) hops.push(event.nodeId)
  }
  return hops
}

/**
 * One group per request that has at least one visible event, ordered by its first
 * visible event. Hop trail and terminal fate come from all retained events (and the
 * outcome ledger), so filtering to `status:rejected` still shows the whole path.
 */
export function groupEventsByRequest(
  visible: readonly DebugEvent[],
  byRequest: ReadonlyMap<string, readonly DebugEvent[]>,
  outcomes: ReadonlyMap<string, RequestOutcomeRecord>
): RequestEventGroup[] {
  const order: string[] = []
  const visibleCount = new Map<string, number>()
  const firstVisibleIndex = new Map<string, number>()
  visible.forEach((event, index) => {
    if (!event.requestId) return
    const count = visibleCount.get(event.requestId)
    if (count === undefined) {
      order.push(event.requestId)
      firstVisibleIndex.set(event.requestId, index)
      visibleCount.set(event.requestId, 1)
    } else {
      visibleCount.set(event.requestId, count + 1)
    }
  })
  return order.map((requestId) => {
    const all = byRequest.get(requestId) ?? []
    const outcome = outcomes.get(requestId)
    let terminal: RequestEventGroup['terminal']
    if (outcome) {
      terminal = {
        status: outcome.status,
        nodeId: outcome.nodeId,
        reasonCode: outcome.reasonCode,
        source: 'ledger'
      }
    } else {
      const end = [...all].reverse().find((event) => TERMINAL_EVENT_STATUS[event.type])
      terminal = end
        ? {
            status: TERMINAL_EVENT_STATUS[end.type] ?? null,
            nodeId: end.nodeId ?? null,
            reasonCode: end.reasonCode ?? null,
            source: 'events'
          }
        : { status: null, nodeId: null, reasonCode: null, source: 'none' }
    }
    return {
      requestId,
      eventCount: all.length,
      visibleCount: visibleCount.get(requestId) ?? 0,
      firstMs: all[0]?.timestampMs ?? 0,
      lastMs: all[all.length - 1]?.timestampMs ?? 0,
      firstVisibleIndex: firstVisibleIndex.get(requestId) ?? 0,
      hops: hopTrail(all),
      terminal
    }
  })
}

// ─── Node-centric ────────────────────────────────────────────────────────────

export interface NodeEventGroup {
  nodeId: string
  eventCount: number
  rejected: number
  timedOut: number
  failures: number
  completed: number
  lastMs: number
}

/** Visible events grouped by node, busiest first. Events with no node are skipped. */
export function groupEventsByNode(visible: readonly DebugEvent[]): NodeEventGroup[] {
  const groups = new Map<string, NodeEventGroup>()
  for (const event of visible) {
    if (!event.nodeId) continue
    let group = groups.get(event.nodeId)
    if (!group) {
      group = {
        nodeId: event.nodeId,
        eventCount: 0,
        rejected: 0,
        timedOut: 0,
        failures: 0,
        completed: 0,
        lastMs: 0
      }
      groups.set(event.nodeId, group)
    }
    group.eventCount++
    if (event.status === 'rejected') group.rejected++
    else if (event.status === 'timeout') group.timedOut++
    else if (event.status === 'failure') group.failures++
    else if (event.status === 'success') group.completed++
    group.lastMs = Math.max(group.lastMs, event.timestampMs)
  }
  return [...groups.values()].sort(
    (a, b) => b.eventCount - a.eventCount || a.nodeId.localeCompare(b.nodeId)
  )
}

// ─── Incident feed ───────────────────────────────────────────────────────────

const SEVERITY: Partial<Record<DebugEventStatus, number>> = {
  failure: 0,
  rejected: 1,
  timeout: 2
}

export function isIncidentEvent(event: DebugEvent): boolean {
  return SEVERITY[event.status] !== undefined
}

/** Failure-class events only (node/broker failures, breaker opens, rejections, timeouts), worst first, then by time. */
export function incidentEvents(visible: readonly DebugEvent[]): DebugEvent[] {
  return visible
    .filter(isIncidentEvent)
    .sort(
      (a, b) => (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9) || a.sequence - b.sequence
    )
}

// ─── Waterfall swim lanes ────────────────────────────────────────────────────

export interface SwimLaneBucket {
  bucket: number
  count: number
  /** Worst status in the bucket (failure > rejected > timeout > success > info). */
  status: DebugEventStatus
  /** Index (into the visible list) of the first event in the bucket. */
  firstIndex: number
  /** Index of the first event carrying the bucket's worst status (what a click opens). */
  worstIndex: number
  counts: Record<DebugEventStatus, number>
}

export interface SwimLane {
  /** Node id, or null for run-level events that carry no node. */
  nodeId: string | null
  eventCount: number
  buckets: SwimLaneBucket[]
}

export interface SwimLaneLayout {
  startMs: number
  endMs: number
  bucketCount: number
  lanes: SwimLane[]
}

const STATUS_RANK: Record<DebugEventStatus, number> = {
  info: 0,
  success: 1,
  timeout: 2,
  rejected: 3,
  failure: 4
}

/**
 * One lane per node (first appearance order). Events are binned into
 * `bucketCount` equal time columns over [startMs, endMs] so 25k events render as
 * at most lanes x buckets marks; each mark keeps the exact per-status counts.
 */
export function buildSwimLanes(
  visible: readonly DebugEvent[],
  bucketCount: number,
  range?: { startMs: number; endMs: number }
): SwimLaneLayout {
  const startMs = range?.startMs ?? visible[0]?.timestampMs ?? 0
  const rawEnd = range?.endMs ?? visible[visible.length - 1]?.timestampMs ?? startMs
  const endMs = rawEnd > startMs ? rawEnd : startMs + 1
  const span = endMs - startMs
  const lanes = new Map<string | null, { lane: SwimLane; byBucket: Map<number, SwimLaneBucket> }>()
  visible.forEach((event, index) => {
    if (event.timestampMs < startMs || event.timestampMs > endMs) return
    const key = event.nodeId ?? null
    let entry = lanes.get(key)
    if (!entry) {
      entry = { lane: { nodeId: key, eventCount: 0, buckets: [] }, byBucket: new Map() }
      lanes.set(key, entry)
    }
    entry.lane.eventCount++
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor(((event.timestampMs - startMs) / span) * bucketCount)
    )
    let cell = entry.byBucket.get(bucket)
    if (!cell) {
      cell = {
        bucket,
        count: 0,
        status: event.status,
        firstIndex: index,
        worstIndex: index,
        counts: { info: 0, success: 0, timeout: 0, rejected: 0, failure: 0 }
      }
      entry.byBucket.set(bucket, cell)
      entry.lane.buckets.push(cell)
    }
    cell.count++
    cell.counts[event.status]++
    if (STATUS_RANK[event.status] > STATUS_RANK[cell.status]) {
      cell.status = event.status
      cell.worstIndex = index
    }
  })
  const ordered = [...lanes.values()].map((entry) => entry.lane)
  // Run-level events (no node) go last.
  ordered.sort((a, b) => (a.nodeId === null ? 1 : 0) - (b.nodeId === null ? 1 : 0))
  return { startMs, endMs, bucketCount, lanes: ordered }
}

// ─── Per-node table sorting ──────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc'

/** Stable sort by a numeric (or null) key; nulls always last. */
export function sortByKey<T>(
  rows: readonly T[],
  key: (row: T) => number | string | null,
  direction: SortDirection
): T[] {
  const sign = direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: key(row) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      const diff =
        typeof a.value === 'string' || typeof b.value === 'string'
          ? String(a.value).localeCompare(String(b.value))
          : a.value - b.value
      return diff !== 0 ? diff * sign : a.index - b.index
    })
    .map((entry) => entry.row)
}
