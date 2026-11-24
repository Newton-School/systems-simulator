import { describe, expect, it } from 'vitest'
import type { AnyNodeData } from '@renderer/types/ui'
import {
  getReplicationEdgePresentation,
  replicationWriteRate,
  shouldShowInactiveEdgeState
} from './replicationEdgePresentation'

const database = (sim: AnyNodeData['sim']): AnyNodeData =>
  ({ componentType: 'relational-db', sim }) as AnyNodeData

describe('getReplicationEdgePresentation', () => {
  it('styles only leader-to-follower database links as replication', () => {
    const leader = database({ replicationEnabled: true, replicationRole: 'leader' })
    const implicitLeader = database({ replicationEnabled: true })
    const follower = database({ replicationEnabled: true, replicationRole: 'follower' })

    expect(getReplicationEdgePresentation(leader, follower)).toMatchObject({
      label: 'REPLICATION',
      strokeDasharray: '8 6',
      idleStrokeWidth: 1.75,
      idleOpacity: 0.62,
      packetRadius: 4.25
    })
    expect(getReplicationEdgePresentation(implicitLeader, follower)).not.toBeNull()
    expect(getReplicationEdgePresentation(follower, leader)).toBeNull()
    expect(getReplicationEdgePresentation(leader, leader)).toBeNull()
  })

  it('does not call a configured replication link inactive when it has no request-flow record', () => {
    expect(
      shouldShowInactiveEdgeState({
        runComplete: true,
        hasFlowRecord: false,
        isReplicationLink: true
      })
    ).toBe(false)

    expect(
      shouldShowInactiveEdgeState({
        runComplete: true,
        hasFlowRecord: false,
        isReplicationLink: false
      })
    ).toBe(true)
  })

  it('derives an aggregate replication stream from committed leader writes', () => {
    expect(
      replicationWriteRate(
        {
          traitCounters: {
            replicationPrimaryAcks: 400,
            replicationQuorumWrites: 200
          }
        },
        4_000
      )
    ).toBe(150)
    expect(replicationWriteRate(undefined, 4_000)).toBe(0)
    expect(replicationWriteRate({ traitCounters: { replicationPrimaryAcks: 10 } }, 0)).toBe(0)
  })
})

describe('getRoutingPulseKind', () => {
  const api = { sim: {} } as never
  const leader = {
    componentType: 'relational-db',
    sim: { replicationEnabled: true, replicationRole: 'leader', replicaMembers: 'l,f' }
  } as never
  const soloLeader = {
    componentType: 'relational-db',
    sim: { replicationEnabled: true, replicationRole: 'leader' }
  } as never
  const follower = {
    componentType: 'relational-db',
    sim: { replicationEnabled: true, replicationRole: 'follower' }
  } as never

  it('classifies write, read and replication traffic', async () => {
    const { getRoutingPulseKind } = await import('./replicationEdgePresentation')
    expect(getRoutingPulseKind(api, leader)).toBe('write')
    expect(getRoutingPulseKind(api, follower)).toBe('read')
    expect(getRoutingPulseKind(leader, follower)).toBe('replication')
    expect(getRoutingPulseKind(api, soloLeader)).toBeNull()
    expect(getRoutingPulseKind(api, api)).toBeNull()
  })
})
