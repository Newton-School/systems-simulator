import { useState, useRef, useCallback, useEffect } from 'react'
import type { SimulationOutput, TimeSeriesSnapshot } from '../../../engine/analysis/output'
import type { TopologyJSON } from '../../../engine/core/types'
import {
  DEFAULT_PLAYBACK_SPEED,
  isValidPlaybackSpeed,
  type PlaybackSpeed,
  type WorkerInboundMessage,
  type WorkerOutboundMessage
} from '../../../engine/worker/protocols'
import useStore from '@renderer/store/useStore'

export type { PlaybackSpeed }

/**
 * Snapshot history cap. The engine snapshots once per simulated second, so this
 * keeps the last 10 simulated minutes; older snapshots are dropped first (ring
 * semantics), so memory stays bounded however long the run is.
 */
export const SNAPSHOT_HISTORY_LIMIT = 600

/** Append with a cap, dropping the oldest entries (immutable, for React state). */
export function appendBounded<T>(history: T[], item: T, limit = SNAPSHOT_HISTORY_LIMIT): T[] {
  const next = history.length >= limit ? history.slice(history.length - limit + 1) : history.slice()
  next.push(item)
  return next
}

/** The dot display rate that matches a worker speed (null = legacy replay rate). */
function displayRateFor(speed: PlaybackSpeed): number | null {
  return speed === 'max' ? null : speed
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SimulationStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error'

export interface SimulationState {
  status: SimulationStatus
  progress: number // 0–100
  eventsProcessed: number
  runStartedAtMs: number | null
  /** Latest snapshot (kept for existing callers). */
  snapshot: TimeSeriesSnapshot | null
  /** Snapshot history for this run, oldest first, capped at SNAPSHOT_HISTORY_LIMIT. */
  snapshots: TimeSeriesSnapshot[]
  /** Snapshots dropped from the front of `snapshots` by the cap. */
  snapshotsDropped: number
  /** Simulated ms per wall ms, or 'max' (as fast as possible, the default). */
  playbackSpeed: PlaybackSpeed
  /** The topology of the current / last run. */
  topology: TopologyJSON | null
  /** Final output; `result` is an alias for the same object. */
  results: SimulationOutput | null
  result: SimulationOutput | null
  stopped: boolean
  error: string | null
}

export interface SimulationControls {
  /** Start a run. `options.speed` defaults to the current `playbackSpeed`. */
  run: (topology: TopologyJSON, options?: { speed?: PlaybackSpeed }) => void
  /** Change playback speed; applies mid-run and to the next run. */
  setPlaybackSpeed: (speed: PlaybackSpeed) => void
  pause: () => void
  resume: () => void
  stop: () => void
  step: (count?: number) => void
  reset: () => void
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: SimulationState = {
  status: 'idle',
  progress: 0,
  eventsProcessed: 0,
  runStartedAtMs: null,
  snapshot: null,
  snapshots: [],
  snapshotsDropped: 0,
  playbackSpeed: DEFAULT_PLAYBACK_SPEED,
  topology: null,
  results: null,
  result: null,
  stopped: false,
  error: null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSimulation(): SimulationState & SimulationControls {
  const [state, setState] = useState<SimulationState>(INITIAL_STATE)
  const workerRef = useRef<Worker | null>(null)
  const speedRef = useRef<PlaybackSpeed>(DEFAULT_PLAYBACK_SPEED)

  // Tear down the worker when the component unmounts
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  // ─── Worker factory ─────────────────────────────────────────────────────────

  function spawnWorker(): Worker {
    const worker = new Worker(
      new URL('../../../engine/worker/simulation.worker.ts', import.meta.url),
      { type: 'module' }
    )

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data
      switch (msg.type) {
        case 'progress':
          setState((s) => ({
            ...s,
            progress: msg.payload.percent,
            eventsProcessed: msg.payload.eventsProcessed
          }))
          break

        case 'snapshot':
          setState((s) => ({
            ...s,
            snapshot: msg.payload.snapshot,
            snapshots: appendBounded(s.snapshots, msg.payload.snapshot),
            snapshotsDropped:
              s.snapshotsDropped + (s.snapshots.length >= SNAPSHOT_HISTORY_LIMIT ? 1 : 0)
          }))
          break

        case 'edge-flow-batch':
          useStore.getState().recordEdgeFlowEventBatch(msg.payload.events)
          break

        case 'complete':
          useStore.getState().setEdgeFlowStatus('complete')
          useStore.getState().selectGraphElements({})
          useStore.getState().setRunInspectorPinned(true)
          // Publish the run output so the always-on cost chip can switch its
          // consumption/egress estimates to measured figures.
          useStore.getState().setLastRunOutput(msg.payload.output)
          setState((s) => ({
            ...s,
            status: 'complete',
            progress: msg.payload.stopped ? s.progress : 100,
            eventsProcessed: msg.payload.output.eventsProcessed,
            results: msg.payload.output,
            result: msg.payload.output,
            stopped: msg.payload.stopped ?? false,
            error: null
          }))
          workerRef.current?.terminate()
          workerRef.current = null
          break

        case 'error':
          // Rejected commands (e.g. step while running) leave the run intact.
          if (msg.payload.recoverable) {
            console.warn(`[simulation] ${msg.payload.message}`)
            break
          }
          setState((s) => ({
            ...s,
            status: 'error',
            error: msg.payload.message
          }))
          workerRef.current?.terminate()
          workerRef.current = null
          break
      }
    }

    worker.onerror = (err) => {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err.message ?? 'Unknown worker error'
      }))
      workerRef.current?.terminate()
      workerRef.current = null
    }

    return worker
  }

  // ─── Post helper ────────────────────────────────────────────────────────────

  function postToWorker(msg: WorkerInboundMessage): void {
    workerRef.current?.postMessage(msg)
  }

  // ─── Controls ───────────────────────────────────────────────────────────────

  const run = useCallback((topology: TopologyJSON, options?: { speed?: PlaybackSpeed }) => {
    const speed =
      options?.speed !== undefined && isValidPlaybackSpeed(options.speed)
        ? options.speed
        : speedRef.current
    speedRef.current = speed
    // Terminate any existing worker before starting a new one
    workerRef.current?.terminate()
    workerRef.current = spawnWorker()
    useStore.getState().selectGraphElements({})
    useStore.getState().setRunInspectorPinned(false)
    useStore.getState().setEdgeFlowPlaybackRate(displayRateFor(speed))

    setState({
      ...INITIAL_STATE,
      status: 'running',
      runStartedAtMs: Date.now(),
      playbackSpeed: speed,
      topology
    })

    workerRef.current.postMessage({
      type: 'run',
      payload: { topology, speed }
    } satisfies WorkerInboundMessage)
  }, [])

  const setPlaybackSpeed = useCallback((speed: PlaybackSpeed) => {
    if (!isValidPlaybackSpeed(speed)) return
    speedRef.current = speed
    postToWorker({ type: 'set-speed', payload: { speed } })
    if (workerRef.current) {
      useStore.getState().setEdgeFlowPlaybackRate(displayRateFor(speed))
    }
    setState((s) => ({ ...s, playbackSpeed: speed }))
  }, [])

  const pause = useCallback(() => {
    postToWorker({ type: 'pause' })
    setState((s) => ({ ...s, status: 'paused' }))
  }, [])

  const resume = useCallback(() => {
    postToWorker({ type: 'resume' })
    // Re-anchor the dot display clock so paced dots do not replay the pause.
    useStore.getState().setEdgeFlowPlaybackRate(displayRateFor(speedRef.current))
    setState((s) => ({ ...s, status: 'running' }))
  }, [])

  const stop = useCallback(() => {
    postToWorker({ type: 'stop' })
    setState((s) => ({ ...s, status: 'paused', stopped: true }))
  }, [])

  const step = useCallback((count = 1) => {
    postToWorker({ type: 'step', payload: { count } })
    useStore.getState().setEdgeFlowPlaybackRate(displayRateFor(speedRef.current))
  }, [])

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    useStore.getState().clearEdgeFlow()
    useStore.getState().setLastRunOutput(null)
    useStore.getState().setTracedRequestIds([])
    // Keep the chosen speed across resets; it is a preference, not run state.
    setState({ ...INITIAL_STATE, playbackSpeed: speedRef.current })
  }, [])

  return { ...state, run, setPlaybackSpeed, pause, resume, stop, step, reset }
}
