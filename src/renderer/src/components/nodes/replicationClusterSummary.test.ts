import { describe, expect, it } from 'vitest'
import { getClusterRates } from './replicationClusterSummary'

describe('getClusterRates', () => {
  const metrics = {
    l: { traitCounters: { replicationPrimaryAcks: 600 } },
    a: { traitCounters: { replicationReplicaReads: 2000 } },
    b: { traitCounters: { replicationReplicaReads: 3400 } }
  } as never

  it('sums follower reads and reports leader writes per second', () => {
    expect(getClusterRates('l', ['a', 'b'], metrics, undefined, 4000)).toEqual({
      writesPerSec: 150,
      readsPerSec: 1350
    })
  })
  it('is null before a run or without traffic', () => {
    expect(getClusterRates('l', ['a'], metrics, undefined, 0)).toBeNull()
    expect(getClusterRates('l', ['a'], {} as never, undefined, 4000)).toBeNull()
  })
})
