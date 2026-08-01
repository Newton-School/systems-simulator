import { parseAttemptState, parseQuestionPackage } from '../../../engine/analysis/question'
import type { AttemptState, HostContract, QuestionPackage } from '../../../engine/analysis/question'

export interface QuestionLaunchContextPayload {
  questionPackage: QuestionPackage
  priorAttempt?: AttemptState
  environmentProfile?: unknown
}

export interface QuestionLaunchContextMessage {
  type: 'ns-simulator:launch-context'
  payload: QuestionLaunchContextPayload
}

export interface QuestionReadyMessage {
  type: 'ns-simulator:ready'
}

export interface QuestionSubmitMessage {
  type: 'ns-simulator:submit'
  payload: {
    contract: HostContract
    attemptState: AttemptState
  }
}

export interface QuestionErrorMessage {
  type: 'ns-simulator:error'
  message: string
}

export type QuestionHostInboundMessage = QuestionLaunchContextMessage
export type QuestionHostOutboundMessage =
  | QuestionReadyMessage
  | QuestionSubmitMessage
  | QuestionErrorMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHostContract(value: unknown): value is HostContract {
  if (!isRecord(value) || !Array.isArray(value.tests)) {
    return false
  }

  return (
    typeof value.totalTests === 'number' &&
    typeof value.passedTests === 'number' &&
    typeof value.allPassed === 'boolean' &&
    value.tests.every(
      (test) =>
        isRecord(test) &&
        typeof test.id === 'string' &&
        typeof test.name === 'string' &&
        typeof test.passed === 'boolean' &&
        (test.detail === undefined || typeof test.detail === 'string')
    )
  )
}

function getHostTargetOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : '*'
  } catch {
    return '*'
  }
}

export function parseQuestionLaunchContextMessage(
  value: unknown
): QuestionLaunchContextMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'ns-simulator:launch-context' ||
    !isRecord(value.payload)
  ) {
    return null
  }

  try {
    const questionPackage = parseQuestionPackage(value.payload.questionPackage)
    const priorAttempt =
      value.payload.priorAttempt === undefined
        ? undefined
        : parseAttemptState(value.payload.priorAttempt, questionPackage.id)

    return {
      type: 'ns-simulator:launch-context',
      payload: {
        questionPackage,
        ...(priorAttempt ? { priorAttempt } : {}),
        ...(value.payload.environmentProfile !== undefined
          ? { environmentProfile: value.payload.environmentProfile }
          : {})
      }
    }
  } catch {
    return null
  }
}

export function isQuestionLaunchContextMessage(
  value: unknown
): value is QuestionLaunchContextMessage {
  return parseQuestionLaunchContextMessage(value) !== null
}

export function parseQuestionHostOutboundMessage(
  value: unknown,
  expectedQuestionId?: string
): QuestionHostOutboundMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }

  if (value.type === 'ns-simulator:ready') {
    return { type: 'ns-simulator:ready' }
  }

  if (value.type === 'ns-simulator:error') {
    return typeof value.message === 'string'
      ? { type: 'ns-simulator:error', message: value.message }
      : null
  }

  if (value.type !== 'ns-simulator:submit' || !isRecord(value.payload)) {
    return null
  }

  if (!isHostContract(value.payload.contract)) {
    return null
  }

  try {
    const attemptState = parseAttemptState(value.payload.attemptState, expectedQuestionId)
    return {
      type: 'ns-simulator:submit',
      payload: {
        contract: value.payload.contract,
        attemptState
      }
    }
  } catch {
    return null
  }
}

export function postQuestionHostMessage(message: QuestionHostOutboundMessage): void {
  if (window.parent === window) {
    return
  }

  window.parent.postMessage(message, getHostTargetOrigin())
}
