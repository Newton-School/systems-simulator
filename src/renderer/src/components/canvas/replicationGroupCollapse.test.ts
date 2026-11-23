import { describe, expect, it } from 'vitest'
import type { Edge } from 'reactflow'
import { applyReplicationGroupCollapse } from './replicationGroupCollapse'

const node = (id: string, sim?: Record<string, unknown>, selected = false) => ({
  id,
  selected,
  data: { sim }
})
const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target
})

const nodes = [
  node('api1'),
  node('api2'),
  node('leader', { replicationRole: 'leader' }),
  node('f1', { replicationRole: 'follower' }),
  node('f2', { replicationRole: 'follower' })
]
const edges = [
  edge('api1', 'leader'),
  edge('api1', 'f1'),
  edge('api1', 'f2'),
  edge('api2', 'leader'),
  edge('api2', 'f1'),
  edge('api2', 'f2'),
  edge('leader', 'f1'),
  edge('leader', 'f2')
]

describe('applyReplicationGroupCollapse', () => {
  it('hides caller→follower edges only, keeping leader and replication links', () => {
    const result = applyReplicationGroupCollapse(nodes, edges, true)
    const hidden = result.edges.filter((e) => e.hidden).map((e) => e.id)
    expect(hidden.sort()).toEqual(['api1-f1', 'api1-f2', 'api2-f1', 'api2-f2'])
    expect(result.hiddenCount).toBe(4)
  })

  it('changes nothing when expanded', () => {
    const result = applyReplicationGroupCollapse(nodes, edges, false)
    expect(result.edges).toBe(edges)
    expect(result.hiddenCount).toBe(0)
    expect(result.collapsibleCount).toBe(4)
  })

  it('keeps edges visible when an endpoint is selected', () => {
    const selected = nodes.map((n) => (n.id === 'f1' ? { ...n, selected: true } : n))
    const result = applyReplicationGroupCollapse(selected, edges, true)
    expect(
      result.edges
        .filter((e) => e.hidden)
        .map((e) => e.id)
        .sort()
    ).toEqual(['api1-f2', 'api2-f2'])
  })

  it('ignores topologies without replication', () => {
    const plain = [node('a'), node('b')]
    const result = applyReplicationGroupCollapse(plain, [edge('a', 'b')], true)
    expect(result.collapsibleCount).toBe(0)
  })
})
