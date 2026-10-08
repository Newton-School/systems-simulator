import type { SimulationOutput } from '../../../engine/analysis/output'
import { projectToDebugEvent, type DebugEvent } from '../../../engine/core/event-stream'
import {
  buildTraceWaterfall,
  terminalCauseLabel
} from '../../../renderer/src/components/simulation/traceWaterfall'
import { parseEventQuery, matchesEventQuery } from '../../eventQuery'
import { labelOf, requireResults, requireTopology, resolveNodeId } from '../data'
import { fmtCount, fmtMs, heading, note, table } from '../format'
import { CommandError, type CommandDefinition, type CommandScope, type ParsedArgs } from '../types'
import type { Palette } from '../../ansi'

const DEFAULT_LAST = 20
const MAX_LAST = 500

function lastCount(args: ParsedArgs): number {
  const raw = args.flags.last ?? args.flags.n
  if (raw === undefined) return DEFAULT_LAST
  const value = raw === true ? NaN : Number(raw)
  if (!Number.isInteger(value) || value < 1)
    throw new CommandError(`--last: expected a positive whole number, got '${raw}'.`)
  return Math.min(value, MAX_LAST)
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  if (value === true) throw new CommandError(`--${name} needs a value.`)
  return value
}

function statusColor(status: DebugEvent['status'], c: Palette): string {
  switch (status) {
    case 'success':
      return c.green
    case 'rejected':
    case 'failure':
      return c.red
    case 'timeout':
      return c.yellow
    default:
      return ''
  }
}

/** Retention note when the stored event stream is a prefix of what the run produced. */
export function retentionNote(results: SimulationOutput, c: Palette): string | null {
  const total = Object.values(results.eventCountsByType).reduce((sum, count) => sum + count, 0)
  if (results.eventStream.length >= total) return null
  const last = results.eventStream[results.eventStream.length - 1]
  const until = last
    ? ` (the first ${fmtCount(results.eventStream.length)}, up to t=${(Number(last.timestampUs) / 1e6).toFixed(2)}s)`
    : ''
  return note(
    `The run produced ${fmtCount(total)} events; ${fmtCount(results.eventStream.length)} are retained for inspection${until}.`,
    c
  )
}

function eventRows(events: DebugEvent[], c: Palette): string[][] {
  return events.map((event) => {
    const color = statusColor(event.status, c)
    return [
      String(event.sequence),
      `${event.timestampMs.toFixed(3)}ms`,
      `${color}${event.type}${color ? c.reset : ''}`,
      event.nodeId ?? '-',
      event.requestId ?? '-',
      event.reasonCode ?? ''
    ]
  })
}

function showEvents(scope: CommandScope, args: ParsedArgs): string[] {
  const c = scope.deps.palette
  const results = requireResults(scope, 'show events')
  const last = lastCount(args)
  const nodeToken = stringFlag(args, 'node')
  const requestId = stringFlag(args, 'request')
  const type = stringFlag(args, 'type')
  const where = stringFlag(args, 'where')
  const nodeId = nodeToken ? resolveNodeId(requireTopology(scope), nodeToken) : undefined
  let records = results.eventStream
  if (nodeId) records = records.filter((record) => record.nodeId === nodeId)
  if (requestId) records = records.filter((record) => record.requestId === requestId)
  if (type)
    records = records.filter((record) => record.type === type || record.type.startsWith(type))
  if (where !== undefined) {
    const parsed = parseEventQuery(where)
    if ('error' in parsed) throw new CommandError(`--where: ${parsed.error}`)
    const { query } = parsed
    const { topology } = scope.deps.topology()
    const nodeLabel = topology ? (id: string) => labelOf(topology, id) : undefined
    records = records.filter((record) =>
      matchesEventQuery(projectToDebugEvent(record), query, { nodeLabel })
    )
  }
  const shown = records.slice(-last).map(projectToDebugEvent)
  const filters = [
    nodeId && `node ${nodeId}`,
    requestId && `request ${requestId}`,
    type && `type ${type}`,
    where && `where ${where}`
  ]
    .filter(Boolean)
    .join(', ')
  const lines = [
    heading(
      'Events',
      c,
      `last ${shown.length} of ${fmtCount(records.length)}${filters ? `, ${filters}` : ''}`
    )
  ]
  if (shown.length === 0) {
    lines.push('No matching events.')
  } else {
    lines.push(
      ...table(['SEQ', 'TIME', 'TYPE', 'NODE', 'REQUEST', 'REASON'], eventRows(shown, c), c, {
        align: ['right', 'right', 'left', 'left', 'left', 'left']
      })
    )
  }
  const retained = retentionNote(results, c)
  if (retained) lines.push(retained)
  return lines
}

function outcomeList(
  scope: CommandScope,
  args: ParsedArgs,
  status: 'rejected' | 'timeout'
): string[] {
  const c = scope.deps.palette
  const results = requireResults(scope, status === 'rejected' ? 'show rejected' : 'show timeouts')
  const last = lastCount(args)
  const matching = results.requestOutcomes.filter((outcome) => outcome.status === status)
  const shown = matching.slice(-last)
  const total =
    status === 'rejected' ? results.summary.rejectedRequests : results.summary.timedOutRequests
  const lines = [
    heading(
      status === 'rejected' ? 'Rejected requests' : 'Timed-out requests',
      c,
      `last ${shown.length} of ${fmtCount(total)}`
    )
  ]
  if (shown.length === 0) {
    lines.push(`${c.green}None.${c.reset}`)
    return lines
  }
  lines.push(
    ...table(
      ['REQUEST', 'AT', 'NODE', 'REASON', 'ATTEMPTS', 'TYPE'],
      shown.map((outcome) => [
        outcome.requestId,
        outcome.terminalAtMs === null ? '-' : `${outcome.terminalAtMs.toFixed(1)}ms`,
        outcome.nodeId ?? '-',
        `${status === 'rejected' ? c.red : c.yellow}${outcome.reasonCode ?? status}${c.reset}`,
        String(outcome.attempts),
        outcome.requestType ?? '-'
      ]),
      c,
      { align: ['left', 'right', 'left', 'left', 'right', 'left'] }
    )
  )
  if (status === 'rejected') {
    // Exact totals come from the per-node counters, not the (possibly sampled) rows.
    const byReason = new Map<string, number>()
    for (const metrics of Object.values(results.perNode)) {
      for (const [reason, count] of Object.entries(metrics.rejectionsByReason)) {
        byReason.set(reason, (byReason.get(reason) ?? 0) + count)
      }
    }
    if (byReason.size > 0) {
      lines.push(
        note(
          `By reason (all nodes, whole run): ${[...byReason].map(([reason, count]) => `${reason} ${fmtCount(count)}`).join(', ')}`,
          c
        )
      )
    }
  }
  if (results.requestOutcomesSampled) {
    lines.push(
      note(
        `Rows are a sample of ${fmtCount(results.requestOutcomeTotal)} outcomes; totals are exact.`,
        c
      )
    )
  }
  if (status === 'rejected') lines.push(note("'why-rejected <request>' explains one.", c))
  return lines
}

const BAR_WIDTH = 40

function showTrace(scope: CommandScope, requestId: string | undefined): string[] {
  const c = scope.deps.palette
  const results = requireResults(scope, 'show trace')
  if (!requestId) {
    const sample = results.traces.slice(0, 5).map((trace) => trace.requestId)
    throw new CommandError(
      `Usage: show trace <requestId>.` +
        (sample.length > 0 ? ` Traced requests include: ${sample.join(', ')}` : '')
    )
  }
  const trace = results.traces.find((candidate) => candidate.requestId === requestId)
  if (!trace) {
    const events = results.eventStream.filter((record) => record.requestId === requestId)
    if (events.length === 0) {
      throw new CommandError(
        `No trace or retained events for ${requestId}. Only sampled requests are traced (traceSampleRate); 'show events' lists ids.`
      )
    }
    const debug = events.map(projectToDebugEvent)
    return [
      heading(`Request ${requestId}`, c, 'not trace-sampled; event timeline instead'),
      ...table(
        ['SEQ', 'TIME', 'TYPE', 'NODE', 'REASON'],
        eventRows(debug, c).map((row) => [row[0], row[1], row[2], row[3], row[5]]),
        c
      )
    ]
  }
  const waterfall = buildTraceWaterfall(trace)
  const total = Math.max(waterfall.totalMs, 1e-9)
  const statusText =
    waterfall.status === 'success'
      ? `${c.green}success${c.reset}`
      : `${c.red}${waterfall.status}${c.reset}`
  const lines = [
    heading(`Trace ${requestId}`, c, `${fmtMs(waterfall.totalMs)} end to end`) + ` ${statusText}`
  ]
  const rows = waterfall.hops.map((hop) => {
    const start = Math.round((hop.startMs / total) * BAR_WIDTH)
    const queue = Math.round((hop.queueMs / total) * BAR_WIDTH)
    const service = Math.max(1, Math.round((hop.serviceMs / total) * BAR_WIDTH))
    const bar =
      ' '.repeat(Math.min(start, BAR_WIDTH)) +
      `${c.yellow}${'░'.repeat(queue)}${c.reset}${hop.outcome === 'departed' ? c.cyan : c.red}${'█'.repeat(service)}${c.reset}`
    return [
      hop.nodeId,
      fmtMs(hop.startMs),
      fmtMs(hop.edgeBeforeMs),
      fmtMs(hop.queueMs),
      fmtMs(hop.serviceMs),
      hop.outcome === 'departed' ? '' : `${c.red}${hop.outcome}${c.reset}`,
      bar
    ]
  })
  lines.push(
    ...table(['NODE', 'ARRIVE', 'NETWORK', 'QUEUE', 'SERVICE', 'OUTCOME', 'TIMELINE'], rows, c, {
      align: ['left', 'right', 'right', 'right', 'right', 'left', 'left']
    })
  )
  if (waterfall.terminal) {
    lines.push(
      `  ended at ${waterfall.terminal.locusKind} ${waterfall.terminal.locus} after ${fmtMs(waterfall.terminal.atMs)}: ${terminalCauseLabel(waterfall.terminal.cause)}`
    )
  }
  lines.push(
    note(
      `${c.yellow}░${c.reset}${c.dim} queue  ${c.cyan}█${c.reset}${c.dim} service. Times are ms from request creation.` +
        (waterfall.exact
          ? ''
          : ' Built from spans (no phase record), so failed hops may be missing.'),
      c
    )
  )
  return lines
}

export const TRACE_MODES = ['runtime', 'sim'] as const

export const TRACE_COMMANDS: CommandDefinition[] = [
  {
    name: 'show events',
    modes: TRACE_MODES,
    summary:
      'Recent engine events (--where takes the Event Log query, e.g. "status:rejected OR node:api")',
    usage: '[--last N] [--node <id>] [--request <id>] [--type <event-type>] [--where "<query>"]',
    execute: (scope, args) => ({ lines: showEvents(scope, args) })
  },
  {
    name: 'show trace',
    modes: TRACE_MODES,
    summary: 'One request as a text waterfall: network, queue and service per hop',
    usage: '<requestId>',
    args: [{ name: 'requestId', kind: 'request' }],
    execute: (scope, args) => ({ lines: showTrace(scope, args.positionals[0]) })
  },
  {
    name: 'show rejected',
    modes: TRACE_MODES,
    summary: 'Recent rejections with reason codes',
    usage: '[--last N]',
    execute: (scope, args) => ({ lines: outcomeList(scope, args, 'rejected') })
  },
  {
    name: 'show timeouts',
    modes: TRACE_MODES,
    summary: 'Recent timeouts',
    usage: '[--last N]',
    execute: (scope, args) => ({ lines: outcomeList(scope, args, 'timeout') })
  }
]
