import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { msToMicro } from '../core/time'
import type { ResolveRoute } from '../routing'
import { dnsRoutingPolicyTrait } from './dnsRoutingPolicy'
import type { TraitStateStore } from './types'

const route = (id: string, weight: number) =>
  ({ targetNodeId: id, edge: { id: `e-${id}`, weight } }) as unknown as ResolveRoute

function node(config: Record<string, unknown>): ComponentNode {
  return {
    id: 'dns',
    type: 'internal-dns',
    category: 'dns-and-certs',
    label: 'dns',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
    config
  } as ComponentNode
}

function store(): TraitStateStore {
  const m = new Map<string, unknown>()
  return { get: (k) => m.get(k) as never, set: (k, v) => void m.set(k, v) }
}

function resolve(
  config: Record<string, unknown>,
  state: TraitStateStore,
  atMs: number,
  aHealthy: boolean
): string {
  const result = dnsRoutingPolicyTrait.filterRoutes?.({
    node: node({ dnsRoutingPolicy: 'failover', dnsCacheTtlSeconds: 30, ...config }),
    request: { id: 'r', type: 'GET', metadata: {} } as unknown as Request,
    clock: msToMicro(atMs),
    random: () => 0,
    state,
    candidates: [route('a', 10), route('b', 1)],
    isTargetHealthy: (id) => id !== 'a' || aHealthy
  })
  const routes = Array.isArray(result) ? result : result!.routes
  return routes[0].targetNodeId
}

describe('DNS resolver caches', () => {
  it('keeps answering the cached primary until the TTL passes, then fails over', () => {
    const state = store()
    const config = { dnsResolvers: 1 }
    expect(resolve(config, state, 0, true)).toBe('a')
    // The primary is down from here on, but the resolver still holds its answer.
    expect(resolve(config, state, 10_000, false)).toBe('a')
    expect(resolve(config, state, 29_999, false)).toBe('a')
    expect(resolve(config, state, 30_000, false)).toBe('b')
  })

  it('answers fresh every time without resolvers', () => {
    const state = store()
    expect(resolve({}, state, 0, true)).toBe('a')
    expect(resolve({}, state, 1_000, false)).toBe('b')
  })
})
