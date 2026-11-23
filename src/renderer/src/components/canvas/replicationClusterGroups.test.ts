import { describe, expect, it } from 'vitest'
import { findReplicationGroups } from './replicationClusterGroups'

const n = (id: string, x: number, y: number, sim?: Record<string, unknown>) => ({
  id,
  position: { x, y },
  width: 100,
  height: 100,
  data: { sim }
})

describe('findReplicationGroups', () => {
  it('boxes the leader and its listed followers with padding', () => {
    const groups = findReplicationGroups([
      n('l', 0, 0, {
        replicationEnabled: true,
        replicationRole: 'leader',
        replicaMembers: 'l,a,b'
      }),
      n('a', 300, 0, { replicationEnabled: true, replicationRole: 'follower' }),
      n('b', 300, 200, { replicationEnabled: true, replicationRole: 'follower' }),
      n('api', -300, 0)
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ leaderId: 'l', followerCount: 2, x: -36, y: -36 })
    expect(groups[0].width).toBe(472)
    expect(groups[0].height).toBe(372)
  })

  it('ignores a lone leader', () => {
    expect(
      findReplicationGroups([n('l', 0, 0, { replicationEnabled: true, replicationRole: 'leader' })])
    ).toEqual([])
  })
})
