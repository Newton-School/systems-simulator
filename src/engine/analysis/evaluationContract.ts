import type { TopologyJSON } from '../core/types'
import type { AttemptGrade, HostContract, QuestionPackage } from './question'
import type { GradedEvaluationBatch } from './rubric'
import type { StructuralEvaluation } from './structural'
import type { SimulationVerdict } from './verdict'

export const SCENARIO_EVALUATION_CONTRACT_VERSION = '1.0' as const
export const QUESTION_EVALUATION_CONTRACT_VERSION = '1.0' as const
export const QUESTION_EVALUATION_BATCH_VERSION = '1.0' as const

export type ScenarioEvaluationResult =
  | {
      scenarioId: string
      scenarioName?: string
      status: 'completed'
      verdict: SimulationVerdict
    }
  | {
      scenarioId: string
      scenarioName?: string
      status: 'error' | 'timeout'
      error: string
    }

export interface ScenarioEvaluationContract {
  version: typeof SCENARIO_EVALUATION_CONTRACT_VERSION
  simulatorVersion?: string
  topologyId: string
  topologySchemaVersion: string
  submissionId?: string
  /**
   * Optional on purpose: callers that need byte-identical output can omit it,
   * while orchestrators that need a wall-clock stamp can inject one explicitly.
   */
  evaluatedAt?: string
  verdicts: ScenarioEvaluationResult[]
  summary: {
    total: number
    completed: number
    errored: number
    timedOut: number
  }
}

export type QuestionEvaluationStatus =
  | 'passed'
  | 'failed'
  | 'invalid_submission'
  | 'evaluation_error'

export type QuestionEvaluationTestKind = 'structural' | 'rubric' | 'execution'

export interface QuestionEvaluationTestResult {
  id: string
  name: string
  scope: string
  kind: QuestionEvaluationTestKind
  status: 'passed' | 'failed'
  pointsEarned: number
  pointsPossible: number
  detail?: string
}

export interface QuestionEvaluationScore {
  earned: number
  possible: number
  fraction: number
}

export interface QuestionEvaluationSummary {
  totalTests: number
  passedTests: number
  failedTests: number
  structuralFailures: number
  rubricFailures: number
  executionFailures: number
}

export interface QuestionEvaluationError {
  code: 'INVALID_SUBMISSION' | 'EVALUATION_ERROR'
  message: string
}

interface QuestionEvaluationContractBase {
  version: typeof QUESTION_EVALUATION_CONTRACT_VERSION
  mode: 'question'
  simulatorVersion?: string
  questionId: string
  questionVersion: string
  topologyId: string
  topologySchemaVersion: string
  attemptId?: string
  submissionId?: string
  evaluatedAt?: string
}

export interface SuccessfulQuestionEvaluationContract extends QuestionEvaluationContractBase {
  status: 'passed' | 'failed'
  score: QuestionEvaluationScore
  summary: QuestionEvaluationSummary
  tests: QuestionEvaluationTestResult[]
  host: HostContract
  structural: StructuralEvaluation
  graded: GradedEvaluationBatch
}

export interface FailedQuestionEvaluationContract extends QuestionEvaluationContractBase {
  status: 'invalid_submission' | 'evaluation_error'
  score: QuestionEvaluationScore
  summary: QuestionEvaluationSummary
  tests: QuestionEvaluationTestResult[]
  host: HostContract
  error: QuestionEvaluationError
}

export type QuestionEvaluationContract =
  | SuccessfulQuestionEvaluationContract
  | FailedQuestionEvaluationContract

export interface QuestionEvaluationBatch {
  version: typeof QUESTION_EVALUATION_BATCH_VERSION
  mode: 'question-batch'
  simulatorVersion?: string
  evaluatedAt?: string
  results: QuestionEvaluationContract[]
  summary: {
    total: number
    passed: number
    failed: number
    invalidSubmissions: number
    evaluationErrors: number
  }
}

export function buildScenarioEvaluationContract(
  topology: Pick<TopologyJSON, 'id' | 'version'>,
  verdicts: ScenarioEvaluationResult[],
  options?: {
    simulatorVersion?: string
    submissionId?: string
    topologyId?: string
    evaluatedAt?: string
  }
): ScenarioEvaluationContract {
  const completed = verdicts.filter((entry) => entry.status === 'completed').length
  const timedOut = verdicts.filter((entry) => entry.status === 'timeout').length

  return {
    version: SCENARIO_EVALUATION_CONTRACT_VERSION,
    ...(options?.simulatorVersion ? { simulatorVersion: options.simulatorVersion } : {}),
    topologyId: options?.topologyId ?? topology.id,
    topologySchemaVersion: topology.version,
    ...(options?.submissionId ? { submissionId: options.submissionId } : {}),
    ...(options?.evaluatedAt ? { evaluatedAt: options.evaluatedAt } : {}),
    verdicts,
    summary: {
      total: verdicts.length,
      completed,
      errored: verdicts.length - completed - timedOut,
      timedOut
    }
  }
}

function buildQuestionScore(pkg: QuestionPackage, grade: AttemptGrade): QuestionEvaluationScore {
  const possible = pkg.suite.cases.reduce(
    (sum) => sum + pkg.rubric.checks.reduce((caseSum, check) => caseSum + (check.points ?? 1), 0),
    0
  )
  const earned = grade.graded.cases.reduce(
    (sum, entry) => sum + (entry.rubric?.score.earned ?? 0),
    0
  )

  return {
    earned,
    possible,
    fraction: possible > 0 ? earned / possible : 1
  }
}

function rubricFailureDetail(
  detail: string | undefined,
  actual: number | null,
  metric: string,
  op: string,
  value: number
): string | undefined {
  if (detail) {
    return detail
  }

  if (actual === null) {
    return undefined
  }

  return `actual ${actual} does not satisfy ${metric} ${op} ${value}`
}

function buildQuestionTests(grade: AttemptGrade): QuestionEvaluationTestResult[] {
  const tests: QuestionEvaluationTestResult[] = grade.structural.checks.map((check) => ({
    id: `structural:${check.id}`,
    name: check.description,
    scope: 'structure',
    kind: 'structural',
    status: check.passed ? 'passed' : 'failed',
    pointsEarned: 0,
    pointsPossible: 0,
    ...(check.detail ? { detail: check.detail } : {})
  }))

  for (const entry of grade.graded.cases) {
    if (entry.rubric) {
      for (const check of entry.rubric.checks) {
        const detail = check.passed
          ? check.detail
          : rubricFailureDetail(check.detail, check.actual, check.metric, check.op, check.value)
        tests.push({
          id: `${entry.id}:${check.id}`,
          name: check.description,
          scope: entry.id,
          kind: 'rubric',
          status: check.passed ? 'passed' : 'failed',
          pointsEarned: check.awarded,
          pointsPossible: check.points,
          ...(detail ? { detail } : {})
        })
      }
      continue
    }

    tests.push({
      id: `${entry.id}:did-not-run`,
      name: `Case ${entry.id} could not run`,
      scope: entry.id,
      kind: 'execution',
      status: 'failed',
      pointsEarned: 0,
      pointsPossible: 0,
      ...(entry.error ? { detail: entry.error } : {})
    })
  }

  return tests
}

function buildQuestionSummary(
  tests: readonly QuestionEvaluationTestResult[]
): QuestionEvaluationSummary {
  const passedTests = tests.filter((test) => test.status === 'passed').length
  return {
    totalTests: tests.length,
    passedTests,
    failedTests: tests.length - passedTests,
    structuralFailures: tests.filter(
      (test) => test.kind === 'structural' && test.status === 'failed'
    ).length,
    rubricFailures: tests.filter((test) => test.kind === 'rubric' && test.status === 'failed')
      .length,
    executionFailures: tests.filter((test) => test.kind === 'execution' && test.status === 'failed')
      .length
  }
}

export function buildQuestionEvaluationContract(
  question: QuestionPackage,
  topology: Pick<TopologyJSON, 'id' | 'version'>,
  grade: AttemptGrade,
  options?: {
    simulatorVersion?: string
    attemptId?: string
    submissionId?: string
    topologyId?: string
    evaluatedAt?: string
  }
): SuccessfulQuestionEvaluationContract {
  const tests = buildQuestionTests(grade)
  return {
    version: QUESTION_EVALUATION_CONTRACT_VERSION,
    mode: 'question',
    ...(options?.simulatorVersion ? { simulatorVersion: options.simulatorVersion } : {}),
    questionId: question.id,
    questionVersion: question.version,
    topologyId: options?.topologyId ?? topology.id,
    topologySchemaVersion: topology.version,
    ...(options?.attemptId ? { attemptId: options.attemptId } : {}),
    ...(options?.submissionId ? { submissionId: options.submissionId } : {}),
    ...(options?.evaluatedAt ? { evaluatedAt: options.evaluatedAt } : {}),
    status: grade.contract.allPassed ? 'passed' : 'failed',
    score: buildQuestionScore(question, grade),
    summary: buildQuestionSummary(tests),
    tests,
    host: grade.contract,
    structural: grade.structural,
    graded: grade.graded
  }
}

export function buildQuestionEvaluationErrorContract(options: {
  questionId: string
  questionVersion?: string
  topologyId: string
  topologySchemaVersion?: string
  status: FailedQuestionEvaluationContract['status']
  message: string
  simulatorVersion?: string
  attemptId?: string
  submissionId?: string
  evaluatedAt?: string
}): FailedQuestionEvaluationContract {
  return {
    version: QUESTION_EVALUATION_CONTRACT_VERSION,
    mode: 'question',
    ...(options.simulatorVersion ? { simulatorVersion: options.simulatorVersion } : {}),
    questionId: options.questionId,
    questionVersion: options.questionVersion ?? 'unknown',
    topologyId: options.topologyId,
    topologySchemaVersion: options.topologySchemaVersion ?? 'unknown',
    ...(options.attemptId ? { attemptId: options.attemptId } : {}),
    ...(options.submissionId ? { submissionId: options.submissionId } : {}),
    ...(options.evaluatedAt ? { evaluatedAt: options.evaluatedAt } : {}),
    status: options.status,
    score: { earned: 0, possible: 0, fraction: 0 },
    summary: {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      structuralFailures: 0,
      rubricFailures: 0,
      executionFailures: 0
    },
    tests: [],
    host: {
      tests: [],
      totalTests: 0,
      passedTests: 0,
      allPassed: false
    },
    error: {
      code: options.status === 'invalid_submission' ? 'INVALID_SUBMISSION' : 'EVALUATION_ERROR',
      message: options.message
    }
  }
}

export function buildQuestionEvaluationBatch(
  results: QuestionEvaluationContract[],
  options?: {
    simulatorVersion?: string
    evaluatedAt?: string
  }
): QuestionEvaluationBatch {
  return {
    version: QUESTION_EVALUATION_BATCH_VERSION,
    mode: 'question-batch',
    ...(options?.simulatorVersion ? { simulatorVersion: options.simulatorVersion } : {}),
    ...(options?.evaluatedAt ? { evaluatedAt: options.evaluatedAt } : {}),
    results,
    summary: {
      total: results.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status === 'failed').length,
      invalidSubmissions: results.filter((result) => result.status === 'invalid_submission').length,
      evaluationErrors: results.filter((result) => result.status === 'evaluation_error').length
    }
  }
}
