import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'
import { EDGE_LATENCY_COMPONENTS } from './network/linkTransmission'

// Bandwidth enforcement (#181) and the per-edge latency breakdown (#26).
// client -> api over one edge; the api is fast and wide so the edge is the
// only thing that can bottleneck.

const DURATION_MS = 10_000
const WARMUP_MS = 1_000

function topology(opts: {
  bandwidthMbps: number
  sizeBytes: number
  rps: number
  edge?: Partial<EdgeDefinition>
}): TopologyJSON {
  const client: ComponentNode = {
    id: 'client',
    type: 'api-endpoint',
    category: 'compute',
    role: 'source',
    label: 'client',
    position: { x: 0, y: 0 }
  }
  const api: ComponentNode = {
    id: 'api',
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: 'api',
    position: { x: 0, y: 0 },
    queue: { workers: 1000, capacity: 100_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 60_000 }
  }
  return {
    id: 'edge-bandwidth',
    name: 'edge bandwidth',
    version: '1.0.0',
    global: {
      simulationDuration: DURATION_MS,
      seed: 'edge-bandwidth-seed',
      warmupDuration: WARMUP_MS,
      timeResolution: 'microsecond',
      defaultTimeout: 60_000,
      traceSampleRate: 0
    },
    nodes: [client, api],
    edges: [
      {
        id: 'client-to-api',
        source: 'client',
        target: 'api',
        mode: 'synchronous',
        protocol: 'https',
        latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
        bandwidth: opts.bandwidthMbps,
        maxConcurrentRequests: 1_000_000,
        packetLossRate: 0,
        errorRate: 0,
        ...opts.edge
      }
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: opts.rps,
      requestDistribution: [{ type: 'upload', weight: 1, sizeBytes: opts.sizeBytes }]
    }
  }
}

function edgeOf(output: ReturnType<SimulationEngine['run']>) {
  const metric = output.perEdge['client-to-api']
  expect(metric).toBeDefined()
  return metric
}

describe('edge bandwidth enforcement', () => {
  it('adds transmission delay: a big payload over a thin link takes longer', () => {
    // 125 KB = 1 Mbit; over 10 Mbps that is 100 ms on the wire. 2 rps leaves the
    // link idle between transfers, so there is no queueing.
    const small = edgeOf(
      new SimulationEngine(topology({ bandwidthMbps: 10, sizeBytes: 1_000, rps: 2 })).run()
    )
    const big = edgeOf(
      new SimulationEngine(topology({ bandwidthMbps: 10, sizeBytes: 125_000, rps: 2 })).run()
    )
    expect(small.latencyBreakdown!.meanMs.transmissionMs).toBeCloseTo(0.8, 3)
    expect(big.latencyBreakdown!.meanMs.transmissionMs).toBeCloseTo(100, 3)
    expect(big.transitLatency.p50!).toBeGreaterThan(small.transitLatency.p50! + 95)
    expect(big.latencyBreakdown!.meanMs.linkQueueMs).toBeLessThan(1)
  })

  it('caps edge throughput at the link rate and queues the excess', () => {
    // Link capacity = 10 Mbps / 1 Mbit = 10 transfers per second; offer 40 rps.
    const output = new SimulationEngine(
      topology({ bandwidthMbps: 10, sizeBytes: 125_000, rps: 40 })
    ).run()
    const metric = edgeOf(output)
    const windowS = (DURATION_MS - WARMUP_MS) / 1000
    const deliveredRps = metric.totalSuccessfulTransits / windowS
    expect(deliveredRps).toBeLessThanOrEqual(10.5)
    expect(deliveredRps).toBeGreaterThan(8)
    expect(metric.linkUtilization).toBeGreaterThan(0.95)
    // The excess waits for the link - that wait dominates the transit.
    expect(metric.latencyBreakdown!.meanMs.linkQueueMs).toBeGreaterThan(1000)
    expect(metric.latencyBreakdown!.maxLinkQueueMs).toBeGreaterThan(
      metric.latencyBreakdown!.meanMs.linkQueueMs
    )
  })

  it('does not throttle the same offered load on a wide link', () => {
    const output = new SimulationEngine(
      topology({ bandwidthMbps: 10_000, sizeBytes: 125_000, rps: 40 })
    ).run()
    const metric = edgeOf(output)
    const windowS = (DURATION_MS - WARMUP_MS) / 1000
    expect(metric.totalSuccessfulTransits / windowS).toBeGreaterThan(38)
    expect(metric.linkUtilization).toBeLessThan(0.01)
    expect(metric.latencyBreakdown!.meanMs.linkQueueMs).toBe(0)
  })
})

describe('per-edge latency breakdown', () => {
  it('components sum to the measured mean edge transit', () => {
    for (const rps of [2, 15]) {
      const metric = edgeOf(
        new SimulationEngine(
          topology({
            bandwidthMbps: 10,
            sizeBytes: 50_000,
            rps,
            edge: {
              latency: {
                distribution: { type: 'log-normal', mu: 1, sigma: 0.5 },
                pathType: 'same-dc'
              },
              packetLossRate: 0.05,
              maxConcurrentRequests: 20
            }
          })
        ).run()
      )
      const breakdown = metric.latencyBreakdown!
      const sum = EDGE_LATENCY_COMPONENTS.reduce((acc, key) => acc + breakdown.meanMs[key], 0)
      // Each transit rounds to whole µs, so allow 2 µs of drift on the mean.
      expect(Math.abs(sum - breakdown.meanTotalMs)).toBeLessThan(0.002)
      expect(Math.abs(breakdown.meanTotalMs - metric.transitLatency.mean!)).toBeLessThan(0.01)
      expect(breakdown.samples).toBe(metric.successLatencySamples)
      // Every modeled component shows up on this lossy, congested, thin link.
      expect(breakdown.meanMs.propagationMs).toBeGreaterThan(0)
      expect(breakdown.meanMs.transmissionMs).toBeCloseTo(40, 3)
      expect(breakdown.meanMs.protocolOverheadMs).toBeGreaterThan(0)
      expect(breakdown.meanMs.retransmissionMs).toBeGreaterThan(0)
    }
  })
})
