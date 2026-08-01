import { useCallback, useEffect, useRef, useState } from 'react'
import type { TopologyJSON } from '../../../engine/core/types'
import type { AttemptGrade, QuestionPackage } from '../../../engine/analysis/question'
import type { WorkerInboundMessage, WorkerOutboundMessage } from '../../../engine/worker/protocols'

export type GraderStatus = 'idle' | 'grading' | 'graded' | 'error'

export interface QuestionGraderState {
  status: GraderStatus
  grade: AttemptGrade | null
  error: string | null
  /** Grade a student topology against a question package (runs the suite off-thread). */
  grade_: (question: QuestionPackage, topology: TopologyJSON) => void
  reset: () => void
}

/**
 * Runs question grading in a dedicated worker so the whole suite executes off the
 * main thread. Mirrors useSimulation's worker lifecycle but for the batch grade
 * path rather than a live single run.
 */
export function useQuestionGrader(): QuestionGraderState {
  const [status, setStatus] = useState<GraderStatus>('idle')
  const [grade, setGrade] = useState<AttemptGrade | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const gradeAttempt = useCallback((question: QuestionPackage, topology: TopologyJSON) => {
    workerRef.current?.terminate()
    const worker = new Worker(
      new URL('../../../engine/worker/simulation.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data
      if (msg.type === 'grade-complete') {
        setGrade(msg.payload.grade)
        setStatus('graded')
        worker.terminate()
        workerRef.current = null
      } else if (msg.type === 'error') {
        setError(msg.payload.message)
        setStatus('error')
        worker.terminate()
        workerRef.current = null
      }
    }
    worker.onerror = (err) => {
      setError(err.message ?? 'Unknown grader error')
      setStatus('error')
      worker.terminate()
      workerRef.current = null
    }

    setStatus('grading')
    setGrade(null)
    setError(null)
    worker.postMessage({
      type: 'grade',
      payload: { question, topology }
    } satisfies WorkerInboundMessage)
  }, [])

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setStatus('idle')
    setGrade(null)
    setError(null)
  }, [])

  return { status, grade, error, grade_: gradeAttempt, reset }
}
