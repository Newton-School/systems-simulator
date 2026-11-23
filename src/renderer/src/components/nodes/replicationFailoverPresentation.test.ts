import { describe, expect, it } from 'vitest'
import { getFailoverState, getQuorumChip } from './replicationFailoverPresentation'

const follower = { sim: { replicationEnabled: true, replicationRole: 'follower' } } as never
const leader = {
  sim: { replicationEnabled: true, replicationRole: 'leader', writeAckPolicy: 'quorum' }
} as never
const window = (componentId: string, startMs: number, endMs: number) =>
  ({ componentId, mode: 'reject', startMs, endMs }) as never

describe('getFailoverState', () => {
  it('reports an outage window as unavailable', () => {
    expect(getFailoverState(leader, 'l', {}, [window('l', 1000, 4500)])).toEqual({
      kind: 'unavailable',
      seconds: 3.5
    })
  })
  it('marks an elected follower as promoted', () => {
    expect(getFailoverState(follower, 'f', { leaderElected: 1 }, [])).toEqual({ kind: 'promoted' })
  })
  it('is quiet otherwise', () => {
    expect(getFailoverState(follower, 'f', {}, [window('other', 0, 1)])).toBeNull()
  })
})

describe('getQuorumChip', () => {
  const projection = (healthy: number, hasQuorum: boolean) =>
    [
      {
        clusterId: 'c',
        protocol: 'raft',
        conflictResolution: 'x',
        leaderId: 'l',
        quorumSize: 2,
        healthyReplicas: healthy,
        hasQuorum,
        members: ['l', 'a', 'b'].map((id) => ({
          id,
          role: 'x',
          term: 1,
          appliedIndex: 0,
          durableIndex: 0
        }))
      }
    ] as never
  it('shows acknowledgement progress', () => {
    const chip = getQuorumChip(leader, 'l', {}, projection(3, true))
    expect(chip?.label).toBe('✓ Acknowledged 3/3')
    expect(chip?.dots).toEqual([true, true, true])
  })
  it('shows quorum loss', () => {
    const chip = getQuorumChip(leader, 'l', { replicationQuorumFailures: 4 }, projection(1, false))
    expect(chip?.label).toBe('✗ Quorum lost 1/3')
    expect(chip?.ok).toBe(false)
  })
  it('only applies to quorum leaders', () => {
    expect(getQuorumChip(follower, 'f', {}, projection(3, true))).toBeNull()
  })
})
