import { useCallback, useMemo } from 'react'
import useStore from '@renderer/store/useStore'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import {
  buildRequestLifecycle,
  clampStep,
  initialStepIndex,
  type LifecycleStep,
  type RequestLifecycle
} from './requestLifecycle'

export interface RequestDebugSessionView {
  lifecycle: RequestLifecycle | null
  stepIndex: number
  step: LifecycleStep | null
  setStep: (index: number) => void
  close: () => void
}

/**
 * The open debugger session joined with its recorded lifecycle. Shared by the
 * results-tray debugger and the canvas overlay so both always show the same step.
 */
export function useRequestDebugSession(): RequestDebugSessionView {
  const session = useStore((state) => state.requestDebug)
  const output = useStore((state) => state.lastRunOutput)
  const setRequestDebug = useStore((state) => state.setRequestDebug)
  const requestId = session?.requestId ?? null

  const lifecycle = useMemo(() => {
    if (!requestId || !output) return null
    const trace = output.traces.find((candidate) => candidate.requestId === requestId)
    return trace ? buildRequestLifecycle(trace) : null
  }, [output, requestId])

  const stepIndex = lifecycle && session ? clampStep(lifecycle, session.stepIndex) : 0
  const setStep = useCallback(
    (index: number) => {
      if (!requestId) return
      setRequestDebug({ requestId, stepIndex: index })
    },
    [requestId, setRequestDebug]
  )
  const close = useCallback(() => setRequestDebug(null), [setRequestDebug])

  return {
    lifecycle,
    stepIndex,
    step: lifecycle?.steps[stepIndex] ?? null,
    setStep,
    close
  }
}

/**
 * Open the step-through debugger on one traced request: stop any request-flow
 * animation and start at the lifecycle's initial step. The Traces tab renders the
 * debugger whenever a session is open, so callers outside it switch to that tab.
 */
export function useOpenRequestDebugger(
  output: SimulationOutput | null
): (requestId: string) => void {
  const setRequestDebug = useStore((state) => state.setRequestDebug)
  const setTracedRequestIds = useStore((state) => state.setTracedRequestIds)
  return useCallback(
    (requestId: string) => {
      if (!output) return
      const trace = output.traces.find((candidate) => candidate.requestId === requestId)
      const lifecycle = trace ? buildRequestLifecycle(trace) : null
      setTracedRequestIds([])
      setRequestDebug({ requestId, stepIndex: lifecycle ? initialStepIndex(lifecycle) : 0 })
    },
    [output, setRequestDebug, setTracedRequestIds]
  )
}
