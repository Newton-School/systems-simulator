import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine'
import { testEdge, testNode, testTopology } from '../__tests__/traitTestTopology'

// Order updates on 50 orders flow through a 4-partition change stream to
// consumers whose apply time is exponential (mean 10 ms), so concurrent applies
// of one order can finish out of order.
function run(streamConfig: Record<string, unknown>, consumers = 1, rps = 200) {
  const consumerNodes = Array.from({ length: consumers }, (_, i) =>
    testNode(`c${i}`, 'microservice', 10, {
      processing: { distribution: { type: 'exponential', lambda: 0.1 }, timeout: 5000 }
    } as never)
  )
  const topology = testTopology(
    [
      testNode('cdc', 'stream', 0.5, {
        queue: { workers: 64, capacity: 10000, discipline: 'fifo' },
        config: {
          streamBrokerEnabled: true,
          partitionCount: 4,
          changeStreamOrdering: true,
          ...streamConfig
        }
      } as never),
      ...consumerNodes
    ],
    [testEdge('src', 'cdc'), ...consumerNodes.map((node) => testEdge('cdc', node.id))],
    rps,
    5000
  )
  topology.workload!.requestDistribution = [
    { type: 'UPDATE', weight: 1, sizeBytes: 256, keyspace: { field: 'orderId', size: 50 } }
  ]
  return new SimulationEngine(topology).run().perNode.cdc.traitCounters
}

describe('changeStream trait', () => {
  it('a parallel consumer applies some changes of one entity out of order', () => {
    const counters = run({})
    expect(counters.changeEventsCaptured).toBe(1000)
    expect(counters.changeOrderViolations).toBeGreaterThan(0)
  })

  it('per-key consumption removes the violations, at the cost of held deliveries', () => {
    const counters = run({ consumerOrdering: 'per-key' })
    expect(counters.changeOrderViolations ?? 0).toBe(0)
    expect(counters.changeEventsWaitedForOrder).toBeGreaterThan(0)
    // All but the few still in flight at the end of the run.
    expect(counters.changeEventsApplied).toBeGreaterThan(990)
  })

  it('per-partition ordering only helps when the partition key is the entity key', () => {
    const wrongKey = run({ consumerOrdering: 'per-partition' }, 4, 350)
    expect(wrongKey.changeOrderViolations).toBeGreaterThan(0)
    const rightKey = run(
      { consumerOrdering: 'per-partition', partitionKeyField: 'orderId' },
      4,
      350
    )
    expect(rightKey.changeOrderViolations ?? 0).toBe(0)
  })

  it('does nothing unless the partitioned broker is on', () => {
    const counters = run({ streamBrokerEnabled: false })
    expect(counters.changeEventsCaptured).toBeUndefined()
  })
})
