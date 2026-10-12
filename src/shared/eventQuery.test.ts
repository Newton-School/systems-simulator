import { describe, expect, it } from 'vitest'
import {
  countEventStatuses,
  filterEvents,
  matchesEventQuery,
  parseEventQuery,
  type EventQuery,
  type QueryableEvent
} from './eventQuery'

const events: QueryableEvent[] = [
  { type: 'request-arrived', status: 'info', requestId: 'req-1', nodeId: 'api' },
  {
    type: 'request-rejected',
    status: 'rejected',
    requestId: 'req-1',
    nodeId: 'api',
    reasonCode: 'capacity_exceeded',
    message: 'request req-1 rejected at api (capacity_exceeded)'
  },
  { type: 'request-arrived', status: 'info', requestId: 'req-2', nodeId: 'db' },
  {
    type: 'request-timed-out',
    status: 'timeout',
    requestId: 'req-2',
    nodeId: 'db',
    reasonCode: 'deadline'
  },
  { type: 'request-completed', status: 'success', requestId: 'req-3', nodeId: 'api' },
  { type: 'node-failed', status: 'failure', nodeId: 'db', edgeId: 'e-api-db' }
]

const labels: Record<string, string> = { api: 'Payment API', db: 'Orders DB' }
const ctx = { nodeLabel: (id: string) => labels[id] }

function q(raw: string): EventQuery {
  const parsed = parseEventQuery(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.query
}

function indexes(raw: string): number[] {
  return events.flatMap((event, index) => (matchesEventQuery(event, q(raw), ctx) ? [index] : []))
}

describe('parseEventQuery / matchesEventQuery', () => {
  it('matches everything for an empty query', () => {
    expect(q('   ').root).toEqual({ kind: 'all' })
    expect(filterEvents(events, q(''), ctx)).toHaveLength(events.length)
  })

  it('filters by each field', () => {
    expect(indexes('request:req-1')).toEqual([0, 1])
    expect(indexes('node:db')).toEqual([2, 3, 5])
    expect(indexes('status:rejected')).toEqual([1])
    expect(indexes('type:request-timed-out')).toEqual([3])
    expect(indexes('reason:CAPACITY_EXCEEDED')).toEqual([1])
    expect(indexes('edge:e-api-db')).toEqual([5])
  })

  it('accepts node labels, quoted values and prefix wildcards', () => {
    expect(indexes('node:"payment api"')).toEqual([0, 1, 4])
    expect(indexes('reason:cap*')).toEqual([1])
    expect(indexes('request:req-*')).toEqual([0, 1, 2, 3, 4])
    expect(indexes('type:request')).toEqual([0, 1, 2, 3, 4])
  })

  it('treats adjacency as AND, binds AND tighter than OR, and supports grouping', () => {
    expect(indexes('node:api status:rejected')).toEqual([1])
    expect(indexes('node:api AND status:rejected')).toEqual([1])
    expect(indexes('status:rejected OR status:timeout')).toEqual([1, 3])
    expect(indexes('node:db AND status:timeout OR status:success')).toEqual([3, 4])
    expect(indexes('node:db AND (status:timeout OR status:success)')).toEqual([3])
    expect(indexes('status:rejected or status:timeout')).toEqual([1, 3])
  })

  it('negates with NOT and a leading dash', () => {
    expect(indexes('node:api -status:info')).toEqual([1, 4])
    expect(indexes('NOT node:api')).toEqual([2, 3, 5])
  })

  it('matches bare words against message, ids, labels and reason', () => {
    expect(indexes('deadline')).toEqual([3])
    expect(indexes('orders')).toEqual([2, 3, 5])
  })

  it('reports syntax errors instead of silently matching', () => {
    const errorOf = (raw: string) => {
      const parsed = parseEventQuery(raw)
      return parsed.ok ? null : parsed.error
    }
    expect(errorOf('colour:red')).toMatch(/Unknown field 'colour:'/)
    expect(errorOf('status:broken')).toMatch(/Unknown status 'broken'/)
    expect(errorOf('type:nope')).toMatch(/No event type starts with 'nope'/)
    expect(errorOf('node:')).toMatch(/needs a value/)
    expect(errorOf('(status:rejected')).toMatch(/Missing '\)'/)
    expect(errorOf('status:rejected)')).toMatch(/Unmatched/)
    expect(errorOf('OR node:api')).toMatch(/needs a term on its left/)
    expect(errorOf('node:api OR')).toMatch(/must be followed by a term/)
    expect(errorOf('node:"api')).toMatch(/Unclosed/)
  })
})

describe('countEventStatuses', () => {
  it('counts each status', () => {
    expect(countEventStatuses(events)).toEqual({
      info: 2,
      success: 1,
      timeout: 1,
      rejected: 1,
      failure: 1
    })
  })
})
