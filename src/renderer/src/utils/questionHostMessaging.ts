import {
  parseAttemptState,
  parseQuestionPackage,
  AttemptState,
  HostContract,
  QuestionPackage
} from '../../../engine/analysis/question'

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
  if (!isRecord(value) || value.type !== 'ns-simulator:launch-context' || !isRecord(value.payload)) {
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

export function postQuestionHostMessage(message: QuestionHostOutboundMessage): void {
  if (window.parent === window) {
    return
  }

  window.parent.postMessage(message, getHostTargetOrigin())
}
