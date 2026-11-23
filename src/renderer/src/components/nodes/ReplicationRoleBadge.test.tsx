import { describe, expect, it } from 'vitest'
import {
  getReplicationRolePresentation,
  getReplicationRuntimePresentation
} from './replicationRolePresentation'

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

  it('adds honest runtime state without changing the configured role', () => {
    const leader = { sim: { replicationEnabled: true, replicationRole: 'leader' } } as never
    const follower = { sim: { replicationEnabled: true, replicationRole: 'follower' } } as never

    expect(
      getReplicationRuntimePresentation(
        leader,
        'leader',
        { traitCounters: { replicationPrimaryAcks: 602 } },
        undefined
      )?.label
    ).toBe('LEADER · REPLICATING')
    expect(
      getReplicationRuntimePresentation(
        follower,
        'follower',
        { traitCounters: { replicationReplicaReads: 100 } },
        {
          nodes: [{ nodeId: 'follower', reads: 100, staleReads: 2, catchUpWaits: 0 }]
        } as never
      )?.label
    ).toBe('FOLLOWER · LAGGING')
  })

  it('shows degraded leader state when quorum or failover affects writes', () => {
    const leader = { sim: { replicationEnabled: true, replicationRole: 'leader' } } as never
    expect(
      getReplicationRuntimePresentation(
        leader,
        'leader',
        { traitCounters: { replicationQuorumFailures: 3 } },
        undefined
      )?.label
    ).toBe('LEADER · DEGRADED')
  })
})

describe('getReplicationLagChip', () => {
  const follower = (lag?: number) =>
    ({
      sim: { replicationEnabled: true, replicationRole: 'follower', replicationLagMs: lag }
    }) as never
  const metrics = { traitCounters: {} } as never

  it('shows Synced for zero-lag followers and ms behind otherwise', async () => {
    const { getReplicationLagChip } = await import('./replicationRolePresentation')
    expect(getReplicationLagChip(follower(0), 'f', metrics, undefined)?.label).toBe('✓ Synced')
    expect(getReplicationLagChip(follower(240), 'f', metrics, undefined)?.label).toBe(
      '240 ms behind'
    )
  })

  it('stays hidden for leaders and before a run', async () => {
    const { getReplicationLagChip } = await import('./replicationRolePresentation')
    const leader = { sim: { replicationEnabled: true, replicationRole: 'leader' } } as never
    expect(getReplicationLagChip(leader, 'l', metrics, undefined)).toBeNull()
    expect(getReplicationLagChip(follower(0), 'f', undefined, undefined)).toBeNull()
  })
})
