import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine/engine'
import type { EdgeDefinition, TopologyJSON } from '../engine/core/types'
import { palette } from './ansi'
import {
  bottleneckNodeId,
  classifyNode,
  renderLiveFrame,
  renderPlainProgressLine,
  runLive,
  UtilizationWindow,
  type LiveFrameState,
  type LiveInputStream,
  type LiveNodeRow
} from './live'

function edge(id: string, source: string, target: string): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(durationMs = 3_000): TopologyJSON {
  return {
    id: 'live',
    name: 'live',
    version: '2.0.0',
    global: {
      simulationDuration: durationMs,
      seed: 'live-seed',
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1_000
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
      {
        id: 'api',
        type: 'microservice',
        category: 'compute',
        role: 'processor',
        label: 'api',
        position: { x: 120, y: 0 },
        queue: { workers: 1, capacity: 10, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 }
      }
    ],
    edges: [edge('client-api', 'client', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1_024 }]
    }
  } as TopologyJSON
}

function row(id: string, utilization: number, extra: Partial<LiveNodeRow> = {}): LiveNodeRow {
  return {
    id,
    label: id,
    status: 'busy',
    utilization,
    queueLength: 0,
    totalInSystem: 0,
    ...extra
  }
}

function frame(nodes: LiveNodeRow[], extra: Partial<LiveFrameState> = {}): LiveFrameState {
  return {
    topologyName: 'demo',
    simTimeMs: 15_200,
    durationMs: 60_000,
    warmupMs: 5_000,
    percent: 25.3,
    eventsProcessed: 123_456,
    wallMs: 1_500,
    paused: false,
    interactive: true,
    nodes,
    ...extra
  }
}

class FakeOut {
  chunks: string[] = []
  isTTY = true
  rows = 40
  write(chunk: string) {
    this.chunks.push(chunk)
    return true
  }
  get text() {
    return this.chunks.join('')
  }
}

class FakeInput implements LiveInputStream {
  isTTY = true
  rawModes: boolean[] = []
  private listener: ((data: Buffer | string) => void) | undefined
  setRawMode(mode: boolean) {
    this.rawModes.push(mode)
  }
  on(_event: 'data', listener: (data: Buffer | string) => void) {
    this.listener = listener
  }
  off() {
    this.listener = undefined
  }
  resume() {
    return undefined
  }
  pause() {
    return undefined
  }
  press(key: string) {
    this.listener?.(key)
  }
  get listening() {
    return this.listener !== undefined
  }
}

describe('classifyNode', () => {
  it('maps utilization and status to the documented indicators', () => {
    expect(classifyNode(0.42, 'busy')).toMatchObject({ symbol: '●', label: 'OK' })
    expect(classifyNode(0.6, 'busy')).toMatchObject({ symbol: '◐', label: 'WARM' })
    expect(classifyNode(0.9, 'busy')).toMatchObject({ symbol: '◉', label: 'HOT' })
    expect(classifyNode(0.97, 'busy')).toMatchObject({ symbol: '✗', label: 'SAT' })
    expect(classifyNode(0.1, 'saturated')).toMatchObject({ label: 'SAT' })
    expect(classifyNode(0, 'failed')).toMatchObject({ symbol: '✗', label: 'FAIL' })
  })
})

describe('bottleneckNodeId', () => {
  it('flags the hottest node only when it is HOT and backed up', () => {
    expect(bottleneckNodeId([row('a', 0.5), row('b', 0.9, { queueLength: 4 })])).toBe('b')
    // Busy but no backlog: not a bottleneck.
    expect(bottleneckNodeId([row('a', 0.99)])).toBeUndefined()
    // Under the HOT threshold.
    expect(bottleneckNodeId([row('a', 0.7, { queueLength: 9 })])).toBeUndefined()
    // Failed nodes are not bottlenecks.
    expect(
      bottleneckNodeId([row('a', 1, { status: 'failed', queueLength: 3 }), row('b', 0.2)])
    ).toBeUndefined()
  })
})

describe('UtilizationWindow', () => {
  it('averages the last N snapshot utilizations per node', () => {
    const window = new UtilizationWindow(2)
    const snap = (u: number) => ({
      timestamp: 0,
      node: {
        a: { queueLength: 0, activeWorkers: 0, totalInSystem: 0, utilization: u, status: 'busy' }
      }
    })
    window.push(snap(1))
    window.push(snap(0))
    expect(window.mean('a')).toBe(0.5)
    window.push(snap(0))
    expect(window.mean('a')).toBe(0)
    expect(window.mean('missing')).toBeUndefined()
  })
})

describe('renderLiveFrame', () => {
  it('renders progress, the node table and the bottleneck flag', () => {
    const lines = renderLiveFrame(
      frame([
        row('gateway', 0.42, { queueLength: 3, queueCapacity: 500 }),
        row('db', 0.97, { queueLength: 148, queueCapacity: 100 })
      ]),
      { palette: palette(false) }
    )
    const text = lines.join('\n')
    expect(text).toContain('t=15.2s / 60.0s')
    expect(text).toContain(' 25%')
    expect(text).toContain('123,456 events')
    expect(text).toContain('[measuring]')
    expect(text).toMatch(/gateway\s+● OK\s+42%\s+3\/500/)
    expect(text).toMatch(/db\s+✗ SAT\s+97%\s+148\/100\s+0 {2}<- bottleneck/)
    expect(text).toContain('q stop  p pause/resume')
    expect(text).not.toContain('\u001b[')
  })

  it('shows the hottest nodes when the table does not fit the terminal', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => row(`n${i}`, i / 10))
    const text = renderLiveFrame(frame(nodes), { palette: palette(false), rows: 11 }).join('\n')
    expect(text).toContain('n9')
    expect(text).not.toMatch(/^n0 /m)
    expect(text).toContain('... 6 more nodes (hottest shown)')
  })

  it('marks paused runs and colours status when enabled', () => {
    const text = renderLiveFrame(frame([row('a', 0.9)], { paused: true }), {
      palette: palette(true)
    }).join('\n')
    expect(text).toContain('PAUSED')
    expect(text).toContain('\u001b[35m◉ HOT')
  })
})

describe('renderPlainProgressLine', () => {
  it('is a single escape-free line naming the hottest node', () => {
    const line = renderPlainProgressLine(frame([row('a', 0.2), row('b', 0.9, { queueLength: 2 })]))
    expect(line).toBe('[live] t=15.2s/60.0s  25%  123,456 events  hottest b 90% q=2 (bottleneck)')
  })
})

describe('runLive', () => {
  it('produces the same output as engine.run() and redraws on the alternate screen', async () => {
    const t = topology()
    const expected = new SimulationEngine(t).run()
    const out = new FakeOut()
    const result = await runLive(new SimulationEngine(t), t, {
      out,
      ansi: true,
      palette: palette(false),
      chunkSize: 100,
      renderIntervalMs: 0
    })
    expect(result.stoppedByUser).toBe(false)
    expect(
      JSON.stringify(result.output, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    ).toBe(JSON.stringify(expected, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    expect(out.text.startsWith('\u001b[?1049h')).toBe(true)
    expect(out.text.endsWith('\u001b[?25h\u001b[?1049l')).toBe(true)
    expect(out.text.split('\u001b[H').length).toBeGreaterThan(3)
    expect(out.text).toContain('100%')
  })

  it('prints one plain line per 10% when ansi is off', async () => {
    const t = topology()
    const out = new FakeOut()
    await runLive(new SimulationEngine(t), t, {
      out,
      ansi: false,
      palette: palette(false),
      chunkSize: 50,
      renderIntervalMs: 0
    })
    const lines = out.text.trim().split('\n')
    expect(lines.every((line) => line.startsWith('[live] '))).toBe(true)
    expect(lines.at(-1)).toContain('100%')
    expect(out.text).not.toContain('\u001b')
  })

  it('q stops the run early, restores the terminal and still returns results', async () => {
    const t = topology(60_000)
    const input = new FakeInput()
    const engine = new SimulationEngine(t)
    let steps = 0
    const step = engine.step.bind(engine)
    engine.step = (count: number) => {
      step(count)
      steps += 1
      if (steps === 3) input.press('q')
    }
    const result = await runLive(engine, t, {
      out: new FakeOut(),
      input,
      ansi: true,
      palette: palette(false),
      chunkSize: 100,
      renderIntervalMs: 0
    })
    expect(result.stoppedByUser).toBe(true)
    expect(result.stoppedAtMs).toBeLessThan(60_000)
    expect(result.output.summary.totalRequests).toBeGreaterThan(0)
    expect(input.rawModes).toEqual([true, false])
    expect(input.listening).toBe(false)
  })

  it('p pauses and resumes; Ctrl-C calls onInterrupt after restoring', async () => {
    const t = topology(60_000)
    const input = new FakeInput()
    const engine = new SimulationEngine(t)
    let steps = 0
    const step = engine.step.bind(engine)
    engine.step = (count: number) => {
      step(count)
      steps += 1
      if (steps === 2) {
        input.press('p')
        setTimeout(() => input.press('p'), 120)
      }
      if (steps === 4) input.press('\u0003')
    }
    let interrupted = false
    const out = new FakeOut()
    const result = await runLive(engine, t, {
      out,
      input,
      ansi: true,
      palette: palette(false),
      chunkSize: 100,
      renderIntervalMs: 0,
      onInterrupt: () => {
        interrupted = true
      }
    })
    expect(out.text).toContain('PAUSED')
    expect(steps).toBe(4)
    expect(interrupted).toBe(true)
    expect(result.stoppedByUser).toBe(false)
    expect(input.rawModes).toEqual([true, false])
  })
})
