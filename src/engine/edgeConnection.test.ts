import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON, WorkloadProfile } from './core/types'
import { SimulationEngine } from './engine'
import { EDGE_LATENCY_COMPONENTS } from './network/linkTransmission'

// Issue #181 tasks 5-8: TLS handshakes and connection reuse, HTTP/2
// multiplexing, Kafka producer batching, persistent WebSocket connections.
//
// gateway -> api is the edge under test. The client -> gateway edge is free, so
// the measured edge is the only network cost, and gateway -> api is
// service-to-service, so it has one connection pool.

const DURATION_MS = 10_000
const WARMUP_MS = 1_000

function service(id: string, serviceMs: number): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 10_000, capacity: 100_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 60_000 }
  }
}

function edge(id: string, source: string, target: string, overrides: Partial<EdgeDefinition>) {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
    bandwidth: 1_000_000,
    maxConcurrentRequests: 1_000_000,
    packetLossRate: 0,
    errorRate: 0,
    ...overrides
  } satisfies EdgeDefinition
}

function topology(opts: {
  edge: Partial<EdgeDefinition>
  rps: number
  apiServiceMs?: number
  sourceEdge?: Partial<EdgeDefinition>
  workload?: Partial<WorkloadProfile>
  timeoutMs?: number
}): TopologyJSON {
  const client: ComponentNode = {
    id: 'client',
    type: 'api-endpoint',
    category: 'compute',
    role: 'source',
    label: 'client',
    position: { x: 0, y: 0 }
  }
  return {
    id: 'edge-connection',
    name: 'edge connection',
    version: '1.0.0',
    global: {
      simulationDuration: DURATION_MS,
      seed: 'edge-connection-seed',
      warmupDuration: WARMUP_MS,
      timeResolution: 'microsecond',
      defaultTimeout: opts.timeoutMs ?? 60_000,
      traceSampleRate: 0
    },
    nodes: [client, service('gateway', 0.1), service('api', opts.apiServiceMs ?? 1)],
    edges: [
      edge('client-to-gateway', 'client', 'gateway', opts.sourceEdge ?? {}),
      edge('gateway-to-api', 'gateway', 'api', opts.edge)
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: opts.rps,
      requestDistribution: [{ type: 'call', weight: 1, sizeBytes: 200 }],
      ...opts.workload
    }
  }
}

function run(t: TopologyJSON) {
  return new SimulationEngine(t).run()
}

function meanTransit(metric: ReturnType<typeof underTest>): number {
  return metric.latencyBreakdown?.meanTotalMs ?? Number.NaN
}

function underTest(output: ReturnType<typeof run>, edgeId = 'gateway-to-api') {
  const metric = output.perEdge[edgeId]
  expect(metric).toBeDefined()
  return metric
}

describe('edge connection model: default is unchanged', () => {
  it('without edge.connection there is no handshake or connection wait', () => {
    const out = run(
      topology({
        edge: { latency: { distribution: { type: 'constant', value: 20 }, pathType: 'same-dc' } },
        rps: 50
      })
    )
    const metric = underTest(out)
    // 20 ms propagation + 0.5 ms HTTPS per-request overhead, nothing else.
    expect(meanTransit(metric)).toBeCloseTo(20.5, 2)
    expect(metric.latencyBreakdown?.meanMs.handshakeMs).toBe(0)
    expect(metric.latencyBreakdown?.meanMs.connectionWaitMs).toBe(0)
    expect(metric.connections).toBeUndefined()
  })
})

describe('TLS handshake overhead and connection reuse (#181 task 5)', () => {
  const rttEdge = (connection: EdgeDefinition['connection']): Partial<EdgeDefinition> => ({
    latency: { distribution: { type: 'constant', value: 20 }, pathType: 'same-dc' },
    connection
  })

  it('a new connection pays TCP + TLS round trips; TLS 1.2 costs one more than 1.3', () => {
    const tls12 = underTest(
      run(topology({ edge: rttEdge({ reuse: 'per-request', tls: '1.2' }), rps: 50 }))
    )
    const tls13 = underTest(
      run(topology({ edge: rttEdge({ reuse: 'per-request', tls: '1.3' }), rps: 50 }))
    )
    const plainTcp = underTest(
      run(topology({ edge: rttEdge({ reuse: 'per-request', tls: 'none' }), rps: 50 }))
    )
    // One RTT = one 20 ms latency sample. TCP 1 + TLS 1.2 2 = 3 RTT = 60 ms.
    expect(tls12.latencyBreakdown?.meanMs.handshakeMs).toBeCloseTo(60, 1)
    expect(meanTransit(tls12)).toBeCloseTo(80.5, 1)
    // TCP 1 + TLS 1.3 1 = 2 RTT = 40 ms.
    expect(tls13.latencyBreakdown?.meanMs.handshakeMs).toBeCloseTo(40, 1)
    expect(meanTransit(tls13)).toBeCloseTo(60.5, 1)
    // TCP alone: 1 RTT.
    expect(plainTcp.latencyBreakdown?.meanMs.handshakeMs).toBeCloseTo(20, 1)
    // Every request opened its own connection.
    expect(tls13.connections?.reused).toBe(0)
    expect(tls13.connections?.opened).toBeGreaterThan(400)
  })

  it('keep-alive pays the handshake once and reuses the warm connection', () => {
    const keepAlive = underTest(
      run(topology({ edge: rttEdge({ reuse: 'keep-alive', tls: '1.3' }), rps: 50 }))
    )
    // Arrivals every 20 ms, each holding its connection ~21 ms: a couple of
    // connections serve the whole run, so the median request pays nothing.
    expect(meanTransit(keepAlive)).toBeCloseTo(20.5, 1)
    expect(keepAlive.connections?.reused).toBeGreaterThan(400)
    expect(keepAlive.connections?.opened ?? 0).toBeLessThan(5)
    expect(keepAlive.latencyBreakdown?.meanMs.handshakeMs ?? 0).toBeLessThan(1)
  })

  it('an idle timeout shorter than the gap between requests turns keep-alive back into per-request', () => {
    const shortIdle = underTest(
      run(
        topology({ edge: rttEdge({ reuse: 'keep-alive', tls: '1.3', idleTimeoutMs: 1 }), rps: 20 })
      )
    )
    expect(shortIdle.latencyBreakdown?.meanMs.handshakeMs).toBeCloseTo(40, 1)
    expect(shortIdle.connections?.closedIdle).toBeGreaterThan(100)
  })

  it('session resumption shortens later handshakes (TLS 1.2: 1 RTT, TLS 1.3: 0-RTT)', () => {
    const resumed12 = underTest(
      run(
        topology({
          edge: rttEdge({ reuse: 'per-request', tls: '1.2', tlsSessionResumption: true }),
          rps: 50
        })
      )
    )
    const resumed13 = underTest(
      run(
        topology({
          edge: rttEdge({ reuse: 'per-request', tls: '1.3', tlsSessionResumption: true }),
          rps: 50
        })
      )
    )
    // TCP 1 + resumed TLS 1.2 1 = 40 ms; TCP 1 + 0-RTT = 20 ms.
    expect(meanTransit(resumed12)).toBeCloseTo(60.5, 0)
    expect(meanTransit(resumed13)).toBeCloseTo(40.5, 0)
    expect(resumed13.connections?.resumed).toBeGreaterThan(400)
  })
})

describe('gRPC multiplexing vs HTTP/1.1 head-of-line blocking (#181 task 6)', () => {
  // A slow downstream (50 ms) behind a 4-connection pool. With one request per
  // connection (HTTP/1.1) the pool carries at most 4 / ~52 ms ~ 77 rps; HTTP/2
  // carries 100 streams on each of those connections.
  const pooled = (protocol: EdgeDefinition['protocol'], rps: number) =>
    topology({
      edge: {
        protocol,
        latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
        connection: { reuse: 'keep-alive', maxConnections: 4 }
      },
      rps,
      apiServiceMs: 50,
      timeoutMs: 2_000,
      workload: { pattern: 'poisson' }
    })

  it('below pool capacity, HTTP/1.1 requests queue for a connection while HTTP/2 does not', () => {
    const http1Out = run(pooled('https', 60))
    const grpcOut = run(pooled('grpc', 60))
    const http1 = underTest(http1Out)
    const grpc = underTest(grpcOut)
    expect(http1.connections?.waited).toBeGreaterThan(100)
    expect(http1.latencyBreakdown?.meanMs.connectionWaitMs).toBeGreaterThan(5)
    expect(http1.transitLatency.p99).toBeGreaterThan(grpc.transitLatency.p99 + 30)
    expect(grpc.connections?.waited ?? 0).toBe(0)
    expect(grpc.latencyBreakdown?.meanMs.connectionWaitMs).toBe(0)
    expect(http1Out.summary.throughput).toBeGreaterThan(55)
  })

  it('past pool capacity, the HTTP/1.1 line grows until requests time out; HTTP/2 keeps up', () => {
    const http1Out = run(pooled('https', 200))
    const grpcOut = run(pooled('grpc', 200))
    // FIFO hands each freed connection to the oldest waiter, which is close to
    // its 2 s deadline, so goodput collapses.
    expect(http1Out.summary.throughput).toBeLessThan(77)
    expect(http1Out.summary.timedOutRequests).toBeGreaterThan(1000)
    expect(grpcOut.summary.throughput).toBeGreaterThan(190)
    expect(grpcOut.summary.timedOutRequests).toBe(0)
    expect(underTest(grpcOut).connections?.waited ?? 0).toBe(0)
  })
})

describe('persistent WebSocket connections (#181 task 8)', () => {
  it('pays the upgrade handshake once per client instead of a handshake per request', () => {
    // client -> gateway is the edge under test here: it leaves the traffic
    // source, so each client (sessionId) has its own connection.
    const clients = {
      requestDistribution: [
        {
          type: 'message',
          weight: 1,
          sizeBytes: 200,
          keyspace: { field: 'sessionId', size: 20 }
        }
      ]
    }
    const rtt = {
      distribution: { type: 'constant' as const, value: 30 },
      pathType: 'internet' as const
    }
    const ws = underTest(
      run(
        topology({
          sourceEdge: {
            protocol: 'websocket',
            mode: 'streaming',
            latency: rtt,
            connection: { reuse: 'persistent' }
          },
          edge: {},
          rps: 100,
          workload: clients
        })
      ),
      'client-to-gateway'
    )
    const https = underTest(
      run(
        topology({
          sourceEdge: {
            protocol: 'https',
            latency: rtt,
            connection: { reuse: 'per-request' }
          },
          edge: {},
          rps: 100,
          workload: clients
        })
      ),
      'client-to-gateway'
    )
    // WebSocket: TCP 1 + TLS 1.3 1 + upgrade 1 = 90 ms, but only on each of the
    // 20 clients' first message (all during warmup), so post-warmup none open.
    expect(ws.connections?.opened ?? 0).toBe(0)
    // (Only a message joining a connection still opening at warmup end waits.)
    expect(ws.latencyBreakdown?.meanMs.handshakeMs ?? 0).toBeLessThan(0.5)
    // 30 ms + 0.1 ms x 0.25 streaming framing overhead.
    expect(meanTransit(ws)).toBeCloseTo(30.03, 0)
    // HTTPS per request: TCP + TLS 1.3 = 60 ms on every message.
    expect(https.latencyBreakdown?.meanMs.handshakeMs).toBeCloseTo(60, 1)
    expect(meanTransit(https)).toBeCloseTo(90.5, 1)
  })

  it('a client without identity is a new client each time and reuses nothing', () => {
    const anon = underTest(
      run(
        topology({
          sourceEdge: {
            protocol: 'websocket',
            mode: 'streaming',
            latency: { distribution: { type: 'constant', value: 30 }, pathType: 'internet' },
            connection: { reuse: 'persistent' }
          },
          edge: {},
          rps: 50
        })
      ),
      'client-to-gateway'
    )
    expect(anon.connections?.reused ?? 0).toBe(0)
    expect(anon.latencyBreakdown?.meanMs.handshakeMs).toBeCloseTo(90, 1)
  })
})

describe('Kafka producer batching on edges (#181 task 7)', () => {
  // producer -> broker over a Kafka edge whose in-flight cap is 5 (Kafka's
  // max.in.flight.requests.per.connection). Each produce request takes 5 ms of
  // propagation + 2 ms Kafka protocol overhead = 7 ms in flight, so unbatched
  // the edge carries at most 5 / 7 ms ~ 714 records/s.
  const kafka = (batching?: EdgeDefinition['batching']) =>
    topology({
      edge: {
        protocol: 'kafka',
        mode: 'asynchronous',
        latency: { distribution: { type: 'constant', value: 5 }, pathType: 'same-dc' },
        maxConcurrentRequests: 5,
        batching
      },
      rps: 2_000
    })

  function summarize(output: ReturnType<typeof run>) {
    const metric = underTest(output)
    const refused = output.summary.rejectedRequests
    return {
      delivered: metric.totalSuccessfulTransits,
      refused,
      p50: metric.transitLatency.p50,
      p99: metric.transitLatency.p99,
      batchWait: metric.latencyBreakdown?.meanMs.batchWaitMs ?? 0,
      recordsPerBatch: metric.batching?.meanRecordsPerBatch ?? 1
    }
  }

  it('batching carries records the unbatched in-flight cap refuses, at a measured latency cost', () => {
    const unbatched = summarize(run(kafka()))
    const linger10 = summarize(run(kafka({ lingerMs: 10 })))
    const linger40 = summarize(run(kafka({ lingerMs: 40 })))

    // Unbatched: every record is its own produce request, so the 5-slot
    // in-flight cap saturates (and the edge congestion model inflates transit
    // as it fills); almost everything is refused.
    expect(unbatched.refused).toBeGreaterThan(15_000)
    expect(unbatched.delivered / 9).toBeLessThan(100)

    // Batched: one produce request per batch, so the cap no longer binds and
    // the full 2000 records/s get through.
    expect(linger10.refused).toBe(0)
    expect(linger40.refused).toBe(0)
    expect(linger10.delivered / 9).toBeGreaterThan(1990)
    expect(linger40.delivered / 9).toBeGreaterThan(1985)

    // The cost: records wait for their batch. Longer linger = bigger batches
    // and higher record latency.
    expect(linger10.recordsPerBatch).toBeCloseTo(20, 0)
    expect(linger40.recordsPerBatch).toBeCloseTo(80, 0)
    expect(linger10.batchWait).toBeCloseTo(5.25, 1)
    expect(linger40.batchWait).toBeCloseTo(20.25, 1)
    expect(linger40.p50).toBeGreaterThan(linger10.p50 + 10)
    expect(linger40.p99).toBeGreaterThan(linger10.p99 + 25)
  }, 20_000)

  it('too short a linger leaves batches too small to stay under the cap', () => {
    const linger2 = summarize(run(kafka({ lingerMs: 2 })))
    expect(linger2.recordsPerBatch).toBeCloseTo(4, 0)
    expect(linger2.refused).toBeGreaterThan(10_000)
  })

  it('a batch is sent early once it reaches batch.size', () => {
    // 200 B records, 2000 B batch: full after 10 records (5 ms at 2000 rps),
    // well before the 50 ms linger.
    const sizeBound = summarize(run(kafka({ lingerMs: 50, maxBatchBytes: 2_000 })))
    expect(sizeBound.recordsPerBatch).toBeCloseTo(10, 0)
    expect(sizeBound.batchWait).toBeLessThan(5)
    expect(sizeBound.refused).toBe(0)
  })

  it('batching is ignored on a non-Kafka edge', () => {
    const out = run(
      topology({
        edge: {
          protocol: 'grpc',
          latency: { distribution: { type: 'constant', value: 5 }, pathType: 'same-dc' },
          batching: { lingerMs: 20 }
        },
        rps: 100
      })
    )
    expect(underTest(out).batching).toBeUndefined()
    expect(underTest(out).latencyBreakdown?.meanMs.batchWaitMs).toBe(0)
  })
})

describe('edge latency breakdown with the new components', () => {
  it('components still sum to the mean transit', () => {
    const out = run(
      topology({
        edge: {
          latency: { distribution: { type: 'constant', value: 3 }, pathType: 'same-dc' },
          connection: { reuse: 'keep-alive', maxConnections: 2 }
        },
        rps: 200,
        apiServiceMs: 8
      })
    )
    const breakdown = underTest(out).latencyBreakdown!
    const sum = EDGE_LATENCY_COMPONENTS.reduce((acc, key) => acc + breakdown.meanMs[key], 0)
    expect(sum).toBeCloseTo(breakdown.meanTotalMs, 1)
    expect(breakdown.meanMs.connectionWaitMs).toBeGreaterThan(0)
  })
})

describe('edge concurrency cap accounting', () => {
  it('a refused transfer does not free another transfer slot', () => {
    // Cap 5, 100 ms transit: at most 5 transfers per 100 ms can be in flight,
    // so no more than 50 per second may get through however many are offered.
    const out = run(
      topology({
        edge: {
          protocol: 'grpc',
          latency: { distribution: { type: 'constant', value: 100 }, pathType: 'same-dc' },
          maxConcurrentRequests: 5
        },
        rps: 1_000
      })
    )
    const metric = underTest(out)
    expect(metric.totalSuccessfulTransits / 9).toBeLessThanOrEqual(50)
    expect(out.summary.rejectedRequests).toBeGreaterThan(8_000)
  })
})
