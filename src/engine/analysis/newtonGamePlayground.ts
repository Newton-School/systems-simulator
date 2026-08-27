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
  type NFRTarget,
  type QuestionConstraints,
  type QuestionPackage,
  type QuestionPrompt,
  type QuestionScaffold,
  type QuestionSuite,
  type ScaleParameters
} from './question'
import type {
  JustifyPrompt,
  QuestionDomain,
  SemanticCriterion,
  WorkloadCategory
} from './gradingCriteria'
import type { StructuralRule } from './structural'

/** The raw string the game posts to announce it is listening. */
export const NEWTON_READY_EVENT = 'ready-event' as const
/** The raw string the host posts to ask the game to persist current state. */
export const NEWTON_SAVE_COMMAND = 'save' as const
export const NEWTON_SAVE_BLOB_VERSION = '1.0' as const
export type NewtonSaveMode = 'legacy-package' | 'mutable-only'

interface NewtonStructuredPresentation {
  prompt?: string
  functionalRequirements?: string[]
  nonFunctionalRequirements?: NFRTarget[]
  scale?: ScaleParameters
}

interface NewtonSimulatorConfig {
  type: 'SIMULATOR_CONFIG'
  questionId?: string
  questionVersion?: string
  questionType?: QuestionPackage['type']
  entryFormat?: QuestionPackage['entryFormat']
  difficulty?: QuestionPackage['difficulty']
  workloadCategory?: WorkloadCategory
  presentationMode?: 'raw-html' | 'structured'
  presentation?: NewtonStructuredPresentation
  promptSource?: 'question_text'
  scaffold?: QuestionScaffold
  constraints?: QuestionConstraints
  suite?: QuestionSuite
  domains?: QuestionDomain[]
  concepts?: string[]
  rubric?: {
    id?: string
    passThreshold?: number
  }
  justify?: JustifyPrompt[]
  environmentProfile?: EnvironmentProfileInput
}

interface NewtonRubricRow {
  hash?: string
  title?: string
  hidden?: boolean
  spec?: unknown
}

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

function isRubricRow(value: unknown): value is NewtonRubricRow {
  return isRecord(value)
}

function toPromptTextFromHtml(html: string | undefined, fallback: string): string {
  if (!html) {
    return fallback
  }

  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > 0 ? text : fallback
}

function defaultPrompt(title: string, questionTextHtml?: string): QuestionPrompt {
  return {
    text: toPromptTextFromHtml(questionTextHtml, title),
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    scale: {}
  }
}

function promptFromPresentation(
  title: string,
  presentation: NewtonStructuredPresentation | undefined,
  questionTextHtml?: string
): QuestionPrompt {
  if (!presentation) {
    return defaultPrompt(title, questionTextHtml)
  }

  const promptText = asNonEmptyString(presentation.prompt)
  return {
    text: promptText ?? defaultPrompt(title, questionTextHtml).text,
    functionalRequirements: Array.isArray(presentation.functionalRequirements)
      ? presentation.functionalRequirements.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      : [],
    nonFunctionalRequirements: Array.isArray(presentation.nonFunctionalRequirements)
      ? presentation.nonFunctionalRequirements
      : [],
    scale: isRecord(presentation.scale) ? (presentation.scale as ScaleParameters) : {}
  }
}

function stripSpecType<T extends Record<string, unknown>>(spec: T): Omit<T, 'type'> {
  const rest = { ...spec }
  delete rest.type
  return rest
}

function deriveQuestionId(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

/**
 * Injected when an author writes only structural/semantic rows and no
 * `RUBRIC_CHECK`. The package schema requires at least one rubric check; this is
 * a harmless always-passing one (a topology with no authored invariants reports
 * zero) so a structural-only question still loads instead of throwing
 * `rubric.checks: Invalid input`. Authors can override it by adding their own
 * `RUBRIC_CHECK` row.
 */
const DEFAULT_NEWTON_RUBRIC_CHECK = {
  id: 'no-invariants',
  description: 'No invariant violations',
  kind: 'invariant',
  metric: 'invariantViolations.count',
  op: '==',
  value: 0,
  points: 1
} as const

/**
 * Translates a raw package-validation error (zod path + message) into an
 * author-actionable sentence. Authors edit Django rows without the codebase, so a
 * message like `constraints.canRemoveScaffoldNodes: Invalid input` is a dead end;
 * this names the row to edit and the field to add.
 */
function friendlyAuthoringError(rawMessage: string): string {
  const hints: Array<[RegExp, string]> = [
    [
      /constraints\.canRemoveScaffoldNodes|constraints\.canModifyScaffold/,
      'In the SIMULATOR_CONFIG row, "constraints" must include both booleans: { "canModifyScaffold": true, "canRemoveScaffoldNodes": true }.'
    ],
    [
      /rubric\.checks/,
      'Add at least one RUBRIC_CHECK test-case row (each needs id, description, metric, op, value). A safe minimal one: metric "invariantViolations.count", op "==", value 0.'
    ],
    [
      /rubric\.passThreshold|passThreshold/,
      'In the SIMULATOR_CONFIG row, "rubric.passThreshold" must be a fraction between 0 and 1 (e.g. 0.71 = 71%), not a point total.'
    ],
    [
      /suite/,
      'The SIMULATOR_CONFIG row needs a "suite" with at least one case, and each case needs a "workload" ({ baseRps, requestDistribution:[{ type, weight, sizeBytes }] }).'
    ],
    [
      /accessPattern/,
      'A storageFit SEMANTIC_CRITERION "accessPattern" must be one of: point-lookup, time-series, append-only-ledger, transactional-relational, search-index, blob.'
    ],
    [
      /prompt/,
      'The question is missing prompt text — set the Django question_text (HTML), or add a "presentation" block to the SIMULATOR_CONFIG row.'
    ],
    [
      /\.metric\b/,
      'A RUBRIC_CHECK "metric" is not a recognized verdict key. Use exact keys like summary.latency.p99, summary.errorRate, reservations.oversells (see the metric list in the authoring manual).'
    ]
  ]

  const matched = hints.find(([pattern]) => pattern.test(rawMessage))
  if (matched) {
    return `Question could not be loaded. ${matched[1]}\n\n(Validator detail: ${rawMessage})`
  }
  return `Question could not be loaded — a test-case row has an invalid field.\n\n(Validator detail: ${rawMessage})`
}

function buildQuestionPackageFromRows(seed: Record<string, unknown>): {
  questionPackage: QuestionPackage
  promptHtml?: string
  environmentProfile?: EnvironmentProfileInput
} {
  const title = asNonEmptyString(seed.question_title) ?? 'Untitled Question'
  const promptHtml = asNonEmptyString(seed.question_text)
  const rubricRows = Array.isArray(seed.rubric) ? seed.rubric.filter(isRubricRow) : []
  const specs = rubricRows
    .map((row) => (isRecord(row.spec) ? row.spec : null))
    .filter((spec): spec is Record<string, unknown> => spec !== null)

  const config = specs.find((spec) => spec.type === 'SIMULATOR_CONFIG') as
    | (Record<string, unknown> & NewtonSimulatorConfig)
    | undefined
  if (!config) {
    throw new Error('Newton seed is missing the SIMULATOR_CONFIG rubric row.')
  }

  const questionId = asNonEmptyString(config.questionId) ?? deriveQuestionId(title)
  const questionVersion = asNonEmptyString(config.questionVersion) ?? QUESTION_PACKAGE_VERSION
  const presentationMode = config.presentationMode ?? 'raw-html'
  const prompt =
    presentationMode === 'structured'
      ? promptFromPresentation(title, config.presentation, promptHtml)
      : defaultPrompt(title, promptHtml)

  const structuralRules = specs
    .filter((spec) => spec.type === 'STRUCTURAL_RULE')
    .map((spec) => stripSpecType(spec) as unknown as StructuralRule)
  const semanticCriteria = specs
    .filter((spec) => spec.type === 'SEMANTIC_CRITERION')
    .map((spec) => stripSpecType(spec) as unknown as SemanticCriterion)
  const rubricChecks = specs
    .filter((spec) => spec.type === 'RUBRIC_CHECK')
    .map((spec) => stripSpecType(spec))

  const packageInput = {
    version: questionVersion,
    id: questionId,
    title,
    difficulty: config.difficulty ?? 'intermediate',
    type: config.questionType ?? 'open-build',
    ...(config.entryFormat ? { entryFormat: config.entryFormat } : {}),
    prompt,
    scaffold: config.scaffold ?? { type: 'empty' },
    // Authors only need to opt out; the required booleans are filled so a partial
    // `constraints` (e.g. just canModifyScaffold + maxNodeCount) still validates.
    constraints: {
      canModifyScaffold: true,
      canRemoveScaffoldNodes: true,
      ...(isRecord(config.constraints) ? config.constraints : {})
    },
    ...(structuralRules.length > 0 ? { structuralRules } : {}),
    ...(semanticCriteria.length > 0 ? { semanticCriteria } : {}),
    ...(Array.isArray(config.domains) ? { domains: config.domains } : {}),
    ...(Array.isArray(config.concepts) ? { concepts: config.concepts } : {}),
    ...(Array.isArray(config.justify) ? { justify: config.justify } : {}),
    ...(config.workloadCategory ? { workloadCategory: config.workloadCategory } : {}),
    suite: config.suite ?? {
      name: `${questionId}-suite`,
      visibleToStudent: false,
      cases: [{ id: 'baseline' }]
    },
    rubric: {
      ...(isRecord(config.rubric) && asNonEmptyString(config.rubric.id)
        ? { id: asNonEmptyString(config.rubric.id) }
        : {}),
      ...(isRecord(config.rubric) && typeof config.rubric.passThreshold === 'number'
        ? { passThreshold: config.rubric.passThreshold }
        : {}),
      // A question with only structural/semantic rows still needs ≥1 rubric check
      // to satisfy the schema; inject a harmless always-passing one.
      checks: rubricChecks.length > 0 ? rubricChecks : [DEFAULT_NEWTON_RUBRIC_CHECK]
    }
  }

  let questionPackage: QuestionPackage
  try {
    questionPackage = parseQuestionPackage(packageInput)
  } catch (error) {
    throw new Error(friendlyAuthoringError(error instanceof Error ? error.message : String(error)))
  }

  return {
    questionPackage,
    ...(presentationMode !== 'structured' && promptHtml ? { promptHtml } : {}),
    ...(config.environmentProfile !== undefined
      ? { environmentProfile: config.environmentProfile }
      : {})
  }
}

function hasRowAuthoredQuestionMetadata(seed: Record<string, unknown>): boolean {
  if (!Array.isArray(seed.rubric)) {
    return false
  }

  return seed.rubric.some(
    (row) => isRubricRow(row) && isRecord(row.spec) && row.spec.type === 'SIMULATOR_CONFIG'
  )
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

  if (hasRowAuthoredQuestionMetadata(seed)) {
    const { questionPackage, promptHtml, environmentProfile } = buildQuestionPackageFromRows(seed)
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
    const hasSimulatorConfig = hasRowAuthoredQuestionMetadata(seed)

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
