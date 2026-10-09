import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { bulkheadCompartmentOf, bulkheadTrait, readBulkheadConfig } from './bulkhead'
import { resolveTraits } from './resolveTraits'

function node(bulkhead?: NonNullable<ComponentNode['resilience']>['bulkhead']): ComponentNode {
  return {
    id: 'svc',
    type: 'microservice',
    category: 'compute',
    label: 'svc',
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 10 }, timeout: 1_000 },
    resilience: bulkhead ? { bulkhead } : undefined
  }
}

const req = (type: string, metadata: Record<string, unknown> = {}) =>
  ({ type, metadata }) as unknown as Request

function decide(n: ComponentNode, request: Request, held: Request[]) {
  return bulkheadTrait.beforeArrival!({
    node: n,
    request,
    clock: 0n,
    countInSystem: (predicate) => held.filter(predicate).length
  })
}

describe('bulkheadTrait', () => {
  it('is off without compartment caps; a bare maxConcurrent does not switch it on', () => {
    expect(readBulkheadConfig(node())).toBeNull()
    expect(readBulkheadConfig(node({ maxConcurrent: 2 }))).toBeNull()
  })

  it('rejects a compartment at its cap and leaves other compartments alone', () => {
    const n = node({ partitions: { report: 2 } })
    const held = [req('report'), req('report'), req('read'), req('read'), req('read')]
    expect(decide(n, req('report'), held)).toMatchObject({
      action: 'rejected',
      reason: 'bulkhead_full',
      payload: { bulkheadCompartment: 'report', bulkheadLimit: 2, bulkheadInUse: 2 }
    })
    expect(decide(n, req('report'), held.slice(1)).action).toBe('continue')
    expect(decide(n, req('read'), held).action).toBe('continue')
  })

  it('applies defaultMaxConcurrent to unlisted compartments, keyed by metadata', () => {
    const n = node({ keyField: 'tenant', defaultMaxConcurrent: 1, partitions: { vip: 5 } })
    const held = [req('GET', { tenant: 'a' }), req('GET', { tenant: 'vip' })]
    expect(decide(n, req('GET', { tenant: 'a' }), held).action).toBe('rejected')
    expect(decide(n, req('GET', { tenant: 'b' }), held).action).toBe('continue')
    expect(decide(n, req('GET', { tenant: 'vip' }), held).action).toBe('continue')
    expect(bulkheadCompartmentOf(req('GET'), 'tenant')).toBe('(no key)')
    expect(bulkheadCompartmentOf(req('GET'), null)).toBe('GET')
  })
})

describe('trait resolution gate', () => {
  it('attaches the bulkhead and load shedder only to nodes that configure them', () => {
    const names = (n: ComponentNode) => resolveTraits(n).map((trait) => trait.name)
    expect(names(node())).not.toContain('resilience.bulkhead')
    expect(names(node())).not.toContain('resilience.load-shedding')
    expect(names(node({ partitions: { report: 2 } }))).toContain('resilience.bulkhead')
    expect(names({ ...node(), config: { loadShedQueueDepth: 4 } })).toContain(
      'resilience.load-shedding'
    )
  })
})
