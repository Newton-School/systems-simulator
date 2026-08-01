import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  QUESTION_EVALUATION_CONTRACT_VERSION,
  buildQuestionEvaluationBatch,
  buildQuestionEvaluationErrorContract,
  type QuestionEvaluationBatch,
  type QuestionEvaluationContract
} from '../engine/analysis/evaluationContract'
import type { QuestionPackage } from '../engine/analysis/question'
import type { TopologyJSON } from '../engine/core/types'

const DEFAULT_QUESTION_TIMEOUT_MS = 30_000
const MAX_CHILD_OUTPUT_BYTES = 10 * 1024 * 1024
const CLI_ENTRY_PATH = resolve(__dirname, 'index.ts')

export interface PreparedQuestionEvaluationAttempt {
  question: QuestionPackage
  topology: TopologyJSON
  attemptId?: string
  submissionId?: string
}

export interface IsolatedQuestionBatchOptions {
  simulatorVersion?: string
  evaluatedAt?: string
  timeoutMs?: number
  executeAttempt?: (
    attempt: PreparedQuestionEvaluationAttempt,
    timeoutMs: number
  ) => QuestionEvaluationContract
}

function attemptMetadata(attempt: PreparedQuestionEvaluationAttempt, fallbackIndex: number) {
  return {
    questionId: attempt.question.id || `question-${fallbackIndex + 1}`,
    questionVersion: attempt.question.version,
    topologyId: attempt.topology.id || `topology-${fallbackIndex + 1}`,
    topologySchemaVersion: attempt.topology.version,
    ...(attempt.attemptId ? { attemptId: attempt.attemptId } : {}),
    ...(attempt.submissionId ? { submissionId: attempt.submissionId } : {})
  }
}

function parseQuestionEvaluationContract(stdout: string): QuestionEvaluationContract | null {
  try {
    const parsed = JSON.parse(stdout) as Partial<QuestionEvaluationContract>
    if (
      parsed &&
      parsed.version === QUESTION_EVALUATION_CONTRACT_VERSION &&
      parsed.mode === 'question' &&
      typeof parsed.status === 'string'
    ) {
      return parsed as QuestionEvaluationContract
    }
  } catch {
    return null
  }

  return null
}

function runQuestionEvaluationIsolated(
  attempt: PreparedQuestionEvaluationAttempt,
  timeoutMs: number,
  options: Pick<IsolatedQuestionBatchOptions, 'simulatorVersion' | 'evaluatedAt'>,
  fallbackIndex: number
): QuestionEvaluationContract {
  const tempDir = mkdtempSync(join(tmpdir(), 'ns-sim-question-'))
  const questionPath = resolve(tempDir, 'question.json')
  const topologyPath = resolve(tempDir, 'topology.json')
  const metadata = attemptMetadata(attempt, fallbackIndex)

  try {
    writeFileSync(questionPath, JSON.stringify(attempt.question, null, 2), 'utf-8')
    writeFileSync(topologyPath, JSON.stringify(attempt.topology, null, 2), 'utf-8')

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        CLI_ENTRY_PATH,
        'evaluate',
        'question',
        questionPath,
        topologyPath,
        ...(attempt.attemptId ? ['--attempt-id', attempt.attemptId] : []),
        ...(attempt.submissionId ? ['--submission-id', attempt.submissionId] : []),
        ...(options.evaluatedAt ? ['--evaluated-at', options.evaluatedAt] : [])
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: MAX_CHILD_OUTPUT_BYTES
      }
    )

    const parsed = parseQuestionEvaluationContract(child.stdout)
    if (parsed) {
      return parsed
    }

    if (child.error?.name === 'TimeoutError' || child.error?.message.includes('ETIMEDOUT')) {
      return buildQuestionEvaluationErrorContract({
        ...metadata,
        simulatorVersion: options.simulatorVersion,
        evaluatedAt: options.evaluatedAt,
        status: 'evaluation_error',
        message: `Attempt exceeded timeout of ${timeoutMs}ms`
      })
    }

    if (child.error) {
      return buildQuestionEvaluationErrorContract({
        ...metadata,
        simulatorVersion: options.simulatorVersion,
        evaluatedAt: options.evaluatedAt,
        status: 'evaluation_error',
        message: child.error.message
      })
    }

    const detail = (
      child.stderr ||
      child.stdout ||
      `Process exited with code ${child.status ?? 'unknown'}`
    ).trim()
    return buildQuestionEvaluationErrorContract({
      ...metadata,
      simulatorVersion: options.simulatorVersion,
      evaluatedAt: options.evaluatedAt,
      status: 'evaluation_error',
      message: detail || 'Question evaluation did not emit a parseable contract.'
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function runQuestionBatchIsolated(
  attempts: readonly PreparedQuestionEvaluationAttempt[],
  options: IsolatedQuestionBatchOptions = {}
): QuestionEvaluationBatch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUESTION_TIMEOUT_MS

  const results = attempts.map((attempt, index) => {
    try {
      return options.executeAttempt
        ? options.executeAttempt(attempt, timeoutMs)
        : runQuestionEvaluationIsolated(attempt, timeoutMs, options, index)
    } catch (err) {
      return buildQuestionEvaluationErrorContract({
        ...attemptMetadata(attempt, index),
        simulatorVersion: options.simulatorVersion,
        evaluatedAt: options.evaluatedAt,
        status: 'evaluation_error',
        message: (err as Error).message
      })
    }
  })

  return buildQuestionEvaluationBatch(results, {
    simulatorVersion: options.simulatorVersion,
    evaluatedAt: options.evaluatedAt
  })
}
