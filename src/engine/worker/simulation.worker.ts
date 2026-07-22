import { SimulationEngine } from '../engine'
import type { EdgeFlowEvent } from '../core/events'
import type { TimeSeriesSnapshot } from '../analysis/output'
import type { WorkerInboundMessage, WorkerOutboundMessage } from './protocols'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Events processed per chunk before yielding to allow incoming messages. */
const CHUNK_SIZE = 5_000
const EDGE_FLOW_BATCH_SIZE = 5_000

// ─── State ────────────────────────────────────────────────────────────────────

let engine: SimulationEngine | null = null
let paused = false
let stopped = false
let running = false
let pendingEdgeFlowEvents: EdgeFlowEvent[] = []
let pendingProgress: { percent: number; eventsProcessed: number } | null = null
let pendingSnapshot: TimeSeriesSnapshot | null = null

// ─── Helpers ──────────────────────────────────────────────────────────────────

function post(msg: WorkerOutboundMessage): void {
  self.postMessage(msg)
}

function flushEdgeFlowEvents(): void {
  if (pendingEdgeFlowEvents.length === 0) {
    return
  }

  const events = pendingEdgeFlowEvents
  pendingEdgeFlowEvents = []
  post({ type: 'edge-flow-batch', payload: { events } })
}

function queueEdgeFlowEvent(event: EdgeFlowEvent): void {
  pendingEdgeFlowEvents.push(event)
  if (pendingEdgeFlowEvents.length >= EDGE_FLOW_BATCH_SIZE) {
    flushEdgeFlowEvents()
  }
}

function flushLiveTelemetry(): void {
  if (pendingSnapshot) {
    post({ type: 'snapshot', payload: { snapshot: pendingSnapshot } })
    pendingSnapshot = null
  }

  if (pendingProgress) {
    post({ type: 'progress', payload: pendingProgress })
    pendingProgress = null
  }

  flushEdgeFlowEvents()
}

function reset(): void {
  engine = null
  paused = false
  stopped = false
  running = false
  pendingEdgeFlowEvents = []
  pendingProgress = null
  pendingSnapshot = null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Chunked execution loop ───────────────────────────────────────────────────
// engine.run() is fully synchronous and cannot be interrupted. Instead, we
// drive the engine with step() in CHUNK_SIZE increments and yield between
// each chunk so that pause/stop messages can be processed.

async function runChunked(): Promise<void> {
  if (!engine) return

  try {
    while (engine.hasPendingEvents() && !stopped) {
      // Honour pause: spin-wait (in 50ms increments) until resumed or stopped
      while (paused && !stopped) {
        await sleep(50)
      }
      if (stopped) break

      engine.step(CHUNK_SIZE)
      flushLiveTelemetry()

      // Yield to the message loop so incoming messages are processed
      await sleep(0)
    }

    if (engine) {
      flushLiveTelemetry()
      const output = engine.getResults()
      post({ type: 'complete', payload: { output, stopped } })
    }
  } catch (err) {
    const e = err as Error
    flushLiveTelemetry()
    post({ type: 'error', payload: { message: e.message, stack: e.stack } })
  } finally {
    reset()
  }
}

// ─── Message loop ─────────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data

  switch (msg.type) {
    case 'run': {
      if (running) {
        post({ type: 'error', payload: { message: 'Simulation already running.' } })
        return
      }

      reset()
      running = true

      try {
        engine = new SimulationEngine(msg.payload.topology)
      } catch (err) {
        const e = err as Error
        post({ type: 'error', payload: { message: e.message, stack: e.stack } })
        reset()
        return
      }

      // Wire progress and snapshot callbacks — these fire inside engine.step()
      engine.onProgress = (percent, eventsProcessed) => {
        pendingProgress = { percent, eventsProcessed }
      }

      engine.onSnapshot = (snapshot) => {
        pendingSnapshot = snapshot
      }

      engine.onEdgeFlowEvent = (event) => {
        queueEdgeFlowEvent(event)
      }

      // Kick off the chunked execution loop (async, doesn't block the thread)
      runChunked()
      break
    }

    case 'pause': {
      paused = true
      break
    }

    case 'resume': {
      paused = false
      break
    }

    case 'stop': {
      stopped = true
      paused = false // unblock any spin-wait
      break
    }

    case 'step': {
      if (!engine) {
        post({ type: 'error', payload: { message: 'No simulation loaded. Send "run" first.' } })
        return
      }
      if (running && !paused) {
        post({ type: 'error', payload: { message: 'Step only works while paused.' } })
        return
      }

      try {
        engine.step(msg.payload.count)
        flushLiveTelemetry()
        if (!engine.hasPendingEvents()) {
          const output = engine.getResults()
          post({ type: 'complete', payload: { output } })
          reset()
        }
      } catch (err) {
        const e = err as Error
        flushLiveTelemetry()
        post({ type: 'error', payload: { message: e.message, stack: e.stack } })
        reset()
      }
      break
    }
  }
}
