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

/** Host lifecycle commands that drive the attempt after launch. */
export type QuestionHostCommand = 'reset' | 'lock' | 'reveal'

export interface QuestionCommandMessage {
  type: 'ns-simulator:command'
  command: QuestionHostCommand
}

export type QuestionHostInboundMessage = QuestionLaunchContextMessage | QuestionCommandMessage
export type QuestionHostOutboundMessage =
  | QuestionReadyMessage
  | QuestionSubmitMessage
  | QuestionErrorMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

/**
 * Host origins the embedder explicitly declared via `?hostOrigin=` on the iframe
 * src (comma-separated). When present these are enforced strictly; when absent we
 * fall back to trust-on-first-use against the launch-context origin.
 */
export function resolveConfiguredHostOrigins(): string[] {
  if (typeof window === 'undefined') {
    return []
  }
  const raw = new URLSearchParams(window.location.search).get('hostOrigin')
  if (!raw) {
    return []
  }
  const origins: string[] = []
  for (const part of raw.split(',')) {
    const origin = normalizeOrigin(part)
    if (origin && !origins.includes(origin)) {
      origins.push(origin)
    }
  }
  return origins
}

function referrerOrigin(): string | null {
  if (typeof document === 'undefined' || !document.referrer) {
    return null
  }
  return normalizeOrigin(document.referrer)
}

// The host origin locked in once a valid launch-context arrives (TOFU) or matched
// against the configured allowlist. All sensitive outbound messages target this.
let trustedHostOrigin: string | null = null

export function rememberTrustedHostOrigin(origin: string): void {
  if (!trustedHostOrigin) {
    trustedHostOrigin = origin
  }
}

export function getTrustedHostOrigin(): string | null {
  return trustedHostOrigin
}

/** Test-only: clears the locked host origin between cases. */
export function resetTrustedHostOrigin(): void {
  trustedHostOrigin = null
}

/**
 * Pure allow-check: with a configured allowlist, only those origins pass; without
 * one, the first origin passes (TOFU) and, once locked, only that origin passes.
 */
export function isHostOriginAllowed(
  origin: string,
  context: { configured: readonly string[]; trusted: string | null }
): boolean {
  if (context.configured.length > 0) {
    return context.configured.includes(origin)
  }
  if (context.trusted) {
    return origin === context.trusted
  }
  return true
}

/**
 * Pure target resolver. Sensitive messages (submit/error) MUST go to the trusted
 * host and are dropped (null) if it is unknown. The content-less `ready` bootstrap
 * may fall back to a single configured origin, the referrer, or `'*'` as a last
 * resort so the initial handshake can complete.
 */
export function computeHostTargetOrigin(
  messageType: QuestionHostOutboundMessage['type'],
  context: { trusted: string | null; configured: readonly string[]; referrer: string | null }
): string | null {
  if (messageType === 'ns-simulator:ready') {
    if (context.trusted) return context.trusted
    if (context.configured.length === 1) return context.configured[0]
    if (context.referrer) return context.referrer
    return '*'
  }
  return context.trusted
}

/** Runtime allow-check against the current window's configured + trusted origins. */
export function isAllowedHostOrigin(origin: string): boolean {
  return isHostOriginAllowed(origin, {
    configured: resolveConfiguredHostOrigins(),
    trusted: trustedHostOrigin
  })
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

export function parseQuestionCommandMessage(value: unknown): QuestionCommandMessage | null {
  if (!isRecord(value) || value.type !== 'ns-simulator:command') {
    return null
  }
  const { command } = value
  if (command === 'reset' || command === 'lock' || command === 'reveal') {
    return { type: 'ns-simulator:command', command }
  }
  return null
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

  const target = computeHostTargetOrigin(message.type, {
    trusted: trustedHostOrigin,
    configured: resolveConfiguredHostOrigins(),
    referrer: referrerOrigin()
  })

  if (target === null) {
    // Sensitive message (submit/error) with no established host origin - never
    // broadcast it. This should not happen in practice since these follow a
    // launch-context handshake that locks the trusted origin.
    console.warn(`[ns-simulator] Dropped "${message.type}" - no trusted host origin established.`)
    return
  }

  window.parent.postMessage(message, target)
}

export { buildGamePlaygroundLaunchPayload }
