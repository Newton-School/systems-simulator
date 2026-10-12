import { describe, expect, it } from 'vitest'
import type {
  ComponentNode,
  EdgeDefinition,
  TopologyJSON,
  WorkloadStopCondition
} from '../core/types'
import { SimulationEngine } from '../engine'
import { createWorkerController } from './simulationWorkerController'
import type { WorkerInboundMessage, WorkerOutboundMessage } from './protocols'

function svc(id: string, workers: number, serviceMs: number): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers, capacity: workers * 4, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 5000 }
  }
}

function edge(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topo(opts: {
  baseRps: number
  serviceMs: number
  workers: number
  durationMs?: number
  stopCondition?: WorkloadStopCondition
}): TopologyJSON {
  return {
    id: 't',
    name: 't',
    version: '1',
    global: {
      simulationDuration: opts.durationMs ?? 5_000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 5_000
    },
    nodes: [
      {
        id: 'client',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'client',
        position: { x: 0, y: 0 }
      },
      svc('api', opts.workers, opts.serviceMs)
    ],
    edges: [edge('client', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: opts.baseRps,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }],
      ...(opts.stopCondition ? { stopCondition: opts.stopCondition } : {})
    }
  }
}

/** A controller on a fake wall clock: sleep(ms) advances `now` by ms instantly. */
function harness(
  onPost?: (msg: WorkerOutboundMessage, send: (m: WorkerInboundMessage) => void) => void
) {
  const messages: WorkerOutboundMessage[] = []
  const clock = { now: 0 }
  const send = (m: WorkerInboundMessage) => controller.handleMessage(m)
  const controller = createWorkerController({
    post: (msg) => {
      messages.push(msg)
      onPost?.(msg, send)
    },
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms
    }
  })
  return { messages, clock, send, controller }
}

const terminal = (messages: WorkerOutboundMessage[]) =>
  messages.filter((m) => m.type === 'complete' || (m.type === 'error' && !m.payload.recoverable))

describe('simulation worker controller', () => {
  it('rejects an invalid topology with a typed error instead of running', async () => {
    const { messages, send, controller } = harness()
    const bad = topo({ baseRps: 10, serviceMs: 1, workers: 1 })
    bad.edges = [edge('client', 'missing-node')]
    send({ type: 'run', payload: { topology: bad } })
    await controller.idle()

    expect(messages.some((m) => m.type === 'complete' || m.type === 'snapshot')).toBe(false)
    const error = messages.find((m) => m.type === 'error')
    expect(error?.type).toBe('error')
    if (error?.type !== 'error') return
    expect(error.payload.code).toBe('invalid-topology')
    expect(error.payload.recoverable).toBeFalsy()
    expect(error.payload.validationErrors?.length).toBeGreaterThan(0)
  })

  it("'max' (the default) produces the same output as engine.run()", async () => {
    const t = topo({ baseRps: 200, serviceMs: 2, workers: 4 })
    const reference = new SimulationEngine(t).run()
    const { messages, send, controller } = harness()
    send({ type: 'run', payload: { topology: t } })
    await controller.idle()

    const done = terminal(messages)
    expect(done).toHaveLength(1)
    expect(done[0].type).toBe('complete')
    if (done[0].type !== 'complete') return
    expect(done[0].payload.stopped).toBe(false)
    expect(done[0].payload.output.eventsProcessed).toBe(reference.eventsProcessed)
    expect(done[0].payload.output.summary).toEqual(reference.summary)
    // Every per-second snapshot is forwarded, not just the latest one.
    const snapshots = messages.filter((m) => m.type === 'snapshot')
    expect(snapshots.length).toBe(reference.timeSeries.length)
  })

  it('paces against simulated time, honours set-speed mid-run, and keeps results identical', async () => {
    const t = topo({ baseRps: 100, serviceMs: 2, workers: 4, durationMs: 6_000 })
    const reference = new SimulationEngine(t).run()
    const observations: Array<{ wallMs: number; simMs: number }> = []
    let speedChangedAtWall: number | null = null
    const h = harness((msg, send) => {
      if (msg.type !== 'snapshot') return
      observations.push({ wallMs: h.clock.now, simMs: msg.payload.snapshot.timestamp })
      if (speedChangedAtWall === null && msg.payload.snapshot.timestamp >= 2_000) {
        speedChangedAtWall = h.clock.now
        send({ type: 'set-speed', payload: { speed: 4 } })
      }
    })
    h.send({ type: 'run', payload: { topology: t, speed: 1 } })
    await h.controller.idle()

    const done = terminal(h.messages)
    expect(done[0].type).toBe('complete')
    if (done[0].type !== 'complete') return
    expect(done[0].payload.output.eventsProcessed).toBe(reference.eventsProcessed)
    expect(done[0].payload.output.summary).toEqual(reference.summary)

    // At 1x the first 2 simulated seconds take ~2 wall seconds (telemetry is
    // flushed every 100ms, so allow that much slack).
    const at2s = observations.find((o) => o.simMs >= 2_000)!
    expect(at2s.wallMs).toBeGreaterThanOrEqual(1_900)
    expect(at2s.wallMs).toBeLessThanOrEqual(2_200)
    // At 4x the remaining 4 simulated seconds take ~1 wall second, not 4.
    const totalWall = h.clock.now
    expect(totalWall - speedChangedAtWall!).toBeGreaterThan(800)
    expect(totalWall - speedChangedAtWall!).toBeLessThan(1_400)
  })

  it('stop ends the run early with partial results (stopped: true)', async () => {
    const t = topo({ baseRps: 100, serviceMs: 2, workers: 4, durationMs: 10_000 })
    const reference = new SimulationEngine(t).run()
    let sentStop = false
    const h = harness((msg, send) => {
      if (!sentStop && msg.type === 'snapshot' && msg.payload.snapshot.timestamp >= 3_000) {
        sentStop = true
        send({ type: 'stop' })
      }
    })
    h.send({ type: 'run', payload: { topology: t, speed: 1 } })
    await h.controller.idle()

    const done = terminal(h.messages)
    expect(done).toHaveLength(1)
    expect(done[0].type).toBe('complete')
    if (done[0].type !== 'complete') return
    expect(done[0].payload.stopped).toBe(true)
    expect(done[0].payload.output.eventsProcessed).toBeGreaterThan(0)
    expect(done[0].payload.output.eventsProcessed).toBeLessThan(reference.eventsProcessed)
  })

  it('stop while paused also completes with partial results; stop when idle is a no-op', async () => {
    const t = topo({ baseRps: 100, serviceMs: 2, workers: 4, durationMs: 10_000 })
    const idle = harness()
    idle.send({ type: 'stop' })
    expect(idle.messages).toHaveLength(0)

    let paused = false
    const h = harness((msg, send) => {
      if (!paused && msg.type === 'snapshot' && msg.payload.snapshot.timestamp >= 1_000) {
        paused = true
        send({ type: 'pause' })
        send({ type: 'step', payload: { count: 50 } })
        send({ type: 'stop' })
      }
    })
    h.send({ type: 'run', payload: { topology: t, speed: 2 } })
    await h.controller.idle()
    const done = terminal(h.messages)
    expect(done).toHaveLength(1)
    expect(done[0].type === 'complete' && done[0].payload.stopped).toBe(true)
  })

  it('a saturation halt completes the run and reports it instead of resuming', async () => {
    const t = topo({
      baseRps: 1000,
      serviceMs: 10,
      workers: 1,
      durationMs: 60_000,
      stopCondition: { mode: 'duration', haltOnSaturation: { utilization: 1.0 } }
    })
    const reference = new SimulationEngine(t).run()
    expect(reference.stopReason).toBe('saturation')
    const { messages, send, controller } = harness()
    send({ type: 'run', payload: { topology: t } })
    await controller.idle()

    const done = terminal(messages)
    expect(done).toHaveLength(1)
    expect(done[0].type).toBe('complete')
    if (done[0].type !== 'complete') return
    expect(done[0].payload.stopped).toBe(false)
    expect(done[0].payload.output.stopReason).toBe('saturation')
    expect(done[0].payload.output.stoppedAtMs).toBe(reference.stoppedAtMs)
    expect(done[0].payload.output.eventsProcessed).toBe(reference.eventsProcessed)
  })

  it('rejected commands are recoverable and leave the run intact', async () => {
    const t = topo({ baseRps: 100, serviceMs: 2, workers: 4, durationMs: 3_000 })
    let poked = false
    const h = harness((msg, send) => {
      if (!poked && msg.type === 'snapshot') {
        poked = true
        send({ type: 'step', payload: { count: 1 } })
        send({ type: 'set-speed', payload: { speed: -1 } })
        send({ type: 'run', payload: { topology: t } })
      }
    })
    h.send({ type: 'run', payload: { topology: t } })
    await h.controller.idle()

    const errors = h.messages.filter((m) => m.type === 'error')
    expect(errors.map((e) => e.type === 'error' && e.payload.code)).toEqual([
      'step-while-running',
      'invalid-speed',
      'already-running'
    ])
    expect(errors.every((e) => e.type === 'error' && e.payload.recoverable)).toBe(true)
    expect(terminal(h.messages).map((m) => m.type)).toEqual(['complete'])
  })
})
