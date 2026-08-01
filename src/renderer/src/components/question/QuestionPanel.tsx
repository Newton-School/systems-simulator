import { useEffect, useState } from 'react'
import useStore from '@renderer/store/useStore'
import { useTopologySerializer } from '@renderer/hooks/useTopologySerializer'
import { useQuestionGrader } from '@renderer/hooks/useQuestionGrader'
import { SAMPLE_QUESTION } from '@renderer/config/sampleQuestion'
import { postQuestionHostMessage } from '@renderer/utils/questionHostMessaging'
import type {
  AttemptGrade,
  AttemptState,
  AttemptStatus,
  QuestionPackage
} from '../../../../engine/analysis/question'
import type { TopologyJSON } from '../../../../engine/core/types'

const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-nss-muted'

type PendingRun = {
  kind: 'dry-run' | 'submit'
  topology: TopologyJSON
}

function buildAttemptId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `attempt-${Date.now()}`
}

function buildAttemptState({
  current,
  questionId,
  topology,
  status,
  now
}: {
  current: AttemptState | null
  questionId: string
  topology: TopologyJSON
  status: AttemptStatus
  now: string
}): AttemptState {
  return {
    attemptId: current?.attemptId ?? buildAttemptId(),
    questionId,
    topology,
    status,
    startedAt: current?.startedAt ?? now,
    lastSavedAt: now,
    submittedAt: current?.submittedAt,
    testRunCount: current?.testRunCount ?? 0,
    lastDryRun: current?.lastDryRun,
    grade: current?.grade
  }
}

function formatAttemptStatus(status: AttemptStatus | 'DRAFT'): string {
  switch (status) {
    case 'AUTOSAVED':
      return 'Autosaved'
    case 'SUBMITTED':
      return 'Submitted'
    case 'GRADING':
      return 'Grading'
    case 'GRADED':
      return 'Graded'
    case 'LOCKED':
      return 'Locked'
    default:
      return 'Draft'
  }
}

function attemptStatusClasses(status: AttemptStatus | 'DRAFT'): string {
  switch (status) {
    case 'GRADED':
      return 'border-nss-success/25 bg-nss-success/10 text-nss-success'
    case 'GRADING':
      return 'border-nss-warning/25 bg-nss-warning/10 text-nss-warning'
    case 'SUBMITTED':
      return 'border-nss-primary/25 bg-nss-primary/10 text-nss-primary'
    case 'LOCKED':
      return 'border-nss-border bg-nss-surface text-nss-muted'
    default:
      return 'border-nss-border bg-nss-surface text-nss-text'
  }
}

/**
 * Minimum question-mode loop (gap-4 A2). When a question is active it shows the
 * brief (FR/NFR/scale), Test/Submit controls, and — after grading — the rubric
 * checklist + overall result. No EnvironmentProfile gating yet; that is a
 * follow-up. In production the host injects the QuestionPackage; here a launcher
 * loads a local sample.
 */
export const QuestionPanel = () => {
  const activeQuestion = useStore((s) => s.activeQuestion)
  const setActiveQuestion = useStore((s) => s.setActiveQuestion)
  const attemptState = useStore((s) => s.attemptState)
  const setAttemptState = useStore((s) => s.setAttemptState)
  const { serialize } = useTopologySerializer()
  const grader = useQuestionGrader()
  const { status: graderStatus, grade: graderGrade, error: graderError, grade_: gradeQuestion, reset: resetGrader } =
    grader
  const [serializeError, setSerializeError] = useState<string | null>(null)
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null)

  useEffect(() => {
    resetGrader()
    setSerializeError(null)
    setPendingRun(null)
  }, [activeQuestion?.id, resetGrader])

  useEffect(() => {
    if (!activeQuestion || !pendingRun) {
      return
    }

    if (graderStatus === 'graded' && graderGrade) {
      const now = new Date().toISOString()
      const baseAttempt = buildAttemptState({
        current: attemptState,
        questionId: activeQuestion.id,
        topology: pendingRun.topology,
        status: 'GRADING',
        now
      })

      if (pendingRun.kind === 'dry-run') {
        setAttemptState({
          ...baseAttempt,
          status: 'DRAFT',
          lastSavedAt: now,
          testRunCount: baseAttempt.testRunCount + 1,
          lastDryRun: {
            timestamp: now,
            grade: graderGrade
          }
        })
      } else {
        const completedAttempt: AttemptState = {
          ...baseAttempt,
          status: 'GRADED',
          submittedAt: baseAttempt.submittedAt ?? now,
          grade: {
            gradedAt: now,
            result: graderGrade
          }
        }

        setAttemptState(completedAttempt)
        postQuestionHostMessage({
          type: 'ns-simulator:submit',
          payload: {
            contract: graderGrade.contract,
            attemptState: completedAttempt
          }
        })
      }

      setPendingRun(null)
      return
    }

    if (graderStatus === 'error') {
      const now = new Date().toISOString()
      if (attemptState) {
        setAttemptState({
          ...attemptState,
          status: attemptState.grade ? 'GRADED' : 'DRAFT',
          lastSavedAt: now
        })
      }
      setPendingRun(null)
    }
  }, [activeQuestion, attemptState, graderGrade, graderStatus, pendingRun, setAttemptState])

  if (!activeQuestion) {
    return (
      <section className="flex h-full min-h-0 flex-col">
        <div className="border-b border-nss-border p-4 pb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">
            Question Text
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
            Load a question package to show the brief, run the minimum grading loop, and submit
            from this sidebar.
          </p>
        </div>

        <div className="flex flex-1 items-center p-3">
          <div className="w-full rounded-lg border border-dashed border-nss-border bg-nss-surface p-4">
            <p className="text-xs font-semibold text-nss-text">No question loaded</p>
            <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
              This tab now hosts the question brief, rubric checks, and Test/Submit flow.
            </p>
            <button
              type="button"
              onClick={() => {
                setAttemptState(null)
                setActiveQuestion(SAMPLE_QUESTION)
              }}
              className="mt-4 w-full rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary-hover"
            >
              Load sample question
            </button>
          </div>
        </div>
      </section>
    )
  }

  const runGrade = (question: QuestionPackage, kind: PendingRun['kind']) => {
    const { topology, errors } = serialize()
    if (!topology) {
      setSerializeError(errors[0] ?? 'Could not serialize the current topology.')
      return
    }

    const now = new Date().toISOString()
    setSerializeError(null)
    setAttemptState(
      buildAttemptState({
        current: attemptState,
        questionId: activeQuestion.id,
        topology,
        status: 'GRADING',
        now
      })
    )
    setPendingRun({ kind, topology })
    gradeQuestion(question, topology)
  }

  const onSubmit = () => runGrade(activeQuestion, 'submit')
  const onTest = () =>
    runGrade(
      activeQuestion.suite.dryRunCase
        ? {
            ...activeQuestion,
            suite: { ...activeQuestion.suite, cases: [activeQuestion.suite.dryRunCase] }
          }
        : activeQuestion,
      'dry-run'
    )

  const currentStatus =
    pendingRun?.kind || graderStatus === 'grading'
      ? 'GRADING'
      : (attemptState?.status ?? 'DRAFT')
  const latestGrade: AttemptGrade | null =
    graderGrade ?? attemptState?.grade?.result ?? attemptState?.lastDryRun?.grade ?? null
  const contract = latestGrade?.contract
  const hasDryRunCase = Boolean(activeQuestion.suite.dryRunCase)
  const testRunCount = attemptState?.testRunCount ?? 0

  return (
    <section className="flex h-full min-h-0 flex-col text-nss-text">
      <header className="border-b border-nss-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">
              Question Text
            </h2>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-nss-primary">
              {activeQuestion.type} · {activeQuestion.difficulty}
            </p>
            <h3 className="truncate text-sm font-semibold">{activeQuestion.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              resetGrader()
              setPendingRun(null)
              setAttemptState(null)
              setActiveQuestion(null)
            }}
            className="shrink-0 text-nss-muted hover:text-nss-text"
            aria-label="Close question"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${attemptStatusClasses(
              currentStatus
            )}`}
          >
            {formatAttemptStatus(currentStatus)}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-nss-muted">
            Test runs: {testRunCount}
          </span>
          {attemptState?.submittedAt && (
            <span className="text-[10px] uppercase tracking-wide text-nss-muted">
              Submitted {new Date(attemptState.submittedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto custom-scrollbar p-4">
        <p className="text-xs leading-relaxed text-nss-text/90">{activeQuestion.prompt.text}</p>

        {activeQuestion.prompt.functionalRequirements.length > 0 && (
          <section className="space-y-2">
            <h3 className={SECTION_TITLE}>Functional Requirements</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-nss-muted">
              {activeQuestion.prompt.functionalRequirements.map((fr) => (
                <li key={fr}>{fr}</li>
              ))}
            </ul>
          </section>
        )}

        {activeQuestion.prompt.nonFunctionalRequirements.length > 0 && (
          <section className="space-y-2">
            <h3 className={SECTION_TITLE}>Non-Functional Targets</h3>
            <div className="space-y-1">
              {activeQuestion.prompt.nonFunctionalRequirements.map((nfr) => (
                <div key={nfr.metric} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-nss-muted">{nfr.description}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {nfr.operator} {nfr.value}
                    {nfr.unit === 'percent' ? '%' : nfr.unit === 'ms' ? 'ms' : ''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h3 className={SECTION_TITLE}>Scale</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {activeQuestion.prompt.scale.peakRps !== undefined && (
              <div className="rounded border border-nss-border bg-nss-surface px-2 py-1.5">
                <div className="text-nss-muted">Peak RPS</div>
                <div className="font-semibold tabular-nums">
                  {activeQuestion.prompt.scale.peakRps}
                </div>
              </div>
            )}
            {activeQuestion.prompt.scale.readWriteRatio !== undefined && (
              <div className="rounded border border-nss-border bg-nss-surface px-2 py-1.5">
                <div className="text-nss-muted">Read / Write</div>
                <div className="font-semibold tabular-nums">
                  {activeQuestion.prompt.scale.readWriteRatio}:
                  {100 - activeQuestion.prompt.scale.readWriteRatio}
                </div>
              </div>
            )}
          </div>
        </section>

        {serializeError && <p className="text-xs text-nss-danger">{serializeError}</p>}
        {graderError && <p className="text-xs text-nss-danger">Grading error: {graderError}</p>}

        {contract && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className={SECTION_TITLE}>Result</h3>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  contract.allPassed
                    ? 'bg-nss-success/15 text-nss-success'
                    : 'bg-nss-danger/15 text-nss-danger'
                }`}
              >
                {contract.allPassed ? 'Passed' : 'Failed'} · {contract.passedTests}/
                {contract.totalTests}
              </span>
            </div>
            <div className="space-y-1">
              {contract.tests.map((test) => (
                <div key={test.id} className="flex items-center gap-2 text-xs">
                  <span className={test.passed ? 'text-nss-success' : 'text-nss-danger'}>
                    {test.passed ? '✓' : '✗'}
                  </span>
                  <span className="text-nss-muted">{test.name}</span>
                  <span className="ml-auto text-[10px] text-nss-muted/70">
                    {test.id.split(':')[0]}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="flex gap-2 border-t border-nss-border p-4">
        <button
          type="button"
          onClick={onTest}
          disabled={graderStatus === 'grading'}
          className="flex-1 rounded-md border border-nss-border bg-nss-surface px-3 py-2 text-xs font-semibold text-nss-text hover:bg-nss-bg disabled:opacity-50"
        >
          {graderStatus === 'grading' ? 'Grading…' : hasDryRunCase ? 'Test (dry run)' : 'Test'}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={graderStatus === 'grading'}
          className="flex-1 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary-hover disabled:opacity-50"
        >
          {graderStatus === 'grading' ? 'Grading…' : 'Submit'}
        </button>
      </footer>
    </section>
  )
}
