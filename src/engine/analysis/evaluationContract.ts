import { z } from 'zod'
import type { TopologyJSON } from '../core/types'
import {
  GradedEvaluationBatchSchema,
  HostContractSchema,
  StructuralEvaluationSchema,
  flattenAttemptCheckRows,
  type AttemptGrade,
  type HostContract,
  type QuestionPackage
} from './question'
import type { GradedEvaluationBatch } from './rubric'
import type { StructuralEvaluation } from './structural'
import { SIMULATION_VERDICT_VERSION, type SimulationVerdict } from './verdict'

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

export type QuestionEvaluationTestKind = 'topology' | 'simulation' | 'invariant' | 'execution'

export interface QuestionEvaluationTestResult {
  id: string
  name: string
  scope: string
  kind: QuestionEvaluationTestKind
  status: 'passed' | 'failed' | 'skipped'
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
  skippedTests: number
  topologyFailures: number
  simulationFailures: number
  invariantFailures: number
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

function buildQuestionScore(
  _question: QuestionPackage,
  grade: AttemptGrade
): QuestionEvaluationScore {
  return grade.graded.score
}

function buildQuestionTests(grade: AttemptGrade): QuestionEvaluationTestResult[] {
  return flattenAttemptCheckRows(grade).map((row) => ({
    id: row.id,
    name: row.name,
    scope: row.scope,
    kind: row.kind,
    status: row.status,
    pointsEarned: row.pointsEarned,
    pointsPossible: row.pointsPossible,
    ...(row.detail ? { detail: row.detail } : {})
  }))
}

function buildQuestionSummary(
  tests: readonly QuestionEvaluationTestResult[]
): QuestionEvaluationSummary {
  const passedTests = tests.filter((test) => test.status === 'passed').length
  return {
    totalTests: tests.length,
    passedTests,
    failedTests: tests.filter((test) => test.status === 'failed').length,
    skippedTests: tests.filter((test) => test.status === 'skipped').length,
    topologyFailures: tests.filter((test) => test.kind === 'topology' && test.status === 'failed')
      .length,
    simulationFailures: tests.filter(
      (test) => test.kind === 'simulation' && test.status === 'failed'
    ).length,
    invariantFailures: tests.filter((test) => test.kind === 'invariant' && test.status === 'failed')
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
      skippedTests: 0,
      topologyFailures: 0,
      simulationFailures: 0,
      invariantFailures: 0,
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

const IsoTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO timestamp.')

const SimulationVerdictSchema = z.custom<SimulationVerdict>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === SIMULATION_VERDICT_VERSION,
  'Expected a SimulationVerdict.'
)

const ScenarioEvaluationResultSchema: z.ZodType<ScenarioEvaluationResult> = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        scenarioId: z.string().min(1),
        scenarioName: z.string().min(1).optional(),
        status: z.literal('completed'),
        verdict: SimulationVerdictSchema
      })
      .strict(),
    z
      .object({
        scenarioId: z.string().min(1),
        scenarioName: z.string().min(1).optional(),
        status: z.literal('error'),
        error: z.string().min(1)
      })
      .strict(),
    z
      .object({
        scenarioId: z.string().min(1),
        scenarioName: z.string().min(1).optional(),
        status: z.literal('timeout'),
        error: z.string().min(1)
      })
      .strict()
  ]
)

export const ScenarioEvaluationContractSchema: z.ZodType<ScenarioEvaluationContract> = z
  .object({
    version: z.literal(SCENARIO_EVALUATION_CONTRACT_VERSION),
    simulatorVersion: z.string().min(1).optional(),
    topologyId: z.string().min(1),
    topologySchemaVersion: z.string().min(1),
    submissionId: z.string().min(1).optional(),
    evaluatedAt: IsoTimestampSchema.optional(),
    verdicts: z.array(ScenarioEvaluationResultSchema),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        errored: z.number().int().nonnegative(),
        timedOut: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict()
  .superRefine((value, ctx) => {
    const completed = value.verdicts.filter((entry) => entry.status === 'completed').length
    const timedOut = value.verdicts.filter((entry) => entry.status === 'timeout').length
    const errored = value.verdicts.filter((entry) => entry.status === 'error').length

    if (value.summary.total !== value.verdicts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'total'],
        message: 'summary.total must match verdicts.length.'
      })
    }

    if (value.summary.completed !== completed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'completed'],
        message: 'summary.completed must match completed verdict rows.'
      })
    }

    if (value.summary.errored !== errored) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'errored'],
        message: 'summary.errored must match errored verdict rows.'
      })
    }

    if (value.summary.timedOut !== timedOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'timedOut'],
        message: 'summary.timedOut must match timeout verdict rows.'
      })
    }
  })

const QuestionEvaluationTestKindSchema = z.enum(['topology', 'simulation', 'invariant', 'execution'])
const QuestionEvaluationTestStatusSchema = z.enum(['passed', 'failed', 'skipped'])

export const QuestionEvaluationTestResultSchema: z.ZodType<QuestionEvaluationTestResult> = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    scope: z.string().min(1),
    kind: QuestionEvaluationTestKindSchema,
    status: QuestionEvaluationTestStatusSchema,
    pointsEarned: z.number().finite().nonnegative(),
    pointsPossible: z.number().finite().nonnegative(),
    detail: z.string().min(1).optional()
  })
  .strict()

export const QuestionEvaluationScoreSchema: z.ZodType<QuestionEvaluationScore> = z
  .object({
    earned: z.number().finite().nonnegative(),
    possible: z.number().finite().nonnegative(),
    fraction: z.number().finite().min(0).max(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.earned > value.possible) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['earned'],
        message: 'earned must be less than or equal to possible.'
      })
    }
  })

export const QuestionEvaluationSummarySchema: z.ZodType<QuestionEvaluationSummary> = z
  .object({
    totalTests: z.number().int().nonnegative(),
    passedTests: z.number().int().nonnegative(),
    failedTests: z.number().int().nonnegative(),
    skippedTests: z.number().int().nonnegative(),
    topologyFailures: z.number().int().nonnegative(),
    simulationFailures: z.number().int().nonnegative(),
    invariantFailures: z.number().int().nonnegative(),
    executionFailures: z.number().int().nonnegative()
  })
  .strict()

export const QuestionEvaluationErrorSchema: z.ZodType<QuestionEvaluationError> = z
  .object({
    code: z.enum(['INVALID_SUBMISSION', 'EVALUATION_ERROR']),
    message: z.string().min(1)
  })
  .strict()

const QuestionEvaluationContractBaseSchema = z
  .object({
    version: z.literal(QUESTION_EVALUATION_CONTRACT_VERSION),
    mode: z.literal('question'),
    simulatorVersion: z.string().min(1).optional(),
    questionId: z.string().min(1),
    questionVersion: z.string().min(1),
    topologyId: z.string().min(1),
    topologySchemaVersion: z.string().min(1),
    attemptId: z.string().min(1).optional(),
    submissionId: z.string().min(1).optional(),
    evaluatedAt: IsoTimestampSchema.optional()
  })
  .strict()

function validateQuestionSummary(
  tests: readonly QuestionEvaluationTestResult[],
  summary: QuestionEvaluationSummary,
  ctx: z.RefinementCtx
): void {
  const expected = buildQuestionSummary(tests)

  if (summary.totalTests !== expected.totalTests) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'totalTests'],
      message: 'summary.totalTests must match tests.length.'
    })
  }

  if (summary.passedTests !== expected.passedTests) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'passedTests'],
      message: 'summary.passedTests must match the number of passed tests.'
    })
  }

  if (summary.failedTests !== expected.failedTests) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'failedTests'],
      message: 'summary.failedTests must match the number of failed tests.'
    })
  }

  if (summary.skippedTests !== expected.skippedTests) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'skippedTests'],
      message: 'summary.skippedTests must match the number of skipped tests.'
    })
  }

  if (summary.topologyFailures !== expected.topologyFailures) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'topologyFailures'],
      message: 'summary.topologyFailures must match failed topology tests.'
    })
  }

  if (summary.simulationFailures !== expected.simulationFailures) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'simulationFailures'],
      message: 'summary.simulationFailures must match failed simulation tests.'
    })
  }

  if (summary.invariantFailures !== expected.invariantFailures) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'invariantFailures'],
      message: 'summary.invariantFailures must match failed invariant tests.'
    })
  }

  if (summary.executionFailures !== expected.executionFailures) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary', 'executionFailures'],
      message: 'summary.executionFailures must match failed execution tests.'
    })
  }
}

function validateHostAlignment(
  tests: readonly QuestionEvaluationTestResult[],
  host: HostContract,
  ctx: z.RefinementCtx
): void {
  if (host.tests.length !== tests.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['host', 'tests'],
      message: 'host.tests must align one-to-one with tests.'
    })
    return
  }

  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index]
    const hostTest = host.tests[index]
    const expectedPassed = test.status === 'passed'

    if (hostTest.id !== test.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['host', 'tests', index, 'id'],
        message: 'host test id must match the corresponding test row id.'
      })
    }

    if (hostTest.name !== test.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['host', 'tests', index, 'name'],
        message: 'host test name must match the corresponding test row name.'
      })
    }

    if (hostTest.passed !== expectedPassed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['host', 'tests', index, 'passed'],
        message: 'host test passed flag must match the corresponding test status.'
      })
    }
  }
}

const SuccessfulQuestionEvaluationContractSchema = QuestionEvaluationContractBaseSchema.extend({
  status: z.enum(['passed', 'failed']),
  score: QuestionEvaluationScoreSchema,
  summary: QuestionEvaluationSummarySchema,
  tests: z.array(QuestionEvaluationTestResultSchema),
  host: HostContractSchema,
  structural: StructuralEvaluationSchema,
  graded: GradedEvaluationBatchSchema
}).superRefine((value, ctx) => {
  validateQuestionSummary(value.tests, value.summary, ctx)
  validateHostAlignment(value.tests, value.host, ctx)

  const failedTests = value.summary.failedTests
  if (value.status === 'passed' && (!value.host.allPassed || failedTests > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'status passed requires all host-visible tests to pass.'
    })
  }

  if (value.status === 'failed' && value.host.allPassed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'status failed cannot report allPassed in the host contract.'
    })
  }
})

const FailedQuestionEvaluationContractSchema = QuestionEvaluationContractBaseSchema.extend({
  status: z.enum(['invalid_submission', 'evaluation_error']),
  score: QuestionEvaluationScoreSchema,
  summary: QuestionEvaluationSummarySchema,
  tests: z.array(QuestionEvaluationTestResultSchema),
  host: HostContractSchema,
  error: QuestionEvaluationErrorSchema
}).superRefine((value, ctx) => {
  if (value.tests.length !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tests'],
      message: 'Error contracts must not include tests.'
    })
  }

  if (
    value.host.tests.length !== 0 ||
    value.host.totalTests !== 0 ||
    value.host.passedTests !== 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['host'],
      message: 'Error contracts must expose an empty host test contract.'
    })
  }

  if (value.host.allPassed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['host', 'allPassed'],
      message: 'Error contracts cannot report allPassed.'
    })
  }

  validateQuestionSummary(value.tests, value.summary, ctx)

  if (value.score.earned !== 0 || value.score.possible !== 0 || value.score.fraction !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['score'],
      message: 'Error contracts must expose a zeroed score.'
    })
  }
})

export const QuestionEvaluationContractSchema = z.discriminatedUnion('status', [
  SuccessfulQuestionEvaluationContractSchema,
  FailedQuestionEvaluationContractSchema
])

export const QuestionEvaluationBatchSchema: z.ZodType<QuestionEvaluationBatch> = z
  .object({
    version: z.literal(QUESTION_EVALUATION_BATCH_VERSION),
    mode: z.literal('question-batch'),
    simulatorVersion: z.string().min(1).optional(),
    evaluatedAt: IsoTimestampSchema.optional(),
    results: z.array(QuestionEvaluationContractSchema),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        invalidSubmissions: z.number().int().nonnegative(),
        evaluationErrors: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict()
  .superRefine((value, ctx) => {
    const passed = value.results.filter((result) => result.status === 'passed').length
    const failed = value.results.filter((result) => result.status === 'failed').length
    const invalidSubmissions = value.results.filter(
      (result) => result.status === 'invalid_submission'
    ).length
    const evaluationErrors = value.results.filter(
      (result) => result.status === 'evaluation_error'
    ).length

    if (value.summary.total !== value.results.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'total'],
        message: 'summary.total must match results.length.'
      })
    }

    if (value.summary.passed !== passed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'passed'],
        message: 'summary.passed must match passed result rows.'
      })
    }

    if (value.summary.failed !== failed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'failed'],
        message: 'summary.failed must match failed result rows.'
      })
    }

    if (value.summary.invalidSubmissions !== invalidSubmissions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'invalidSubmissions'],
        message: 'summary.invalidSubmissions must match invalid submission rows.'
      })
    }

    if (value.summary.evaluationErrors !== evaluationErrors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'evaluationErrors'],
        message: 'summary.evaluationErrors must match evaluation error rows.'
      })
    }
  })

export function parseScenarioEvaluationContract(raw: unknown): ScenarioEvaluationContract {
  return ScenarioEvaluationContractSchema.parse(raw)
}

export function parseQuestionEvaluationContract(raw: unknown): QuestionEvaluationContract {
  return QuestionEvaluationContractSchema.parse(raw)
}

export function parseQuestionEvaluationBatch(raw: unknown): QuestionEvaluationBatch {
  return QuestionEvaluationBatchSchema.parse(raw)
}
