import { useCallback, useMemo } from 'react'
import useStore from '@renderer/store/useStore'
import {
  buildRequestLifecycle,
  clampStep,
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
