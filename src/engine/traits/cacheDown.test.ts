/**
 * A down or faulted cache must not serve. Before this was fixed, a cache with `nodeErrorRate = 1`
 * (or a scheduled reject / blackhole / hang fault) still answered its hits, because hits are
 * decided on arrival and skipped the failure checks that run when service completes.
 * See docs/cache-fallback-proposal.md, section 2.
 */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, FaultSpec, TopologyJSON } from '../core/types'
import { SimulationEngine } from '../engine'

function node(
  id: string,
  type: ComponentNode['type'],
  config?: Record<string, unknown>
): ComponentNode {
  return {
    id,
    type,
    category: type === 'in-memory-cache' ? 'storage-and-data' : 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
    config
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

function fault(mode: string, durationMs = 0): FaultSpec {
  return {
    targetId: 'cache',
    faultType: 'chaos',
    timing: 'deterministic',
    duration: durationMs > 0 ? 'fixed' : 'permanent',
    params: { atMs: 0, durationMs, mode, inFlightPolicy: 'hang', recoveryPolicy: 'reset' }
  }
}

function run(cacheConfig: Record<string, unknown>, faults?: FaultSpec[]) {
  const topology = {
    id: 't',
    name: 'cache-down',
    version: '1.0.0',
    global: {
      simulationDuration: 2_000,
      seed: 'cache-down',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000,
      traceSampleRate: 0
    },
    nodes: [
      node('source', 'microservice'),
      node('cache', 'in-memory-cache', cacheConfig),
      node('db', 'microservice')
    ],
    edges: [edge('s-c', 'source', 'cache'), edge('c-d', 'cache', 'db')],
    faults,
    workload: {
      sourceNodeId: 'source',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  const output = new SimulationEngine(topology).run()
  return { output, cache: output.perNode.cache, summary: output.summary }
}

const WARM = { cacheHitRate: 0.9, cacheHitLatencyMs: 0.1 }

describe('a down or faulted cache does not serve hits', () => {
  it('baseline: a healthy cache serves about its hit rate and reaches the database for the rest', () => {
    const { cache, summary, output } = run(WARM)
    expect(summary.successfulRequests).toBe(summary.totalRequests)
    expect(cache.cacheHits).toBeGreaterThan(150)
    expect(output.perNode.db.totalArrived).toBeGreaterThan(0)
  })

  it('nodeErrorRate = 1: nothing is served, no hit is counted, and nothing reaches the database', () => {
    const { cache, summary, output } = run({ ...WARM, nodeErrorRate: 1 })
    expect(summary.successfulRequests).toBe(0)
    expect(summary.failedRequests).toBe(summary.totalRequests)
    expect(cache.cacheHits ?? 0).toBe(0)
    expect(output.perNode.db.totalArrived).toBe(0)
    expect(output.conservationCheck.find((c) => c.nodeId === 'cache')?.balanced).toBe(true)
  })

  it('nodeErrorRate = 0.5: roughly half of the requests fail, hits included', () => {
    const { summary } = run({ ...WARM, nodeErrorRate: 0.5 })
    const failedShare = summary.failedRequests / summary.totalRequests
    expect(failedShare).toBeGreaterThan(0.35)
    expect(failedShare).toBeLessThan(0.65)
  })

  for (const mode of ['blackhole', 'hang']) {
    it(`scheduled ${mode} fault: no hit is served while the cache is failed`, () => {
      const { cache, summary } = run(WARM, [fault(mode)])
      expect(cache.cacheHits ?? 0).toBe(0)
      expect(summary.successfulRequests).toBe(0)
    })
  }

  // A cache that fails fast is bypassed (decision D5): the caller reaches the store behind it.
  it('scheduled reject fault: no hit is served, and the database takes every request', () => {
    const { cache, summary, output } = run(WARM, [fault('reject')])
    expect(cache.cacheHits ?? 0).toBe(0)
    expect(summary.successfulRequests).toBe(summary.totalRequests)
    expect(output.perNode.db.totalArrived).toBe(summary.totalRequests)
    expect(cache.traitCounters.cacheBypassed).toBeGreaterThan(0)
  })

  it("onCacheFailure: 'fail' keeps the refusal", () => {
    const { cache, summary } = run({ ...WARM, onCacheFailure: 'fail' }, [fault('reject')])
    expect(cache.cacheHits ?? 0).toBe(0)
    expect(summary.successfulRequests).toBe(0)
  })

  it('a degraded fault slows the node but does not make it refuse hits', () => {
    const degraded: FaultSpec = {
      ...fault('degraded'),
      params: {
        ...fault('degraded').params,
        degradation: { fraction: 1, serviceTimeMultiplier: 5 }
      }
    }
    const { cache, summary } = run(WARM, [degraded])
    expect(cache.cacheHits).toBeGreaterThan(150)
    expect(summary.successfulRequests).toBe(summary.totalRequests)
  })

  it('a node with no failure set behaves exactly as before (no extra random draws)', () => {
    const a = run(WARM).summary
    const b = run({ ...WARM, nodeErrorRate: 0 }).summary
    expect(b).toEqual(a)
  })
})
