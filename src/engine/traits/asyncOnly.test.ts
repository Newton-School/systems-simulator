import { describe, expect, it } from 'vitest'
import { isAsyncBoundaryComponentType } from './asyncOnly'

describe('isAsyncBoundaryComponentType', () => {
  it('recognizes observability component types via their componentSpecs asyncBoundary flag', () => {
    expect(isAsyncBoundaryComponentType('metrics-store')).toBe(true)
    expect(isAsyncBoundaryComponentType('centralized-logging')).toBe(true)
    expect(isAsyncBoundaryComponentType('distributed-tracing')).toBe(true)
    expect(isAsyncBoundaryComponentType('alerting-hook')).toBe(true)
    expect(isAsyncBoundaryComponentType('safety-observability-mesh')).toBe(true)
  })

  it('recognizes other fire-and-forget planes flagged in componentSpecs (queues, brokers, background workers)', () => {
    expect(isAsyncBoundaryComponentType('queue')).toBe(true)
    expect(isAsyncBoundaryComponentType('stream')).toBe(true)
    expect(isAsyncBoundaryComponentType('message-broker')).toBe(true)
    expect(isAsyncBoundaryComponentType('pub-sub')).toBe(true)
    expect(isAsyncBoundaryComponentType('batch-worker')).toBe(true)
    expect(isAsyncBoundaryComponentType('agent-orchestrator')).toBe(true)
  })

  it('does not flag ordinary compute or storage nodes', () => {
    expect(isAsyncBoundaryComponentType('microservice')).toBe(false)
    expect(isAsyncBoundaryComponentType('relational-db')).toBe(false)
  })
})
