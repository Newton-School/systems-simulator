import { useEffect, useState } from 'react'
import useStore from '@renderer/store/useStore'
import { useTopologySerializer } from '@renderer/hooks/useTopologySerializer'
import { useQuestionGrader } from '@renderer/hooks/useQuestionGrader'
import { SAMPLE_QUESTION } from '@renderer/config/sampleQuestion'
import { postQuestionHostMessage } from '@renderer/utils/questionHostMessaging'
import { archiveSubmission, listArchivedSubmissionIds } from '@renderer/utils/submissionArchive'
import {
  buildGamePlaygroundResult,
  buildGamePlaygroundSubmitPayload
} from '../../../../engine/analysis/gamePlayground'
import { buildQuestionEvaluationContract } from '../../../../engine/analysis/evaluationContract'
import { buildEvaluationEnvelope } from '../../../../engine/analysis/evaluationEnvelope'
import {
  canTriggerTestRun,
  shouldShowRubricResults
} from '../../../../engine/analysis/environmentProfile'
import {
  autosaveAttempt,
  buildQuestionTestRows,
  createAttemptState,
  isAttemptCurrentForTopology,
  markAttemptGrading,
  recordDryRunGrade,
  recordSubmittedGrade,
  resolveVisibleAttemptGrade,
  resolveVisibleAttemptStatus,
  recoverAttemptAfterGradingError
} from '../../../../engine/analysis/question'
import type {
  AttemptGrade,
  AttemptStatus,
  QuestionPackage
} from '../../../../engine/analysis/question'
import type { TopologyJSON } from '../../../../engine/core/types'

const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-nss-muted'

type PendingRun = {
  kind: 'dry-run' | 'submit'
  topology: TopologyJSON
}

type QuestionPanelView = 'brief' | 'tests'

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
 * Question-mode loop. When a question is active it shows the brief (FR/NFR/scale),
 * Test/Submit controls, and the rubric checklist + overall result. What is shown
 * and allowed is gated by the resolved EnvironmentProfile (rubric-check timing,
 * test-run limit, graded submit, prompt visibility). In production the host
 * injects the QuestionPackage and profile; here a launcher loads a local sample
 * in the default AUTHOR profile.
 */
export const QuestionPanel = () => {
  const isEmbedded = typeof window !== 'undefined' && window.parent !== window
  const activeQuestion = useStore((s) => s.activeQuestion)
  const setActiveQuestion = useStore((s) => s.setActiveQuestion)
  const attemptState = useStore((s) => s.attemptState)
  const setAttemptState = useStore((s) => s.setAttemptState)
  const environmentProfile = useStore((s) => s.environmentProfile)
  const resultsRevealed = useStore((s) => s.resultsRevealed)
  const { serialize } = useTopologySerializer()
  const grader = useQuestionGrader()
  const {
    status: graderStatus,
    grade: graderGrade,
    runs: graderRuns,
    error: graderError,
    grade_: gradeQuestion,
    reset: resetGrader
  } = grader
  const [serializeError, setSerializeError] = useState<string | null>(null)
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null)
  const [panelView, setPanelView] = useState<QuestionPanelView>('brief')
  const [archivedCount, setArchivedCount] = useState(0)
  const activeQuestionId = activeQuestion?.id

  useEffect(() => {
    setArchivedCount(activeQuestionId ? listArchivedSubmissionIds(activeQuestionId).length : 0)
  }, [activeQuestionId])

  useEffect(() => {
    resetGrader()
    setSerializeError(null)
    setPendingRun(null)
    setPanelView('brief')
  }, [activeQuestion?.id, resetGrader])

  useEffect(() => {
    if (!activeQuestion || pendingRun || graderStatus === 'grading') {
      return
    }

    const { topology } = serialize()
    if (!topology) {
      return
    }

    const nextAttempt = autosaveAttempt(attemptState, {
      questionId: activeQuestion.id,
      topology,
      now: new Date().toISOString()
    })

    if (nextAttempt !== attemptState) {
      setAttemptState(nextAttempt)
    }
  }, [activeQuestion, attemptState, graderStatus, pendingRun, serialize, setAttemptState])

  useEffect(() => {
    if (!activeQuestion || !pendingRun) {
      return
    }

    if (graderStatus === 'graded' && graderGrade) {
      const now = new Date().toISOString()
      const baseAttempt =
        attemptState ??
        createAttemptState({
          questionId: activeQuestion.id,
          topology: pendingRun.topology,
          now
        })

      if (pendingRun.kind === 'dry-run') {
        setAttemptState(
          recordDryRunGrade(baseAttempt, {
            topology: pendingRun.topology,
            grade: graderGrade,
            now
          })
        )
      } else {
        const completedAttempt = recordSubmittedGrade(baseAttempt, {
          topology: pendingRun.topology,
          grade: graderGrade,
          now
        })

        setAttemptState(completedAttempt)

        // Seal the submission into an immutable, tamper-evident envelope and
        // archive it. Best-effort: archiving must never block the submit/host
        // handshake, so failures are swallowed after logging.
        try {
          const submissionId = `${completedAttempt.attemptId}:${completedAttempt.submittedAt ?? now}`
          const contract = buildQuestionEvaluationContract(
            activeQuestion,
            pendingRun.topology,
            graderGrade,
            { attemptId: completedAttempt.attemptId, submissionId, evaluatedAt: now }
          )
          const envelope = buildEvaluationEnvelope({
            submissionId,
            attemptId: completedAttempt.attemptId,
            submittedAt: completedAttempt.submittedAt ?? now,
            evaluatedAt: now,
            topologySnapshot: pendingRun.topology,
            cases: graderRuns ?? [],
            contract
          })
          archiveSubmission(envelope)
          setArchivedCount(listArchivedSubmissionIds(activeQuestion.id).length)
        } catch (err) {
          console.error('Failed to archive submission envelope', err)
        }

        postQuestionHostMessage({
          type: 'ns-simulator:submit',
          payload: buildGamePlaygroundSubmitPayload(
            activeQuestion,
            completedAttempt,
            buildGamePlaygroundResult(graderGrade.contract)
          )
        })
      }

      setPendingRun(null)
      return
    }

    if (graderStatus === 'error') {
      const now = new Date().toISOString()
      setAttemptState(recoverAttemptAfterGradingError(attemptState, now))
      setPendingRun(null)
    }
  }, [
    activeQuestion,
    attemptState,
    graderGrade,
    graderRuns,
    graderStatus,
    pendingRun,
    setAttemptState
  ])

  if (!activeQuestion) {
    return (
      <section className="flex h-full min-h-0 flex-col">
        <div className="border-b border-nss-border p-4 pb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">
            Question Text
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
            {isEmbedded
              ? 'Waiting for the host to inject a question package into this embedded simulator.'
              : 'Load a question package to show the brief, run the grading loop, and submit from this sidebar.'}
          </p>
        </div>

        <div className="flex flex-1 items-center p-3">
          <div className="w-full rounded-lg border border-dashed border-nss-border bg-nss-surface p-4">
            <p className="text-xs font-semibold text-nss-text">No question loaded</p>
            <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
              {isEmbedded
                ? 'The iframe handshake is active, but the host has not sent a launch context yet.'
                : 'This tab now hosts the question brief, rubric checks, and Test/Submit flow.'}
            </p>
            {!isEmbedded && (
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
            )}
          </div>
        </div>
      </section>
    )
  }

  const runGrade = (question: QuestionPackage, kind: PendingRun['kind']) => {
    // A frozen attempt (host `lock`) accepts no more test/submit runs.
    if (attemptState?.status === 'LOCKED') {
      return
    }
    const { topology, errors } = serialize()
    if (!topology) {
      setSerializeError(errors[0] ?? 'Could not serialize the current topology.')
      return
    }

    const now = new Date().toISOString()
    setSerializeError(null)
    setAttemptState(
      markAttemptGrading(attemptState, {
        questionId: activeQuestion.id,
        topology,
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

  const currentTopology = serialize().topology
  const hasStaleAttempt = Boolean(
    attemptState && !isAttemptCurrentForTopology(attemptState, currentTopology)
  )
  const currentStatus =
    pendingRun?.kind || graderStatus === 'grading'
      ? 'GRADING'
      : resolveVisibleAttemptStatus(attemptState, currentTopology)
  const latestGrade: AttemptGrade | null =
    graderGrade ?? resolveVisibleAttemptGrade(attemptState, currentTopology)
  const contract = latestGrade?.contract
  const hasDryRunCase = Boolean(activeQuestion.suite.dryRunCase)
  const testRunCount = attemptState?.testRunCount ?? 0
  const testRows = buildQuestionTestRows(activeQuestion, latestGrade)
  const passedTests = testRows.filter((row) => row.status === 'passed').length
  const failedTests = testRows.filter((row) => row.status === 'failed').length
  const pendingTests = testRows.filter((row) => row.status === 'pending').length

  // --- EnvironmentProfile + host-command gates ---
  const isAttemptLocked = attemptState?.status === 'LOCKED'
  const showPrompt = environmentProfile.visibility.prompt
  // The suite is shown only when the author marked it student-visible AND the
  // environment reveals grading-suite details (hidden in INTERVIEW).
  const showSuiteDetails =
    activeQuestion.suite.visibleToStudent && environmentProfile.visibility.gradingSuiteDetails
  const hasSubmittedGrade = Boolean(attemptState?.grade)
  // A host `reveal` command overrides the profile's rubric-visibility timing.
  const showRubricResults =
    resultsRevealed || shouldShowRubricResults(environmentProfile, { hasSubmittedGrade })
  const showSubmit = environmentProfile.graded
  const { maxTestRuns } = environmentProfile.capabilities
  const canTest = canTriggerTestRun(environmentProfile, { testRunCount }) && !isAttemptLocked
  const testRunsRemaining =
    maxTestRuns === undefined ? null : Math.max(0, maxTestRuns - testRunCount)
  const effectivePanelView: QuestionPanelView = showPrompt ? panelView : 'tests'

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
          {!isEmbedded && (
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
          )}
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
          {archivedCount > 0 && (
            <span className="text-[10px] uppercase tracking-wide text-nss-muted">
              Archived: {archivedCount}
            </span>
          )}
        </div>

        <div className="mt-3 flex gap-1 rounded-md bg-nss-bg p-0.5">
          {(showPrompt ? (['brief', 'tests'] as const) : (['tests'] as const)).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setPanelView(view)}
              className={`flex-1 rounded px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                effectivePanelView === view
                  ? 'bg-nss-surface text-nss-text'
                  : 'text-nss-muted hover:text-nss-text'
              }`}
            >
              {view === 'brief'
                ? 'Brief'
                : `Tests${failedTests > 0 ? ` (${failedTests} failed)` : pendingTests > 0 ? ` (${pendingTests} pending)` : ''}`}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto custom-scrollbar p-4">
        {serializeError && <p className="text-xs text-nss-danger">{serializeError}</p>}
        {graderError && <p className="text-xs text-nss-danger">Grading error: {graderError}</p>}
        {hasStaleAttempt && (
          <p className="text-xs text-nss-warning">
            The canvas has changed since the last graded attempt. Re-run tests to refresh the
            visible results.
          </p>
        )}

        {effectivePanelView === 'brief' ? (
          <>
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
                    <div
                      key={nfr.metric}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
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

            {showSuiteDetails && (
              <section className="space-y-2">
                <h3 className={SECTION_TITLE}>Grading Suite</h3>
                <div className="space-y-1">
                  {activeQuestion.suite.cases.map((suiteCase) => {
                    const overrides = [
                      suiteCase.workload?.baseRps !== undefined
                        ? `${suiteCase.workload.baseRps} rps`
                        : null,
                      suiteCase.workload?.pattern ?? null,
                      suiteCase.faults && suiteCase.faults.length > 0
                        ? `${suiteCase.faults.length} fault${suiteCase.faults.length > 1 ? 's' : ''}`
                        : null
                    ].filter(Boolean)
                    return (
                      <div
                        key={suiteCase.id}
                        className="flex items-center justify-between gap-3 rounded border border-nss-border/70 bg-nss-surface/40 px-2 py-1.5 text-xs"
                      >
                        <span className="font-semibold text-nss-text">{suiteCase.id}</span>
                        <span className="shrink-0 text-[10px] text-nss-muted">
                          {overrides.length > 0 ? overrides.join(' · ') : 'baseline conditions'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className={SECTION_TITLE}>Tests</h3>
              {showRubricResults && (
                <span className="text-[10px] uppercase tracking-wide text-nss-muted">
                  {passedTests} passed · {failedTests} failed · {pendingTests} pending
                </span>
              )}
            </div>

            {!showRubricResults && (
              <p className="rounded border border-nss-border bg-nss-surface px-3 py-2 text-[11px] leading-relaxed text-nss-muted">
                {environmentProfile.visibility.rubricChecks === 'POST_SUBMIT_ONLY'
                  ? 'Rubric results are revealed after you submit. Use Test to check your design against a representative run.'
                  : 'Rubric results are hidden for this environment.'}
              </p>
            )}

            {showRubricResults && contract && (
              <div className="rounded border border-nss-border bg-nss-surface px-3 py-2 text-[11px] text-nss-muted">
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
            )}

            {graderStatus === 'grading' && (
              <p className="text-[11px] leading-relaxed text-nss-warning">
                Running grading now. The tests list will update when the batch finishes.
              </p>
            )}

            <div className="space-y-1">
              {showRubricResults &&
                testRows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded border border-nss-border/70 bg-nss-surface/40 p-2"
                  >
                    <div className="flex items-start gap-2 text-xs">
                      <span
                        className={
                          row.status === 'passed'
                            ? 'text-nss-success'
                            : row.status === 'failed'
                              ? 'text-nss-danger'
                              : 'text-nss-warning'
                        }
                      >
                        {row.status === 'passed' ? '✓' : row.status === 'failed' ? '✗' : '•'}
                      </span>
                      <span className="min-w-0 flex-1 text-nss-muted">{row.name}</span>
                      <span className="shrink-0 text-[10px] text-nss-muted/70">{row.scope}</span>
                    </div>
                    {row.detail && (
                      <p className="mt-1 pl-5 text-[10px] leading-relaxed text-nss-muted/80">
                        {row.detail}
                      </p>
                    )}
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
          disabled={graderStatus === 'grading' || !canTest}
          className="flex-1 rounded-md border border-nss-border bg-nss-surface px-3 py-2 text-xs font-semibold text-nss-text hover:bg-nss-bg disabled:opacity-50"
        >
          {graderStatus === 'grading'
            ? 'Grading…'
            : `${hasDryRunCase ? 'Test (dry run)' : 'Test'}${
                testRunsRemaining !== null ? ` · ${testRunsRemaining} left` : ''
              }`}
        </button>
        {showSubmit && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={graderStatus === 'grading' || isAttemptLocked}
            className="flex-1 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary-hover disabled:opacity-50"
          >
            {graderStatus === 'grading' ? 'Grading…' : isAttemptLocked ? 'Locked' : 'Submit'}
          </button>
        )}
      </footer>
    </section>
  )
}
