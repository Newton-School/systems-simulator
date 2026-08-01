import {
  buildGamePlaygroundLaunchPayload,
  parseGamePlaygroundLaunchPayload,
  parseGamePlaygroundSubmitPayload,
  type GamePlaygroundLaunchPayload,
  type GamePlaygroundSubmitPayload
} from '../../../engine/analysis/gamePlayground'

export interface QuestionLaunchContextPayload {
  version: GamePlaygroundLaunchPayload['version']
  questionPackage: GamePlaygroundLaunchPayload['questionPackage']
  priorAttempt?: GamePlaygroundLaunchPayload['priorAttempt']
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
  payload: GamePlaygroundSubmitPayload
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
  if (
    !isRecord(value) ||
    value.type !== 'ns-simulator:launch-context' ||
    !isRecord(value.payload)
  ) {
    return null
  }

  try {
    return {
      type: 'ns-simulator:launch-context',
      payload: parseGamePlaygroundLaunchPayload({
        version: value.payload.version ?? '1.0',
        questionPackage: value.payload.questionPackage,
        ...(value.payload.priorAttempt !== undefined
          ? { priorAttempt: value.payload.priorAttempt }
          : {}),
        ...(value.payload.environmentProfile !== undefined
          ? { environmentProfile: value.payload.environmentProfile }
          : {})
      })
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

  try {
    return {
      type: 'ns-simulator:submit',
      payload: parseGamePlaygroundSubmitPayload(value.payload, expectedQuestionId)
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

export { buildGamePlaygroundLaunchPayload }
