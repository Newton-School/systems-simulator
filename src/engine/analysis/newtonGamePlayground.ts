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
 * The adapter now supports two Newton authoring models:
 *
 *   - legacy: the seed itself is a full `QuestionPackage`, or a save blob that
 *     carries one forward.
 *   - row-authored: immutable question metadata comes from Django
 *     (`question_title`, `question_text`, `rubric[].spec`), while mutable learner
 *     state comes from `initial_game_state` / `game_json`.
 *
 * This module is pure (no DOM / postMessage) — the renderer glue lives in
 * `newtonHostMessaging.ts`.
 */
import type { TopologyJSON } from '../core/types'
import { TopologyJSONSchema } from '../validation/validator'
import type { GamePlaygroundResult } from './gamePlayground'
import type { EnvironmentProfileInput } from './environmentProfile'
import {
  parseAttemptState,
  parseQuestionPackage,
  QUESTION_PACKAGE_VERSION,
  type AttemptState,
  type HostTest,
  type QuestionPackage
} from './question'
import {
  DEFAULT_NEWTON_RUBRIC_CHECK,
  defaultQuestionPrompt,
  hasNewtonQuestionRows,
  parseNewtonRowsToQuestionPackage,
  questionIdFromTitle
} from './newtonQuestionRows'

export { AUTO_PLACEHOLDER_RUBRIC_CHECK_ID } from './newtonQuestionRows'

/** The raw string the game posts to announce it is listening. */
export const NEWTON_READY_EVENT = 'ready-event' as const
/** The raw string the host posts to ask the game to persist current state. */
export const NEWTON_SAVE_COMMAND = 'save' as const
export const NEWTON_SAVE_BLOB_VERSION = '1.0' as const
export type NewtonSaveMode = 'legacy-package' | 'mutable-only'

/** The parsed seed the host pushes into the iframe. */
export interface NewtonGameSeed {
  questionPackage: QuestionPackage
  /** Restored prior attempt (present on a reopen; absent on first open). */
  priorAttempt?: AttemptState
  /** Draft mutable topology from `initial_game_state` when no attempt exists yet. */
  seedTopology?: TopologyJSON
  /** Mentor / locked view — editing and submitting must be disabled. */
  readOnly: boolean
  /** The learner's playground hash, when the host provided one. */
  playgroundHash?: string
  /** Raw learner-visible Django HTML for assignment-mode rendering. */
  promptHtml?: string
  /** Optional row-authored environment profile override for Newton host launches. */
  environmentProfile?: EnvironmentProfileInput
  /** Whether Newton saves should keep carrying the full package forward. */
  saveMode: NewtonSaveMode
  /**
   * Set when the seed had a renderable prompt but its grading config could not be
   * built (missing/invalid SIMULATOR_CONFIG or rows). The prompt still loads so an
   * author can see the question while iterating; this message says what is still
   * needed to make it gradeable. Absent on a fully-authored question.
   */
  authoringWarning?: string
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
  /** Legacy compatibility only: old Newton-authored questions still rely on this. */
  questionPackage?: QuestionPackage
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

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function legacyQuestionPackageFromSeed(seed: Record<string, unknown>): QuestionPackage | null {
  const candidate = isRecord(seed.questionPackage) ? seed.questionPackage : seed
  try {
    return parseQuestionPackage(candidate)
  } catch {
    return null
  }
}

function readSeedTopology(seed: Record<string, unknown>): TopologyJSON | undefined {
  if (!isRecord(seed.topology)) {
    return undefined
  }
  return TopologyJSONSchema.parse(seed.topology)
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
 * Parses a host seed into a `NewtonGameSeed`.
 *
 * Order of precedence:
 *   1. row-authored Newton metadata (`question_title`, `question_text`,
 *      `rubric[].spec`) plus mutable `game_json` / `initial_game_state`
 *   2. legacy reopen/first-open (`questionPackage` nested, or seed itself parses
 *      as a full QuestionPackage)
 */
/**
 * Builds a minimal, always-valid package that carries the Django-authored prompt
 * (`question_title` / `question_text`) with defaults everywhere else. Used so the
 * question text renders even when the grading config is missing or invalid — an
 * author writing test cases should always be able to see the brief. Returns null
 * only when there is no prompt or title to show.
 */
function buildPromptPreviewPackage(
  seed: Record<string, unknown>
): { questionPackage: QuestionPackage; promptHtml?: string } | null {
  const title = asNonEmptyString(seed.question_title)
  const promptHtml = asNonEmptyString(seed.question_text)
  if (title === undefined && promptHtml === undefined) {
    return null
  }
  const resolvedTitle = title ?? 'Untitled Question'
  const id = questionIdFromTitle(resolvedTitle)
  try {
    const questionPackage = parseQuestionPackage({
      version: QUESTION_PACKAGE_VERSION,
      id,
      title: resolvedTitle,
      difficulty: 'intermediate',
      type: 'open-build',
      prompt: defaultQuestionPrompt(resolvedTitle, promptHtml),
      scaffold: { type: 'empty' },
      constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
      suite: { name: `${id}-suite`, visibleToStudent: false, cases: [{ id: 'baseline' }] },
      rubric: { checks: [DEFAULT_NEWTON_RUBRIC_CHECK] }
    })
    return { questionPackage, ...(promptHtml ? { promptHtml } : {}) }
  } catch {
    return null
  }
}

/** Best-effort seed topology read that never throws (preview / degraded loads). */
function tryReadSeedTopology(seed: Record<string, unknown>): TopologyJSON | undefined {
  try {
    return readSeedTopology(seed)
  } catch {
    return undefined
  }
}

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

  if (hasNewtonQuestionRows(seed)) {
    try {
      const { questionPackage, promptHtml, environmentProfile } =
        parseNewtonRowsToQuestionPackage(seed)
      const priorAttempt =
        seed.attemptState === undefined
          ? undefined
          : parseAttemptState(seed.attemptState, questionPackage.id)
      const seedTopology = priorAttempt ? undefined : readSeedTopology(seed)
      return {
        questionPackage,
        ...(priorAttempt ? { priorAttempt } : {}),
        ...(seedTopology ? { seedTopology } : {}),
        readOnly,
        ...(playgroundHash ? { playgroundHash } : {}),
        ...(promptHtml ? { promptHtml } : {}),
        ...(environmentProfile !== undefined ? { environmentProfile } : {}),
        saveMode: 'mutable-only'
      }
    } catch (error) {
      // The grading config is broken — but never hide the prompt. Load it in
      // preview mode with an actionable warning about what still needs fixing.
      const preview = buildPromptPreviewPackage(seed)
      if (preview) {
        const seedTopology = tryReadSeedTopology(seed)
        return {
          questionPackage: preview.questionPackage,
          ...(seedTopology ? { seedTopology } : {}),
          readOnly,
          ...(playgroundHash ? { playgroundHash } : {}),
          ...(preview.promptHtml ? { promptHtml: preview.promptHtml } : {}),
          saveMode: 'mutable-only',
          authoringWarning: error instanceof Error ? error.message : String(error)
        }
      }
      throw error
    }
  }

  const legacyQuestionPackage = legacyQuestionPackageFromSeed(seed)
  if (legacyQuestionPackage) {
    const legacySeedTopology = readSeedTopology(seed)
    const priorAttempt =
      seed.attemptState === undefined
        ? undefined
        : parseAttemptState(seed.attemptState, legacyQuestionPackage.id)
    return {
      questionPackage: legacyQuestionPackage,
      ...(priorAttempt ? { priorAttempt } : {}),
      ...(legacySeedTopology ? { seedTopology: legacySeedTopology } : {}),
      readOnly,
      ...(playgroundHash ? { playgroundHash } : {}),
      saveMode: 'legacy-package'
    }
  }

  // No SIMULATOR_CONFIG and no legacy package — but if a prompt was authored in
  // Django, show it anyway so the author can see the brief while adding rows.
  const preview = buildPromptPreviewPackage(seed)
  if (preview) {
    const seedTopology = tryReadSeedTopology(seed)
    return {
      questionPackage: preview.questionPackage,
      ...(seedTopology ? { seedTopology } : {}),
      readOnly,
      ...(playgroundHash ? { playgroundHash } : {}),
      ...(preview.promptHtml ? { promptHtml: preview.promptHtml } : {}),
      saveMode: 'mutable-only',
      authoringWarning:
        'Question text shown. Add a SIMULATOR_CONFIG test-case row (and grading rows) to configure grading.'
    }
  }

  throw new Error('Newton seed does not contain any recoverable simulator question metadata.')
}

/**
 * Best-effort human-readable explanation for a rejected Newton host seed. Used
 * by the embedded UI so Django-authoring mistakes surface as actionable errors
 * instead of a silent "no question loaded" empty state.
 */
export function explainNewtonSeedParseFailure(raw: unknown): string | null {
  try {
    parseNewtonSeed(raw)
    return null
  } catch (error) {
    const seed = toSeedObject(raw)
    if (!seed) {
      return error instanceof Error
        ? error.message
        : 'Newton seed must be a JSON object or JSON string.'
    }

    const hasQuestionText =
      asNonEmptyString(seed.question_title) !== undefined ||
      asNonEmptyString(seed.question_text) !== undefined
    const hasRubric = Array.isArray(seed.rubric)
    const hasSimulatorConfig = hasNewtonQuestionRows(seed)

    if ((hasQuestionText || hasRubric) && !hasSimulatorConfig) {
      return 'Newton question is missing the SIMULATOR_CONFIG test-case row. Add the Django assignment_question_test_case_mapping rows from the assignment authoring guide.'
    }

    return error instanceof Error
      ? error.message
      : 'Newton seed does not contain any recoverable simulator question metadata.'
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
  options: {
    justificationAnswers?: Record<string, string>
    saveMode?: NewtonSaveMode
  } = {}
): NewtonSaveBlob {
  const { justificationAnswers, saveMode = 'mutable-only' } = options
  const hasAnswers = justificationAnswers && Object.keys(justificationAnswers).length > 0
  return {
    version: NEWTON_SAVE_BLOB_VERSION,
    ...mapResultToNewtonScores(result),
    topology: attemptState.topology,
    ...(saveMode === 'legacy-package' ? { questionPackage } : {}),
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
