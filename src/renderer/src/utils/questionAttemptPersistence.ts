import {
  parseAttemptState,
  resumePersistedAttempt,
  type AttemptState
} from '../../../engine/analysis/question'

const STORAGE_PREFIX = 'ns-simulator.question-attempt.v1'

function attemptStorageKey(questionId: string): string {
  return `${STORAGE_PREFIX}:${questionId}`
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function persistAttemptState(attempt: AttemptState): void {
  const storage = getStorage()
  if (!storage) {
    return
  }

  storage.setItem(attemptStorageKey(attempt.questionId), JSON.stringify(attempt))
}

export function loadPersistedAttemptState(questionId: string, now?: string): AttemptState | null {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  const raw = storage.getItem(attemptStorageKey(questionId))
  if (!raw) {
    return null
  }

  try {
    return resumePersistedAttempt(parseAttemptState(JSON.parse(raw), questionId), now)
  } catch {
    storage.removeItem(attemptStorageKey(questionId))
    return null
  }
}

export function clearPersistedAttemptState(questionId: string): void {
  const storage = getStorage()
  if (!storage) {
    return
  }

  storage.removeItem(attemptStorageKey(questionId))
}
