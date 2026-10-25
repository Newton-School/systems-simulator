/**
 * A cache that crash-restarts loses its memory (chapter 22 section 1, finding 33): it comes back
 * empty and re-warms, like a `cache-flush` fault. A degraded node, or a node that resumes held
 * requests, keeps its process and so its contents.
 */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, FaultSpec, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function node(id: string, type: ComponentNode['type'], config?: Record<string, unknown>) {
  return {
    id,
    type,
    category: type === 'in-memory-cache' ? 'storage-and-data' : 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 8, capacity: 200, discipline: 'fifo' },
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

function hitsBetween(params: Record<string, unknown>, fromMs: number, toMs: number): number {
  const fault: FaultSpec = {
    targetId: 'cache',
    faultType: 'chaos',
    timing: 'deterministic',
    duration: 'fixed',
    params: { atMs: 1_000, durationMs: 200, ...params }
  }
  const topology = {
    id: 't',
    name: 'cache-restart',
    version: '1.0.0',
    global: {
      simulationDuration: 9_000,
      seed: 'cache-restart',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000,
      traceSampleRate: 0
    },
    nodes: [
      node('source', 'microservice'),
      node('cache', 'in-memory-cache', { cacheHitRate: 1, cacheHitLatencyMs: 0.1 }),
      node('db', 'microservice')
    ],
    edges: [edge('s-c', 'source', 'cache'), edge('c-d', 'cache', 'db')],
    faults: [fault],
    workload: {
      sourceNodeId: 'source',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  const output = new SimulationEngine(topology).run()
  return output.requestOutcomes.filter(
    (o) => o.createdAtMs >= fromMs && o.createdAtMs < toMs && o.cacheOutcome === 'hit'
  ).length
}

describe('a restarted cache comes back cold', () => {
  const reset = { mode: 'reject', inFlightPolicy: 'reset', recoveryPolicy: 'reset' }

  it('serves no hits while it re-warms after a crash-restart, then serves hits again', () => {
    expect(hitsBetween(reset, 0, 1_000)).toBeGreaterThan(80) // warm before the fault
    expect(hitsBetween(reset, 1_300, 6_000)).toBe(0) // empty after the restart
    expect(hitsBetween(reset, 6_500, 9_000)).toBeGreaterThan(200) // warm again
  })

  it('keeps its contents when the node was only degraded', () => {
    const degraded = { mode: 'degraded', degradation: { fraction: 1, serviceTimeMultiplier: 2 } }
    expect(hitsBetween(degraded, 1_300, 6_000)).toBeGreaterThan(400)
  })

  it('keeps its contents when held requests resume at recovery', () => {
    const resume = { mode: 'hang', inFlightPolicy: 'hang', recoveryPolicy: 'resume' }
    expect(hitsBetween(resume, 1_300, 6_000)).toBeGreaterThan(400)
  })
})
