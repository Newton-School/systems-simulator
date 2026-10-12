import { CANONICAL_EVENT_TYPES, type DebugEventStatus } from '../engine/core/event-stream'

/**
 * Event-log query language, shared by the Results Tray Event Log filter bar and
 * the sim cli `show events --where` flag (#78). Pure: no React, no store.
 *
 * Syntax:
 *   request:<id>  node:<id|label>  edge:<id>  status:<level>  type:<event-type>  reason:<code>
 *   bare words match the event message, ids, node label and reason code (substring)
 *   a trailing `*` on a value makes it a prefix match (`reason:queue*`)
 *   `type:` also prefix-matches on its own (`type:request` matches every request-* type)
 *   AND / OR (case-insensitive), adjacency is AND, AND binds tighter than OR
 *   NOT or a leading `-` negates a term; parentheses group
 *   values with spaces go in double quotes: node:"Payment API"
 */

export const EVENT_QUERY_FIELDS = ['request', 'node', 'edge', 'status', 'type', 'reason'] as const
export type EventQueryField = (typeof EVENT_QUERY_FIELDS)[number]

export const DEBUG_EVENT_STATUSES: readonly DebugEventStatus[] = [
  'info',
  'success',
  'timeout',
  'rejected',
  'failure'
]

const FIELD_ALIASES: Record<string, EventQueryField> = {
  request: 'request',
  req: 'request',
  node: 'node',
  edge: 'edge',
  status: 'status',
  type: 'type',
  reason: 'reason'
}

const STATUS_ALIASES: Record<string, DebugEventStatus> = {
  info: 'info',
  success: 'success',
  ok: 'success',
  timeout: 'timeout',
  'timed-out': 'timeout',
  rejected: 'rejected',
  reject: 'rejected',
  failure: 'failure',
  failed: 'failure'
}

export type EventQueryNode =
  | { kind: 'all' }
  | { kind: 'clause'; field: EventQueryField; value: string; prefix: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'not'; child: EventQueryNode }
  | { kind: 'and'; children: EventQueryNode[] }
  | { kind: 'or'; children: EventQueryNode[] }

export interface EventQuery {
  raw: string
  root: EventQueryNode
}

// Both arms name both fields so callers narrow the same way with or without strictNullChecks.
export type EventQueryParseResult =
  | { ok: true; query: EventQuery; error?: undefined }
  | { ok: false; error: string; query?: undefined }

/** The fields an event needs to be matched. `DebugEvent` satisfies it. */
export interface QueryableEvent {
  type: string
  status: DebugEventStatus
  requestId?: string
  nodeId?: string
  edgeId?: string
  reasonCode?: string
  message?: string
}

export interface EventQueryContext {
  /** Display label for a node id, so `node:` accepts labels as well as ids. */
  nodeLabel?: (nodeId: string) => string | undefined
}

type Token =
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'word'; text: string; negated: boolean }

class QueryError extends Error {}

function tokenize(raw: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' })
      i++
      continue
    }
    let negated = false
    if (ch === '-' && i + 1 < raw.length && !/\s/.test(raw[i + 1])) {
      negated = true
      i++
    }
    let text = ''
    while (i < raw.length && !/[\s()]/.test(raw[i])) {
      if (raw[i] === '"') {
        const close = raw.indexOf('"', i + 1)
        if (close === -1) throw new QueryError('Unclosed " quote.')
        text += raw.slice(i + 1, close)
        i = close + 1
        continue
      }
      text += raw[i]
      i++
    }
    if (text === '') {
      if (negated) throw new QueryError("'-' must be followed by a term.")
      continue
    }
    const upper = text.toUpperCase()
    if (!negated && upper === 'AND') tokens.push({ kind: 'and' })
    else if (!negated && upper === 'OR') tokens.push({ kind: 'or' })
    else if (!negated && upper === 'NOT') tokens.push({ kind: 'not' })
    else tokens.push({ kind: 'word', text, negated })
  }
  return tokens
}

function parseTerm(text: string): EventQueryNode {
  const colon = text.indexOf(':')
  if (colon <= 0) return { kind: 'text', value: text.toLowerCase() }
  const name = text.slice(0, colon).toLowerCase()
  const field = FIELD_ALIASES[name]
  if (!field) {
    throw new QueryError(
      `Unknown field '${name}:'. Use one of ${EVENT_QUERY_FIELDS.map((f) => `${f}:`).join(', ')}.`
    )
  }
  let value = text.slice(colon + 1)
  if (value === '') throw new QueryError(`'${name}:' needs a value.`)
  let prefix = false
  if (value.endsWith('*')) {
    prefix = true
    value = value.slice(0, -1)
  }
  const lower = value.toLowerCase()
  if (field === 'status') {
    const status = STATUS_ALIASES[lower]
    if (!status) {
      throw new QueryError(
        `Unknown status '${value}'. Use one of ${DEBUG_EVENT_STATUSES.join(', ')}.`
      )
    }
    return { kind: 'clause', field, value: status, prefix: false }
  }
  if (field === 'type') {
    if (!CANONICAL_EVENT_TYPES.some((type) => type.startsWith(lower))) {
      throw new QueryError(
        `No event type starts with '${value}'. Types include request-rejected, request-timed-out, node-failed.`
      )
    }
    // type: always prefix-matches, mirroring `show events --type`.
    return { kind: 'clause', field, value: lower, prefix: true }
  }
  return { kind: 'clause', field, value: lower, prefix }
}

class Parser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): EventQueryNode {
    if (this.tokens.length === 0) return { kind: 'all' }
    const node = this.parseOr()
    if (this.index < this.tokens.length) {
      throw new QueryError(this.peek()?.kind === 'rparen' ? "Unmatched ')'." : 'Unexpected input.')
    }
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private parseOr(): EventQueryNode {
    const children = [this.parseAnd()]
    while (this.peek()?.kind === 'or') {
      this.index++
      if (this.peek() === undefined) throw new QueryError("'OR' must be followed by a term.")
      children.push(this.parseAnd())
    }
    return children.length === 1 ? children[0] : { kind: 'or', children }
  }

  private parseAnd(): EventQueryNode {
    const children = [this.parseUnary()]
    for (;;) {
      const next = this.peek()
      if (next === undefined || next.kind === 'or' || next.kind === 'rparen') break
      if (next.kind === 'and') {
        this.index++
        if (this.peek() === undefined) throw new QueryError("'AND' must be followed by a term.")
      }
      children.push(this.parseUnary())
    }
    return children.length === 1 ? children[0] : { kind: 'and', children }
  }

  private parseUnary(): EventQueryNode {
    const token = this.peek()
    if (token === undefined) throw new QueryError('Expected a term.')
    this.index++
    switch (token.kind) {
      case 'not': {
        if (this.peek() === undefined) throw new QueryError("'NOT' must be followed by a term.")
        return { kind: 'not', child: this.parseUnary() }
      }
      case 'lparen': {
        if (this.peek()?.kind === 'rparen') throw new QueryError('Empty parentheses.')
        const inner = this.parseOr()
        if (this.peek()?.kind !== 'rparen') throw new QueryError("Missing ')'.")
        this.index++
        return inner
      }
      case 'word': {
        const term = parseTerm(token.text)
        return token.negated ? { kind: 'not', child: term } : term
      }
      case 'rparen':
        throw new QueryError("Unmatched ')'.")
      case 'and':
      case 'or':
        throw new QueryError(`'${token.kind.toUpperCase()}' needs a term on its left.`)
    }
  }
}

export function parseEventQuery(raw: string): EventQueryParseResult {
  try {
    return { ok: true, query: { raw, root: new Parser(tokenize(raw)).parse() } }
  } catch (error) {
    if (error instanceof QueryError) return { ok: false, error: error.message }
    throw error
  }
}

function valueMatches(candidate: string | undefined, value: string, prefix: boolean): boolean {
  if (candidate === undefined) return false
  const lower = candidate.toLowerCase()
  return prefix ? lower.startsWith(value) : lower === value
}

function evaluate(node: EventQueryNode, event: QueryableEvent, ctx: EventQueryContext): boolean {
  switch (node.kind) {
    case 'all':
      return true
    case 'not':
      return !evaluate(node.child, event, ctx)
    case 'and':
      return node.children.every((child) => evaluate(child, event, ctx))
    case 'or':
      return node.children.some((child) => evaluate(child, event, ctx))
    case 'text': {
      const label = event.nodeId ? ctx.nodeLabel?.(event.nodeId) : undefined
      return [
        event.message,
        event.type,
        event.requestId,
        event.nodeId,
        label,
        event.edgeId,
        event.reasonCode
      ].some((field) => field !== undefined && field.toLowerCase().includes(node.value))
    }
    case 'clause':
      switch (node.field) {
        case 'request':
          return valueMatches(event.requestId, node.value, node.prefix)
        case 'node':
          return (
            valueMatches(event.nodeId, node.value, node.prefix) ||
            (event.nodeId !== undefined &&
              valueMatches(ctx.nodeLabel?.(event.nodeId), node.value, node.prefix))
          )
        case 'edge':
          return valueMatches(event.edgeId, node.value, node.prefix)
        case 'status':
          return event.status === node.value
        case 'type':
          return event.type.startsWith(node.value)
        case 'reason':
          return valueMatches(event.reasonCode, node.value, node.prefix)
      }
  }
}

export function matchesEventQuery(
  event: QueryableEvent,
  query: EventQuery,
  ctx: EventQueryContext = {}
): boolean {
  return evaluate(query.root, event, ctx)
}

export function isMatchAllQuery(query: EventQuery): boolean {
  return query.root.kind === 'all'
}

export function filterEvents<T extends QueryableEvent>(
  events: readonly T[],
  query: EventQuery,
  ctx: EventQueryContext = {}
): T[] {
  if (isMatchAllQuery(query)) return [...events]
  return events.filter((event) => evaluate(query.root, event, ctx))
}

export type EventStatusCounts = Record<DebugEventStatus, number>

/** Per-status counts over a set of events, for the filter bar's aggregate badges. */
export function countEventStatuses(events: readonly QueryableEvent[]): EventStatusCounts {
  const counts: EventStatusCounts = { info: 0, success: 0, timeout: 0, rejected: 0, failure: 0 }
  for (const event of events) counts[event.status]++
  return counts
}
