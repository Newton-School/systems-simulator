import type {
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

function isQuestionPackage(value: unknown): value is QuestionPackage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.type === 'string' &&
    isRecord(value.prompt) &&
    isRecord(value.scaffold) &&
    isRecord(value.constraints) &&
    isRecord(value.suite) &&
    isRecord(value.rubric)
  )
}

function getHostTargetOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : '*'
  } catch {
    return '*'
  }
}

export function isQuestionLaunchContextMessage(
  value: unknown
): value is QuestionLaunchContextMessage {
  if (!isRecord(value) || value.type !== 'ns-simulator:launch-context' || !isRecord(value.payload)) {
    return false
  }

  return isQuestionPackage(value.payload.questionPackage)
}

export function postQuestionHostMessage(message: QuestionHostOutboundMessage): void {
  if (window.parent === window) {
    return
  }

  window.parent.postMessage(message, getHostTargetOrigin())
}
