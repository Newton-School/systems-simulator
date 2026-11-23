import { describe, expect, it } from 'vitest'
import {
  buildReplicationConfigSummary,
  buildReplicationResultsSummary
} from './replicationInspector'

const node = (id: string, role: 'leader' | 'follower', members = 'primary,replica-a') => ({
  id,
  data: {
    label: id,
    sim: {
      replicationEnabled: true,
      replicationRole: role,
      replicaMembers: members,
      replicationLagMs: role === 'follower' ? 40 : undefined,
      writeAckPolicy: role === 'leader' ? 'quorum' : undefined
    }
  }
})

describe('buildReplicationConfigSummary', () => {
  it('summarizes a valid leader and follower group', () => {
    const nodes = [node('primary', 'leader'), node('replica-a', 'follower')]
    const summary = buildReplicationConfigSummary('primary', nodes[0].data as never, nodes)

    expect(summary).toMatchObject({
      role: 'leader',
      memberCount: 2,
      leaderCount: 1,
      followerCount: 1,
      settingLabel: 'Write acknowledgement',
      settingValue: 'Quorum',
      warning: null
    })
  })

  it('explains follower behavior and lag', () => {
    const nodes = [node('primary', 'leader'), node('replica-a', 'follower')]
    const summary = buildReplicationConfigSummary('replica-a', nodes[1].data as never, nodes)

    expect(summary).toMatchObject({
      role: 'follower',
      settingLabel: 'Replica lag',
      settingValue: '40 ms'
    })
    expect(summary?.behavior).toContain('rejects writes')
  })

  it('warns when a group has multiple leaders', () => {
    const nodes = [node('primary', 'leader'), node('replica-a', 'leader')]
    const summary = buildReplicationConfigSummary('primary', nodes[0].data as never, nodes)

    expect(summary?.warning).toContain('2 leaders')
  })

  it('does not summarize standalone databases', () => {
    const data = { sim: { replicationEnabled: false } }
    expect(buildReplicationConfigSummary('db', data as never, [{ id: 'db', data }])).toBeNull()
  })

  it('summarizes committed leader writes without treating them as request-edge traffic', () => {
    const leader = node('primary', 'leader')
    const summary = buildReplicationResultsSummary({
      nodeId: leader.id,
      data: leader.data as never,
      traitCounters: { replicationPrimaryAcks: 602 }
    })

    expect(summary).toMatchObject({
      status: 'Replication healthy',
      tone: 'healthy'
    })
    expect(summary?.metrics[0]).toEqual({ label: 'Committed writes', value: '602' })
  })

  it('surfaces follower stale reads and lag', () => {
    const follower = node('replica-a', 'follower')
    const summary = buildReplicationResultsSummary({
      nodeId: follower.id,
      data: follower.data as never,
      traitCounters: { replicationReplicaReads: 1_000 },
      consistency: {
        nodes: [
          {
            nodeId: follower.id,
            nodeLabel: 'Replica A',
            model: 'eventual',
            role: 'follower',
            replicationLagMs: 40,
            reads: 1_000,
            staleReads: 25,
            catchUpWaits: 0,
            catchUpWaitMs: 0
          }
        ]
      } as never
    })

    expect(summary).toMatchObject({
      status: 'Replica served stale reads',
      tone: 'warning'
    })
    expect(summary?.metrics).toContainEqual({ label: 'Stale reads', value: '25 · 2.5%' })
    expect(summary?.metrics).toContainEqual({ label: 'Configured lag', value: '40 ms' })
  })
})
