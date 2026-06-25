import { useState, useRef, useCallback, useEffect } from 'react'
import type { SimulationOutput, TimeSeriesSnapshot } from '../../../engine/analysis/output'
import type { TopologyJSON } from '../../../engine/core/types'
import type { WorkerInboundMessage, WorkerOutboundMessage } from '../../../engine/worker/protocols'
import useStore from '@renderer/store/useStore'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SimulationStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error'

export interface SimulationState {
  status: SimulationStatus
  progress: number // 0–100
  eventsProcessed: number
  snapshot: TimeSeriesSnapshot | null
  results: SimulationOutput | null
  stopped: boolean
  error: string | null
}

export interface SimulationControls {
  run: (topology: TopologyJSON) => void
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
  snapshot: null,
  results: null,
  stopped: false,
  error: null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSimulation(): SimulationState & SimulationControls {
  const [state, setState] = useState<SimulationState>(INITIAL_STATE)
  const workerRef = useRef<Worker | null>(null)

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
          setState((s) => ({ ...s, snapshot: msg.payload.snapshot }))
          break

        case 'edge-flow':
          useStore.getState().recordEdgeFlowEvent(msg.payload.event)
          break

        case 'complete':
          useStore.getState().setEdgeFlowStatus('complete')
          setState((s) => ({
            ...s,
            status: 'complete',
            progress: msg.payload.stopped ? s.progress : 100,
            eventsProcessed: msg.payload.output.eventsProcessed,
            results: msg.payload.output,
            stopped: msg.payload.stopped ?? false,
            error: null
          }))
          workerRef.current?.terminate()
          workerRef.current = null
          break

        case 'error':
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

  const run = useCallback((topology: TopologyJSON) => {
    // Terminate any existing worker before starting a new one
    workerRef.current?.terminate()
    workerRef.current = spawnWorker()

    setState({
      status: 'running',
      progress: 0,
      eventsProcessed: 0,
      snapshot: null,
      results: null,
      stopped: false,
      error: null
    })

    workerRef.current.postMessage({
      type: 'run',
      payload: { topology }
    } satisfies WorkerInboundMessage)
  }, [])

  const pause = useCallback(() => {
    postToWorker({ type: 'pause' })
    setState((s) => ({ ...s, status: 'paused' }))
  }, [])

  const resume = useCallback(() => {
    postToWorker({ type: 'resume' })
    setState((s) => ({ ...s, status: 'running' }))
  }, [])

  const stop = useCallback(() => {
    postToWorker({ type: 'stop' })
    setState((s) => ({ ...s, status: 'paused', stopped: true }))
  }, [])

  const step = useCallback((count = 1) => {
    postToWorker({ type: 'step', payload: { count } })
  }, [])

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    useStore.getState().clearEdgeFlow()
    setState(INITIAL_STATE)
  }, [])

  return { ...state, run, pause, resume, stop, step, reset }
}
