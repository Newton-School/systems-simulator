import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine'
import { deriveNodeConcurrency } from '../nodes/resourceDerivation'
import { testEdge, testNode, testTopology } from '../__tests__/traitTestTopology'

// A connection server: 2 x c5.xlarge (4 vCPU, 8 GB each), 2 ms per message.
function gateway(config: Record<string, unknown>) {
  return testNode('gw', 'api-gateway', 2, {
    resources: { instanceType: 'c5.xlarge', instanceCount: 2 },
    config
  } as never)
}

function run(config: Record<string, unknown>, rps = 500) {
  const topology = testTopology([gateway(config)], [testEdge('src', 'gw')], rps, 5000)
  return new SimulationEngine(topology).run().perNode.gw
}

describe('persistentConnFanout: held connections', () => {
  it('held connections pin RAM, so request admission K shrinks', () => {
    const plain = deriveNodeConcurrency(gateway({}))
    const held = deriveNodeConcurrency(
      gateway({ heldConnections: 100_000, maxConnectionsPerInstance: 65_000 })
    )
    expect(plain.effectiveK).toBe(4096)
    // 100k x 32 KB = 3125 MB of the 16 GB fleet.
    expect(held.heldConnections?.connectionRamMb).toBe(3125)
    expect(held.effectiveK).toBe(3314)
  })

  it('connections past the per-instance ceiling are refused and counted', () => {
    const gw = run({ heldConnections: 500_000, maxConnectionsPerInstance: 65_000 })
    expect(gw.traitCounters.connectionsHeld).toBe(130_000)
    expect(gw.traitCounters.connectionsRefused).toBe(370_000)
  })

  it('heartbeats are steady CPU: fewer cores for requests, counted in utilization', () => {
    const quiet = run({ heldConnections: 120_000, maxConnectionsPerInstance: 65_000 })
    const chatty = run({
      heldConnections: 120_000,
      maxConnectionsPerInstance: 65_000,
      heartbeatIntervalMs: 1000,
      heartbeatCostMs: 0.05
    })
    // 120k pings/s x 0.05 ms = 6 of 8 cores.
    const derived = deriveNodeConcurrency(
      gateway({
        heldConnections: 120_000,
        maxConnectionsPerInstance: 65_000,
        heartbeatIntervalMs: 1000,
        heartbeatCostMs: 0.05
      })
    )
    expect(derived.heldConnections?.heartbeatCores).toBeCloseTo(6, 6)
    expect(derived.effectiveC).toBe(64)
    expect(quiet.utilization).toBeLessThan(0.05)
    expect(chatty.utilization).toBeGreaterThan(0.75)
  })
})

describe('persistentConnFanout: push fan-out', () => {
  it('each message is a write to every recipient, as on-core work', () => {
    const gw = run({
      heldConnections: 100_000,
      maxConnectionsPerInstance: 65_000,
      pushRecipients: 1000
    })
    expect(gw.traitCounters.pushMessages).toBe(2500)
    expect(gw.traitCounters.pushDeliveries).toBe(2_500_000)
    // 2 ms of work plus 1000 x 0.01 ms of writes per message.
    expect(gw.latencyNodeLocal.p50).toBeGreaterThan(11)
    // 500 msg/s x ~10 ms of writes = ~5 of 8 cores busy.
    expect(gw.utilization).toBeGreaterThan(0.6)
  })

  it('recipients whose connection was refused are undeliverable, not written', () => {
    const gw = run({
      heldConnections: 200_000,
      maxConnectionsPerInstance: 65_000,
      pushRecipients: 1000
    })
    expect(gw.traitCounters.pushDeliveries).toBe(1_625_000) // 65% connected
    expect(gw.traitCounters.pushUndeliverable).toBe(875_000)
  })

  it('a gateway with neither field set is unchanged', () => {
    const plain = run({})
    expect(plain.traitCounters.pushMessages).toBeUndefined()
    expect(plain.traitCounters.connectionsHeld).toBeUndefined()
  })
})
