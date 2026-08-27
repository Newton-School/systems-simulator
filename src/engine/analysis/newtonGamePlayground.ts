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
  Budget,
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
  budget?: Budget
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
 * Stable id of the auto-injected placeholder rubric check. The renderer filters
 * rows with this id out of the authoring Tests list so authors never see a check
 * they did not write; it is used only to satisfy the schema so a check-less draft
 * still loads.
 */
export const AUTO_PLACEHOLDER_RUBRIC_CHECK_ID = '__auto_placeholder_no_checks__'

/**
 * Injected when an author writes only structural/semantic rows and no
 * `RUBRIC_CHECK`. The package schema requires at least one rubric check; this is
 * a harmless always-passing one (a topology with no authored invariants reports
 * zero) so a structural-only question still loads instead of throwing
 * `rubric.checks: Invalid input`. It is HIDDEN from the authoring UI (filtered by
 * its id); authors override it simply by adding their own `RUBRIC_CHECK` row.
 */
const DEFAULT_NEWTON_RUBRIC_CHECK = {
  id: AUTO_PLACEHOLDER_RUBRIC_CHECK_ID,
  description: 'No invariant violations',
  kind: 'invariant',
  metric: 'invariantViolations.count',
  op: '==',
  value: 0,
  points: 1
} as const

// ── Atomic-row normalization ────────────────────────────────────────────────
// Authors should write only the essence of a test case; these fill the required
// but derivable fields (id, description, points, workload weight/sizeBytes,
// suite name/visibility/case id) so a row like
//   { "type": "STRUCTURAL_RULE", "kind": "requires_single_source" }
// or { "type": "RUBRIC_CHECK", "metric": "summary.latency.p99", "op": "<", "value": 100 }
// is enough.

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'rule'
  )
}

function reserveUniqueId(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) {
    id = `${base}-${n++}`
  }
  used.add(id)
  return id
}

function str(spec: Record<string, unknown>, key: string): string | undefined {
  return asNonEmptyString(spec[key])
}

function describeStructuralRule(spec: Record<string, unknown>): string {
  const kind = String(spec.kind ?? '')
  const ct = str(spec, 'componentType')
  switch (kind) {
    case 'requires_single_source':
      return 'Exactly one traffic source'
    case 'requires_connected_graph':
      return 'The graph must be fully connected'
    case 'requires_component':
      return `Requires a ${ct ?? 'component'}`
    case 'forbids_component':
      return `Must not use ${ct ?? 'component'}`
    case 'requires_category':
      return `Requires a ${str(spec, 'category') ?? 'category'} component`
    case 'requires_redundancy':
      return `Requires redundant ${ct ?? 'component'} instances`
    case 'requires_path':
      return `${str(spec, 'fromType') ?? 'source'} must reach ${str(spec, 'toType') ?? 'target'}`
    case 'requires_edge':
      return `Requires an edge from ${str(spec, 'fromType') ?? '?'} to ${str(spec, 'toType') ?? '?'}`
    case 'max_component_count':
      return `At most ${String(spec.maxCount ?? spec.count ?? 'N')} ${ct ?? 'component'}`
    default:
      return `Structural rule: ${kind}`
  }
}

function describeSemanticCriterion(spec: Record<string, unknown>): string {
  const kind = String(spec.kind ?? '')
  switch (kind) {
    case 'guardedPath':
      return `Traffic from ${str(spec, 'from') ?? '?'} must pass through ${str(spec, 'guard') ?? 'the guard'}${str(spec, 'to') ? ` to reach ${str(spec, 'to')}` : ''}`
    case 'storageFit':
      return `Store must fit a ${str(spec, 'accessPattern') ?? ''} workload`
        .replace(/\s+/g, ' ')
        .trim()
    case 'placement':
      return `Correct placement of ${str(spec, 'componentType') ?? 'the component'}`
    case 'fanout':
      return 'Broker must fan out to independent consumers'
    default:
      return `Semantic criterion: ${kind}`
  }
}

function idBase(spec: Record<string, unknown>): string {
  const kind = String(spec.kind ?? 'rule')
  if (spec.type === 'RUBRIC_CHECK') {
    const metric = String(spec.metric ?? 'check')
    return slugify(metric.split('.').pop() ?? metric)
  }
  const disc =
    str(spec, 'componentType') ??
    str(spec, 'category') ??
    (str(spec, 'fromType') && str(spec, 'toType')
      ? `${str(spec, 'fromType')}-${str(spec, 'toType')}`
      : undefined)
  return slugify(disc ? `${kind}-${disc}` : kind)
}

/** Fills id/description/points on a grading-row spec so authors can omit them. */
function normalizeRowSpec(
  spec: Record<string, unknown>,
  used: Set<string>
): Record<string, unknown> {
  const id = str(spec, 'id') ?? reserveUniqueId(idBase(spec), used)
  const out: Record<string, unknown> = { ...spec, id }
  if (spec.type === 'STRUCTURAL_RULE' && str(spec, 'description') === undefined) {
    out.description = describeStructuralRule(spec)
  }
  if (spec.type === 'SEMANTIC_CRITERION') {
    if (str(spec, 'description') === undefined) out.description = describeSemanticCriterion(spec)
    if (typeof spec.points !== 'number') out.points = 1
  }
  if (spec.type === 'RUBRIC_CHECK' && str(spec, 'description') === undefined) {
    out.description =
      `${String(spec.metric ?? '')} ${String(spec.op ?? '')} ${String(spec.value ?? '')}`.trim()
  }
  return out
}

/** Fills suite name/visibility/case ids and per-class workload weight/sizeBytes. */
function normalizeSuite(rawSuite: unknown, questionId: string): Record<string, unknown> {
  const suite = isRecord(rawSuite) ? rawSuite : {}
  const cases =
    Array.isArray(suite.cases) && suite.cases.length > 0 ? suite.cases : [{ id: 'baseline' }]
  return {
    ...suite,
    name: asNonEmptyString(suite.name) ?? `${questionId}-suite`,
    visibleToStudent: typeof suite.visibleToStudent === 'boolean' ? suite.visibleToStudent : false,
    cases: cases.map((rawCase, index) => normalizeCase(rawCase, index))
  }
}

function normalizeCase(rawCase: unknown, index: number): Record<string, unknown> {
  const testCase = isRecord(rawCase) ? rawCase : {}
  const out: Record<string, unknown> = {
    ...testCase,
    id: asNonEmptyString(testCase.id) ?? (index === 0 ? 'peak' : `case-${index + 1}`)
  }
  if (isRecord(testCase.workload)) {
    out.workload = normalizeWorkload(testCase.workload)
  }
  return out
}

function normalizeWorkload(workload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(workload.requestDistribution)) {
    return workload
  }
  const entries = workload.requestDistribution
  return {
    ...workload,
    requestDistribution: entries.map((entry) => {
      const rec = isRecord(entry) ? entry : {}
      return {
        ...rec,
        weight: typeof rec.weight === 'number' ? rec.weight : 1 / entries.length,
        sizeBytes: typeof rec.sizeBytes === 'number' ? rec.sizeBytes : 256
      }
    })
  }
}

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

  // SIMULATOR_CONFIG is optional: when absent, every field below falls back to a
  // sensible default, so an author can write only rules/checks and still get a
  // working question.
  const config = (specs.find((spec) => spec.type === 'SIMULATOR_CONFIG') ?? {}) as Record<
    string,
    unknown
  > &
    NewtonSimulatorConfig

  const questionId = asNonEmptyString(config.questionId) ?? deriveQuestionId(title)
  const questionVersion = asNonEmptyString(config.questionVersion) ?? QUESTION_PACKAGE_VERSION
  const presentationMode = config.presentationMode ?? 'raw-html'
  const prompt =
    presentationMode === 'structured'
      ? promptFromPresentation(title, config.presentation, promptHtml)
      : defaultPrompt(title, promptHtml)

  // Pre-seed with explicit ids so derived ids never collide with them.
  const usedIds = new Set<string>(
    specs.map((spec) => str(spec, 'id')).filter((id): id is string => id !== undefined)
  )
  const normalize = (spec: Record<string, unknown>) =>
    stripSpecType(normalizeRowSpec(spec, usedIds))

  const structuralRules = specs
    .filter((spec) => spec.type === 'STRUCTURAL_RULE')
    .map((spec) => normalize(spec) as unknown as StructuralRule)
  const semanticCriteria = specs
    .filter((spec) => spec.type === 'SEMANTIC_CRITERION')
    .map((spec) => normalize(spec) as unknown as SemanticCriterion)
  const rubricChecks = specs
    .filter((spec) => spec.type === 'RUBRIC_CHECK')
    .map((spec) => normalize(spec))

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
    ...(isRecord(config.budget) ? { budget: config.budget } : {}),
    ...(config.workloadCategory ? { workloadCategory: config.workloadCategory } : {}),
    suite: normalizeSuite(config.suite, questionId),
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

const AUTHORED_ROW_TYPES = new Set([
  'SIMULATOR_CONFIG',
  'STRUCTURAL_RULE',
  'SEMANTIC_CRITERION',
  'RUBRIC_CHECK'
])

function hasRowAuthoredQuestionMetadata(seed: Record<string, unknown>): boolean {
  if (!Array.isArray(seed.rubric)) {
    return false
  }

  // Any recognized grading row is enough to author from the rows. A
  // SIMULATOR_CONFIG is optional — its fields all default (see
  // buildQuestionPackageFromRows) — so an author can write just a STRUCTURAL_RULE
  // and still see it, instead of falling through to prompt-only preview.
  return seed.rubric.some(
    (row) =>
      isRubricRow(row) &&
      isRecord(row.spec) &&
      typeof row.spec.type === 'string' &&
      AUTHORED_ROW_TYPES.has(row.spec.type)
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
  const id = deriveQuestionId(resolvedTitle)
  try {
    const questionPackage = parseQuestionPackage({
      version: QUESTION_PACKAGE_VERSION,
      id,
      title: resolvedTitle,
      difficulty: 'intermediate',
      type: 'open-build',
      prompt: defaultPrompt(resolvedTitle, promptHtml),
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

  if (hasRowAuthoredQuestionMetadata(seed)) {
    try {
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
