import { useEffect, useMemo, useState } from 'react'
import useStore from '@renderer/store/useStore'
import { useTopologySerializer } from '@renderer/hooks/useTopologySerializer'
import { useQuestionGrader } from '@renderer/hooks/useQuestionGrader'
import { SAMPLE_QUESTION } from '@renderer/config/sampleQuestion'
import { postQuestionHostMessage } from '@renderer/utils/questionHostMessaging'
import { isNewtonHostMode, postNewtonSave } from '@renderer/utils/newtonHostMessaging'
import { sanitizeQuestionPromptHtml } from '@renderer/utils/questionPromptHtml'
import { archiveSubmission, listArchivedSubmissionIds } from '@renderer/utils/submissionArchive'
import {
  buildGamePlaygroundResult,
  buildGamePlaygroundSubmitPayload
} from '../../../../engine/analysis/gamePlayground'
import { buildNewtonSaveBlob } from '../../../../engine/analysis/newtonGamePlayground'
import {
  buildJustificationContext,
  gradeJustification,
  type JustificationResult
} from '../../../../engine/analysis/justification'
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
  parseQuestionPackage,
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
import { BudgetMeter } from './BudgetMeter'

const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-nss-muted'

/**
 * V1 kill-switch for the justification feature. The deterministic keyword grader
 * makes for a confusing "guess the exact token" UX, so justification input is
 * hidden for launch. Flip to `true` (and restore `justify` in the question
 * packages) to bring it back for the V2 redesign.
 */
const SHOW_JUSTIFICATION = false

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
  const activeQuestionPromptHtml = useStore((s) => s.activeQuestionPromptHtml)
  const setActiveQuestionPromptHtml = useStore((s) => s.setActiveQuestionPromptHtml)
  const hostLaunchErrorMessage = useStore((s) => s.hostLaunchErrorMessage)
  const attemptState = useStore((s) => s.attemptState)
  const setAttemptState = useStore((s) => s.setAttemptState)
  const newtonSaveMode = useStore((s) => s.newtonSaveMode)
  const setNewtonSaveMode = useStore((s) => s.setNewtonSaveMode)
  const justificationAnswers = useStore((s) => s.justificationAnswers)
  const setJustificationAnswer = useStore((s) => s.setJustificationAnswer)
  const requestQuestionLoad = useStore((s) => s.requestQuestionLoad)
  const [questionLoadError, setQuestionLoadError] = useState<string | null>(null)
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
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
  const sanitizedPromptHtml = useMemo(
    () =>
      activeQuestionPromptHtml ? sanitizeQuestionPromptHtml(activeQuestionPromptHtml) : undefined,
    [activeQuestionPromptHtml]
  )

  // Live topology for the budget meter - recomputed on every canvas edit (pure,
  // no simulation), so cost updates as the student adds/sizes components.
  const budget = activeQuestion?.budget
  const liveTopology = useMemo<TopologyJSON | null>(() => {
    if (!budget) return null
    const empty = { nodes: [], edges: [] } as unknown as TopologyJSON
    try {
      return serialize().topology ?? empty
    } catch {
      // An incomplete/empty canvas still has a well-defined budget (0 / cap).
      return empty
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, nodes, edges, serialize])

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

        const gameResult = buildGamePlaygroundResult(graderGrade.contract)
        if (isNewtonHostMode()) {
          // Newton Game Playground host: post a verbatim-persisted JSON blob with
          // the two score keys + carried-forward package (client-computed; the
          // backend does not re-grade).
          postNewtonSave(
            buildNewtonSaveBlob(activeQuestion, completedAttempt, gameResult, now, {
              justificationAnswers: useStore.getState().justificationAnswers,
              saveMode: newtonSaveMode ?? 'mutable-only'
            })
          )
        } else {
          postQuestionHostMessage({
            type: 'ns-simulator:submit',
            payload: buildGamePlaygroundSubmitPayload(activeQuestion, completedAttempt, gameResult)
          })
        }
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
    newtonSaveMode,
    pendingRun,
    setAttemptState
  ])

  // Live, deterministic feedback on justification prompts - graded against the
  // current graph (graph-consistency), no LLM. Re-derives when the graph or an
  // answer changes. Declared before the early return to satisfy rules-of-hooks.
  const justifyGrades = useMemo<Record<string, JustificationResult>>(() => {
    const prompts = activeQuestion?.justify ?? []
    if (prompts.length === 0) {
      return {}
    }
    const { topology } = serialize()
    if (!topology) {
      return {}
    }
    const scaleNumbers: number[] = [
      ...Object.values(activeQuestion!.prompt.scale).filter(
        (v): v is number => typeof v === 'number'
      ),
      ...activeQuestion!.prompt.nonFunctionalRequirements.map((nfr) => nfr.value)
    ]
    const ctx = buildJustificationContext(topology, scaleNumbers)
    const out: Record<string, JustificationResult> = {}
    for (const prompt of prompts) {
      out[prompt.id] = gradeJustification(
        prompt,
        { promptId: prompt.id, text: justificationAnswers[prompt.id] ?? '' },
        ctx
      )
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuestion, justificationAnswers, nodes, edges])

  if (!activeQuestion) {
    return (
      <section className="flex min-h-0 flex-col">
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

        <div className="flex flex-1 items-center">
          <div className="w-full rounded-lg p-4">
            <p className="text-xs font-semibold text-nss-text">No question loaded</p>
            <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
              {isEmbedded
                ? (hostLaunchErrorMessage ??
                  'The iframe handshake is active, but the host has not sent a launch context yet.')
                : 'This tab now hosts the question brief, rubric checks, and Test/Submit flow.'}
            </p>
            {!isEmbedded && (
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setAttemptState(null)
                    setActiveQuestionPromptHtml(null)
                    setActiveQuestion(SAMPLE_QUESTION)
                    setNewtonSaveMode(null)
                  }}
                  className="w-full rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary-hover"
                >
                  Load sample question
                </button>
                <label className="block w-full cursor-pointer rounded-md border border-nss-border bg-nss-surface px-3 py-2 text-center text-xs font-semibold text-nss-text hover:border-nss-primary">
                  Load question (.json)…
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => {
                        try {
                          const pkg = parseQuestionPackage(JSON.parse(String(reader.result)))
                          setQuestionLoadError(null)
                          requestQuestionLoad(pkg)
                        } catch (error) {
                          setQuestionLoadError((error as Error).message.split('\n')[0])
                        }
                      }
                      reader.readAsText(file)
                    }}
                  />
                </label>
                <p className="text-center text-[10px] text-nss-muted">
                  Paste any bank QuestionPackage JSON into a file and load it - no host needed.
                </p>
                {questionLoadError && (
                  <p className="text-[10px] leading-snug text-red-500">{questionLoadError}</p>
                )}
              </div>
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
    gradeQuestion(
      question,
      topology,
      Object.entries(justificationAnswers).map(([promptId, text]) => ({ promptId, text }))
    )
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
  // --- EnvironmentProfile + host-command gates ---
  const isAttemptLocked = attemptState?.status === 'LOCKED'
  const showPrompt = environmentProfile.visibility.prompt
  // The suite is shown only when the author marked it student-visible AND the
  // environment reveals grading-suite details (hidden in ASSIGNMENT).
  const showSuiteDetails =
    activeQuestion.suite.visibleToStudent && environmentProfile.visibility.gradingSuiteDetails
  const hasSubmittedGrade = Boolean(attemptState?.grade)
  // A host `reveal` command overrides the profile's rubric-visibility timing.
  const showRubricResults =
    resultsRevealed || shouldShowRubricResults(environmentProfile, { hasSubmittedGrade })
  const showSubmit = environmentProfile.graded
  const canTest = canTriggerTestRun(environmentProfile, { testRunCount }) && !isAttemptLocked
  const visibleTestRows = showRubricResults ? testRows : buildQuestionTestRows(activeQuestion)
  const passedTests = visibleTestRows.filter((row) => row.status === 'passed').length
  const failedTests = visibleTestRows.filter((row) => row.status === 'failed').length
  const pendingTests = visibleTestRows.filter((row) => row.status === 'pending').length
  const hasEvaluatedTests = showRubricResults && latestGrade !== null
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
                setActiveQuestionPromptHtml(null)
                setActiveQuestion(null)
                setNewtonSaveMode(null)
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
                : `Tests${failedTests > 0 ? ` (${failedTests} failed)` : hasEvaluatedTests && pendingTests > 0 ? ` (${pendingTests} pending)` : ''}`}
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
            {sanitizedPromptHtml ? (
              <div
                className="text-xs leading-relaxed text-nss-text/90 [&_a]:text-nss-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-nss-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-nss-surface [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:text-[11px] [&_h3]:font-semibold [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-nss-surface [&_pre]:p-2 [&_table]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-nss-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-nss-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-4"
                dangerouslySetInnerHTML={{ __html: sanitizedPromptHtml }}
              />
            ) : (
              <>
                <p className="text-xs leading-relaxed text-nss-text/90">
                  {activeQuestion.prompt.text}
                </p>

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
              </>
            )}

            {budget && liveTopology && <BudgetMeter budget={budget} topology={liveTopology} />}

            {/* V1: the justification feature is hidden. The current grader is a
               rigid deterministic keyword/number/tradeoff matcher (not an LLM),
               which produces confusing "inconsistent" feedback. We will redesign
               this UX for V2. The section is force-disabled here and `justify` is
               also stripped from the question files, so nothing renders. */}
            {SHOW_JUSTIFICATION && activeQuestion.justify && activeQuestion.justify.length > 0 && (
              <section className="space-y-2">
                <h3 className={SECTION_TITLE}>Justify your design</h3>
                <p className="text-[11px] leading-relaxed text-nss-muted">
                  Reference the component you actually placed, cite a number from the question, and
                  state a tradeoff. Graded deterministically against your graph.
                </p>
                <div className="space-y-3">
                  {activeQuestion.justify.map((prompt) => {
                    const grade = justifyGrades[prompt.id]
                    const badge =
                      grade?.outcome === 'passed'
                        ? { label: 'consistent', cls: 'text-green-500 border-green-500/30' }
                        : grade?.outcome === 'partial'
                          ? { label: 'partial', cls: 'text-yellow-500 border-yellow-500/30' }
                          : grade?.outcome === 'failed'
                            ? { label: 'not consistent', cls: 'text-red-500 border-red-500/30' }
                            : null
                    return (
                      <div key={prompt.id} className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <label
                            htmlFor={`justify-${prompt.id}`}
                            className="text-[11px] font-medium text-nss-text"
                          >
                            {prompt.decision}
                          </label>
                          {showRubricResults && badge && (
                            <span
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          )}
                        </div>
                        <textarea
                          id={`justify-${prompt.id}`}
                          value={justificationAnswers[prompt.id] ?? ''}
                          onChange={(event) =>
                            setJustificationAnswer(prompt.id, event.target.value)
                          }
                          disabled={isAttemptLocked}
                          rows={2}
                          placeholder="e.g. I used a KV store - it handles 200K reads/sec, but we lose ad-hoc joins."
                          className="w-full resize-y rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text placeholder:text-nss-muted/70 outline-none focus:border-nss-primary transition-colors disabled:opacity-60"
                        />
                        {showRubricResults && grade?.detail && grade.outcome !== 'passed' && (
                          <p className="text-[10px] leading-snug text-nss-muted">{grade.detail}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

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
              <span className="text-[10px] uppercase tracking-wide text-nss-muted">
                {hasEvaluatedTests
                  ? `${passedTests} passed · ${failedTests} failed · ${pendingTests} pending`
                  : `${visibleTestRows.length} checks`}
              </span>
            </div>

            {!hasEvaluatedTests && (
              <p className="rounded border border-nss-border bg-nss-surface px-3 py-2 text-[11px] leading-relaxed text-nss-muted">
                Use Test to evaluate the current topology. Until you run it, the authored checks
                below stay pending. Submit records the graded attempt.
              </p>
            )}

            {hasEvaluatedTests && contract && (
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
              {visibleTestRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded border border-nss-border/70 bg-nss-surface/40 p-2"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={
                        row.status === 'passed'
                          ? 'shrink-0 text-nss-success'
                          : row.status === 'failed'
                            ? 'shrink-0 text-nss-danger'
                            : 'shrink-0 text-nss-warning'
                      }
                    >
                      {row.status === 'passed' ? '✓' : row.status === 'failed' ? '✗' : '•'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-nss-muted" title={row.name}>
                      {row.name}
                    </span>
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
          {graderStatus === 'grading' ? 'Grading…' : hasDryRunCase ? 'Test (dry run)' : 'Test'}
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
