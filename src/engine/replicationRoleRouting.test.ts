import { describe, expect, it } from 'vitest'
import type { Request } from './core/events'
import type { ComponentNode, EdgeDefinition } from './core/types'
import { RoutingTable } from './routing'
import { createRandom } from './stochastic/random'

function request(type: string): Request {
  return {
    id: 'r',
    type,
    sizeBytes: 1,
    priority: 1,
    createdAt: 0n,
    deadline: 1_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata: {}
  }
}

function edge(source: string, target: string, overrides: Partial<EdgeDefinition> = {}) {
  return {
    id: `${source}-${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'tcp',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-rack' },
    bandwidth: 1000,
    maxConcurrentRequests: 1000,
    packetLossRate: 0,
    errorRate: 0,
    ...overrides
  } as EdgeDefinition
}

function node(id: string, role?: string): ComponentNode {
  return {
    id,
    type: id === 'api' ? 'microservice' : 'relational-db',
    category: id === 'api' ? 'compute' : 'datastore',
    label: id,
    position: { x: 0, y: 0 },
    ...(role ? { config: { replicationEnabled: true, replicationRole: role } } : {})
  } as ComponentNode
}

const nodes = [
  node('api'),
  node('leader', 'leader'),
  node('f1', 'follower'),
  node('f2', 'follower')
]

function targets(table: RoutingTable, type: string, runs = 40): Set<string> {
  const seen = new Set<string>()
  for (let i = 0; i < runs; i++) {
    for (const route of table.resolveTarget('api', request(type))) seen.add(route.targetNodeId)
  }
  return seen
}

describe('replication role routing on plain edges', () => {
  const plain = [edge('api', 'leader'), edge('api', 'f1'), edge('api', 'f2')]

  it('sends writes only to the leader', () => {
    const table = new RoutingTable(plain, createRandom('w'), nodes)
    expect([...targets(table, 'write')]).toEqual(['leader'])
  })

  it('spreads reads across the followers and not the leader', () => {
    const table = new RoutingTable(plain, createRandom('r'), nodes)
    expect([...targets(table, 'read')].sort()).toEqual(['f1', 'f2'])
  })

  it('leaves other request types alone', () => {
    const table = new RoutingTable(plain, createRandom('o'), nodes)
    expect(targets(table, 'GET', 80).size).toBe(3)
  })

  it('does nothing when the caller reaches only followers', () => {
    const table = new RoutingTable([edge('api', 'f1'), edge('api', 'f2')], createRandom('f'), nodes)
    expect([...targets(table, 'write')].sort()).toEqual(['f1', 'f2'])
  })

  it('respects explicit conditions exactly as authored', () => {
    const conditional = [
      edge('api', 'leader', { mode: 'conditional', condition: 'request.type === "write"' }),
      edge('api', 'f1', { mode: 'conditional', condition: 'request.type === "read"' }),
      edge('api', 'f2', { mode: 'conditional', condition: 'request.type === "read"' })
    ]
    const table = new RoutingTable(conditional, createRandom('c'), nodes)
    expect([...targets(table, 'write')]).toEqual(['leader'])
    expect([...targets(table, 'read')].sort()).toEqual(['f1', 'f2'])
  })

  it('ignores topologies without replication roles', () => {
    const plainNodes = [node('api'), node('a'), node('b')]
    const table = new RoutingTable(
      [edge('api', 'a'), edge('api', 'b')],
      createRandom('n'),
      plainNodes
    )
    expect([...targets(table, 'write')].sort()).toEqual(['a', 'b'])
  })
})

describe('leader replication links', () => {
  it('does not forward client requests along a plain leader→follower edge', () => {
    const table = new RoutingTable(
      [edge('leader', 'f1'), edge('leader', 'f2')],
      createRandom('l'),
      nodes
    )
    expect(table.resolveTarget('leader', request('write'))).toEqual([])
    expect(table.resolveTarget('leader', request('read'))).toEqual([])
  })

  it('keeps an explicit replication-typed edge', () => {
    const table = new RoutingTable(
      [edge('leader', 'f1', { mode: 'conditional', condition: 'request.type === "replication"' })],
      createRandom('l2'),
      nodes
    )
    expect(table.resolveTarget('leader', request('replication'))).toHaveLength(1)
  })
})
