import { describe, expect, it } from 'vitest'
import type { RequestOutcomeRecord } from '../../../../engine/core/event-stream'
import { replicationEffectEdgeIds } from './requestTraceReplication'

const record = (requestType: string, status: RequestOutcomeRecord['status'] = 'success') =>
  ({ requestType, status }) as RequestOutcomeRecord

const nodes = [
  {
    id: 'primary',
    data: {
      componentType: 'relational-db',
      sim: { replicationEnabled: true, replicationRole: 'leader' }
    }
  },
  {
    id: 'replica-a',
    data: {
      componentType: 'relational-db',
      sim: { replicationEnabled: true, replicationRole: 'follower' }
    }
  },
  {
    id: 'replica-b',
    data: {
      componentType: 'relational-db',
      sim: { replicationEnabled: true, replicationRole: 'follower' }
    }
  }
]
const edges = [
  { id: 'rep-a', source: 'primary', target: 'replica-a' },
  { id: 'rep-b', source: 'primary', target: 'replica-b' },
  { id: 'request', source: 'api', target: 'primary' }
] as never

describe('replicationEffectEdgeIds', () => {
  it('adds derived replication legs after a successful write reaches the leader', () => {
    expect(
      replicationEffectEdgeIds({
        record: record('write'),
        visitedNodeIds: ['source', 'api', 'primary'],
        edges,
        nodes
      })
    ).toEqual(['rep-a', 'rep-b'])
  })

  it('does not add replication legs to reads or failed writes', () => {
    expect(
      replicationEffectEdgeIds({
        record: record('read'),
        visitedNodeIds: ['source', 'api', 'primary'],
        edges,
        nodes
      })
    ).toEqual([])
    expect(
      replicationEffectEdgeIds({
        record: record('write', 'rejected'),
        visitedNodeIds: ['source', 'api', 'primary'],
        edges,
        nodes
      })
    ).toEqual([])
  })
})
