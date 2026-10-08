import { SimulationEngine } from '../engine'
import { runSimulation, resolveEvaluationMode } from '../runSimulation'
import { runFluidSimulation, fluidRepresentativeTraffic } from '../analysis/fluidSimulation'
import { gradeAttemptWithArtifacts } from '../analysis/question'
import { validateTopology } from '../validation/validator'
import type { TopologyJSON } from '../core/types'
import type { EdgeFlowEvent } from '../core/events'
import type { SimulationOutput, TimeSeriesSnapshot } from '../analysis/output'
import type { RequestOutcomeRecord } from '../core/event-stream'
import {
  DEFAULT_PLAYBACK_SPEED,
  isValidPlaybackSpeed,
  type PlaybackSpeed,
  type WorkerErrorCode,
  type WorkerInboundMessage,
  type WorkerOutboundMessage
} from './protocols'

/**
 * The simulation worker's behaviour, independent of the `self` global so it can
 * be unit-tested in Node. `simulation.worker.ts` wires it to the real worker
 * scope. See protocols.ts for the message contract (speed, stop, validation).
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Events processed per chunk before yielding to allow incoming messages. */
export const CHUNK_SIZE = 5_000
const LIVE_TELEMETRY_INTERVAL_MS = 100
const EDGE_FLOW_MAX_PENDING_EVENTS = 25_000
const MAX_RETAINED_REQUEST_OUTCOMES = 25_000
/** Longest single wait while paused or while a paced run waits for its next event. */
const MAX_IDLE_WAIT_MS = 50

export interface WorkerControllerDeps {
  post: (msg: WorkerOutboundMessage) => void
  /** Wall clock in ms. Injectable so pacing can be tested deterministically. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface WorkerController {
  handleMessage: (msg: WorkerInboundMessage) => void
  /** Resolves when the current chunked run (if any) has posted its terminal message. */
  idle: () => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sampleRequestOutcomes(outcomes: RequestOutcomeRecord[]): RequestOutcomeRecord[] {
  if (outcomes.length <= MAX_RETAINED_REQUEST_OUTCOMES) {
    return outcomes
  }

  const stride = Math.ceil(outcomes.length / MAX_RETAINED_REQUEST_OUTCOMES)
  const sampled: RequestOutcomeRecord[] = []

  for (
    let index = 0;
    index < outcomes.length && sampled.length < MAX_RETAINED_REQUEST_OUTCOMES;
    index += stride
  ) {
    sampled.push(outcomes[index])
  }

  const last = outcomes[outcomes.length - 1]
  if (last && sampled[sampled.length - 1]?.requestId !== last.requestId) {
    sampled[sampled.length - 1] = last
  }

  return sampled
}

function prepareOutputForTransport(output: SimulationOutput): SimulationOutput {
  if (output.requestOutcomes.length <= MAX_RETAINED_REQUEST_OUTCOMES) {
    return output
  }

  return {
    ...output,
    requestOutcomeTotal: output.requestOutcomeTotal,
    requestOutcomesSampled: true,
    requestOutcomes: sampleRequestOutcomes(output.requestOutcomes)
  }
}

export function createWorkerController(deps: WorkerControllerDeps): WorkerController {
  const post = deps.post
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? defaultSleep

  // ─── State ──────────────────────────────────────────────────────────────────

  let engine: SimulationEngine | null = null
  let paused = false
  let stopped = false
  let running = false
  let speed: PlaybackSpeed = DEFAULT_PLAYBACK_SPEED
  /** Wall/sim anchor for paced runs; reset on speed change and on resume. */
  let paceAnchor: { wallMs: number; simMs: number } | null = null
  let pendingEdgeFlowEvents: EdgeFlowEvent[] = []
  let pendingProgress: { percent: number; eventsProcessed: number } | null = null
  // Every snapshot is forwarded (they are 1 per simulated second), so the
  // renderer's history has no gaps for windowed, time-weighted metrics.
  let pendingSnapshots: TimeSeriesSnapshot[] = []
  let lastTelemetryFlushAtMs = 0
  let currentLoop: Promise<void> = Promise.resolve()

  function postError(
    code: WorkerErrorCode,
    message: string,
    extra: Partial<Extract<WorkerOutboundMessage, { type: 'error' }>['payload']> = {}
  ): void {
    post({ type: 'error', payload: { message, code, ...extra } })
  }

  function flushEdgeFlowEvents(): void {
    if (pendingEdgeFlowEvents.length === 0) {
      return
    }
    const events = pendingEdgeFlowEvents
    pendingEdgeFlowEvents = []
    post({ type: 'edge-flow-batch', payload: { events } })
  }

  function flushLiveTelemetry(force = false): void {
    const wallNow = now()
    const pendingEventPressure = pendingEdgeFlowEvents.length >= EDGE_FLOW_MAX_PENDING_EVENTS
    if (
      !force &&
      !pendingEventPressure &&
      wallNow - lastTelemetryFlushAtMs < LIVE_TELEMETRY_INTERVAL_MS
    ) {
      return
    }

    for (const snapshot of pendingSnapshots) {
      post({ type: 'snapshot', payload: { snapshot } })
    }
    pendingSnapshots = []

    if (pendingProgress) {
      post({ type: 'progress', payload: pendingProgress })
      pendingProgress = null
    }

    flushEdgeFlowEvents()
    lastTelemetryFlushAtMs = wallNow
  }

  function reset(): void {
    engine = null
    paused = false
    stopped = false
    running = false
    speed = DEFAULT_PLAYBACK_SPEED
    paceAnchor = null
    pendingEdgeFlowEvents = []
    pendingProgress = null
    pendingSnapshots = []
    lastTelemetryFlushAtMs = 0
  }

  function postComplete(active: SimulationEngine, wasStopped: boolean): void {
    flushLiveTelemetry(true)
    const output = prepareOutputForTransport(active.getResults())
    post({ type: 'complete', payload: { output, stopped: wasStopped } })
  }

  /**
   * Advance one slice. 'max' processes a full chunk. A paced speed processes only
   * the events due by the wall-clock target; when nothing is due yet it waits
   * (bounded, so pause/stop/set-speed stay responsive).
   */
  async function advance(active: SimulationEngine): Promise<void> {
    if (speed === 'max') {
      active.step(CHUNK_SIZE)
      return
    }

    const wallNow = now()
    if (!paceAnchor) {
      paceAnchor = { wallMs: wallNow, simMs: active.getClockMs() }
    }
    const targetSimMs = paceAnchor.simMs + (wallNow - paceAnchor.wallMs) * speed
    const nextMs = active.peekNextEventTimeMs()
    if (nextMs !== null && nextMs > targetSimMs) {
      const waitMs = Math.min(MAX_IDLE_WAIT_MS, Math.max(1, (nextMs - targetSimMs) / speed))
      await sleep(waitMs)
      return
    }
    active.stepUntil(targetSimMs, CHUNK_SIZE)
  }

  // engine.run() is fully synchronous and cannot be interrupted. Instead, drive
  // the engine with step()/stepUntil() and yield between slices so that pause,
  // stop and set-speed messages are processed.
  async function runChunked(active: SimulationEngine): Promise<void> {
    try {
      while (active.hasPendingEvents() && !stopped) {
        if (paused) {
          while (paused && !stopped) {
            flushLiveTelemetry(true)
            await sleep(MAX_IDLE_WAIT_MS)
          }
          // Re-anchor after a pause so a paced run does not sprint to catch up.
          paceAnchor = null
          continue
        }

        await advance(active)
        flushLiveTelemetry()

        // Yield to the message loop so incoming messages are processed
        await sleep(0)
      }

      // A saturation halt ends here too: the engine reports no pending events
      // once halted, and the output carries stopReason 'saturation'.
      postComplete(active, stopped)
    } catch (err) {
      const e = err as Error
      flushLiveTelemetry(true)
      postError('engine-error', e.message, { stack: e.stack })
    } finally {
      reset()
    }
  }

  /**
   * Analytic run: no per-request simulation. Compute the steady-state output with
   * the fluid model, stream a capped set of representative edge-flow dots (so the
   * canvas still animates), then post the completed output. The dots are cosmetic -
   * the real numbers are in `output`, and `output.requestsPerDot` tells the UI how
   * many requests each dot stands for.
   */
  function runAnalytic(topology: TopologyJSON): void {
    try {
      const output = runFluidSimulation(topology)
      const { events } = fluidRepresentativeTraffic(topology)

      const BATCH = 500
      for (let i = 0; i < events.length; i += BATCH) {
        post({ type: 'edge-flow-batch', payload: { events: events.slice(i, i + BATCH) } })
      }

      post({
        type: 'complete',
        payload: { output: prepareOutputForTransport(output), stopped }
      })
    } catch (err) {
      const e = err as Error
      postError('engine-error', e.message, { stack: e.stack })
    } finally {
      reset()
    }
  }

  function handleRun(topology: TopologyJSON, requestedSpeed: PlaybackSpeed | undefined): void {
    if (running) {
      postError('already-running', 'Simulation already running.', { recoverable: true })
      return
    }
    if (requestedSpeed !== undefined && !isValidPlaybackSpeed(requestedSpeed)) {
      postError('invalid-speed', `Invalid playback speed: ${String(requestedSpeed)}.`)
      return
    }

    // Never trust that the renderer validated: reject an invalid topology here
    // with the same validator, instead of letting the engine throw mid-run.
    const validation = validateTopology(topology)
    if (!validation.valid) {
      const validationErrors = validation.errors ?? []
      postError(
        'invalid-topology',
        validationErrors.length > 0
          ? `Topology validation failed: ${validationErrors.map((e) => e.message).join('; ')}`
          : 'Topology validation failed.',
        { validationErrors }
      )
      return
    }

    reset()
    running = true
    speed = requestedSpeed ?? DEFAULT_PLAYBACK_SPEED

    if (resolveEvaluationMode(topology) === 'analytic') {
      runAnalytic(topology)
      return
    }

    let active: SimulationEngine
    try {
      active = new SimulationEngine(topology)
    } catch (err) {
      const e = err as Error
      postError('engine-error', e.message, { stack: e.stack })
      reset()
      return
    }
    engine = active

    // These fire inside engine.step()
    active.onProgress = (percent, eventsProcessed) => {
      pendingProgress = { percent, eventsProcessed }
    }
    active.onSnapshot = (snapshot) => {
      pendingSnapshots.push(snapshot)
    }
    active.onEdgeFlowEvent = (event) => {
      pendingEdgeFlowEvents.push(event)
    }

    currentLoop = runChunked(active)
  }

  function handleStep(count: number): void {
    if (!engine) {
      postError('not-loaded', 'No simulation loaded. Send "run" first.', { recoverable: true })
      return
    }
    if (running && !paused) {
      postError('step-while-running', 'Step only works while paused.', { recoverable: true })
      return
    }

    try {
      engine.step(count)
      flushLiveTelemetry(true)
      // A halted engine reports no pending events, so stepping past a
      // saturation halt completes the run instead of resuming it.
      if (!engine.hasPendingEvents()) {
        // Unblock the paused loop; it posts the terminal `complete`.
        paused = false
      }
    } catch (err) {
      const e = err as Error
      flushLiveTelemetry(true)
      postError('engine-error', e.message, { stack: e.stack })
      stopped = true
      paused = false
    }
  }

  function handleMessage(msg: WorkerInboundMessage): void {
    switch (msg.type) {
      case 'run':
        handleRun(msg.payload.topology, msg.payload.speed)
        break

      case 'grade': {
        if (running) {
          postError('already-running', 'Simulation already running.', { recoverable: true })
          return
        }
        // Runs the whole question suite synchronously inside the worker - blocks the
        // worker thread (not the main thread), no live telemetry, then returns the grade.
        try {
          const { grade, cases } = gradeAttemptWithArtifacts(
            msg.payload.question,
            msg.payload.topology,
            (topology) => runSimulation(topology),
            msg.payload.justificationAnswers ?? []
          )
          post({ type: 'grade-complete', payload: { grade, cases } })
        } catch (err) {
          const e = err as Error
          postError('engine-error', e.message, { stack: e.stack })
        }
        break
      }

      case 'pause':
        if (running) paused = true
        break

      case 'resume':
        paused = false
        break

      case 'stop':
        if (running) {
          stopped = true
          paused = false // unblock the pause wait
        }
        break

      case 'set-speed':
        if (!isValidPlaybackSpeed(msg.payload.speed)) {
          postError('invalid-speed', `Invalid playback speed: ${String(msg.payload.speed)}.`, {
            recoverable: true
          })
          return
        }
        speed = msg.payload.speed
        paceAnchor = null
        break

      case 'step':
        handleStep(msg.payload.count)
        break
    }
  }

  return {
    handleMessage,
    idle: () => currentLoop
  }
}
