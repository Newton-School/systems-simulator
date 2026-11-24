import { describe, expect, it } from 'vitest'
import { getReplayNodeState } from './replicationReplay'

const timeline = [
  { atMs: 5000, type: 'leader-down', nodeId: 'p' },
  { atMs: 5000, type: 'election-started', nodeId: 'p' },
  { atMs: 7000, type: 'leader-elected', nodeId: 'r1', replacedNodeId: 'p' },
  { atMs: 9000, type: 'leader-recovered', nodeId: 'p' }
] as never
const follower = {
  sim: { replicationEnabled: true, replicationRole: 'follower', replicaMembers: 'p,r1,r2' }
} as never
const leader = { sim: { replicationEnabled: true, replicationRole: 'leader' } } as never

describe('getReplayNodeState', () => {
  it('is quiet before the failure', () => {
    expect(getReplayNodeState(timeline, 'p', leader, 4999)).toBeNull()
    expect(getReplayNodeState(timeline, 'r2', follower, 4999)).toBeNull()
  })
  it('takes the leader down and starts the election', () => {
    expect(getReplayNodeState(timeline, 'p', leader, 5000)).toEqual({ kind: 'down' })
    expect(getReplayNodeState(timeline, 'r2', follower, 6000)).toEqual({
      kind: 'electing',
      remainingMs: 1000
    })
  })
  it('promotes the elected follower and ends the election for the others', () => {
    expect(getReplayNodeState(timeline, 'r1', follower, 7000)).toEqual({ kind: 'promoted' })
    expect(getReplayNodeState(timeline, 'r2', follower, 7000)).toBeNull()
  })
  it('marks the original leader recovered', () => {
    expect(getReplayNodeState(timeline, 'p', leader, 9500)).toEqual({ kind: 'recovered' })
  })
  it('does nothing without a timeline', () => {
    expect(getReplayNodeState(undefined, 'p', leader, 6000)).toBeNull()
  })
})
