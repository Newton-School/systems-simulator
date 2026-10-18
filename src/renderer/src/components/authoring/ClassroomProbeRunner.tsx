import { useState } from 'react'
import type { QuestionPackage } from '../../../../engine/analysis/question'
import {
  runClassroomMisconceptionProbes,
  type ClassroomProbeResult
} from '../../../../engine/classroom/probeRunner'

export function ClassroomProbeRunner({
  question
}: {
  question: QuestionPackage
}): React.JSX.Element | null {
  const probes = question.classroom?.misconceptions?.filter((item) => item.probe) ?? []
  const [results, setResults] = useState<ClassroomProbeResult[] | null>(null)
  const [running, setRunning] = useState(false)
  if (probes.length === 0) return null

  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      const { runSimulation } = await import('../../../../engine/runSimulation')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      setResults(runClassroomMisconceptionProbes(question, runSimulation))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="mb-4 rounded-xl border border-nss-border bg-nss-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-nss-text">Classroom probe runner</h3>
          <p className="mt-1 text-xs text-nss-muted">
            Each wrong design must trigger its own teaching message and no other.
          </p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={() => void run()}
          className="rounded bg-nss-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {running ? 'Running…' : `Run ${probes.length} probe${probes.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {results && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {results.map((result) => (
            <li
              key={result.misconceptionId}
              className={result.passed ? 'text-nss-success' : 'text-nss-danger'}
            >
              {result.passed ? '✓' : '×'} {result.misconceptionId}: {result.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
