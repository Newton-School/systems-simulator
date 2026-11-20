import { describe, expect, it } from 'vitest'
import { getReplicationRolePresentation } from './replicationRolePresentation'

describe('getReplicationRolePresentation', () => {
  it('maps replication roles to learner-facing leader and follower badges', () => {
    expect(
      getReplicationRolePresentation({
        sim: { replicationEnabled: true, replicationRole: 'leader' }
      } as never)?.label
    ).toBe('LEADER')
    expect(
      getReplicationRolePresentation({
        sim: { replicationEnabled: true, replicationRole: 'replica' }
      } as never)?.label
    ).toBe('FOLLOWER')
    expect(
      getReplicationRolePresentation({
        sim: { replicationEnabled: true }
      } as never)?.label
    ).toBe('LEADER')
  })

  it('does not badge standalone databases', () => {
    expect(
      getReplicationRolePresentation({
        sim: { replicationEnabled: false, replicationRole: 'leader' }
      } as never)
    ).toBeNull()
    expect(getReplicationRolePresentation({ sim: {} } as never)).toBeNull()
  })
})
