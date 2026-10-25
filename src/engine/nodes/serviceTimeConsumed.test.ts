import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine'
import { edge, node, source, topology } from '../scenarios/__tests__/fixtures'

/**
 * A trait that sets a per-request service-time adjustment (a latency penalty such as inspection or crypto cost, or a
 * service-time override such as an idempotency lookup) applies it to the node it arrived at. It must not travel with
 * the request and apply again at every node after it.
 */
function meanLatencyMs(output: ReturnType<SimulationEngine['run']>): number {
  const ok = output.requestOutcomes.filter((o) => o.status === 'success')
  return ok.reduce((sum, o) => sum + o.latencyMs, 0) / ok.length
}

describe('per-request service-time adjustments are consumed by the node that receives them', () => {
  it('a latency penalty is charged once, however many nodes follow', () => {
    const run = (downstream: number) => {
      const ids = Array.from({ length: downstream }, (_, i) => `svc${i}`)
      const gate = node('gate', 'network-policy', {
        serviceMs: 1,
        category: 'security-and-identity',
        config: { inspectionMs: 10 }
      })
      const nodes = [source(), gate, ...ids.map((id) => node(id, 'microservice', { serviceMs: 1 }))]
      const edges = [
        edge('client', 'gate'),
        edge('gate', ids[0]),
        ...ids.slice(1).map((id, i) => edge(ids[i], id))
      ]
      return meanLatencyMs(
        new SimulationEngine(
          topology(nodes, edges, {
            sourceNodeId: 'client',
            pattern: 'constant',
            baseRps: 20,
            requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
          })
        ).run()
      )
    }
    // Each extra service adds its own 1 ms and one 1 ms hop, never another 10 ms of inspection.
    expect(run(4) - run(1)).toBeLessThan(10)
    expect(run(4) - run(1)).toBeGreaterThan(5)
  })

  it('an override of the service time applies to its own node only', () => {
    const lookup = node('idem', 'idempotency-manager', {
      serviceMs: 5,
      category: 'auxiliary',
      config: { storeLookupMs: 1 }
    })
    const pay = node('pay', 'microservice', { serviceMs: 50 })
    const output = new SimulationEngine(
      topology([source(), lookup, pay], [edge('client', 'idem'), edge('idem', 'pay')], {
        sourceNodeId: 'client',
        pattern: 'constant',
        baseRps: 20,
        requestDistribution: [
          {
            type: 'POST',
            weight: 1,
            sizeBytes: 100,
            metadata: { idempotencyKey: 'k' },
            keyspace: { field: 'idempotencyKey', size: 1_000 }
          }
        ]
      })
    ).run()
    const executed = output.requestOutcomes.filter(
      (o) => o.status === 'success' && o.nodeId === 'pay'
    )
    expect(executed.length).toBeGreaterThan(50)
    // 1 ms lookup + 2 ms of hops + the payment node's own 50 ms, not the lookup's 1 ms again.
    expect(Math.min(...executed.map((o) => o.latencyMs))).toBeGreaterThan(45)
  })
})
