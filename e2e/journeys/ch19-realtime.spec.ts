/**
 * Chapter 19: real-time and media (docs/reference/19-real-time-and-media.md).
 * Expected values come from the chapter: a gateway holds the smallest of the offered, per-instance-capped and RAM-bound
 * connection counts and refuses the rest, keep-alive pings cost held / interval x cost cores, a push to N recipients costs
 * N sends of CPU, delivered pushes = messages x recipients x connected share. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { bodyText, importTopology, openApp, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import {
  heartbeatCores,
  heldConnections,
  meshUploadMbps,
  relErr,
  sfuEgressMbps
} from '../support/oracles'
import { chain, computeNode, type RunSpec } from '../support/topology'

type Out = ReturnType<typeof runEngine>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 10,
    pattern: 'constant',
    durationMs: 10_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (a: string, b: string) =>
  [a, b, { protocol: 'tcp' }] as [string, string, Record<string, unknown>]

/** A WebSocket gateway on m5.large (2 vCPU, 8 GB) with 1 ms of service time per request. */
function gateway(
  seed: string,
  config: Record<string, unknown>,
  instances = 1,
  over: Partial<RunSpec> = {}
) {
  const gw = computeNode('gw', { serviceMs: 1, type: 'websockets-gateway', config })
  ;(gw as Record<string, unknown>).category = 'real-time-and-media'
  ;(gw.resources as Record<string, unknown>).instanceCount = instances
  return chain({ run: run(seed, over), nodes: [gw], edges: [tcp('source', 'gw')] })
}

const counters = (out: Out) => out.perNode.gw.traitCounters

// ───────────────────────── 1. Connection capacity ─────────────────────────

test.describe('RT-01 a gateway holds min(offered, per-instance cap, RAM limit) and refuses the rest (ch19 section 2)', () => {
  const RAM_GB = 8
  const KB = 32
  const cases: [string, Record<string, unknown>, number, number][] = [
    ['100,000 offered fit in 8 GB at 32 KB', { heldConnections: 100_000 }, 1, 100_000],
    [
      '1,000,000 offered: the RAM limit (262,144) binds',
      { heldConnections: 1_000_000 },
      1,
      1_000_000
    ],
    [
      'a per-instance cap of 40,000 binds below RAM',
      { heldConnections: 100_000, maxConnectionsPerInstance: 40_000 },
      1,
      100_000
    ],
    [
      'two instances double the cap to 80,000',
      { heldConnections: 100_000, maxConnectionsPerInstance: 40_000 },
      2,
      100_000
    ],
    [
      'fatter connections (64 KB) halve the RAM limit',
      { heldConnections: 1_000_000, memPerConnectionKb: 64 },
      1,
      1_000_000
    ]
  ]
  for (const [name, config, instances, offered] of cases) {
    test(name, () => {
      const kb = (config.memPerConnectionKb as number | undefined) ?? KB
      const cap = (config.maxConnectionsPerInstance as number | undefined) ?? null
      const expectedHeld = heldConnections(offered, cap, instances, RAM_GB, kb)
      const c = counters(
        runEngine(gateway(`rt01-${name.length}`, { pushRecipients: 1, ...config }, instances))
      )
      expect(c.connectionsHeld).toBe(expectedHeld)
      expect(c.connectionsRefused ?? 0).toBe(offered - expectedHeld)
    })
  }
})

// ───────────────────────── 2. Push fan-out ─────────────────────────

test.describe('RT-02 a push to N recipients costs N sends of CPU and delivers to the connected share (ch19 section 3)', () => {
  test('1,000 recipients at 0.01 ms per send: 10 ms of work on top of the 1 ms service time', () => {
    const out = runEngine(
      gateway('rt02', { heldConnections: 1000, pushRecipients: 1000, pushSendMs: 0.01 })
    )
    expect(Math.abs(out.summary.latency.mean - (1 + 1000 * 0.01))).toBeLessThan(0.1)
  })

  test('delivered pushes = messages x recipients when everyone is connected', () => {
    const out = runEngine(gateway('rt02b', { heldConnections: 1000, pushRecipients: 1000 }))
    const c = counters(out)
    expect(c.pushDeliveries).toBe(c.pushMessages * 1000)
    expect(c.pushUndeliverable ?? 0).toBe(0)
  })

  test('with only a share of the offered connections held, deliveries fall by that share and the rest are undeliverable', () => {
    const offered = 1_000_000
    const held = heldConnections(offered, null, 1, 8, 32)
    const out = runEngine(gateway('rt02c', { heldConnections: offered, pushRecipients: 1000 }))
    const c = counters(out)
    const share = held / offered
    expect(Math.abs(c.pushDeliveries / (c.pushMessages * 1000) - share)).toBeLessThan(0.002)
    expect(c.pushDeliveries + c.pushUndeliverable).toBe(c.pushMessages * 1000)
  })

  test('more recipients, more work: latency grows linearly in recipients', () => {
    const mean = (n: number) =>
      runEngine(gateway(`rt02d-${n}`, { heldConnections: n, pushRecipients: n, pushSendMs: 0.01 }))
        .summary.latency.mean
    expect(relErr(mean(4000) - 1, 4 * (mean(1000) - 1))).toBeLessThan(0.02)
  })
})

// ───────────────────────── 3. Heartbeats ─────────────────────────

test.describe('RT-03 keep-alive pings are steady CPU: held / interval x cost cores (ch19 section 2)', () => {
  const util = (seed: string, config: Record<string, unknown>) =>
    runEngine(gateway(seed, { heldConnections: 100_000, ...config }, 1, { rps: 1 })).perNode.gw
      .utilization

  test('100,000 connections pinged every 30 s at 0.01 ms use 0.033 cores of the 2 available', () => {
    const base = util('rt03a', {})
    const withBeats = util('rt03b', { heartbeatIntervalMs: 30_000, heartbeatCostMs: 0.01 })
    const cores = heartbeatCores(100_000, 30_000, 0.01)
    expect(relErr(withBeats - base, cores / 2)).toBeLessThan(0.1)
  })

  test('pings every second at 1 ms would need 100 cores: the gateway saturates and requests stall', () => {
    const out = runEngine(
      gateway(
        'rt03c',
        { heldConnections: 100_000, heartbeatIntervalMs: 1000, heartbeatCostMs: 1 },
        1,
        { rps: 10 }
      )
    )
    expect(heartbeatCores(100_000, 1000, 1)).toBe(100)
    expect(out.perNode.gw.utilization).toBeGreaterThan(0.99)
    // a 1 ms request now waits behind the pings: at least ten times its service time
    expect(out.summary.latency.mean).toBeGreaterThan(10)
  })
})

// ───────────────────────── 4. Not modelled (decisions) ─────────────────────────

test.describe('RT-04 video topologies and reconnect storms (ch19 sections 2 and 5)', () => {
  test('the bandwidth arithmetic the chapter gives (mesh upload, SFU egress)', () => {
    expect(meshUploadMbps(5, 1.5)).toBeCloseTo(6, 9)
    expect(sfuEgressMbps(50, 1.5)).toBeCloseTo(3675, 6)
  })

  // Decision needed (ch19 open items): an `sfu-mcu` or `webrtc-mesh` node models a processing cost only; it has no
  // per-participant bandwidth, so the difference between mesh, SFU and MCU is not visible in a run.
  test.fixme('an SFU node with 50 participants at 1.5 Mbps reports 3,675 Mbps of egress', () => {
    const sfu = computeNode('sfu', {
      serviceMs: 1,
      type: 'sfu-mcu',
      config: { participants: 50, bitrateMbps: 1.5 }
    })
    const out = runEngine(chain({ run: run('rt04'), nodes: [sfu], edges: [tcp('source', 'sfu')] }))
    expect(out.perNode.sfu.traitCounters.egressMbps).toBeCloseTo(3675, 0)
  })

  // Decision needed: held connections are a steady state; a reconnect storm after a restart is not modelled.
  test.fixme('restarting a gateway makes its clients reconnect at once and costs their handshakes', () => {
    const out = runEngine(gateway('rt04b', { heldConnections: 100_000 }))
    expect(out.perNode.gw.traitCounters.reconnectHandshakes).toBe(100_000)
  })
})

// ───────────────────────── 5. The browser agrees ─────────────────────────

test.describe('RT-05 the browser shows the push cost the engine computed', () => {
  test('1,000 recipients per push shows a p50 of about 11 ms', async ({ page }) => {
    const t = gateway(
      'rt05',
      { heldConnections: 1000, pushRecipients: 1000, pushSendMs: 0.01 },
      1,
      { durationMs: 20_000 }
    )
    const out = runEngine(t)
    expect(Math.abs(out.summary.latency.p50 - 11)).toBeLessThan(0.3)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const text = await bodyText(page)
    const m = text.match(/\np50\s*\n([\d.,]+)\s*(ms|s)\b/)
    expect(m, 'a p50 with a unit').not.toBeNull()
    const uiMs = Number(m![1].replace(/,/g, '')) * (m![2] === 's' ? 1000 : 1)
    expect(relErr(uiMs, out.summary.latency.p50)).toBeLessThan(0.03)
  })
})
