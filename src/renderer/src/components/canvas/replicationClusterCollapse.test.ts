import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import { collapseReplicationClusters } from './replicationClusterCollapse'

const node = (id: string, sim?: Record<string, unknown>): Node =>
  ({ id, position: { x: 0, y: 0 }, data: { sim } }) as Node

const nodes = [
  node('api'),
  node('l', { replicationEnabled: true, replicationRole: 'leader', replicaMembers: 'l,a,b' }),
  node('a', { replicationEnabled: true, replicationRole: 'follower' }),
  node('b', { replicationEnabled: true, replicationRole: 'follower' })
]

describe('collapseReplicationClusters', () => {
  it('hides only the followers, keeping the leader and callers', () => {
    const result = collapseReplicationClusters(nodes, true)
    expect(result.nodes.filter((n) => n.hidden).map((n) => n.id)).toEqual(['a', 'b'])
    expect([...result.hiddenIds].sort()).toEqual(['a', 'b'])
  })

  it('is a no-op when expanded or when there is no group', () => {
    expect(collapseReplicationClusters(nodes, false).nodes).toBe(nodes)
    expect(collapseReplicationClusters([node('x')], true).hiddenIds.size).toBe(0)
  })
})
