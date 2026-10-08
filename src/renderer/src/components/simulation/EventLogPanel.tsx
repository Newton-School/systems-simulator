import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Bug, Crosshair, Filter, Search, X } from 'lucide-react'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import {
  projectToDebugEvent,
  type DebugEvent,
  type DebugEventStatus
} from '../../../../engine/core/event-stream'
import {
  DEBUG_EVENT_STATUSES,
  countEventStatuses,
  filterEvents,
  isMatchAllQuery,
  parseEventQuery,
  type EventQuery
} from '../../../../shared/eventQuery'
import { TooltipInfo } from '@renderer/components/ui/Tooltip'
import useStore from '../../store/useStore'
import {
  buildSwimLanes,
  eventLogCoverage,
  groupEventsByNode,
  groupEventsByRequest,
  incidentEvents,
  indexEventsByRequest,
  indexOutcomes,
  type EventLogCoverage,
  type RequestEventGroup
} from './eventLogModel'
import { WindowedList, type WindowedListHandle } from './WindowedList'
import { useFocusNodeOnCanvas } from './useFocusNodeOnCanvas'

export type EventLogMode = 'table' | 'requests' | 'nodes' | 'incidents' | 'waterfall'

const EVENT_LOG_MODES: Array<{ id: EventLogMode; label: string; hint: string }> = [
  { id: 'table', label: 'Table', hint: 'Every event in sequence order' },
  { id: 'requests', label: 'Requests', hint: 'Events grouped by request, with hop trail' },
  { id: 'nodes', label: 'Nodes', hint: 'Events grouped by node' },
  { id: 'incidents', label: 'Incidents', hint: 'Failures, rejections and timeouts, worst first' },
  { id: 'waterfall', label: 'Waterfall', hint: 'One swim lane per node over sim time' }
]

const SECTION_TITLE = 'text-[11px] font-semibold text-nss-muted uppercase tracking-wider'
const TABLE_ROW_HEIGHT = 26
const REQUEST_ROW_HEIGHT = 58
const INCIDENT_ROW_HEIGHT = 50
const LIST_MAX_HEIGHT = 360
const SWIM_LANE_BUCKETS = 160
const TABLE_COLUMNS =
  'grid grid-cols-[56px_76px_132px_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1.6fr)] gap-2'

/** Filter text and display mode per run, so leaving the tab and coming back keeps them. */
const eventLogMemory = new WeakMap<SimulationOutput, { query: string; mode: EventLogMode }>()

function fmtSimTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '-'
  if (Math.abs(ms) < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`
  return `${(ms / 1000).toFixed(3)} s`
}

function statusTone(status: DebugEventStatus | 'in-flight' | 'connection_reset' | null): string {
  switch (status) {
    case 'success':
      return 'text-nss-success bg-nss-success/10 border-nss-success/25'
    case 'timeout':
      return 'text-nss-warning bg-nss-warning/10 border-nss-warning/25'
    case 'rejected':
    case 'failure':
    case 'connection_reset':
      return 'text-nss-danger bg-nss-danger/10 border-nss-danger/25'
    default:
      return 'text-nss-muted bg-nss-surface border-nss-border'
  }
}

const STATUS_BADGE_LABEL: Record<DebugEventStatus, string> = {
  info: 'info',
  success: 'completed',
  timeout: 'timed out',
  rejected: 'rejected',
  failure: 'failures'
}

const MARK_FILL: Record<DebugEventStatus, string> = {
  info: 'bg-nss-muted',
  success: 'bg-nss-success',
  timeout: 'bg-nss-warning',
  rejected: 'bg-nss-danger',
  failure: 'bg-nss-danger'
}

function modeButtonClass(active: boolean): string {
  return `h-7 px-2.5 text-[11px] font-semibold transition-colors first:rounded-l-md last:rounded-r-md border-y border-r first:border-l ${
    active
      ? 'border-nss-primary bg-nss-primary/10 text-nss-primary'
      : 'border-nss-border bg-nss-surface text-nss-muted hover:bg-nss-bg hover:text-nss-text'
  }`
}

function smallButtonClass(): string {
  return 'inline-flex h-6 items-center gap-1 rounded border border-nss-border bg-nss-surface px-1.5 text-[10px] font-semibold text-nss-muted transition-colors hover:border-nss-primary/50 hover:text-nss-primary'
}

function CoverageNote({ coverage }: { coverage: EventLogCoverage }) {
  if (coverage.retained === 0) {
    return <span>No engine events were retained for this run.</span>
  }
  const window = `sim time ${fmtSimTime(coverage.firstMs)} to ${fmtSimTime(coverage.lastMs)}`
  if (!coverage.truncated) {
    return (
      <span>
        All {coverage.total.toLocaleString()} events the run produced ({window}).
      </span>
    )
  }
  return (
    <span className="text-nss-warning">
      Partial log: the first {coverage.retained.toLocaleString()} of{' '}
      {coverage.total.toLocaleString()} events ({window} of a {fmtSimTime(coverage.runMs)} run).
      Events after {fmtSimTime(coverage.lastMs)} were not retained, so every view, filter and count
      here covers only that window.
    </span>
  )
}

const QUERY_HELP = (
  <div className="space-y-1 text-[11px]">
    <div>
      <code>request:</code> <code>node:</code> <code>edge:</code> <code>status:</code>{' '}
      <code>type:</code> <code>reason:</code>
    </div>
    <div>status: info, success, timeout, rejected, failure</div>
    <div>
      Combine with AND / OR (adjacent terms are AND; AND binds tighter), group with ( ), negate with
      NOT or a leading -. A trailing * is a prefix match. Bare words search the message, ids and
      labels.
    </div>
    <div>
      e.g. <code>status:rejected OR status:timeout</code>, <code>node:api AND reason:queue*</code>
    </div>
  </div>
)

export function EventLogPanel({
  output,
  onDebugRequest
}: {
  output: SimulationOutput
  /** Open the step-through debugger on a traced request. */
  onDebugRequest: (requestId: string) => void
}) {
  // Labels as recorded in the run (stable per output, unaffected by later canvas edits).
  const nodeLabel = useCallback(
    (nodeId: string) => output.perNode[nodeId]?.nodeLabel ?? nodeId,
    [output]
  )
  const edgeLabel = useCallback(
    (edgeId: string) => output.perEdge[edgeId]?.edgeLabel ?? edgeId,
    [output]
  )
  const remembered = eventLogMemory.get(output)
  const [query, setQueryState] = useState(remembered?.query ?? '')
  const [mode, setModeState] = useState<EventLogMode>(remembered?.mode ?? 'table')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const focusNode = useFocusNodeOnCanvas()

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next)
      eventLogMemory.set(output, { query: next, mode: eventLogMemory.get(output)?.mode ?? mode })
    },
    [mode, output]
  )
  const setMode = useCallback(
    (next: EventLogMode) => {
      setModeState(next)
      eventLogMemory.set(output, { query: eventLogMemory.get(output)?.query ?? query, mode: next })
    },
    [output, query]
  )

  const coverage = useMemo(() => eventLogCoverage(output), [output])
  const events = useMemo(() => output.eventStream.map(projectToDebugEvent), [output.eventStream])
  const bySequence = useMemo(
    () => new Map(events.map((event) => [event.sequence, event])),
    [events]
  )
  const byRequest = useMemo(() => indexEventsByRequest(events), [events])
  const outcomes = useMemo(() => indexOutcomes(output.requestOutcomes), [output.requestOutcomes])
  const tracedIds = useMemo(
    () => new Set(output.traces.map((trace) => trace.requestId)),
    [output.traces]
  )

  // Filtering 25k events is a few ms; deferring keeps typing responsive anyway.
  const deferredQuery = useDeferredValue(query)
  const parsed = useMemo(() => parseEventQuery(deferredQuery), [deferredQuery])
  // While the text does not parse, keep showing the last valid filter's result.
  const [lastValidQuery, setLastValidQuery] = useState<EventQuery>(MATCH_ALL)
  if (parsed.ok && parsed.query !== lastValidQuery) setLastValidQuery(parsed.query)
  const activeQuery = parsed.ok ? parsed.query : lastValidQuery
  const ctx = useMemo(() => ({ nodeLabel }), [nodeLabel])
  const visible = useMemo(() => filterEvents(events, activeQuery, ctx), [activeQuery, ctx, events])
  const counts = useMemo(() => countEventStatuses(visible), [visible])
  const selected = selectedSeq !== null ? (bySequence.get(selectedSeq) ?? null) : null

  const selectEvent = useCallback(
    (event: DebugEvent) => {
      setSelectedSeq(event.sequence)
      if (event.edgeId) selectGraphElements({ edgeId: event.edgeId })
      else if (event.nodeId) selectGraphElements({ nodeId: event.nodeId })
    },
    [selectGraphElements]
  )

  const addStatusFilter = (status: DebugEventStatus) => {
    const clause = `status:${status}`
    const trimmed = query.trim()
    if (trimmed.split(/\s+/).includes(clause)) return
    setQuery(trimmed === '' ? clause : `(${trimmed}) AND ${clause}`)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <h3 className={SECTION_TITLE}>Event Log</h3>
            <TooltipInfo
              label="About the event log"
              content="The engine's own ordered record of the run: arrivals, queueing, processing, forwarding, trait decisions and each request's terminal event. Every view below is a re-arrangement of these events."
            />
          </div>
          <div className="text-[11px] text-nss-muted" data-testid="event-log-coverage">
            <CoverageNote coverage={coverage} />
          </div>
        </div>
        <div className="flex shrink-0" role="group" aria-label="Event log display">
          {EVENT_LOG_MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.hint}
              aria-pressed={mode === entry.id}
              onClick={() => setMode(entry.id)}
              className={modeButtonClass(mode === entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nss-muted"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter: status:rejected OR node:api, request:<id>, type:, reason:"
              aria-label="Filter events"
              aria-invalid={!parsed.ok}
              spellCheck={false}
              className={`w-full rounded-md border bg-nss-bg py-1.5 pl-8 pr-8 font-mono text-[11px] text-nss-text placeholder:font-sans placeholder:text-nss-muted focus:outline-none focus:ring-1 ${
                parsed.ok
                  ? 'border-nss-border focus:border-nss-primary/50 focus:ring-nss-primary/40'
                  : 'border-nss-danger/60 focus:ring-nss-danger/40'
              }`}
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear event filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-nss-muted hover:text-nss-text"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <TooltipInfo label="Event filter syntax" content={QUERY_HELP} width={340} />
        </div>
        {!parsed.ok && (
          <div className="text-[11px] text-nss-danger" role="alert">
            {parsed.error} Showing the last valid filter.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]" aria-live="polite">
          <span className="tabular-nums text-nss-muted">
            {isMatchAllQuery(activeQuery)
              ? `${visible.length.toLocaleString()} events`
              : `${visible.length.toLocaleString()} of ${events.length.toLocaleString()} events match`}
          </span>
          {DEBUG_EVENT_STATUSES.filter((status) => status !== 'info' && counts[status] > 0).map(
            (status) => (
              <button
                key={status}
                type="button"
                onClick={() => addStatusFilter(status)}
                title={`Narrow to status:${status}`}
                className={`rounded-full border px-1.5 py-0.5 font-semibold tabular-nums ${statusTone(status)}`}
              >
                {counts[status].toLocaleString()} {STATUS_BADGE_LABEL[status]}
              </button>
            )
          )}
        </div>
      </div>

      {events.length === 0 ? null : visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-nss-border px-3 py-4 text-xs text-nss-muted">
          No retained events match this filter.
        </div>
      ) : (
        <>
          {mode === 'table' && (
            <EventTable
              events={visible}
              selectedSeq={selectedSeq}
              onSelect={selectEvent}
              nodeLabel={nodeLabel}
              edgeLabel={edgeLabel}
            />
          )}
          {mode === 'requests' && (
            <RequestCards
              groups={groupEventsByRequest(visible, byRequest, outcomes)}
              visible={visible}
              tracedIds={tracedIds}
              nodeLabel={nodeLabel}
              onSelect={selectEvent}
              onDebugRequest={onDebugRequest}
              selectedSeq={selectedSeq}
            />
          )}
          {mode === 'nodes' && (
            <NodeCards
              output={output}
              visible={visible}
              nodeLabel={nodeLabel}
              onFocus={focusNode}
              onFilter={(nodeId) => {
                setQuery(`node:${nodeId}`)
                setMode('table')
              }}
            />
          )}
          {mode === 'incidents' && (
            <IncidentFeed
              events={visible}
              tracedIds={tracedIds}
              nodeLabel={nodeLabel}
              onSelect={selectEvent}
              onDebugRequest={onDebugRequest}
              selectedSeq={selectedSeq}
            />
          )}
          {mode === 'waterfall' && (
            <SwimLanes
              events={visible}
              nodeLabel={nodeLabel}
              onSelect={selectEvent}
              onFocus={focusNode}
              selectedSeq={selectedSeq}
            />
          )}
        </>
      )}

      {selected && (
        <EventDetail
          event={selected}
          traced={selected.requestId !== undefined && tracedIds.has(selected.requestId)}
          tracedCount={output.traces.length}
          nodeLabel={nodeLabel}
          edgeLabel={edgeLabel}
          onClose={() => setSelectedSeq(null)}
          onFocus={(event) => {
            if (event.nodeId) focusNode(event.nodeId)
            else if (event.sourceNodeId) focusNode(event.sourceNodeId)
          }}
          onFilterRequest={(requestId) => setQuery(`request:${requestId}`)}
          onDebugRequest={onDebugRequest}
        />
      )}
    </div>
  )
}

const MATCH_ALL: EventQuery = { raw: '', root: { kind: 'all' } }

/** Arrow-key navigation over a windowed list of events. */
function useListKeyboard(
  length: number,
  selectedIndex: number,
  select: (index: number) => void,
  listRef: React.RefObject<WindowedListHandle | null>
) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (length === 0) return
    let next: number | null = null
    if (event.key === 'ArrowDown') next = Math.min(length - 1, selectedIndex + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, selectedIndex < 0 ? 0 : selectedIndex - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = length - 1
    if (next === null) return
    event.preventDefault()
    select(next)
    listRef.current?.scrollToIndex(next)
  }
}

function EventTable({
  events,
  selectedSeq,
  onSelect,
  nodeLabel,
  edgeLabel
}: {
  events: DebugEvent[]
  selectedSeq: number | null
  onSelect: (event: DebugEvent) => void
  nodeLabel: (nodeId: string) => string
  edgeLabel: (edgeId: string) => string
}) {
  const listRef = useRef<WindowedListHandle>(null)
  const selectedIndex = useMemo(
    () => (selectedSeq === null ? -1 : events.findIndex((event) => event.sequence === selectedSeq)),
    [events, selectedSeq]
  )
  const onKeyDown = useListKeyboard(
    events.length,
    selectedIndex,
    (index) => onSelect(events[index]),
    listRef
  )
  return (
    <div className="overflow-hidden rounded-md border border-nss-border">
      <div
        className={`${TABLE_COLUMNS} border-b border-nss-border bg-nss-surface px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-nss-muted`}
      >
        <span className="text-right">#</span>
        <span className="text-right">Sim time</span>
        <span>Event</span>
        <span>Node</span>
        <span>Request</span>
        <span>Details</span>
      </div>
      <WindowedList
        ref={listRef}
        count={events.length}
        rowHeight={TABLE_ROW_HEIGHT}
        maxHeight={LIST_MAX_HEIGHT}
        ariaLabel="Events"
        onKeyDown={onKeyDown}
        renderRow={(index) => {
          const event = events[index]
          const isSelected = event.sequence === selectedSeq
          return (
            <div
              key={event.sequence}
              role="listitem"
              aria-selected={isSelected}
              onClick={() => onSelect(event)}
              style={{ height: TABLE_ROW_HEIGHT }}
              className={`${TABLE_COLUMNS} cursor-pointer items-center border-b border-nss-border px-2 text-[11px] tabular-nums ${
                isSelected ? 'bg-nss-primary/10' : 'hover:bg-nss-bg'
              }`}
            >
              <span className="text-right text-nss-muted">{event.sequence.toLocaleString()}</span>
              <span className="text-right text-nss-muted">{fmtSimTime(event.timestampMs)}</span>
              <span className="min-w-0">
                <span
                  className={`inline-block max-w-full truncate rounded-full border px-1.5 text-[10px] font-medium leading-4 ${statusTone(event.status)}`}
                >
                  {event.type}
                </span>
              </span>
              <span className="truncate text-nss-text">
                {event.nodeId ? nodeLabel(event.nodeId) : '-'}
              </span>
              <span className="truncate font-mono text-[10px] text-nss-muted">
                {event.requestId ?? '-'}
              </span>
              <span className="truncate text-nss-muted" title={event.message}>
                {[event.reasonCode, event.edgeId ? `via ${edgeLabel(event.edgeId)}` : null]
                  .filter(Boolean)
                  .join(' · ') || event.message}
              </span>
            </div>
          )
        }}
      />
    </div>
  )
}

function terminalLabel(group: RequestEventGroup): string {
  switch (group.terminal.status) {
    case 'success':
      return 'completed'
    case 'rejected':
      return 'rejected'
    case 'timeout':
      return 'timed out'
    case 'connection_reset':
      return 'connection reset'
    case 'in-flight':
      return 'in flight at cutoff'
    default:
      return 'no terminal event retained'
  }
}

function RequestCards({
  groups,
  visible,
  tracedIds,
  nodeLabel,
  onSelect,
  onDebugRequest,
  selectedSeq
}: {
  groups: RequestEventGroup[]
  visible: DebugEvent[]
  tracedIds: ReadonlySet<string>
  nodeLabel: (nodeId: string) => string
  onSelect: (event: DebugEvent) => void
  onDebugRequest: (requestId: string) => void
  selectedSeq: number | null
}) {
  const selectedRequest =
    selectedSeq !== null
      ? visible.find((event) => event.sequence === selectedSeq)?.requestId
      : undefined
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-nss-border px-3 py-4 text-xs text-nss-muted">
        None of the matching events belong to a request (they are node or run-level events).
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-nss-muted">
        {groups.length.toLocaleString()} requests. Hop trails use every retained event of the
        request; terminal status comes from the complete outcome ledger.
      </div>
      <div className="overflow-hidden rounded-md border border-nss-border">
        <WindowedList
          count={groups.length}
          rowHeight={REQUEST_ROW_HEIGHT}
          maxHeight={LIST_MAX_HEIGHT}
          ariaLabel="Requests"
          renderRow={(index) => {
            const group = groups[index]
            const failed =
              group.terminal.status !== null &&
              group.terminal.status !== 'success' &&
              group.terminal.status !== 'in-flight'
            const traced = tracedIds.has(group.requestId)
            return (
              <div
                key={group.requestId}
                role="listitem"
                aria-selected={selectedRequest === group.requestId}
                onClick={() => onSelect(visible[group.firstVisibleIndex])}
                style={{ height: REQUEST_ROW_HEIGHT }}
                className={`flex cursor-pointer flex-col justify-center gap-1 border-b border-nss-border px-2.5 ${
                  selectedRequest === group.requestId ? 'bg-nss-primary/10' : 'hover:bg-nss-bg'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2 text-[11px]">
                  <span className="truncate font-mono text-nss-text">{group.requestId}</span>
                  <span
                    className={`shrink-0 rounded-full border px-1.5 text-[10px] font-semibold leading-4 ${statusTone(group.terminal.status)}`}
                  >
                    {terminalLabel(group)}
                  </span>
                  {failed && group.terminal.nodeId && (
                    <span className="truncate text-[10px] text-nss-danger">
                      at {nodeLabel(group.terminal.nodeId)}
                      {group.terminal.reasonCode ? ` (${group.terminal.reasonCode})` : ''}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums text-[10px] text-nss-muted">
                    {group.eventCount} events · {fmtSimTime(group.firstMs)}
                  </span>
                  {traced && (
                    <button
                      type="button"
                      className={smallButtonClass()}
                      onClick={(event) => {
                        event.stopPropagation()
                        onDebugRequest(group.requestId)
                      }}
                    >
                      <Bug size={11} /> Debug
                    </button>
                  )}
                </div>
                <div
                  className="truncate text-[10px] text-nss-muted"
                  title={group.hops.map(nodeLabel).join(' → ')}
                >
                  {group.hops.length > 0
                    ? group.hops.map((hop, hopIndex) => (
                        <span key={`${hop}-${hopIndex}`}>
                          {hopIndex > 0 && <span className="px-1">→</span>}
                          <span
                            className={
                              failed &&
                              hopIndex === group.hops.length - 1 &&
                              hop === group.terminal.nodeId
                                ? 'font-semibold text-nss-danger'
                                : 'text-nss-text'
                            }
                          >
                            {nodeLabel(hop)}
                          </span>
                        </span>
                      ))
                    : 'No node visits retained for this request.'}
                </div>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}

function NodeCards({
  output,
  visible,
  nodeLabel,
  onFocus,
  onFilter
}: {
  output: SimulationOutput
  visible: DebugEvent[]
  nodeLabel: (nodeId: string) => string
  onFocus: (nodeId: string) => void
  onFilter: (nodeId: string) => void
}) {
  const groups = useMemo(() => groupEventsByNode(visible), [visible])
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-nss-border px-3 py-4 text-xs text-nss-muted">
        None of the matching events carry a node.
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-nss-muted">
        Counts are over the matching events. Utilization is the node&apos;s time-weighted average
        for the whole run.
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const utilization = output.perNode[group.nodeId]?.utilization ?? null
          const utilPct = utilization === null ? null : Math.min(1, Math.max(0, utilization))
          return (
            <div
              key={group.nodeId}
              role="button"
              tabIndex={0}
              onClick={() => onFocus(group.nodeId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onFocus(group.nodeId)
                }
              }}
              title="Select on canvas"
              className="cursor-pointer space-y-1.5 rounded-md border border-nss-border bg-nss-surface p-2.5 text-[11px] outline-none hover:border-nss-primary/40 focus-visible:ring-1 focus-visible:ring-nss-primary/50"
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-nss-text">
                  {nodeLabel(group.nodeId)}
                </span>
                <button
                  type="button"
                  className={`${smallButtonClass()} ml-auto`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onFilter(group.nodeId)
                  }}
                  title={`Show node:${group.nodeId} in the table`}
                >
                  <Filter size={10} /> Events
                </button>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-nss-muted">
                <span>
                  <span className="text-nss-text">{group.eventCount.toLocaleString()}</span> events
                </span>
                <span className={group.rejected > 0 ? 'text-nss-danger' : undefined}>
                  {group.rejected.toLocaleString()} rejected
                </span>
                <span className={group.timedOut > 0 ? 'text-nss-warning' : undefined}>
                  {group.timedOut.toLocaleString()} timed out
                </span>
                {group.failures > 0 && (
                  <span className="text-nss-danger">{group.failures} failures</span>
                )}
                <span>last {fmtSimTime(group.lastMs)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-nss-bg"
                  role="meter"
                  aria-label="Utilization"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={utilPct === null ? undefined : Math.round(utilPct * 100)}
                >
                  {utilPct !== null && (
                    <div
                      className={`h-full rounded-full ${
                        utilPct > 0.9
                          ? 'bg-nss-danger'
                          : utilPct > 0.7
                            ? 'bg-nss-warning'
                            : 'bg-nss-success'
                      }`}
                      style={{ width: `${utilPct * 100}%` }}
                    />
                  )}
                </div>
                <span className="w-16 text-right tabular-nums text-[10px] text-nss-muted">
                  {utilPct === null ? 'util -' : `util ${(utilPct * 100).toFixed(0)}%`}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IncidentFeed({
  events,
  tracedIds,
  nodeLabel,
  onSelect,
  onDebugRequest,
  selectedSeq
}: {
  events: DebugEvent[]
  tracedIds: ReadonlySet<string>
  nodeLabel: (nodeId: string) => string
  onSelect: (event: DebugEvent) => void
  onDebugRequest: (requestId: string) => void
  selectedSeq: number | null
}) {
  const incidents = useMemo(() => incidentEvents(events), [events])
  const listRef = useRef<WindowedListHandle>(null)
  const selectedIndex = incidents.findIndex((event) => event.sequence === selectedSeq)
  const onKeyDown = useListKeyboard(
    incidents.length,
    selectedIndex,
    (index) => onSelect(incidents[index]),
    listRef
  )
  if (incidents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-nss-border px-3 py-4 text-xs text-nss-muted">
        No failures, rejections or timeouts among the matching events.
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-nss-muted">
        {incidents.length.toLocaleString()} incidents: node and broker failures and breaker opens
        first, then rejections, then timeouts; each group in time order.
      </div>
      <WindowedList
        ref={listRef}
        count={incidents.length}
        rowHeight={INCIDENT_ROW_HEIGHT}
        maxHeight={LIST_MAX_HEIGHT}
        ariaLabel="Incidents"
        onKeyDown={onKeyDown}
        renderRow={(index) => {
          const event = incidents[index]
          const traced = event.requestId !== undefined && tracedIds.has(event.requestId)
          const border = event.status === 'timeout' ? 'border-l-nss-warning' : 'border-l-nss-danger'
          return (
            <div key={event.sequence} style={{ height: INCIDENT_ROW_HEIGHT }} className="pb-1">
              <div
                role="listitem"
                aria-selected={event.sequence === selectedSeq}
                onClick={() => onSelect(event)}
                className={`flex h-full cursor-pointer items-center gap-2 rounded-md border border-l-4 border-nss-border ${border} px-2.5 text-[11px] ${
                  event.sequence === selectedSeq
                    ? 'bg-nss-primary/10'
                    : 'bg-nss-surface hover:bg-nss-bg'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full border px-1.5 text-[10px] font-semibold leading-4 ${statusTone(event.status)}`}
                    >
                      {event.type}
                    </span>
                    <span className="truncate font-semibold text-nss-text">
                      {event.nodeId ? nodeLabel(event.nodeId) : 'run-level'}
                    </span>
                    {event.reasonCode && (
                      <span className="truncate font-mono text-[10px] text-nss-muted">
                        {event.reasonCode}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-nss-muted">
                    {fmtSimTime(event.timestampMs)} · #{event.sequence.toLocaleString()}
                    {event.requestId ? ` · ${event.requestId}` : ''}
                  </div>
                </div>
                {traced && event.requestId && (
                  <button
                    type="button"
                    className={smallButtonClass()}
                    onClick={(click) => {
                      click.stopPropagation()
                      onDebugRequest(event.requestId!)
                    }}
                  >
                    <Bug size={11} /> Debug
                  </button>
                )}
              </div>
            </div>
          )
        }}
      />
    </div>
  )
}

function SwimLanes({
  events,
  nodeLabel,
  onSelect,
  onFocus,
  selectedSeq
}: {
  events: DebugEvent[]
  nodeLabel: (nodeId: string) => string
  onSelect: (event: DebugEvent) => void
  onFocus: (nodeId: string) => void
  selectedSeq: number | null
}) {
  const layout = useMemo(() => buildSwimLanes(events, SWIM_LANE_BUCKETS), [events])
  const maxCount = Math.max(
    1,
    ...layout.lanes.flatMap((lane) => lane.buckets.map((bucket) => bucket.count))
  )
  const span = layout.endMs - layout.startMs
  const bucketMs = span / layout.bucketCount
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const selected =
    selectedSeq !== null ? events.find((event) => event.sequence === selectedSeq) : null
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-nss-muted">
        {layout.lanes.length} lanes over {fmtSimTime(layout.startMs)} to {fmtSimTime(layout.endMs)}.
        Each mark is a {fmtSimTime(bucketMs)} slice; darker means more events, colour is the worst
        status in the slice. Filter to one request (request:&lt;id&gt;) for its own timeline.
      </div>
      <div className="max-h-[360px] overflow-y-auto rounded-md border border-nss-border bg-nss-surface p-2">
        <div className="space-y-1">
          {layout.lanes.map((lane) => (
            <div key={lane.nodeId ?? '__run__'} className="flex items-center gap-2">
              <button
                type="button"
                disabled={lane.nodeId === null}
                onClick={() => lane.nodeId && onFocus(lane.nodeId)}
                title={lane.nodeId ? 'Select on canvas' : 'Events with no node'}
                className="w-36 shrink-0 truncate text-left text-[11px] text-nss-text hover:text-nss-primary disabled:text-nss-muted disabled:hover:text-nss-muted"
              >
                {lane.nodeId ? nodeLabel(lane.nodeId) : 'run-level'}
                <span className="ml-1 tabular-nums text-[10px] text-nss-muted">
                  {lane.eventCount.toLocaleString()}
                </span>
              </button>
              <div className="relative h-5 flex-1 rounded bg-nss-bg">
                {lane.buckets.map((bucket) => {
                  const start = layout.startMs + bucket.bucket * bucketMs
                  const breakdown = (Object.keys(bucket.counts) as DebugEventStatus[])
                    .filter((status) => bucket.counts[status] > 0)
                    .map((status) => `${bucket.counts[status]} ${status}`)
                    .join(', ')
                  return (
                    <button
                      key={bucket.bucket}
                      type="button"
                      // One tab stop per lane (its label), not one per mark; the table is the keyboard path.
                      tabIndex={-1}
                      onClick={() => onSelect(events[bucket.worstIndex])}
                      title={`${fmtSimTime(start)} to ${fmtSimTime(start + bucketMs)}: ${bucket.count} events (${breakdown})`}
                      aria-label={`${lane.nodeId ? nodeLabel(lane.nodeId) : 'run-level'} at ${fmtSimTime(start)}: ${bucket.count} events`}
                      className={`absolute inset-y-0.5 rounded-sm ${MARK_FILL[bucket.status]}`}
                      style={{
                        left: `${(bucket.bucket / layout.bucketCount) * 100}%`,
                        width: `max(3px, ${100 / layout.bucketCount}%)`,
                        opacity: 0.35 + 0.65 * Math.sqrt(bucket.count / maxCount)
                      }}
                    />
                  )
                })}
                {selected &&
                  (selected.nodeId ?? null) === lane.nodeId &&
                  selected.timestampMs >= layout.startMs &&
                  selected.timestampMs <= layout.endMs && (
                    <div
                      className="pointer-events-none absolute -inset-y-0.5 w-0.5 bg-nss-primary"
                      style={{ left: `${((selected.timestampMs - layout.startMs) / span) * 100}%` }}
                    />
                  )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="w-36 shrink-0" />
          <div className="relative h-4 flex-1 text-[9px] tabular-nums text-nss-muted">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
                style={{ left: `${tick * 100}%` }}
              >
                {fmtSimTime(layout.startMs + tick * span)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function EventDetail({
  event,
  traced,
  tracedCount,
  nodeLabel,
  edgeLabel,
  onClose,
  onFocus,
  onFilterRequest,
  onDebugRequest
}: {
  event: DebugEvent
  traced: boolean
  tracedCount: number
  nodeLabel: (nodeId: string) => string
  edgeLabel: (edgeId: string) => string
  onClose: () => void
  onFocus: (event: DebugEvent) => void
  onFilterRequest: (requestId: string) => void
  onDebugRequest: (requestId: string) => void
}) {
  const payloadText = useMemo(() => {
    const keys = Object.keys(event.payload)
    return keys.length > 0 ? JSON.stringify(event.payload, null, 2) : null
  }, [event.payload])
  const snapshot = event.nodeSnapshot
  const fields: Array<[string, string]> = [
    ['Sequence', `#${event.sequence.toLocaleString()}`],
    ['Sim time', fmtSimTime(event.timestampMs)],
    ['Status', event.status]
  ]
  if (event.nodeId) fields.push(['Node', `${nodeLabel(event.nodeId)} [${event.nodeId}]`])
  if (event.edgeId) fields.push(['Edge', edgeLabel(event.edgeId)])
  if (event.sourceNodeId && event.targetNodeId)
    fields.push(['Hop', `${nodeLabel(event.sourceNodeId)} → ${nodeLabel(event.targetNodeId)}`])
  if (event.requestId) fields.push(['Request', event.requestId])
  if (event.reasonCode) fields.push(['Reason', event.reasonCode])
  return (
    <div
      className="space-y-2 rounded-md border border-nss-border bg-nss-surface p-3 text-[11px]"
      aria-label="Selected event"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-1.5 text-[10px] font-semibold leading-4 ${statusTone(event.status)}`}
        >
          {event.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-nss-text">{event.message}</span>
        {(event.nodeId || event.sourceNodeId) && (
          <button type="button" className={smallButtonClass()} onClick={() => onFocus(event)}>
            <Crosshair size={11} /> Show on canvas
          </button>
        )}
        {event.requestId && (
          <button
            type="button"
            className={smallButtonClass()}
            onClick={() => onFilterRequest(event.requestId!)}
          >
            <Filter size={11} /> This request
          </button>
        )}
        {event.requestId && traced && (
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-nss-primary bg-nss-primary/10 px-1.5 text-[10px] font-semibold text-nss-primary hover:bg-nss-primary/20"
            onClick={() => onDebugRequest(event.requestId!)}
          >
            <Bug size={11} /> Debug request
          </button>
        )}
        <button
          type="button"
          aria-label="Close event detail"
          className="text-nss-muted hover:text-nss-text"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>
      {event.requestId && !traced && (
        <div className="text-[10px] text-nss-muted">
          This request was not in the trace sample ({tracedCount.toLocaleString()} requests were
          traced), so the step-through debugger has no phase record for it. Its retained events are
          still listed here.
        </div>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-nss-muted">{label}</dt>
            <dd className="truncate font-mono text-nss-text" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {snapshot && (
        <div className="text-[10px] text-nss-muted">
          Node state at this event: queue {snapshot.queueLength}, {snapshot.activeWorkers} busy
          worker{snapshot.activeWorkers === 1 ? '' : 's'}
          {snapshot.workers !== undefined ? ` of ${snapshot.workers}` : ''}
          {snapshot.capacity !== undefined ? `, capacity ${snapshot.capacity}` : ''}, status{' '}
          {snapshot.status}. This is an instantaneous snapshot, not a run average.
        </div>
      )}
      {payloadText && (
        <pre className="max-h-40 overflow-auto rounded border border-nss-border bg-nss-bg p-2 font-mono text-[10px] text-nss-text">
          {payloadText}
        </pre>
      )}
    </div>
  )
}
