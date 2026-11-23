import { describe, expect, it } from 'vitest'
import { findManagingLeader, planReplicaMembershipSync } from './replicaMembers'

const node = (id: string, sim?: Record<string, unknown>) => ({ id, data: { sim } })

describe('planReplicaMembershipSync', () => {
  const nodes = [
    node('p', { replicationEnabled: true, replicationRole: 'leader' }),
    node('r1'),
    node('r2'),
    node('x')
  ]

  it('gives every selected database the same list, leader first, as followers', () => {
    const patches = planReplicaMembershipSync(nodes, 'p', ['r1', 'p', 'r2'])
    expect(patches.map((patch) => patch.nodeId)).toEqual(['r1', 'r2'])
    for (const patch of patches) {
      expect(patch.sim).toMatchObject({
        replicationEnabled: true,
        replicationRole: 'follower',
        replicaMembers: 'p,r1,r2'
      })
    }
  })

  it('detaches databases removed from the set', () => {
    const synced = [
      nodes[0],
      node('r1', {
        replicationEnabled: true,
        replicationRole: 'follower',
        replicaMembers: 'p,r1,r2'
      }),
      node('r2', {
        replicationEnabled: true,
        replicationRole: 'follower',
        replicaMembers: 'p,r1,r2'
      })
    ]
    const patches = planReplicaMembershipSync(synced, 'p', ['r1'])
    const r2 = patches.find((patch) => patch.nodeId === 'r2')
    expect(r2?.sim.replicationEnabled).toBe(false)
    expect(r2?.sim.replicaMembers).toBeUndefined()
  })
})

describe('findManagingLeader', () => {
  it('finds the leader that lists the follower', () => {
    const nodes = [
      node('p', { replicationEnabled: true, replicationRole: 'leader', replicaMembers: 'p,r1' }),
      node('r1', { replicationEnabled: true, replicationRole: 'follower', replicaMembers: 'p,r1' })
    ]
    expect(findManagingLeader(nodes, 'r1')?.id).toBe('p')
    expect(findManagingLeader(nodes, 'p')).toBeUndefined()
  })
})
