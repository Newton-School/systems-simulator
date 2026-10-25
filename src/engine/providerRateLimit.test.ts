/** A provider rate limit (decision H1): past `rateLimitRps` the call fails as a retryable 429; retries add load. */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function run(rateLimitRps: number | undefined, retry: boolean) {
  const node = (id: string, type: string, extra: Partial<ComponentNode> = {}) =>
    ({
      id,
      type,
      category: type === 'third-party-api-connector' ? 'external-and-integration' : 'compute',
      label: id,
      position: { x: 0, y: 0 },
      queue: { workers: 100, capacity: 1000, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 2 }, timeout: 2_000 },
      ...extra
    }) as ComponentNode
  const edge = (id: string, source: string, target: string) =>
    ({
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
    }) as never
  const topology = {
    id: 't',
    name: 'provider-limit',
    version: '1.0.0',
    global: {
      simulationDuration: 10_000,
      seed: 'provider-limit',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 2_000,
      traceSampleRate: 0
    },
    nodes: [
      node(
        'svc',
        'microservice',
        retry
          ? {
              resilience: {
                retry: { maxAttempts: 3, baseDelay: 5, maxDelay: 5, multiplier: 1, jitter: false }
              }
            }
          : {}
      ),
      node('api', 'third-party-api-connector', {
        config: { externalLatencyMs: 5, ...(rateLimitRps ? { rateLimitRps } : {}) }
      })
    ],
    edges: [edge('e0', 'client', 'svc'), edge('e', 'svc', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 200,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  return new SimulationEngine(topology).run()
}

describe('provider rate limit', () => {
  it('refuses the share of calls past the limit as provider_rate_limited', () => {
    const out = run(100, false)
    expect(out.summary.errorRate).toBeGreaterThan(0.45)
    expect(out.summary.errorRate).toBeLessThan(0.55)
    expect(out.perNode.api.traitCounters.providerRateLimited).toBeGreaterThan(0)
  })

  it('refuses nothing without a limit, or under it', () => {
    expect(run(undefined, false).summary.errorRate).toBe(0)
    expect(run(400, false).summary.errorRate).toBe(0)
  })

  it('treats the 429 as retryable: retries add calls to the provider', () => {
    const plain = run(100, false).perNode.api.totalArrived
    const retried = run(100, true).perNode.api.totalArrived
    expect(retried).toBeGreaterThan(plain * 1.3)
  })
})
