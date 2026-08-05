/**
 * Newton Game Playground wire adapter.
 *
 * The ns-simulator's *own* embed protocol (`ns-simulator:*`, see
 * `gamePlayground.ts` / `questionHostMessaging.ts`) is used by our own host. To
 * plug into `newton-web`'s **generic** game host with zero host-side changes, the
 * iframe must instead speak the platform's Game Playground contract documented in
 * *Game Playground — End-to-End Documentation*:
 *
 *   - handshake: the game posts the raw string `'ready-event'`; the host pushes a
 *     JSON-string **seed** (= `game_json` if present, else `initial_game_state`,
 *     merged with host metadata like `playgroundHash` / `read_only`).
 *   - saves: the game posts `JSON.stringify(blob)`; the backend persists it
 *     verbatim and reads only `test_cases_passed` / `all_test_cases_passed`.
 *   - the host may post the raw string `'save'` asking for the current state.
 *
 * For the ns-simulator the seed's game state is a self-contained `QuestionPackage`
 * (Strategy A — the package lives in `initial_game_state`; see
 * `newton-api-backend-integration.md` §2). Because the host replaces the seed
 * base with `game_json` after the first save, every save blob must **carry the
 * package forward**.
 *
 * This module is pure (no DOM / postMessage) — the renderer glue lives in
 * `newtonHostMessaging.ts`.
 */
import type { TopologyJSON } from '../core/types'
import type { GamePlaygroundResult } from './gamePlayground'
import {
  parseAttemptState,
  parseQuestionPackage,
  type AttemptState,
  type HostTest,
  type QuestionPackage
} from './question'

/** The raw string the game posts to announce it is listening. */
export const NEWTON_READY_EVENT = 'ready-event' as const
/** The raw string the host posts to ask the game to persist current state. */
export const NEWTON_SAVE_COMMAND = 'save' as const
export const NEWTON_SAVE_BLOB_VERSION = '1.0' as const

/** The parsed seed the host pushes into the iframe. */
export interface NewtonGameSeed {
  questionPackage: QuestionPackage
  /** Restored prior attempt (present on a reopen; absent on first open). */
  priorAttempt?: AttemptState
  /** Mentor / locked view — editing and submitting must be disabled. */
  readOnly: boolean
  /** The learner's playground hash, when the host provided one. */
  playgroundHash?: string
}

/**
 * The blob the game posts back, persisted verbatim as `game_json`. The two score
 * keys are top-level (the backend reads only those); the rest is carried forward
 * so a reopen fully restores the simulator.
 */
export interface NewtonSaveBlob {
  version: typeof NEWTON_SAVE_BLOB_VERSION
  /** Backend-read score keys. */
  test_cases_passed: number
  test_cases_total: number
  all_test_cases_passed: boolean
  /** The student's design, mirrored at the top level for direct inspection /
   * future server-side grading (also lives inside `attemptState`). */
  topology: TopologyJSON
  /** Carried forward so the next seed (= game_json) still restores everything. */
  questionPackage: QuestionPackage
  attemptState: AttemptState
  /** Advisory per-check detail for UI restore — never re-graded by the backend. */
  rubric_results: HostTest[]
  /** The student's free-text justification answers, by prompt id (persisted for grading/audit). */
  justification_answers?: Record<string, string>
  saved_at: string
}

export interface NewtonScoreKeys {
  test_cases_passed: number
  test_cases_total: number
  all_test_cases_passed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Normalizes the host's raw message data (a JSON string, or an object) to an object. */
function toSeedObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isRecord(raw) ? raw : null
}

/**
 * Parses a host seed into a `NewtonGameSeed`. Handles both shapes:
 *   - first open: the seed *is* the `QuestionPackage` (from `initial_game_state`),
 *   - reopen: the seed is a prior `NewtonSaveBlob` (`game_json`) with the package
 *     nested and a restorable `attemptState`.
 * Host metadata (`playgroundHash`, `read_only`, …) is read then stripped.
 * Throws if no valid `QuestionPackage` can be recovered.
 */
export function parseNewtonSeed(raw: unknown): NewtonGameSeed {
  const seed = toSeedObject(raw)
  if (!seed) {
    throw new Error('Newton seed must be a JSON object or JSON string.')
  }

  const readOnly = seed.read_only === true
  const playgroundHash =
    typeof seed.playgroundHash === 'string' && seed.playgroundHash.length > 0
      ? seed.playgroundHash
      : undefined

  // Reopen: a prior save blob carries the package + attempt explicitly.
  if (isRecord(seed.questionPackage)) {
    const questionPackage = parseQuestionPackage(seed.questionPackage)
    const priorAttempt =
      seed.attemptState === undefined
        ? undefined
        : parseAttemptState(seed.attemptState, questionPackage.id)
    return {
      questionPackage,
      ...(priorAttempt ? { priorAttempt } : {}),
      readOnly,
      ...(playgroundHash ? { playgroundHash } : {})
    }
  }

  // First open: the seed itself is the QuestionPackage. Host metadata keys
  // (playgroundHash / read_only / …) are ignored by the package schema.
  const questionPackage = parseQuestionPackage(seed)
  return {
    questionPackage,
    readOnly,
    ...(playgroundHash ? { playgroundHash } : {})
  }
}

/** Collapses a graded result to the two (three, incl. total) backend score keys. */
export function mapResultToNewtonScores(result: GamePlaygroundResult): NewtonScoreKeys {
  return {
    test_cases_passed: result.passedTests,
    test_cases_total: result.totalTests,
    all_test_cases_passed: result.allPassed
  }
}

/**
 * Builds the save blob to post back. `savedAt` is injected (kept pure/testable).
 */
export function buildNewtonSaveBlob(
  questionPackage: QuestionPackage,
  attemptState: AttemptState,
  result: GamePlaygroundResult,
  savedAt: string,
  justificationAnswers?: Record<string, string>
): NewtonSaveBlob {
  const hasAnswers = justificationAnswers && Object.keys(justificationAnswers).length > 0
  return {
    version: NEWTON_SAVE_BLOB_VERSION,
    ...mapResultToNewtonScores(result),
    topology: attemptState.topology,
    questionPackage,
    attemptState,
    rubric_results: result.tests.map((test) => ({ ...test })),
    ...(hasAnswers ? { justification_answers: { ...justificationAnswers } } : {}),
    saved_at: savedAt
  }
}

/** Whether the host message is the raw `'save'` request. */
export function isNewtonSaveCommand(raw: unknown): boolean {
  if (raw === NEWTON_SAVE_COMMAND) {
    return true
  }
  return isRecord(raw) && raw.type === NEWTON_SAVE_COMMAND
}
