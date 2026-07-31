import { describe, expect, it } from 'vitest'
import { createEvent } from './core/events'
import type { CanonicalEventRecord } from './core/event-stream'
import type {
  ComponentNode,
  EdgeDefinition,
  TopologyJSON,
  WorkloadProfile,
  DistributionConfig
} from './core/types'
import type { NodeFailureSpec } from './nodes/failure'
import { SimulationEngine } from './engine'

// --- topology builders -------------------------------------------------------

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

function serverNode(
  id: string,
  opts: {
    workers?: number
    capacity?: number
    serviceMs?: number | DistributionConfig
    timeoutMs?: number
  } = {}
): ComponentNode {
  const distribution: DistributionConfig =
    typeof opts.serviceMs === 'object'
      ? opts.serviceMs
      : { type: 'constant', value: opts.serviceMs ?? 8 }
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: opts.workers ?? 4, capacity: opts.capacity ?? 24, discipline: 'fifo' },
    processing: { distribution, timeout: opts.timeoutMs ?? 250 }
  }
}

function edge(source: string, target: string, latency: DistributionConfig): EdgeDefinition {
  return {
    id: `${source}-to-${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: latency, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 10_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function workload(
  sourceId: string,
  baseRps: number,
  pattern: WorkloadProfile['pattern']
): WorkloadProfile {
  return {
    sourceNodeId: sourceId,
    pattern,
    baseRps,
    requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
  }
}

function topology(opts: {
  serviceMs?: number | DistributionConfig
  workers?: number
  capacity?: number
  timeoutMs?: number
  edgeLatency?: DistributionConfig
  baseRps: number
  pattern?: WorkloadProfile['pattern']
  simulationDuration: number
  warmupDuration?: number
  defaultTimeout?: number
  seed?: string
}): TopologyJSON {
  return {
    id: 'failure-modes-test',
    name: 'failure-modes',
    version: '1.0.0',
    global: {
      simulationDuration: opts.simulationDuration,
      seed: opts.seed ?? 'failure-seed',
      warmupDuration: opts.warmupDuration ?? 0,
      timeResolution: 'microsecond',
      defaultTimeout: opts.defaultTimeout ?? 1000,
      traceSampleRate: 0
    },
    nodes: [
      sourceNode('client'),
      serverNode('api', {
        workers: opts.workers,
        capacity: opts.capacity,
        serviceMs: opts.serviceMs,
        timeoutMs: opts.timeoutMs
      })
    ],
    edges: [edge('client', 'api', opts.edgeLatency ?? { type: 'constant', value: 5 })],
    workload: workload('client', opts.baseRps, opts.pattern ?? 'constant')
  }
}

// --- injection & measurement helpers ----------------------------------------

function injectFailure(
  engine: SimulationEngine,
  nodeId: string,
  spec: NodeFailureSpec,
  atUs: bigint
): void {
  const internal = engine as unknown as {
    eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
  }
  internal.eventQueue.insert(createEvent('node-failure', nodeId, '', { failureSpec: spec }, atUs))
}

function injectRecovery(engine: SimulationEngine, nodeId: string, atUs: bigint): void {
  const internal = engine as unknown as {
    eventQueue: { insert: (event: ReturnType<typeof createEvent>) => void }
  }
  internal.eventQueue.insert(createEvent('node-recovery', nodeId, '', {}, atUs))
}

function bigintField(value: unknown): bigint | null {
  if (typeof value === 'string' && value.length > 0) return BigInt(value)
  if (typeof value === 'number') return BigInt(Math.round(value))
  return null
}

/** Node-level time-to-error (ms) for terminal error events of a given type. */
function nodeTimeToErrorMs(
  stream: CanonicalEventRecord[],
  type: CanonicalEventRecord['type'],
  reasonCode?: string
): number[] {
  const result: number[] = []
  for (const record of stream) {
    if (record.type !== type) continue
    if (reasonCode && record.reasonCode !== reasonCode) continue
    const arrival = bigintField(record.payload.nodeArrivalTime)
    const at = BigInt(record.timestampUs)
    if (arrival === null) continue
    result.push(Number(at - arrival) / 1000)
  }
  return result
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(p * (sorted.length - 1))]
}

const RESET_ON_FAIL: NodeFailureSpec = {
  mode: 'reject',
  inFlightPolicy: 'reset',
  recoveryPolicy: 'reset'
}

/** The sample topology's jittery client→API edge (log-normal propagation). */
const JITTER_EDGE: DistributionConfig = { type: 'log-normal', mu: 2.1, sigma: 0.35 }

describe('failure modes', () => {
  it('reject: instant node_failed, time-to-error walls near the edge hop, not the timeout', () => {
    const topo = topology({ baseRps: 200, simulationDuration: 2000, timeoutMs: 250 })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    // Fail before any request reaches the server (system priority runs first at t=0).
    injectFailure(engine, 'api', RESET_ON_FAIL, 0n)

    const output = engine.run()
    const stream = engine.getEventStream()

    expect(output.summary.successfulRequests).toBe(0)
    expect(output.summary.rejectedRequests).toBeGreaterThan(0)
    expect(output.summary.timedOutRequests).toBe(0)

    // Rejection is one edge hop after arrival — essentially instant, far below 250ms.
    const ttes = nodeTimeToErrorMs(stream, 'request-rejected', 'node_failed')
    expect(ttes.length).toBeGreaterThan(0)
    expect(percentile(ttes, 0.5)).toBeLessThan(1)
    expect(percentile(ttes, 0.99)).toBeLessThan(1)

    // Discriminator: a DEAD node attributes its errors to node_failed, never to
    // queue_full — the operator can tell "dead" from "overloaded" at a glance.
    const tte = output.summary.timeToErrorByCause
    expect(tte.node_failed.count).toBeGreaterThan(0)
    expect(tte.node_failed.shareOfErrors).toBe(1)
    expect(tte.queue_full.count).toBe(0)
  })

  it('overload discriminator: a saturated (never-failed) node attributes errors to queue_full, not node_failed', () => {
    // 3000 rps offered at a 4-worker / 8ms node (≈500 rps ceiling), no failure:
    // the queue fills and admission sheds load — the "overloaded" story.
    const topo = topology({
      baseRps: 3000,
      workers: 4,
      capacity: 24,
      serviceMs: 8,
      timeoutMs: 250,
      simulationDuration: 3000
    })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    const output = engine.run()

    const tte = output.summary.timeToErrorByCause
    expect(output.summary.successfulRequests).toBeGreaterThan(0) // sick, not dead
    expect(tte.queue_full.count).toBeGreaterThan(0)
    expect(tte.node_failed.count).toBe(0)
    // The healthy server still serves at its ceiling — this is overload, not death.
    expect(output.summary.throughput).toBeGreaterThan(400)
  })

  it('blackhole full-duration: 0 successes, all errors wall at the node timeout, K untouched', () => {
    const topo = topology({ baseRps: 200, simulationDuration: 2000, timeoutMs: 250 })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    injectFailure(
      engine,
      'api',
      { mode: 'blackhole', inFlightPolicy: 'hang', recoveryPolicy: 'reset' },
      0n
    )

    const output = engine.run()
    const perNode = output.perNode.api
    const stream = engine.getEventStream()

    expect(output.summary.successfulRequests).toBe(0)
    expect(output.summary.timedOutRequests).toBeGreaterThan(0)
    expect(output.summary.connectionResetRequests).toBe(0)

    // A dead NIC does no K bookkeeping: blackhole holds never enter the system.
    expect(perNode?.peakInSystem).toBe(0)

    // Time-to-error is a wall at exactly the node timeout: p50 ≈ p99 ≈ 250ms.
    const ttes = nodeTimeToErrorMs(stream, 'request-timed-out')
    expect(ttes.length).toBeGreaterThan(0)
    expect(percentile(ttes, 0.5)).toBeCloseTo(250, 0)
    expect(percentile(ttes, 0.99)).toBeCloseTo(250, 0)

    // Phase 3 data path: success latency is N/A (no successes, never a fake 0),
    // and the whole error population is attributed to the `timeout` cause — the
    // client-observed wall (edge 5ms + node timeout 250ms ≈ 255ms), never blended.
    expect(output.summary.latency.p50).toBeNull()
    expect(output.summary.latency.p99).toBeNull()
    expect(output.summary.latencyWindowErrorRate).toBe(1)
    const tte = output.summary.timeToErrorByCause
    expect(tte.timeout.count).toBeGreaterThan(0)
    expect(tte.rejected.count).toBe(0)
    expect(tte.connection_reset.count).toBe(0)
    expect(tte.timeout.shareOfErrors).toBe(1)
    expect(tte.timeout.p50! / 255).toBeGreaterThan(0.97)
    expect(tte.timeout.p50! / 255).toBeLessThan(1.03)
  })

  it('hang under sustained load: inSystem holds at K, overflow blackholes, all errors wall at the timeout', () => {
    const topo = topology({
      baseRps: 1000,
      capacity: 24,
      workers: 4,
      simulationDuration: 3000,
      timeoutMs: 250
    })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    injectFailure(
      engine,
      'api',
      { mode: 'hang', inFlightPolicy: 'hang', recoveryPolicy: 'reset' },
      0n
    )

    const output = engine.run()
    const perNode = output.perNode.api
    const stream = engine.getEventStream()

    expect(output.summary.successfulRequests).toBe(0)
    // Rolling window of exactly K held zombies; the invariant guarantees it never exceeds K.
    expect(perNode?.peakInSystem).toBe(24)

    const ttes = nodeTimeToErrorMs(stream, 'request-timed-out')
    expect(percentile(ttes, 0.5)).toBeCloseTo(250, 0)
    expect(percentile(ttes, 0.99)).toBeCloseTo(250, 0)
  })

  it('onset with inFlightPolicy hang: in-service completion never fires; its original timeout does', () => {
    // Exactly one long-running request in service, then a hang onset mid-service.
    const topo = topology({
      baseRps: 1, // inter-arrival 1000ms > sim duration → a single request at t=0
      workers: 1,
      capacity: 4,
      serviceMs: 100,
      timeoutMs: 250,
      simulationDuration: 400,
      edgeLatency: { type: 'constant', value: 5 }
    })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    // Request arrives at api at t=5ms and starts a 100ms service (would complete at 105ms).
    injectFailure(
      engine,
      'api',
      { mode: 'hang', inFlightPolicy: 'hang', recoveryPolicy: 'reset' },
      20_000n
    )

    const output = engine.run()
    const stream = engine.getEventStream()

    // The in-service request never completes; it times out at its ORIGINAL node
    // timeout (arrival 5ms + 250ms = 255ms total), not at service completion.
    expect(output.summary.successfulRequests).toBe(0)
    expect(output.summary.timedOutRequests).toBe(1)

    const completed = stream.filter((e) => e.type === 'processing-completed')
    expect(completed).toHaveLength(0)

    const ttes = nodeTimeToErrorMs(stream, 'request-timed-out')
    expect(ttes).toHaveLength(1)
    expect(ttes[0]).toBeCloseTo(250, 0)
  })

  it('recovery resume, outage > node timeout: zero goodput on the backlog, then fresh arrivals succeed', () => {
    const topo = topology({
      baseRps: 100,
      workers: 4,
      capacity: 24,
      serviceMs: 8,
      timeoutMs: 250,
      simulationDuration: 3000,
      defaultTimeout: 5000
    })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    // Outage from 500ms to 1200ms (700ms > 250ms node timeout): every held request
    // times out during the outage, so nothing survives to be resumed.
    injectFailure(
      engine,
      'api',
      { mode: 'hang', inFlightPolicy: 'hang', recoveryPolicy: 'resume' },
      500_000n
    )
    injectRecovery(engine, 'api', 1_200_000n)

    const output = engine.run()

    // Backlog all timed out (zero goodput on it), but post-recovery arrivals succeed again.
    expect(output.summary.timedOutRequests).toBeGreaterThan(0)
    expect(output.summary.successfulRequests).toBeGreaterThan(0)
    // No resumed request could beat a >nodeTimeout outage, so resets are all-or-none via timeout.
    expect(output.summary.connectionResetRequests).toBe(0)
  })

  it('recovery resume, outage < node timeout: near-deadline requests fail, others survive the race', () => {
    const topo = topology({
      baseRps: 100,
      workers: 4,
      capacity: 24,
      serviceMs: 8,
      timeoutMs: 250,
      simulationDuration: 3000,
      defaultTimeout: 5000
    })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    // Short outage (100ms < 250ms node timeout): some held requests still have
    // budget when the node resumes and can complete before their timeout fires.
    injectFailure(
      engine,
      'api',
      { mode: 'hang', inFlightPolicy: 'hang', recoveryPolicy: 'resume' },
      500_000n
    )
    injectRecovery(engine, 'api', 600_000n)

    const output = engine.run()
    expect(output.summary.successfulRequests).toBeGreaterThan(0)
  })

  it('degraded (fraction 0.2, x10): p50 near baseline while p99 is elevated', () => {
    const baseServiceMs = 8
    const build = (degraded: boolean): SimulationEngine => {
      const topo = topology({
        baseRps: 150,
        workers: 4,
        capacity: 64,
        serviceMs: baseServiceMs,
        timeoutMs: 5000,
        simulationDuration: 4000,
        defaultTimeout: 10_000,
        seed: 'degraded-seed'
      })
      const engine = new SimulationEngine(topo, { debugInvariants: true })
      if (degraded) {
        injectFailure(
          engine,
          'api',
          {
            mode: 'degraded',
            inFlightPolicy: 'reset',
            recoveryPolicy: 'reset',
            degradation: { fraction: 0.2, serviceTimeMultiplier: 10 }
          },
          0n
        )
      }
      return engine
    }

    const baseline = build(false).run()
    const degradedOut = build(true).run()

    // Most requests unaffected → p50 close to baseline; the slow 20% pull p99 way up.
    expect(degradedOut.summary.latency.p50).toBeLessThan(baseline.summary.latency.p50 * 2 + 5)
    expect(degradedOut.summary.latency.p99).toBeGreaterThan(baseline.summary.latency.p99 * 3)
  })

  it('is deterministic: identical seed + config + failure mode → identical output twice', () => {
    for (const spec of [
      { mode: 'reject', inFlightPolicy: 'reset', recoveryPolicy: 'reset' },
      { mode: 'blackhole', inFlightPolicy: 'hang', recoveryPolicy: 'reset' },
      { mode: 'hang', inFlightPolicy: 'hang', recoveryPolicy: 'resume' }
    ] as NodeFailureSpec[]) {
      const run = (): {
        summary: unknown
        counts: unknown
      } => {
        const topo = topology({
          baseRps: 300,
          simulationDuration: 2000,
          timeoutMs: 250,
          seed: 'determinism-seed'
        })
        const engine = new SimulationEngine(topo)
        injectFailure(engine, 'api', spec, 400_000n)
        injectRecovery(engine, 'api', 1_400_000n)
        const output = engine.run()
        return { summary: output.summary, counts: engine.getEventCountsByType() }
      }

      const a = run()
      const b = run()
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })
})

/** API-node arrival timestamps (µs), in event order, from the canonical stream. */
function apiArrivalGapsUs(stream: CanonicalEventRecord[]): bigint[] {
  const arrivals = stream
    .filter((e) => e.type === 'request-arrived' && e.nodeId === 'api')
    .map((e) => BigInt(e.timestampUs))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const gaps: bigint[] = []
  for (let i = 1; i < arrivals.length; i++) gaps.push(arrivals[i] - arrivals[i - 1])
  return gaps
}

describe('arrival jitter — rejects below nominal capacity are legitimate, not a bug', () => {
  // 120 rps at a 1-worker / 8ms node (≈125 rps ceiling). Offered < capacity, so
  // the naive D/D/1 reading says "no queue, no rejects". That only holds if the
  // API sees perfectly even arrivals.
  const singleServer = (edgeLatency: { type: 'constant'; value: number } | typeof JITTER_EDGE) =>
    topology({
      baseRps: 120,
      pattern: 'constant',
      workers: 1,
      capacity: 2,
      serviceMs: 8,
      timeoutMs: 250,
      simulationDuration: 5000,
      edgeLatency,
      seed: 'jitter-repro'
    })

  it('Repro A — a clean (constant) edge keeps arrivals even: no queue, no rejects', () => {
    const output = new SimulationEngine(singleServer({ type: 'constant', value: 0 }), {
      debugInvariants: true
    }).run()
    const node = output.perNode.api

    expect(output.summary.rejectedRequests).toBe(0)
    expect(output.summary.timedOutRequests).toBe(0)
    expect(node.postWarmupRejected).toBe(0)
    // No queue wait → node-local latency is the flat 8ms service.
    expect(node.latencyNodeLocal.p50).not.toBeNull()
    expect(node.latencyNodeLocal.p50! - 8).toBeLessThan(0.5)

    // Mechanism: constant edge preserves the 8.33ms spacing — no bunching.
    const gaps = apiArrivalGapsUs(output.eventStream)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps.every((g) => g >= 8000n)).toBe(true)
  })

  it('Repro B — a jittery (log-normal) edge bunches arrivals: some capacity_exceeded rejects', () => {
    const output = new SimulationEngine(singleServer(JITTER_EDGE), {
      debugInvariants: true
    }).run()
    const node = output.perNode.api

    // Below nominal capacity yet still rejecting — the whole point of the tool.
    expect(output.summary.rejectedRequests).toBeGreaterThan(0)
    expect(node.rejectionsByReason.capacity_exceeded).toBeGreaterThan(0)
    // Queue was actually used → node-local latency exceeds the 8ms service.
    expect(node.latencyNodeLocal.p50).not.toBeNull()
    expect(node.latencyNodeLocal.p50!).toBeGreaterThan(8)

    // Mechanism: at least one pair of consecutive API arrivals is spaced < 8ms.
    const gaps = apiArrivalGapsUs(output.eventStream)
    expect(gaps.some((g) => g < 8000n)).toBe(true)
  })
})

describe('utilization is a time-weighted integral, not a snapshot average', () => {
  it('one request, 10ms service over a 50ms run → exactly 0.2 (not a sampling artifact)', () => {
    // A single request served [0,10ms] on one worker over 50ms → the worker is
    // busy 10/50 = 20% of the run. A 1s-snapshot average would miss this entirely.
    const topo = topology({
      baseRps: 1, // inter-arrival 1000ms > 50ms run → exactly one request at t=0
      pattern: 'constant',
      workers: 1,
      capacity: 4,
      serviceMs: 10,
      timeoutMs: 5000,
      simulationDuration: 50,
      edgeLatency: { type: 'constant', value: 0 },
      seed: 'util-integral'
    })
    const output = new SimulationEngine(topo, { debugInvariants: true }).run()
    expect(output.perNode.api.utilization).toBeCloseTo(0.2, 10)
  })

  it('the reported utilization matches busy time from completions (the 80%→92.5% fix)', () => {
    // Constant 120rps, clean edge, 1 worker / 8ms / 5s: worker busy ≈ completed×8ms.
    const topo = topology({
      baseRps: 120,
      pattern: 'constant',
      workers: 1,
      capacity: 2,
      serviceMs: 8,
      timeoutMs: 250,
      simulationDuration: 5000,
      edgeLatency: { type: 'constant', value: 0 },
      seed: 'util-busy'
    })
    const output = new SimulationEngine(topo, { debugInvariants: true }).run()
    const api = output.perNode.api
    // ~96% busy (8ms service / 8.33ms arrival), NOT the ~80% a snapshot average gave.
    expect(api.utilization).toBeGreaterThan(0.9)
    // Cross-check against completed work: busy ≈ completed × 8ms / 5000ms.
    const expected = (api.totalProcessed * 8) / 5000
    expect(api.utilization).toBeCloseTo(expected, 2)
  })
})

describe('queueing core regression (no failure)', () => {
  it('saturated single server still throttles to ~server capacity with ~50% errors', () => {
    // 1000 rps offered at a 4-worker / 8ms-service node → ~500 rps ceiling.
    const topo = topology({
      baseRps: 1000,
      pattern: 'poisson',
      workers: 4,
      capacity: 24,
      serviceMs: 8,
      timeoutMs: 250,
      simulationDuration: 60_000,
      warmupDuration: 5000,
      defaultTimeout: 1000,
      edgeLatency: { type: 'log-normal', mu: 2.1, sigma: 0.35 },
      seed: 'sample-direct-client-server'
    })
    const engine = new SimulationEngine(topo)
    const output = engine.run()

    // Throughput near the 500 rps service ceiling.
    expect(output.summary.throughput).toBeGreaterThan(470)
    expect(output.summary.throughput).toBeLessThan(510)
    // Roughly half the offered load is shed.
    expect(output.summary.errorRate).toBeGreaterThan(0.4)
    expect(output.summary.errorRate).toBeLessThan(0.6)
    // Median successful latency in the tens of ms (queue wait + service under load).
    expect(output.summary.latency.p50).toBeGreaterThan(20)
    expect(output.summary.latency.p50).toBeLessThan(120)
  })
})

describe('per-node scoped aggregation (honest node badge)', () => {
  it('the node reads its own node-local latency, not end-to-end — the 305 vs 16 projection', () => {
    // 290ms edge in front of an 8ms node, unsaturated. End-to-end ≈ 298ms; the
    // node badge must read ~8ms node-local. Both are honest projections of one
    // truth, and their difference (≈290ms) is the edge — the diagnostic.
    const topo = topology({
      baseRps: 50,
      workers: 4,
      capacity: 64,
      serviceMs: 8,
      timeoutMs: 5000,
      simulationDuration: 4000,
      defaultTimeout: 10_000,
      edgeLatency: { type: 'constant', value: 290 }
    })
    const output = new SimulationEngine(topo, { debugInvariants: true }).run()

    const systemP50 = output.summary.latency.p50!
    const nodeP50 = output.perNode.api.latencyNodeLocal.p50!
    expect(systemP50).toBeGreaterThan(280) // end-to-end, edge-dominated
    expect(nodeP50).toBeLessThan(20) // node-local, healthy
    expect(systemP50 - nodeP50).toBeGreaterThan(250) // the delta lives on the edge
  })

  it('a dead node reports N/A node-local latency (never a fake 0) and owns its failures', () => {
    const topo = topology({ baseRps: 200, simulationDuration: 2000, timeoutMs: 250 })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    injectFailure(engine, 'api', RESET_ON_FAIL, 0n)

    const node = engine.run().perNode.api
    // Survivor-bias fix: no successful node-local passes → N/A, not 0 with a ✓.
    expect(node.latencyNodeLocal.p50).toBeNull()
    expect(node.latencyNodeLocal.p99).toBeNull()
    // The node owns its failures in its own scoped per-cause breakdown.
    expect(node.timeToErrorByCause.node_failed.count).toBeGreaterThan(0)
    expect(node.errorRate).toBeGreaterThan(0.9)
  })
})

describe('failure-by-locus Pareto (who killed my request)', () => {
  it('attributes a dead node’s failures to the node, cause node_failed', () => {
    const topo = topology({ baseRps: 200, simulationDuration: 2000, timeoutMs: 250 })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    injectFailure(engine, 'api', RESET_ON_FAIL, 0n)

    const pareto = engine.run().summary.failuresByLocus
    expect(pareto.length).toBeGreaterThan(0)
    const top = pareto[0]
    expect(top.locus).toBe('api')
    expect(top.locusKind).toBe('node')
    expect(top.dominantCause).toBe('node_failed')
    expect(top.shareOfFailures).toBe(1)
  })

  it('attributes edge drops to the edge, cause network_error — not the node behind it', () => {
    // A healthy node behind an edge that fails every request: the failure locus
    // must be the EDGE, so an edge problem never masquerades as a node problem.
    const topo = topology({
      baseRps: 200,
      simulationDuration: 2000,
      edgeLatency: { type: 'constant', value: 5 }
    })
    topo.edges[0].errorRate = 1
    const engine = new SimulationEngine(topo, { debugInvariants: true })

    const summary = engine.run().summary
    const pareto = summary.failuresByLocus
    expect(pareto.length).toBeGreaterThan(0)
    const top = pareto[0]
    expect(top.locusKind).toBe('edge')
    expect(top.locus).toBe('client-to-api')
    expect(top.dominantCause).toBe('network_error')

    // Reconciliation: the Pareto totals equal the time-to-error population.
    const paretoTotal = pareto.reduce((sum, p) => sum + p.total, 0)
    expect(paretoTotal).toBe(summary.timeToErrorSamples)
  })
})

describe('declared faults schedule failure/recovery (UI bridge)', () => {
  it('a fixed-duration fault fails then recovers the node, populating the status timeline', () => {
    const topo = topology({ baseRps: 200, simulationDuration: 3000, timeoutMs: 250 })
    topo.faults = [
      {
        targetId: 'api',
        faultType: 'crash',
        timing: 'deterministic',
        duration: 'fixed',
        params: {
          atMs: 500,
          durationMs: 700,
          mode: 'blackhole',
          inFlightPolicy: 'hang',
          recoveryPolicy: 'reset'
        }
      }
    ]
    const output = new SimulationEngine(topo, { debugInvariants: true }).run()

    expect(output.statusTimeline).toHaveLength(1)
    expect(output.statusTimeline[0]).toMatchObject({ componentId: 'api', mode: 'blackhole' })
    expect(output.statusTimeline[0].startMs).toBeCloseTo(500, 3)
    expect(output.statusTimeline[0].endMs).toBeCloseTo(1200, 3)
    // The outage walled requests at the timeout — the failure was actually applied.
    expect(output.summary.timeToErrorByCause.timeout.count).toBeGreaterThan(0)
  })

  it('a permanent fault never recovers (window runs to the horizon)', () => {
    const topo = topology({ baseRps: 200, simulationDuration: 2000, timeoutMs: 250 })
    topo.faults = [
      {
        targetId: 'api',
        faultType: 'crash',
        timing: 'deterministic',
        duration: 'permanent',
        params: { atMs: 400, mode: 'reject' }
      }
    ]
    const output = new SimulationEngine(topo, { debugInvariants: true }).run()
    expect(output.statusTimeline).toHaveLength(1)
    expect(output.statusTimeline[0].endMs).toBeCloseTo(2000, 3)
    expect(output.summary.timeToErrorByCause.node_failed.count).toBeGreaterThan(0)
  })
})

describe('status timeline artifact (failure windows)', () => {
  it('records a closed failure window from onset to recovery', () => {
    const topo = topology({ baseRps: 100, simulationDuration: 3000, timeoutMs: 250 })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    injectFailure(
      engine,
      'api',
      { mode: 'blackhole', inFlightPolicy: 'hang', recoveryPolicy: 'reset' },
      500_000n
    )
    injectRecovery(engine, 'api', 1_200_000n)

    const timeline = engine.run().statusTimeline
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({ componentId: 'api', mode: 'blackhole' })
    expect(timeline[0].startMs).toBeCloseTo(500, 3)
    expect(timeline[0].endMs).toBeCloseTo(1200, 3)
  })

  it('closes a window still open at cutoff at the simulation horizon', () => {
    const topo = topology({ baseRps: 100, simulationDuration: 2000, timeoutMs: 250 })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    injectFailure(engine, 'api', RESET_ON_FAIL, 400_000n) // never recovers

    const timeline = engine.run().statusTimeline
    expect(timeline).toHaveLength(1)
    expect(timeline[0].startMs).toBeCloseTo(400, 3)
    expect(timeline[0].endMs).toBeCloseTo(2000, 3) // run horizon
  })

  it('has an empty timeline when nothing fails', () => {
    const topo = topology({ baseRps: 100, simulationDuration: 1000 })
    expect(new SimulationEngine(topo).run().statusTimeline).toEqual([])
  })
})

describe('phase-timeline latency decomposition', () => {
  it('attributes a slow edge to the edge, not the (healthy) node — the bottleneck verdict', () => {
    // A 290ms edge in front of an 8ms service, unsaturated so the node barely
    // queues. End-to-end ≈ 298ms; the node badge would read ~8-16ms. The
    // decomposition must place ~290ms on the edge — the 305−16 diagnostic.
    const topo = topology({
      baseRps: 50,
      workers: 4,
      capacity: 64,
      serviceMs: 8,
      timeoutMs: 5000,
      simulationDuration: 4000,
      defaultTimeout: 10_000,
      edgeLatency: { type: 'constant', value: 290 }
    })
    const engine = new SimulationEngine(topo, { debugInvariants: true })
    const output = engine.run()
    const decomposition = output.summary.latencyDecomposition

    // Per-component scoping: the node badge reads its OWN node-local latency
    // (~8ms service), while the summary tray reads end-to-end (~298ms). The two
    // now come from the same histogram math at different scopes — 305−16 made real.
    const apiNodeLocalP50 = output.perNode.api.latencyNodeLocal.p50!
    const systemP50 = output.summary.latency.p50!
    expect(apiNodeLocalP50).toBeLessThan(20)
    expect(systemP50).toBeGreaterThan(280)
    expect(systemP50 - apiNodeLocalP50).toBeGreaterThan(260) // the edge, located by subtraction

    expect(decomposition.length).toBeGreaterThan(0)
    const top = decomposition[0]
    // Bottleneck-first ordering: the edge dominates end-to-end latency.
    expect(top.kind).toBe('edge')
    expect(top.label).toBe('client→api')
    expect(top.shareOfEndToEnd).toBeGreaterThan(0.9)
    expect(top.meanMs).toBeGreaterThan(280)
    expect(top.meanMs).toBeLessThan(300)

    // Node-local contributions (queue + service) are the small remainder.
    const nodeMs = decomposition
      .filter((e) => e.component === 'api')
      .reduce((sum, e) => sum + e.meanMs, 0)
    expect(nodeMs).toBeLessThan(20)

    // Contributions reconstruct mean end-to-end (no silently dropped time).
    const totalMean = decomposition.reduce((sum, e) => sum + e.meanMs, 0)
    expect(totalMean).toBeGreaterThan(290)
    expect(totalMean).toBeLessThan(315)
  })
})
