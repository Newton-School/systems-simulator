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

import { planLeaderFieldSync } from './replicaMembers'

describe('planLeaderFieldSync', () => {
  const group = [
    node('p', { replicationEnabled: true, replicationRole: 'leader', replicaMembers: 'p,r1,r2' }),
    node('r1', {
      replicationEnabled: true,
      replicationRole: 'follower',
      consistencyModel: 'eventual'
    }),
    node('r2', {
      replicationEnabled: true,
      replicationRole: 'follower',
      consistencyModel: 'strong'
    }),
    node('other', { consistencyModel: 'eventual' })
  ]

  it('copies the leader value to members that differ and leaves others alone', () => {
    const patches = planLeaderFieldSync(group, 'p', 'consistencyModel', 'strong')
    expect(patches.map((patch) => patch.nodeId)).toEqual(['r1'])
    expect(patches[0].sim.consistencyModel).toBe('strong')
  })

  it('does nothing when the node is not a leader', () => {
    expect(planLeaderFieldSync(group, 'r1', 'consistencyModel', 'strong')).toEqual([])
  })
})

describe('membership sync carries the leader consistency model', () => {
  it('gives newly selected followers the leader model', () => {
    const nodes = [
      node('p', {
        replicationEnabled: true,
        replicationRole: 'leader',
        consistencyModel: 'strong'
      }),
      node('r1')
    ]
    const [patch] = planReplicaMembershipSync(nodes, 'p', ['r1'])
    expect(patch.sim.consistencyModel).toBe('strong')
  })
})
