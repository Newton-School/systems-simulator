/**
 * Retries nest (chapter 22 section 2, finding 34): a caller whose own attempts are spent passes the
 * failure to the caller above it, which retries the whole downstream call. Attempts multiply across
 * layers: k layers of n attempts send n^k calls to a dependency that always fails.
 */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, FaultSpec, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

const RETRY = { maxAttempts: 3, baseDelay: 1, maxDelay: 1, multiplier: 1, jitter: false }

function node(id: string, retrying: boolean): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 8, capacity: 200, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 5_000 },
    ...(retrying ? { resilience: { retry: RETRY } } : {})
  } as ComponentNode
}

function edge(id: string, source: string, target: string) {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 1000,
    packetLossRate: 0,
    errorRate: 0
  } as never
}

/** source -> a -> b -> c -> dep, with the named callers retrying and `dep` always rejecting. */
function callsPerRequest(retrying: string[]): number {
  const down: FaultSpec = {
    targetId: 'dep',
    faultType: 'chaos',
    timing: 'deterministic',
    duration: 'permanent',
    params: { atMs: 0, mode: 'reject' }
  }
  const topology = {
    id: 't',
    name: 'nested-retries',
    version: '1.0.0',
    global: {
      simulationDuration: 10_000,
      seed: 'nested-retries',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 5_000,
      traceSampleRate: 0
    },
    nodes: ['source', 'a', 'b', 'c', 'dep'].map((id) => node(id, retrying.includes(id))),
    edges: [
      edge('e1', 'source', 'a'),
      edge('e2', 'a', 'b'),
      edge('e3', 'b', 'c'),
      edge('e4', 'c', 'dep')
    ],
    faults: [down],
    workload: {
      sourceNodeId: 'source',
      pattern: 'constant',
      baseRps: 2,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  const out = new SimulationEngine(topology).run()
  return out.perNode.dep.totalArrived / out.summary.totalRequests
}

describe('nested retries compound', () => {
  it('sends one call when no layer retries', () => {
    expect(callsPerRequest([])).toBe(1)
  })

  it('sends n calls for one retrying layer, n^2 for two and n^3 for three', () => {
    expect(callsPerRequest(['c'])).toBeCloseTo(3, 1)
    expect(callsPerRequest(['b', 'c'])).toBeCloseTo(9, 1)
    expect(callsPerRequest(['a', 'b', 'c'])).toBeCloseTo(27, 1)
  })

  it('lets a layer with no retry policy pass the failure up to the layer that has one', () => {
    expect(callsPerRequest(['a'])).toBeCloseTo(3, 1)
    expect(callsPerRequest(['a', 'c'])).toBeCloseTo(9, 1)
  })
})

describe('retries on a callee timeout', () => {
  function errorRate(retrying: boolean): number {
    const timeoutNode = (id: string, ms: number, resilience?: unknown) =>
      ({
        id,
        type: 'microservice',
        category: 'compute',
        label: id,
        position: { x: 0, y: 0 },
        queue: { workers: 50, capacity: 500, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 2 }, timeout: ms },
        ...(resilience ? { resilience } : {})
      }) as ComponentNode
    const topology = {
      id: 't',
      name: 'timeout-retry',
      version: '1.0.0',
      global: {
        simulationDuration: 10_000,
        seed: 'timeout-retry',
        warmupDuration: 0,
        timeResolution: 'microsecond',
        defaultTimeout: 5_000,
        traceSampleRate: 0
      },
      nodes: [
        timeoutNode('source', 5_000),
        timeoutNode(
          'caller',
          5_000,
          retrying
            ? {
                retry: {
                  maxAttempts: 5,
                  baseDelay: 300,
                  maxDelay: 300,
                  multiplier: 1,
                  jitter: false
                }
              }
            : undefined
        ),
        timeoutNode('dep', 100)
      ],
      edges: [edge('e1', 'source', 'caller'), edge('e2', 'caller', 'dep')],
      faults: [
        {
          targetId: 'dep',
          faultType: 'chaos',
          timing: 'deterministic',
          duration: 'fixed',
          params: { atMs: 2_000, durationMs: 1_000, mode: 'blackhole' }
        }
      ],
      workload: {
        sourceNodeId: 'source',
        pattern: 'constant',
        baseRps: 50,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
      }
    } as unknown as TopologyJSON
    return new SimulationEngine(topology).run().summary.errorRate
  }

  it("treats a node's own timeout, which leaves budget in the request, as retryable", () => {
    expect(errorRate(false)).toBeGreaterThan(0.08)
    expect(errorRate(true)).toBeLessThan(0.01)
  })
})
