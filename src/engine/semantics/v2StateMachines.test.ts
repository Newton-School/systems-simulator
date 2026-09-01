import { describe, expect, it } from 'vitest'
import {
  ReplicaCluster,
  ReplicatedLog,
  reconcileExternalOutcome,
  routeSession
} from './v2StateMachines'

describe('V2 state machines', () => {
  it('retains replayable partition records, commits offsets, and rebalances groups', () => {
    const log = new ReplicatedLog(2, 100)
    const appended = log.append('order-1', 0)
    log.rebalance('indexers', ['a', 'b'])
    const member = appended.partition % 2 === 0 ? 'a' : 'b'
    expect(log.poll('indexers', member, appended.partition, 10)?.offset).toBe(0)
    log.commit('indexers', appended.partition, 0)
    expect(log.poll('indexers', member, appended.partition, 10)).toBeNull()
    expect(log.expire(100)).toBe(1)
  })
  it('commits only with quorum and promotes a deterministic leader', () => {
    const cluster = new ReplicaCluster([
      { id: 'a', role: 'leader', term: 1, appliedIndex: 0 },
      { id: 'b', role: 'follower', term: 1, appliedIndex: 0 },
      { id: 'c', role: 'follower', term: 1, appliedIndex: 0 }
    ])
    expect(cluster.write(2).committed).toBe(true)
    cluster.fail('a')
    expect(cluster.elect()?.id).toBe('b')
  })
  it('uses an authoritative probe and preserves L4/L7/session differences', () => {
    expect(reconcileExternalOutcome({ lookup: () => 'not-found' }, 'k')).toBe('safe-retry')
    expect(
      routeSession({ protocol: 'http', open: true, streamWindow: 1 }, 'l7', { path: '/nope' }, [
        '/ok'
      ])
    ).toBe('rejected')
    expect(routeSession({ protocol: 'websocket', open: true, streamWindow: 0 }, 'l4', {})).toBe(
      'flow-controlled'
    )
  })
})
