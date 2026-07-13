import type { TopologyJSON } from '../engine/core/types'

export interface CuratedScenario {
  id: string
  title: string
  description: string
  concepts: string[]
  difficulty: 'intro' | 'intermediate' | 'advanced'
  whatToLookAt: string
  topology: TopologyJSON
}

function baseGlobal(seed: string, simulationDuration = 20_000, warmupDuration = 2_000) {
  return {
    simulationDuration,
    warmupDuration,
    seed,
    defaultTimeout: 5_000,
    timeResolution: 'millisecond' as const,
    traceSampleRate: 0.01
  }
}

export const CURATED_SCENARIOS: readonly CuratedScenario[] = [
  {
    id: 'serverless-cold-start',
    title: 'Serverless Cold Start',
    description:
      'A bursty source wakes an idle serverless function, showing the first cold-start spike and later warm requests.',
    concepts: ['cold start', 'serverless', 'throttling'],
    difficulty: 'intro',
    whatToLookAt:
      'Run it once, then switch to Latency. The first burst after idle should spike. Increase base RPS until max concurrency is hit and watch rejections appear.',
    topology: {
      id: 'serverless-cold-start',
      name: 'Serverless Cold Start',
      version: '2.0.0',
      global: baseGlobal('cold-start-seed'),
      nodes: [
        {
          id: 'client',
          type: 'api-endpoint',
          category: 'compute',
          role: 'source',
          label: 'Client App',
          position: { x: 0, y: 0 }
        },
        {
          id: 'lambda',
          type: 'serverless-function',
          category: 'compute',
          role: 'processor',
          label: 'Checkout Function',
          position: { x: 260, y: 0 },
          queue: { workers: 4, capacity: 20, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 20 },
            timeout: 2_000
          },
          config: {
            coldStartLatency: { type: 'exponential', lambda: 1 / 220 },
            idleTimeoutMs: 4_000,
            maxConcurrency: 2
          }
        }
      ],
      edges: [
        {
          id: 'client-lambda',
          source: 'client',
          target: 'lambda',
          mode: 'synchronous',
          protocol: 'https',
          latency: {
            distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
            pathType: 'same-dc'
          },
          bandwidth: 100,
          maxConcurrentRequests: 100,
          packetLossRate: 0,
          errorRate: 0
        }
      ],
      workload: {
        sourceNodeId: 'client',
        pattern: 'bursty',
        baseRps: 2,
        bursty: { burstRps: 18, burstDuration: 2_000, normalDuration: 5_000 },
        requestDistribution: [{ type: 'invoke', weight: 1, sizeBytes: 1_024 }]
      }
    }
  },
  {
    id: 'key-based-sharding',
    title: 'Key-Based Sharding',
    description:
      'Requests with the same shard key always land on the same shard while different keys spread across the ring.',
    concepts: ['sharding', 'hash routing', 'determinism'],
    difficulty: 'intermediate',
    whatToLookAt:
      'Run it, then inspect the shard nodes. The same shardKey keeps arriving at the same shard across reruns with the same seed.',
    topology: {
      id: 'key-based-sharding',
      name: 'Key-Based Sharding',
      version: '2.0.0',
      global: baseGlobal('sharding-seed'),
      nodes: [
        {
          id: 'client',
          type: 'api-endpoint',
          category: 'compute',
          role: 'source',
          label: 'Shard-Aware Client',
          position: { x: 0, y: 0 }
        },
        {
          id: 'router',
          type: 'sharding',
          category: 'auxiliary',
          role: 'router',
          label: 'Shard Router',
          position: { x: 240, y: 0 },
          queue: { workers: 8, capacity: 16, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 0.5 },
            timeout: 100
          },
          config: {
            routingKeyField: 'shardKey'
          }
        },
        {
          id: 'shard-a',
          type: 'shard-node',
          category: 'auxiliary',
          role: 'storage',
          label: 'Shard A',
          position: { x: 520, y: -120 },
          queue: { workers: 8, capacity: 64, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 4 },
            timeout: 500
          }
        },
        {
          id: 'shard-b',
          type: 'shard-node',
          category: 'auxiliary',
          role: 'storage',
          label: 'Shard B',
          position: { x: 520, y: 0 },
          queue: { workers: 8, capacity: 64, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 4 },
            timeout: 500
          }
        },
        {
          id: 'shard-c',
          type: 'shard-node',
          category: 'auxiliary',
          role: 'storage',
          label: 'Shard C',
          position: { x: 520, y: 120 },
          queue: { workers: 8, capacity: 64, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 4 },
            timeout: 500
          }
        }
      ],
      edges: [
        {
          id: 'client-router',
          source: 'client',
          target: 'router',
          mode: 'synchronous',
          protocol: 'https',
          latency: {
            distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
            pathType: 'same-dc'
          },
          bandwidth: 100,
          maxConcurrentRequests: 100,
          packetLossRate: 0,
          errorRate: 0
        },
        {
          id: 'router-a',
          source: 'router',
          target: 'shard-a',
          mode: 'synchronous',
          protocol: 'tcp',
          latency: {
            distribution: { type: 'log-normal', mu: -1.2, sigma: 0.3 },
            pathType: 'same-rack'
          },
          bandwidth: 10_000,
          maxConcurrentRequests: 50,
          packetLossRate: 0,
          errorRate: 0
        },
        {
          id: 'router-b',
          source: 'router',
          target: 'shard-b',
          mode: 'synchronous',
          protocol: 'tcp',
          latency: {
            distribution: { type: 'log-normal', mu: -1.2, sigma: 0.3 },
            pathType: 'same-rack'
          },
          bandwidth: 10_000,
          maxConcurrentRequests: 50,
          packetLossRate: 0,
          errorRate: 0
        },
        {
          id: 'router-c',
          source: 'router',
          target: 'shard-c',
          mode: 'synchronous',
          protocol: 'tcp',
          latency: {
            distribution: { type: 'log-normal', mu: -1.2, sigma: 0.3 },
            pathType: 'same-rack'
          },
          bandwidth: 10_000,
          maxConcurrentRequests: 50,
          packetLossRate: 0,
          errorRate: 0
        }
      ],
      workload: {
        sourceNodeId: 'client',
        pattern: 'constant',
        baseRps: 60,
        requestDistribution: [
          { type: 'lookup', weight: 0.25, sizeBytes: 768, metadata: { shardKey: 'tenant-a' } },
          { type: 'lookup', weight: 0.25, sizeBytes: 768, metadata: { shardKey: 'tenant-b' } },
          { type: 'lookup', weight: 0.25, sizeBytes: 768, metadata: { shardKey: 'tenant-c' } },
          { type: 'lookup', weight: 0.25, sizeBytes: 768, metadata: { shardKey: 'tenant-d' } }
        ]
      }
    }
  },
  {
    id: 'stream-consumer-lag',
    title: 'Stream Consumer Lag',
    description:
      'A producer publishes faster than the stream can drain, causing visible lag growth inside the broker.',
    concepts: ['kafka', 'consumer lag', 'backlog'],
    difficulty: 'intermediate',
    whatToLookAt:
      'Switch to Throughput, select the stream, and inspect its lag summary. Final lag should stay above zero while producer RPS exceeds consumer capacity.',
    topology: {
      id: 'stream-consumer-lag',
      name: 'Stream Consumer Lag',
      version: '2.0.0',
      global: baseGlobal('consumer-lag-seed'),
      nodes: [
        {
          id: 'producer',
          type: 'api-endpoint',
          category: 'compute',
          role: 'source',
          label: 'Producer',
          position: { x: 0, y: 0 }
        },
        {
          id: 'stream',
          type: 'stream',
          category: 'messaging-and-streaming',
          role: 'storage',
          label: 'Kafka Topic',
          position: { x: 260, y: 0 },
          queue: { workers: 1, capacity: 1_000, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 20 },
            timeout: 2_000
          }
        }
      ],
      edges: [
        {
          id: 'producer-stream',
          source: 'producer',
          target: 'stream',
          mode: 'asynchronous',
          protocol: 'kafka',
          latency: {
            distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
            pathType: 'same-dc'
          },
          bandwidth: 1_000,
          maxConcurrentRequests: 500,
          packetLossRate: 0,
          errorRate: 0
        }
      ],
      workload: {
        sourceNodeId: 'producer',
        pattern: 'constant',
        baseRps: 100,
        requestDistribution: [{ type: 'publish', weight: 1, sizeBytes: 2_048 }]
      }
    }
  },
  {
    id: 'dns-weighted-routing',
    title: 'DNS Weighted Routing',
    description:
      'A resolver returns weighted answers and caches lookups, making 80/20 splits and TTL effects visible.',
    concepts: ['dns', 'weighted routing', 'ttl cache'],
    difficulty: 'intermediate',
    whatToLookAt:
      'Run it, then inspect the two API targets. The weighted policy should send roughly 80% of traffic to stable and 20% to canary while repeated lookups hit the DNS cache.',
    topology: {
      id: 'dns-weighted-routing',
      name: 'DNS Weighted Routing',
      version: '2.0.0',
      global: baseGlobal('dns-weighted-seed'),
      nodes: [
        {
          id: 'client',
          type: 'api-endpoint',
          category: 'compute',
          role: 'source',
          label: 'Client',
          position: { x: 0, y: 0 }
        },
        {
          id: 'dns',
          type: 'internal-dns',
          category: 'dns-and-certs',
          role: 'router',
          label: 'Resolver',
          position: { x: 220, y: 0 },
          queue: { workers: 8, capacity: 16, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 0.6 },
            timeout: 100
          },
          config: {
            dnsRoutingPolicy: 'weighted',
            dnsCacheTtlSeconds: 30
          }
        },
        {
          id: 'stable',
          type: 'microservice',
          category: 'compute',
          role: 'processor',
          label: 'Stable API',
          position: { x: 500, y: -100 },
          queue: { workers: 8, capacity: 64, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 8 },
            timeout: 800
          }
        },
        {
          id: 'canary',
          type: 'microservice',
          category: 'compute',
          role: 'processor',
          label: 'Canary API',
          position: { x: 500, y: 100 },
          queue: { workers: 8, capacity: 64, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 8 },
            timeout: 800
          }
        }
      ],
      edges: [
        {
          id: 'client-dns',
          source: 'client',
          target: 'dns',
          mode: 'synchronous',
          protocol: 'udp',
          latency: {
            distribution: { type: 'log-normal', mu: 0, sigma: 0.3 },
            pathType: 'same-dc'
          },
          bandwidth: 100,
          maxConcurrentRequests: 100,
          packetLossRate: 0,
          errorRate: 0
        },
        {
          id: 'dns-stable',
          source: 'dns',
          target: 'stable',
          mode: 'synchronous',
          protocol: 'https',
          latency: {
            distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
            pathType: 'same-dc'
          },
          bandwidth: 100,
          maxConcurrentRequests: 100,
          packetLossRate: 0,
          errorRate: 0,
          weight: 80
        },
        {
          id: 'dns-canary',
          source: 'dns',
          target: 'canary',
          mode: 'synchronous',
          protocol: 'https',
          latency: {
            distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
            pathType: 'same-dc'
          },
          bandwidth: 100,
          maxConcurrentRequests: 100,
          packetLossRate: 0,
          errorRate: 0,
          weight: 20
        }
      ],
      workload: {
        sourceNodeId: 'client',
        pattern: 'constant',
        baseRps: 40,
        requestDistribution: [
          {
            type: 'resolve',
            weight: 1,
            sizeBytes: 256,
            metadata: { host: 'catalog.internal', origin: 'us' }
          }
        ]
      }
    }
  },
  {
    id: 'circuit-breaker-fail-fast',
    title: 'Circuit Breaker Fail-Fast',
    description:
      'A sidecar trips open after repeated downstream failures, then rejects quickly until probe traffic is allowed again.',
    concepts: ['circuit breaker', 'fail fast', 'recovery timeout'],
    difficulty: 'advanced',
    whatToLookAt:
      'Switch to Errors and inspect the sidecar. Rejections should move from downstream node errors to fail-fast breaker rejections after the breaker opens.',
    topology: {
      id: 'circuit-breaker-fail-fast',
      name: 'Circuit Breaker Fail Fast',
      version: '2.0.0',
      global: baseGlobal('breaker-seed', 15_000, 1_000),
      nodes: [
        {
          id: 'client',
          type: 'api-endpoint',
          category: 'compute',
          role: 'source',
          label: 'Client',
          position: { x: 0, y: 0 }
        },
        {
          id: 'sidecar',
          type: 'sidecar',
          category: 'compute',
          role: 'processor',
          label: 'Service Mesh Sidecar',
          position: { x: 220, y: 0 },
          queue: { workers: 8, capacity: 32, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 1 },
            timeout: 500
          },
          resilience: {
            circuitBreaker: {
              failureThreshold: 0.5,
              failureCount: 4,
              recoveryTimeout: 2_000,
              halfOpenRequests: 1
            }
          },
          config: {
            circuitBreaker: {
              failureThreshold: 0.5,
              failureCount: 4,
              recoveryTimeout: 2_000,
              halfOpenRequests: 1
            }
          }
        },
        {
          id: 'payment',
          type: 'microservice',
          category: 'compute',
          role: 'processor',
          label: 'Failing Payment Service',
          position: { x: 500, y: 0 },
          queue: { workers: 4, capacity: 16, discipline: 'fifo' },
          processing: {
            distribution: { type: 'exponential', lambda: 1 / 8 },
            timeout: 800
          },
          config: {
            nodeErrorRate: 1
          }
        }
      ],
      edges: [
        {
          id: 'client-sidecar',
          source: 'client',
          target: 'sidecar',
          mode: 'synchronous',
          protocol: 'https',
          latency: {
            distribution: { type: 'log-normal', mu: 0, sigma: 0.35 },
            pathType: 'same-dc'
          },
          bandwidth: 100,
          maxConcurrentRequests: 100,
          packetLossRate: 0,
          errorRate: 0
        },
        {
          id: 'sidecar-payment',
          source: 'sidecar',
          target: 'payment',
          mode: 'synchronous',
          protocol: 'grpc',
          latency: {
            distribution: { type: 'log-normal', mu: -0.3, sigma: 0.25 },
            pathType: 'same-rack'
          },
          bandwidth: 1_000,
          maxConcurrentRequests: 50,
          packetLossRate: 0,
          errorRate: 0
        }
      ],
      workload: {
        sourceNodeId: 'client',
        pattern: 'constant',
        baseRps: 20,
        requestDistribution: [{ type: 'charge', weight: 1, sizeBytes: 1_024 }]
      }
    }
  }
]
