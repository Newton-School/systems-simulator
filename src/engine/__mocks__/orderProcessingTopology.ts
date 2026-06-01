import { TopologyJSON } from '../core/types'

/**
 * Order Processing Platform — comprehensive sample topology.
 *
 * Architecture overview:
 *
 *   [api-gw] → [auth-svc] → [lb] ─ round-robin ─┬─ [order-svc-1] ─┐
 *                                               └─ [order-svc-2] ─┤
 *                                                                 ↓
 *                                                            [inventory-svc]
 *                                                                 ↓
 *                                                               [redis]
 *                                                 ┌── weight 0.9 ──↙ ↘── weight 0.1 ──┐
 *                                          [payment-svc-v1]              [payment-svc-v2]
 *                                           ↓ sync  ↓ async              ↓ sync  ↓ async
 *                                        [orders-db] [event-bus]      [orders-db] [event-bus]
 *                                                        ↓ async fan-out
 *                                           ┌────────────┼────────────┐
 *                                      [email-svc] [warehouse-svc] [analytics-svc]
 *
 * Features demonstrated:
 *   - Round-robin load balancing   (lb → order-svc-1 / order-svc-2)
 *   - Weighted canary routing      (redis → payment-svc-v1 90% / payment-svc-v2 10%)
 *   - Mixed sync + async from one node (payment-svc → orders-db sync + event-bus async)
 *   - Async fan-out                (event-bus → email / warehouse / analytics)
 *   - SLO targets on critical services
 *   - Resilience (retry + circuit breaker) on payment services
 *   - Bursty workload pattern simulating flash-sale traffic spikes
 *   - Mixed request distribution (POST / GET / DELETE)
 */
export const orderProcessingTopology: TopologyJSON = {
  id: 'order-processing-v1',
  name: 'Order Processing Platform',
  version: '1.0.0',

  global: {
    simulationDuration: 120_000, // 2 minutes — enough to observe 2 full burst cycles
    warmupDuration: 10_000, // 10 s warmup before metrics are collected
    seed: 'order-platform-2025',
    timeResolution: 'microsecond',
    defaultTimeout: 5_000,
    traceSampleRate: 0.05 // 5% trace sampling
  },

  nodes: [
    // ── Network / Entry ──────────────────────────────────────────────────────
    {
      id: 'api-gw',
      type: 'api-gateway',
      category: 'network-and-edge',
      label: 'API Gateway',
      position: { x: 400, y: 50 },
      queue: { workers: 200, capacity: 20_000, discipline: 'fifo' },
      processing: {
        distribution: { type: 'constant', value: 1 }, // 1 ms proxy overhead
        timeout: 30_000
      },
      slo: {
        latencyP99: 10,
        availabilityTarget: 0.999,
        errorBudget: 0.001
      }
    },

    {
      id: 'lb',
      type: 'load-balancer',
      category: 'network-and-edge',
      label: 'Order LB',
      position: { x: 400, y: 200 },
      queue: { workers: 500, capacity: 50_000, discipline: 'fifo' },
      processing: {
        distribution: { type: 'constant', value: 0.5 }, // sub-ms routing decision
        timeout: 30_000
      }
    },

    // ── Auth ─────────────────────────────────────────────────────────────────
    {
      id: 'auth-svc',
      type: 'auth-service',
      category: 'compute',
      label: 'Auth Service',
      position: { x: 400, y: 125 },
      resources: { cpu: 4, memory: 2048, replicas: 2 },
      queue: { workers: 40, capacity: 800, discipline: 'fifo' },
      processing: {
        // Token validation: fast with occasional cache-miss spikes
        distribution: {
          type: 'mixture',
          components: [
            { weight: 0.85, distribution: { type: 'log-normal', mu: 1.6, sigma: 0.2 } }, // ~5 ms cache hit
            { weight: 0.15, distribution: { type: 'log-normal', mu: 3.0, sigma: 0.3 } } // ~22 ms cache miss
          ]
        },
        timeout: 1_000
      },
      slo: {
        latencyP99: 50,
        availabilityTarget: 0.999,
        errorBudget: 0.001
      },
      resilience: {
        retry: {
          maxAttempts: 2,
          baseDelay: 20,
          maxDelay: 100,
          multiplier: 2,
          jitter: true
        }
      }
    },

    // ── Order services (replicas behind the load balancer) ───────────────────
    {
      id: 'order-svc-1',
      type: 'microservice',
      category: 'compute',
      label: 'Order Service (A)',
      position: { x: 250, y: 300 },
      resources: { cpu: 8, memory: 4096, replicas: 1 },
      queue: { workers: 20, capacity: 400, discipline: 'fifo' },
      processing: {
        distribution: { type: 'log-normal', mu: 2.5, sigma: 0.4 }, // ~14 ms mean
        timeout: 3_000
      },
      slo: {
        latencyP99: 100,
        availabilityTarget: 0.995,
        errorBudget: 0.005
      }
    },

    {
      id: 'order-svc-2',
      type: 'microservice',
      category: 'compute',
      label: 'Order Service (B)',
      position: { x: 550, y: 300 },
      resources: { cpu: 8, memory: 4096, replicas: 1 },
      queue: { workers: 20, capacity: 400, discipline: 'fifo' },
      processing: {
        distribution: { type: 'log-normal', mu: 2.5, sigma: 0.4 }, // ~14 ms mean
        timeout: 3_000
      },
      slo: {
        latencyP99: 100,
        availabilityTarget: 0.995,
        errorBudget: 0.005
      }
    },

    // ── Inventory ────────────────────────────────────────────────────────────
    {
      id: 'inventory-svc',
      type: 'microservice',
      category: 'compute',
      label: 'Inventory Service',
      position: { x: 400, y: 400 },
      resources: { cpu: 4, memory: 2048, replicas: 2 },
      queue: { workers: 30, capacity: 600, discipline: 'fifo' },
      processing: {
        // Stock check: mostly fast, occasional contention on popular items
        distribution: {
          type: 'mixture',
          components: [
            { weight: 0.9, distribution: { type: 'log-normal', mu: 2.0, sigma: 0.35 } }, // ~8 ms
            { weight: 0.1, distribution: { type: 'log-normal', mu: 3.5, sigma: 0.4 } } // ~36 ms (contention)
          ]
        },
        timeout: 2_000
      }
    },

    // ── Cache ─────────────────────────────────────────────────────────────────
    {
      id: 'redis',
      type: 'in-memory-cache',
      category: 'storage-and-data',
      label: 'Redis Cache',
      position: { x: 400, y: 480 },
      queue: { workers: 1000, capacity: 100_000, discipline: 'fifo' },
      processing: {
        distribution: { type: 'exponential', lambda: 2 }, // mean 0.5 ms
        timeout: 500
      }
    },

    // ── Payment services (canary: v2 receives 10% of traffic) ────────────────
    {
      id: 'payment-svc-v1',
      type: 'microservice',
      category: 'compute',
      label: 'Payment Service (stable)',
      position: { x: 250, y: 580 },
      resources: { cpu: 8, memory: 8192, replicas: 3 },
      queue: { workers: 24, capacity: 300, discipline: 'priority' },
      processing: {
        // External payment-provider call: heavier tail
        distribution: { type: 'log-normal', mu: 3.2, sigma: 0.5 }, // ~30 ms mean
        timeout: 4_000
      },
      slo: {
        latencyP99: 200,
        availabilityTarget: 0.999,
        errorBudget: 0.001
      },
      resilience: {
        circuitBreaker: {
          failureThreshold: 0.3,
          failureCount: 10,
          recoveryTimeout: 15_000,
          halfOpenRequests: 3
        },
        retry: {
          maxAttempts: 2,
          baseDelay: 50,
          maxDelay: 500,
          multiplier: 2,
          jitter: true
        }
      }
    },

    {
      id: 'payment-svc-v2',
      type: 'microservice',
      category: 'compute',
      label: 'Payment Service (canary)',
      position: { x: 550, y: 580 },
      resources: { cpu: 8, memory: 8192, replicas: 1 },
      queue: { workers: 8, capacity: 100, discipline: 'priority' },
      processing: {
        // v2 is faster due to optimised provider SDK
        distribution: { type: 'log-normal', mu: 2.9, sigma: 0.45 }, // ~20 ms mean
        timeout: 4_000
      },
      slo: {
        latencyP99: 150,
        availabilityTarget: 0.999,
        errorBudget: 0.001
      },
      resilience: {
        circuitBreaker: {
          failureThreshold: 0.3,
          failureCount: 10,
          recoveryTimeout: 15_000,
          halfOpenRequests: 3
        },
        retry: {
          maxAttempts: 2,
          baseDelay: 50,
          maxDelay: 500,
          multiplier: 2,
          jitter: true
        }
      }
    },

    // ── Persistence ───────────────────────────────────────────────────────────
    {
      id: 'orders-db',
      type: 'relational-db',
      category: 'storage-and-data',
      label: 'Orders DB (PostgreSQL)',
      position: { x: 400, y: 680 },
      resources: { cpu: 16, memory: 32768, replicas: 1 },
      queue: { workers: 50, capacity: 2_000, discipline: 'fifo' },
      processing: {
        // Transactional write: normally fast, occasional fsync spike
        distribution: {
          type: 'mixture',
          components: [
            { weight: 0.92, distribution: { type: 'log-normal', mu: 2.0, sigma: 0.3 } }, // ~8 ms
            { weight: 0.08, distribution: { type: 'log-normal', mu: 4.0, sigma: 0.4 } } // ~60 ms fsync
          ]
        },
        timeout: 5_000
      },
      slo: {
        latencyP99: 100,
        availabilityTarget: 0.9999,
        errorBudget: 0.0001
      }
    },

    // ── Messaging ─────────────────────────────────────────────────────────────
    {
      id: 'event-bus',
      type: 'event-bus',
      category: 'messaging-and-streaming',
      label: 'Order Event Bus',
      position: { x: 400, y: 760 },
      queue: { workers: 200, capacity: 50_000, discipline: 'fifo' },
      processing: {
        distribution: { type: 'constant', value: 2 }, // 2 ms broker commit
        timeout: 2_000
      }
    },

    // ── Async consumers ───────────────────────────────────────────────────────
    {
      id: 'email-svc',
      type: 'microservice',
      category: 'compute',
      label: 'Email Notification',
      position: { x: 150, y: 880 },
      queue: { workers: 10, capacity: 1_000, discipline: 'fifo' },
      processing: {
        // SMTP relay: high variance due to third-party
        distribution: { type: 'log-normal', mu: 3.5, sigma: 0.8 }, // ~50 ms mean, fat tail
        timeout: 10_000
      }
    },

    {
      id: 'warehouse-svc',
      type: 'microservice',
      category: 'compute',
      label: 'Warehouse Fulfillment',
      position: { x: 400, y: 880 },
      queue: { workers: 15, capacity: 500, discipline: 'fifo' },
      processing: {
        distribution: { type: 'log-normal', mu: 3.0, sigma: 0.5 }, // ~22 ms mean
        timeout: 8_000
      }
    },

    {
      id: 'analytics-svc',
      type: 'microservice',
      category: 'compute',
      label: 'Analytics Ingest',
      position: { x: 650, y: 880 },
      queue: { workers: 100, capacity: 10_000, discipline: 'fifo' },
      processing: {
        distribution: { type: 'log-normal', mu: 1.8, sigma: 0.3 }, // ~7 ms mean
        timeout: 3_000
      }
    }
  ],

  edges: [
    // ── Entry path ────────────────────────────────────────────────────────────
    {
      id: 'e-apigw-auth',
      source: 'api-gw',
      target: 'auth-svc',
      label: 'authenticate',
      mode: 'synchronous',
      protocol: 'https',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 10_000,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-auth-lb',
      source: 'auth-svc',
      target: 'lb',
      label: 'route',
      mode: 'synchronous',
      protocol: 'grpc',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 10_000,
      packetLossRate: 0,
      errorRate: 0
    },

    // ── Round-robin: lb → order service replicas ──────────────────────────────
    {
      id: 'e-lb-order1',
      source: 'lb',
      target: 'order-svc-1',
      label: 'replica-a',
      mode: 'synchronous',
      protocol: 'grpc',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 5_000,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-lb-order2',
      source: 'lb',
      target: 'order-svc-2',
      label: 'replica-b',
      mode: 'synchronous',
      protocol: 'grpc',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 5_000,
      packetLossRate: 0,
      errorRate: 0
    },

    // ── Order → Inventory ─────────────────────────────────────────────────────
    {
      id: 'e-order1-inventory',
      source: 'order-svc-1',
      target: 'inventory-svc',
      mode: 'synchronous',
      protocol: 'grpc',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 5_000,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-order2-inventory',
      source: 'order-svc-2',
      target: 'inventory-svc',
      mode: 'synchronous',
      protocol: 'grpc',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 5_000,
      packetLossRate: 0,
      errorRate: 0
    },

    // ── Inventory → Cache ─────────────────────────────────────────────────────
    {
      id: 'e-inventory-redis',
      source: 'inventory-svc',
      target: 'redis',
      mode: 'synchronous',
      protocol: 'tcp',
      latency: { distribution: { type: 'constant', value: 0.5 }, pathType: 'same-rack' },
      bandwidth: 10_000,
      maxConcurrentRequests: 50_000,
      packetLossRate: 0,
      errorRate: 0
    },

    // ── Weighted canary: cache → payment services ─────────────────────────────
    {
      id: 'e-redis-payment-v1',
      source: 'redis',
      target: 'payment-svc-v1',
      label: 'stable (90%)',
      mode: 'synchronous',
      protocol: 'grpc',
      weight: 9,
      latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 2_000,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-redis-payment-v2',
      source: 'redis',
      target: 'payment-svc-v2',
      label: 'canary (10%)',
      mode: 'synchronous',
      protocol: 'grpc',
      weight: 1,
      latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 500,
      packetLossRate: 0,
      errorRate: 0
    },

    // ── Payment → DB (sync write — terminates the synchronous request path) ────
    {
      id: 'e-payment-v1-db',
      source: 'payment-svc-v1',
      target: 'orders-db',
      label: 'persist',
      mode: 'synchronous',
      protocol: 'tcp',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 1_000,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-payment-v2-db',
      source: 'payment-svc-v2',
      target: 'orders-db',
      label: 'persist',
      mode: 'synchronous',
      protocol: 'tcp',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 1_000,
      packetLossRate: 0,
      errorRate: 0
    },

    // ── Payment → Event bus (async — does not block the sync request path) ─────
    {
      id: 'e-payment-v1-events',
      source: 'payment-svc-v1',
      target: 'event-bus',
      label: 'order.created',
      mode: 'asynchronous',
      protocol: 'kafka',
      latency: { distribution: { type: 'constant', value: 3 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 10_000,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-payment-v2-events',
      source: 'payment-svc-v2',
      target: 'event-bus',
      label: 'order.created',
      mode: 'asynchronous',
      protocol: 'kafka',
      latency: { distribution: { type: 'constant', value: 3 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 10_000,
      packetLossRate: 0,
      errorRate: 0
    },

    // ── Event bus → consumers (async fan-out to all three simultaneously) ──────
    {
      id: 'e-events-email',
      source: 'event-bus',
      target: 'email-svc',
      label: 'notify.customer',
      mode: 'asynchronous',
      protocol: 'amqp',
      latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
      bandwidth: 1_000,
      maxConcurrentRequests: 500,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-events-warehouse',
      source: 'event-bus',
      target: 'warehouse-svc',
      label: 'fulfillment.start',
      mode: 'asynchronous',
      protocol: 'amqp',
      latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
      bandwidth: 1_000,
      maxConcurrentRequests: 500,
      packetLossRate: 0,
      errorRate: 0
    },
    {
      id: 'e-events-analytics',
      source: 'event-bus',
      target: 'analytics-svc',
      label: 'event.ingest',
      mode: 'asynchronous',
      protocol: 'kafka',
      latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
      bandwidth: 10_000,
      maxConcurrentRequests: 5_000,
      packetLossRate: 0,
      errorRate: 0
    }
  ],

  workload: {
    sourceNodeId: 'api-gw',
    // Bursty pattern: simulates flash-sale traffic with 4x spikes every 55 s
    pattern: 'bursty',
    baseRps: 100,
    bursty: {
      burstRps: 400,
      burstDuration: 15_000, // 15 s burst
      normalDuration: 40_000 // 40 s normal between bursts
    },
    requestDistribution: [
      { type: 'POST', weight: 0.6, sizeBytes: 2048 }, // create order
      { type: 'GET', weight: 0.3, sizeBytes: 256 }, // check order status
      { type: 'DELETE', weight: 0.1, sizeBytes: 128 } // cancel order
    ]
  }
}
