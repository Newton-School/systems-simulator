/**
 * Append-only archive of sealed evaluation envelopes.
 *
 * Unlike `questionAttemptPersistence` (a mutable, best-effort autosave of the
 * *in-progress* attempt that is overwritten on every save), this archive stores
 * *submissions* immutably: once an envelope is written under its submissionId it
 * is never overwritten, and reads verify the envelope's integrity checksum
 * before trusting it. Corrupt entries are reported, never silently deleted — an
 * audit archive must not erase evidence.
 */
import {
  parseEvaluationEnvelope,
  verifyEvaluationEnvelope,
  type EvaluationEnvelope
} from '../../../engine/analysis/evaluationEnvelope'

const STORAGE_PREFIX = 'ns-simulator.submission.v1'

function submissionKey(submissionId: string): string {
  return `${STORAGE_PREFIX}:${submissionId}`
}

function indexKey(questionId: string): string {
  return `${STORAGE_PREFIX}.index:${questionId}`
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export type ArchiveOutcome =
  | { stored: true }
  | { stored: false; reason: 'already-archived' | 'no-storage' | 'error' }

function readIndex(storage: Storage, questionId: string): string[] {
  const raw = storage.getItem(indexKey(questionId))
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * Archives a sealed envelope. Immutable: if a submission with the same id is
 * already archived, the existing record is kept and `already-archived` is
 * returned rather than overwriting it.
 */
export function archiveSubmission(envelope: EvaluationEnvelope): ArchiveOutcome {
  const storage = getStorage()
  if (!storage) {
    return { stored: false, reason: 'no-storage' }
  }

  const key = submissionKey(envelope.submissionId)
  if (storage.getItem(key) !== null) {
    return { stored: false, reason: 'already-archived' }
  }

  try {
    storage.setItem(key, JSON.stringify(envelope))
    const index = readIndex(storage, envelope.questionId)
    if (!index.includes(envelope.submissionId)) {
      index.push(envelope.submissionId)
      storage.setItem(indexKey(envelope.questionId), JSON.stringify(index))
    }
    return { stored: true }
  } catch {
    // Roll back a partial write so the archive never holds an unindexed blob.
    try {
      storage.removeItem(key)
    } catch {
      // ignore
    }
    return { stored: false, reason: 'error' }
  }
}

/**
 * Loads and verifies a single archived envelope. Returns null if it is missing,
 * unparseable, or fails its integrity check — the stored bytes are left intact.
 */
export function loadArchivedSubmission(submissionId: string): EvaluationEnvelope | null {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  const raw = storage.getItem(submissionKey(submissionId))
  if (!raw) {
    return null
  }

  try {
    const envelope = parseEvaluationEnvelope(JSON.parse(raw))
    return verifyEvaluationEnvelope(envelope).valid ? envelope : null
  } catch {
    return null
  }
}

/** Lists the archived submission ids for a question, oldest first. */
export function listArchivedSubmissionIds(questionId: string): string[] {
  const storage = getStorage()
  if (!storage) {
    return []
  }
  return readIndex(storage, questionId)
}

/** Loads every verifiable archived envelope for a question, oldest first. */
export function loadArchivedSubmissions(questionId: string): EvaluationEnvelope[] {
  const envelopes: EvaluationEnvelope[] = []
  for (const submissionId of listArchivedSubmissionIds(questionId)) {
    const envelope = loadArchivedSubmission(submissionId)
    if (envelope) {
      envelopes.push(envelope)
    }
  }
  return envelopes
}
