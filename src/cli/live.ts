// `sim run --live`: drives the engine in chunks (`engine.step`) and redraws a
// live table of per-node state after each chunk, like `htop` / `docker stats`.
// On a terminal it uses the alternate screen (cleared on exit, so the normal
// final report prints afterwards); anywhere else it degrades to one plain
// progress line per 10% of simulated time, with no escape codes.

import type { TopologyJSON } from '../engine/core/types'
import type { SimulationOutput, TimeSeriesSnapshot } from '../engine/analysis/output'
import { padEndVisible, padStartVisible, truncate, type Palette } from './ansi'

export interface LiveEngine {
  onProgress?: (percent: number, eventsProcessed: number) => void
  onSnapshot?: (snapshot: TimeSeriesSnapshot) => void
  step(count: number): void
  hasPendingEvents(): boolean
  stop(): void
  getResults(): SimulationOutput
  getEventsProcessed(): number
  getStopReason?(): string
}

export interface LiveNodeRow {
  id: string
  label: string
  status: string
  /** Mean of the last few 1s snapshot utilizations (see UTILIZATION_WINDOW). */
  utilization: number
  queueLength: number
  queueCapacity?: number
  totalInSystem: number
}

export interface LiveFrameState {
  topologyName: string
  simTimeMs: number
  durationMs: number
  warmupMs: number
  percent: number
  eventsProcessed: number
  wallMs: number
  paused: boolean
  /** Whether q / p keys are live (stdin is a raw-mode terminal). */
  interactive: boolean
  nodes: LiveNodeRow[]
}

export type NodeTone = 'ok' | 'warm' | 'hot' | 'saturated' | 'failed'

export interface NodeIndicator {
  tone: NodeTone
  symbol: string
  label: string
}

/** Status thresholds on instantaneous utilization (at the latest 1s snapshot). */
export function classifyNode(utilization: number, status: string): NodeIndicator {
  if (status === 'failed') return { tone: 'failed', symbol: '✗', label: 'FAIL' }
  if (status === 'saturated' || utilization >= 0.95) {
    return { tone: 'saturated', symbol: '✗', label: 'SAT' }
  }
  if (utilization >= 0.85) return { tone: 'hot', symbol: '◉', label: 'HOT' }
  if (utilization >= 0.6) return { tone: 'warm', symbol: '◐', label: 'WARM' }
  return { tone: 'ok', symbol: '●', label: 'OK' }
}

/** Utilization at or above which the hottest node is flagged as the bottleneck. */
export const BOTTLENECK_UTILIZATION = 0.85

/**
 * Snapshots are point samples (a single-worker node reads 0% or 100%), so the
 * live Util column averages the last few of them. The final report still uses
 * the engine's time-weighted utilization.
 */
export const UTILIZATION_WINDOW = 5

/**
 * The node to flag: the hottest non-failed node, when it is at least HOT and has
 * a standing backlog (queue > 0 or saturated) - the same "busy and backed up"
 * test the engine's saturation guard uses, so a node that is merely busy is not
 * called a bottleneck.
 */
export function bottleneckNodeId(nodes: readonly LiveNodeRow[]): string | undefined {
  let best: LiveNodeRow | undefined
  for (const node of nodes) {
    if (node.status === 'failed') continue
    if (!best || node.utilization > best.utilization) best = node
  }
  if (!best || best.utilization < BOTTLENECK_UTILIZATION) return undefined
  return best.queueLength > 0 || best.status === 'saturated' ? best.id : undefined
}

/** Rolling per-node utilization over the last `size` snapshots. */
export class UtilizationWindow {
  private readonly samples = new Map<string, number[]>()

  constructor(private readonly size = UTILIZATION_WINDOW) {}

  push(snapshot: TimeSeriesSnapshot): void {
    for (const [nodeId, state] of Object.entries(snapshot.node)) {
      const list = this.samples.get(nodeId) ?? []
      list.push(state.utilization)
      if (list.length > this.size) list.shift()
      this.samples.set(nodeId, list)
    }
  }

  mean(nodeId: string): number | undefined {
    const list = this.samples.get(nodeId)
    if (!list || list.length === 0) return undefined
    return list.reduce((sum, value) => sum + value, 0) / list.length
  }
}

export function nodeRowsFromSnapshot(
  topology: TopologyJSON,
  snapshot: TimeSeriesSnapshot | undefined,
  window?: UtilizationWindow
): LiveNodeRow[] {
  return topology.nodes.map((node) => {
    const state = snapshot?.node[node.id]
    return {
      id: node.id,
      label: node.label || node.id,
      status: state?.status ?? 'idle',
      utilization: window?.mean(node.id) ?? state?.utilization ?? 0,
      queueLength: state?.queueLength ?? 0,
      ...(node.queue?.capacity !== undefined ? { queueCapacity: node.queue.capacity } : {}),
      totalInSystem: state?.totalInSystem ?? 0
    }
  })
}

function progressBar(percent: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function toneColor(tone: NodeTone, c: Palette): string {
  switch (tone) {
    case 'ok':
      return c.green
    case 'warm':
      return c.yellow
    case 'hot':
      return c.magenta
    case 'saturated':
    case 'failed':
      return c.red
  }
}

/**
 * Render one full frame. `rows` caps the node table to the terminal height; when
 * the topology has more nodes than fit, the hottest ones are shown.
 */
export function renderLiveFrame(
  state: LiveFrameState,
  options: { palette: Palette; rows?: number }
): string[] {
  const c = options.palette
  const lines: string[] = []
  const phase =
    state.simTimeMs < state.warmupMs
      ? `${c.dim}[warmup]${c.reset}`
      : `${c.dim}[measuring]${c.reset}`
  const runState = state.paused ? `${c.yellow}${c.bold}PAUSED${c.reset}` : phase
  lines.push(
    `${c.bold}${c.cyan}System Design Simulator${c.reset} ${c.dim}live${c.reset}  ${state.topologyName}`
  )
  lines.push(
    `t=${fmtSeconds(state.simTimeMs)} / ${fmtSeconds(state.durationMs)}  ` +
      `${progressBar(state.percent, 24)} ${String(Math.floor(state.percent)).padStart(3)}%  ` +
      `${state.eventsProcessed.toLocaleString('en-US')} events  ` +
      `${c.dim}wall ${fmtSeconds(state.wallMs)}${c.reset}  ${runState}`
  )
  lines.push('')

  const bottleneck = bottleneckNodeId(state.nodes)
  const reserved = 7 // header lines + table header + footer
  // Unknown/zero height (some pseudo-terminals) means "do not cap".
  const maxNodes =
    options.rows !== undefined && options.rows > 0
      ? Math.max(3, options.rows - reserved)
      : state.nodes.length
  let shown = state.nodes
  let hidden = 0
  if (state.nodes.length > maxNodes) {
    shown = [...state.nodes].sort((x, y) => y.utilization - x.utilization).slice(0, maxNodes)
    hidden = state.nodes.length - shown.length
  }

  const labelW = Math.min(24, Math.max(4, ...shown.map((n) => n.label.length)))
  lines.push(
    `${c.bold}${'Node'.padEnd(labelW)}  ${'Status'.padEnd(7)}  ${'Util'.padStart(5)}` +
      `  ${'Queue'.padStart(11)}  ${'In sys'.padStart(7)}${c.reset}`
  )
  for (const node of shown) {
    const indicator = classifyNode(node.utilization, node.status)
    const color = toneColor(indicator.tone, c)
    const status = `${color}${indicator.symbol} ${indicator.label}${c.reset}`
    const queue =
      node.queueCapacity !== undefined
        ? `${node.queueLength}/${node.queueCapacity}`
        : String(node.queueLength)
    const util = `${color}${(node.utilization * 100).toFixed(0)}%${c.reset}`
    const flag = node.id === bottleneck ? `  ${c.red}${c.bold}<- bottleneck${c.reset}` : ''
    lines.push(
      `${truncate(node.label, labelW).padEnd(labelW)}  ${padEndVisible(status, 7)}` +
        `  ${padStartVisible(util, 5)}  ${queue.padStart(11)}  ${String(node.totalInSystem).padStart(7)}${flag}`
    )
  }
  if (hidden > 0) {
    lines.push(
      `${c.dim}... ${hidden} more node${hidden === 1 ? '' : 's'} (hottest shown)${c.reset}`
    )
  }
  lines.push('')
  lines.push(
    `${c.dim}Util: mean of the last ${UTILIZATION_WINDOW} 1s snapshots; queue and in-system: latest snapshot.` +
      `${state.interactive ? '  q stop  p pause/resume' : ''}${c.reset}`
  )
  return lines
}

/** One escape-free status line for non-terminal output. */
export function renderPlainProgressLine(state: LiveFrameState): string {
  const bottleneck = bottleneckNodeId(state.nodes)
  const hottest = [...state.nodes].sort((x, y) => y.utilization - x.utilization)[0]
  const hot = hottest
    ? `  hottest ${hottest.label} ${(hottest.utilization * 100).toFixed(0)}% q=${hottest.queueLength}` +
      (hottest.id === bottleneck ? ' (bottleneck)' : '')
    : ''
  return (
    `[live] t=${fmtSeconds(state.simTimeMs)}/${fmtSeconds(state.durationMs)} ` +
    `${String(Math.floor(state.percent)).padStart(3)}%  ` +
    `${state.eventsProcessed.toLocaleString('en-US')} events${hot}`
  )
}

export interface LiveOutputStream {
  write(chunk: string): unknown
  isTTY?: boolean
  rows?: number
}

export interface LiveInputStream {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
  on(event: 'data', listener: (data: Buffer | string) => void): unknown
  off(event: 'data', listener: (data: Buffer | string) => void): unknown
  resume(): unknown
  pause(): unknown
}

export interface LiveRunOptions {
  out: LiveOutputStream
  /** Keyboard input; only used when it is a TTY that supports raw mode. */
  input?: LiveInputStream
  /** Render the ANSI live table (true) or plain progress lines (false). */
  ansi: boolean
  palette: Palette
  /** Events per `engine.step` call. */
  chunkSize?: number
  /** Minimum wall time between redraws. */
  renderIntervalMs?: number
  now?: () => number
  /** Called on Ctrl-C after the terminal is restored (default: exit 130). */
  onInterrupt?: () => void
}

export interface LiveRunResult {
  output: SimulationOutput
  /** True when the user pressed q before the run finished. */
  stoppedByUser: boolean
  stoppedAtMs?: number
  wallMs: number
}

const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[?25l'
const LEAVE_ALT_SCREEN = '\x1b[?25h\x1b[?1049l'
const CURSOR_HOME = '\x1b[H'
const CLEAR_LINE_END = '\x1b[K'
const CLEAR_SCREEN_END = '\x1b[J'

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runLive(
  engine: LiveEngine,
  topology: TopologyJSON,
  options: LiveRunOptions
): Promise<LiveRunResult> {
  const now = options.now ?? Date.now
  const chunkSize = options.chunkSize ?? 5_000
  const renderIntervalMs = options.renderIntervalMs ?? 100
  const durationMs = topology.global.simulationDuration
  const start = now()

  let latest: TimeSeriesSnapshot | undefined
  const window = new UtilizationWindow()
  let percent = 0
  let paused = false
  let stopRequested = false
  let interrupted = false
  engine.onSnapshot = (snapshot) => {
    latest = snapshot
    window.push(snapshot)
  }
  engine.onProgress = (pct) => {
    percent = pct
  }

  const input = options.input
  const interactive =
    options.ansi && input?.isTTY === true && typeof input.setRawMode === 'function'
  const onKey = (data: Buffer | string) => {
    const key = data.toString()
    if (key === '\u0003') {
      interrupted = true
      stopRequested = true
    } else if (key === 'q' || key === 'Q') {
      stopRequested = true
    } else if (key === 'p' || key === 'P' || key === ' ') {
      paused = !paused
    }
  }

  const frameState = (): LiveFrameState => ({
    topologyName: topology.name,
    simTimeMs: (percent / 100) * durationMs,
    durationMs,
    warmupMs: topology.global.warmupDuration,
    percent,
    eventsProcessed: engine.getEventsProcessed(),
    wallMs: now() - start,
    paused,
    interactive,
    nodes: nodeRowsFromSnapshot(topology, latest, window)
  })

  let lastPlainBucket = -1
  const draw = () => {
    const state = frameState()
    if (options.ansi) {
      const lines = renderLiveFrame(state, { palette: options.palette, rows: options.out.rows })
      options.out.write(
        CURSOR_HOME + lines.map((line) => line + CLEAR_LINE_END).join('\n') + CLEAR_SCREEN_END
      )
    } else {
      const bucket = Math.floor(state.percent / 10)
      if (bucket > lastPlainBucket) {
        lastPlainBucket = bucket
        options.out.write(renderPlainProgressLine(state) + '\n')
      }
    }
  }

  const restore = () => {
    if (interactive) {
      input!.off('data', onKey)
      input!.setRawMode!(false)
      input!.pause()
    }
    if (options.ansi) options.out.write(LEAVE_ALT_SCREEN)
  }
  const restoreOnExit = () => restore()

  if (options.ansi) options.out.write(ENTER_ALT_SCREEN)
  if (interactive) {
    input!.setRawMode!(true)
    input!.resume()
    input!.on('data', onKey)
  }
  process.once('exit', restoreOnExit)

  try {
    draw()
    let lastDraw = now()
    while (engine.hasPendingEvents() && !stopRequested) {
      if (paused) {
        draw()
        await sleep(50)
        continue
      }
      engine.step(chunkSize)
      // The saturation guard halts inside the engine; a further step() would
      // resume past it, so honour it here the way engine.run() does.
      if (engine.getStopReason?.() === 'saturation') break
      if (now() - lastDraw >= renderIntervalMs) {
        draw()
        lastDraw = now()
      }
      await yieldToEventLoop()
    }
    if (!stopRequested) percent = 100
    draw()
  } finally {
    process.removeListener('exit', restoreOnExit)
    restore()
  }

  if (interrupted) {
    ;(options.onInterrupt ?? (() => process.exit(130)))()
  }

  const stoppedByUser = stopRequested && !interrupted
  const stoppedAtMs = stoppedByUser ? frameState().simTimeMs : undefined
  // Mark the run finished (as engine.run() leaves it) so in-flight spans are
  // flushed into the metrics exactly once, whether it ended or was stopped.
  engine.stop()
  const output = engine.getResults()
  return {
    output,
    stoppedByUser,
    ...(stoppedAtMs !== undefined ? { stoppedAtMs } : {}),
    wallMs: now() - start
  }
}
