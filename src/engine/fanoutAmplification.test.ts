import { describe, expect, it } from 'vitest'
import type {
  ComponentNode,
  DistributionConfig,
  EdgeDefinition,
  TopologyJSON,
  WorkloadProfile
} from './core/types'
import type { SimulationOutput } from './analysis/output'
import { SimulationEngine } from './engine'
import { evaluateScenarios } from './analysis/evaluate'
import { validateTopology } from './validation/validator'

// Source → fan-out service → feed cache. The fan-out service's outgoing write edge
// carries a fanoutFactor, so one post amplifies into N feed-cache writes (GAP 2).

function sourceNode(id: string): ComponentNode {
  return {
    id,
    type: 'api-endpoint',
    category: 'compute',
    role: 'source',
    label: id,
    position: { x: 0, y: 0 }
  }
}

function serverNode(id: string, workers = 8, capacity = 100_000): ComponentNode {
  const distribution: DistributionConfig = { type: 'constant', value: 1 }
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers, capacity, discipline: 'fifo' },
    processing: { distribution, timeout: 5000 }
  }
}

function edge(source: string, target: string, extra: Partial<EdgeDefinition> = {}): EdgeDefinition {
  return {
    id: `${source}-to-${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 100_000,
    maxConcurrentRequests: 1_000_000,
    packetLossRate: 0,
    errorRate: 0,
    ...extra
  }
}

function workload(sourceId: string, baseRps: number): WorkloadProfile {
  return {
    sourceNodeId: sourceId,
    pattern: 'constant',
    baseRps,
    requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 512 }]
  }
}

function buildTopology(fanoutFactor: number | undefined): TopologyJSON {
  return {
    id: 'fanout-test',
    name: 'fanout',
    version: '1.0.0',
    global: {
      simulationDuration: 1000,
      seed: 'fanout-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 5000,
      traceSampleRate: 0
    },
    nodes: [sourceNode('client'), serverNode('fanout'), serverNode('feed-cache')],
    edges: [
      edge('client', 'fanout'),
      edge('fanout', 'feed-cache', { mode: 'asynchronous', fanoutFactor })
    ],
    workload: workload('client', 20)
  }
}

describe('fan-out amplification (GAP 2)', () => {
  it('amplifies one write into N deliveries to the downstream target', () => {
    const baseline = new SimulationEngine(buildTopology(undefined)).run()
    const amplified = new SimulationEngine(buildTopology(50)).run()

    const baseArrived = baseline.perNode['feed-cache'].totalArrived
    const ampArrived = amplified.perNode['feed-cache'].totalArrived
    expect(baseArrived).toBeGreaterThan(0)

    // With factor 50, the feed cache should see ~50× the arrivals of the
    // no-amplification baseline (allow slack for timing/warmup boundaries).
    expect(ampArrived).toBeGreaterThan(baseArrived * 40)
  })

  it('records the extra deliveries as fanoutAmplifiedWrites on the source', () => {
    const amplified = new SimulationEngine(buildTopology(50)).run()
    const counters = amplified.perNode.fanout.traitCounters
    const ampArrived = amplified.perNode['feed-cache'].totalArrived

    // Each forwarded request adds 49 extra deliveries (the 50th is the original),
    // so the counter is ~49/50 of what the feed cache received.
    expect(counters.fanoutAmplifiedWrites).toBeGreaterThan(0)
    expect(counters.fanoutAmplifiedWrites).toBeCloseTo((ampArrived * 49) / 50, -1)
  })

  it('does not amplify when no factor is set', () => {
    const baseline = new SimulationEngine(buildTopology(undefined)).run()
    expect(baseline.perNode.fanout.traitCounters.fanoutAmplifiedWrites ?? 0).toBe(0)
  })
})

// Regression: EdgeDefinitionSchema once lacked `fanoutFactor`, so Zod stripped it and
// every caller that runs `validateTopology(...).data` (CLI, scenario batch, question
// grading) simulated no amplification while the app, which runs the raw topology, did.
describe('fan-out amplification through the validated path', () => {
  it('keeps fanoutFactor on the validated edge', () => {
    const validation = validateTopology(buildTopology(2000))
    expect(validation.valid).toBe(true)
    const fanoutEdge = validation.data?.edges.find((e) => e.id === 'fanout-to-feed-cache')
    expect(fanoutEdge?.fanoutFactor).toBe(2000)
  })

  it('amplifies deliveries when graded via evaluateScenarios', () => {
    const runAndCapture = (topologyFactor: number | undefined): SimulationOutput => {
      let captured: SimulationOutput | undefined
      const contract = evaluateScenarios(buildTopology(topologyFactor), [{ id: 'base' }], (t) => {
        captured = new SimulationEngine(t).run()
        return captured
      })
      expect(contract.verdicts[0].status).toBe('completed')
      return captured as SimulationOutput
    }

    const baseArrived = runAndCapture(undefined).perNode['feed-cache'].totalArrived
    const ampArrived = runAndCapture(50).perNode['feed-cache'].totalArrived
    expect(baseArrived).toBeGreaterThan(0)
    expect(ampArrived).toBeGreaterThan(baseArrived * 40)
  })

  it('rejects a non-integer or non-positive fanoutFactor', () => {
    expect(validateTopology(buildTopology(0)).valid).toBe(false)
    expect(validateTopology(buildTopology(2.5)).valid).toBe(false)
  })
})
