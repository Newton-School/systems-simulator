import { describe, expect, it } from 'vitest'
import type { AnyNodeData } from '@renderer/types/ui'
import { getReplicationEdgePresentation } from './replicationEdgePresentation'

const database = (sim: AnyNodeData['sim']): AnyNodeData =>
  ({ componentType: 'relational-db', sim }) as AnyNodeData

describe('getReplicationEdgePresentation', () => {
  it('styles only leader-to-follower database links as replication', () => {
    const leader = database({ replicationEnabled: true, replicationRole: 'leader' })
    const implicitLeader = database({ replicationEnabled: true })
    const follower = database({ replicationEnabled: true, replicationRole: 'follower' })

    expect(getReplicationEdgePresentation(leader, follower)).toMatchObject({
      label: 'REPLICATION',
      strokeDasharray: '8 6'
    })
    expect(getReplicationEdgePresentation(implicitLeader, follower)).not.toBeNull()
    expect(getReplicationEdgePresentation(follower, leader)).toBeNull()
    expect(getReplicationEdgePresentation(leader, leader)).toBeNull()
  })
})
