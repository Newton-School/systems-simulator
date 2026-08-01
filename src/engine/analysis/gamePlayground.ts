import { z } from 'zod'
import {
  parseQuestionEvaluationContract,
  type QuestionEvaluationContract
} from './evaluationContract'
import {
  HostContractSchema,
  HostTestSchema,
  parseAttemptState,
  parseQuestionPackage,
  type AttemptState,
  type HostContract,
  type HostTest,
  type QuestionPackage
} from './question'

export const GAME_PLAYGROUND_PAYLOAD_VERSION = '1.0' as const

export interface GamePlaygroundResult {
  version: typeof GAME_PLAYGROUND_PAYLOAD_VERSION
  status: QuestionEvaluationContract['status']
  tests: HostTest[]
  totalTests: number
  passedTests: number
  allPassed: boolean
}

export interface GamePlaygroundLaunchPayload {
  version: typeof GAME_PLAYGROUND_PAYLOAD_VERSION
  questionPackage: QuestionPackage
  priorAttempt?: AttemptState
  environmentProfile?: unknown
}

export interface GamePlaygroundSubmitPayload {
  version: typeof GAME_PLAYGROUND_PAYLOAD_VERSION
  questionId: string
  questionVersion: string
  attemptId: string
  submissionId?: string
  result: GamePlaygroundResult
  attemptState: AttemptState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const QuestionEvaluationStatusSchema = z.enum([
  'passed',
  'failed',
  'invalid_submission',
  'evaluation_error'
])

export const GamePlaygroundResultSchema: z.ZodType<GamePlaygroundResult> = z
  .object({
    version: z.literal(GAME_PLAYGROUND_PAYLOAD_VERSION),
    status: QuestionEvaluationStatusSchema,
    tests: z.array(HostTestSchema),
    totalTests: z.number().int().nonnegative(),
    passedTests: z.number().int().nonnegative(),
    allPassed: z.boolean()
  })
  .strict()
  .superRefine((value, ctx) => {
    const host = HostContractSchema.safeParse(value)
    if (!host.success) {
      for (const issue of host.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message
        })
      }
    }

    if (value.status === 'passed' && !value.allPassed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'passed status requires allPassed to be true.'
      })
    }

    if (
      (value.status === 'invalid_submission' || value.status === 'evaluation_error') &&
      (value.tests.length !== 0 ||
        value.totalTests !== 0 ||
        value.passedTests !== 0 ||
        value.allPassed)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'error statuses must collapse to an empty boolean contract.'
      })
    }
  })

export function buildGamePlaygroundResult(
  contract: HostContract,
  status: GamePlaygroundResult['status'] = contract.allPassed ? 'passed' : 'failed'
): GamePlaygroundResult {
  const result: GamePlaygroundResult = {
    version: GAME_PLAYGROUND_PAYLOAD_VERSION,
    status,
    tests: contract.tests.map((test) => ({ ...test })),
    totalTests: contract.totalTests,
    passedTests: contract.passedTests,
    allPassed: contract.allPassed
  }

  return parseGamePlaygroundResult(result)
}

export function buildGamePlaygroundResultFromEvaluationContract(
  contract: QuestionEvaluationContract
): GamePlaygroundResult {
  return buildGamePlaygroundResult(contract.host, contract.status)
}

export function parseGamePlaygroundResult(raw: unknown): GamePlaygroundResult {
  return GamePlaygroundResultSchema.parse(raw)
}

export function buildGamePlaygroundLaunchPayload(
  questionPackage: QuestionPackage,
  options: {
    priorAttempt?: AttemptState
    environmentProfile?: unknown
  } = {}
): GamePlaygroundLaunchPayload {
  if (options.priorAttempt && options.priorAttempt.questionId !== questionPackage.id) {
    throw new Error('priorAttempt.questionId must match questionPackage.id.')
  }

  return {
    version: GAME_PLAYGROUND_PAYLOAD_VERSION,
    questionPackage,
    ...(options.priorAttempt ? { priorAttempt: options.priorAttempt } : {}),
    ...(options.environmentProfile !== undefined
      ? { environmentProfile: options.environmentProfile }
      : {})
  }
}

export function parseGamePlaygroundLaunchPayload(raw: unknown): GamePlaygroundLaunchPayload {
  if (!isRecord(raw) || raw.version !== GAME_PLAYGROUND_PAYLOAD_VERSION) {
    throw new Error('Expected a versioned Game Playground launch payload.')
  }

  const questionPackage = parseQuestionPackage(raw.questionPackage)
  const priorAttempt =
    raw.priorAttempt === undefined
      ? undefined
      : parseAttemptState(raw.priorAttempt, questionPackage.id)

  return buildGamePlaygroundLaunchPayload(questionPackage, {
    ...(priorAttempt ? { priorAttempt } : {}),
    ...(raw.environmentProfile !== undefined ? { environmentProfile: raw.environmentProfile } : {})
  })
}

export function buildGamePlaygroundSubmitPayload(
  question: Pick<QuestionPackage, 'id' | 'version'>,
  attemptState: AttemptState,
  result: GamePlaygroundResult,
  options: {
    submissionId?: string
  } = {}
): GamePlaygroundSubmitPayload {
  if (attemptState.questionId !== question.id) {
    throw new Error('attemptState.questionId must match the submitted question id.')
  }

  return {
    version: GAME_PLAYGROUND_PAYLOAD_VERSION,
    questionId: question.id,
    questionVersion: question.version,
    attemptId: attemptState.attemptId,
    ...(options.submissionId ? { submissionId: options.submissionId } : {}),
    result,
    attemptState
  }
}

export function parseGamePlaygroundSubmitPayload(
  raw: unknown,
  expectedQuestionId?: string
): GamePlaygroundSubmitPayload {
  if (!isRecord(raw)) {
    throw new Error('Expected a Game Playground submit payload object.')
  }

  const attemptState = parseAttemptState(raw.attemptState, expectedQuestionId)
  const questionId =
    typeof raw.questionId === 'string' && raw.questionId.length > 0
      ? raw.questionId
      : attemptState.questionId

  if (questionId !== attemptState.questionId) {
    throw new Error('submit payload questionId must match attemptState.questionId.')
  }

  if (expectedQuestionId && questionId !== expectedQuestionId) {
    throw new Error(`submit payload questionId must match ${expectedQuestionId}.`)
  }

  const attemptId =
    typeof raw.attemptId === 'string' && raw.attemptId.length > 0
      ? raw.attemptId
      : attemptState.attemptId

  if (attemptId !== attemptState.attemptId) {
    throw new Error('submit payload attemptId must match attemptState.attemptId.')
  }

  let result: GamePlaygroundResult
  if (raw.result !== undefined) {
    result = parseGamePlaygroundResult(raw.result)
  } else if (raw.contract !== undefined) {
    result = buildGamePlaygroundResult(HostContractSchema.parse(raw.contract))
  } else if (raw.evaluation !== undefined) {
    result = buildGamePlaygroundResultFromEvaluationContract(
      parseQuestionEvaluationContract(raw.evaluation)
    )
  } else {
    throw new Error('submit payload must include result, contract, or evaluation.')
  }

  const questionVersion =
    typeof raw.questionVersion === 'string' && raw.questionVersion.length > 0
      ? raw.questionVersion
      : 'unknown'
  const submissionId =
    typeof raw.submissionId === 'string' && raw.submissionId.length > 0
      ? raw.submissionId
      : undefined

  return {
    version: GAME_PLAYGROUND_PAYLOAD_VERSION,
    questionId,
    questionVersion,
    attemptId,
    ...(submissionId ? { submissionId } : {}),
    result,
    attemptState
  }
}
