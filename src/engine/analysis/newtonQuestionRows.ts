import type { TopologyJSON } from '../core/types'
import type { EnvironmentProfileInput } from './environmentProfile'
import type {
  Budget,
  JustifyPrompt,
  QuestionDomain,
  SemanticCriterion,
  WorkloadCategory
} from './gradingCriteria'
import {
  parseQuestionPackage,
  QUESTION_PACKAGE_VERSION,
  type NFRTarget,
  type QuestionConstraints,
  type QuestionPackage,
  type QuestionPrompt,
  type QuestionScaffold,
  type QuestionSuite,
  type ScaleParameters
} from './question'
import type { RubricCheck } from './rubric'
import type { StructuralRule } from './structural'
import { deriveQuestionIdFromTitle } from './questionAuthoringDraft'
import { buildQuestionTextHtml } from './questionTextHtml'

export const NEWTON_ROW_CODEC_VERSION = '1.0' as const

export interface NewtonStructuredPresentation {
  prompt?: string
  functionalRequirements?: string[]
  nonFunctionalRequirements?: NFRTarget[]
  scale?: ScaleParameters
  additionalContext?: string
}

export interface SimulatorConfigRow {
  type: 'SIMULATOR_CONFIG'
  configVersion?: typeof NEWTON_ROW_CODEC_VERSION
  questionId?: string
  questionVersion?: string
  questionType?: QuestionPackage['type']
  entryFormat?: QuestionPackage['entryFormat']
  difficulty?: QuestionPackage['difficulty']
  description?: string
  tags?: string[]
  estimatedTimeMinutes?: number
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
    version?: string
    id?: string
    passThreshold?: number
  }
  budget?: Budget
  justify?: JustifyPrompt[]
  author?: string
  createdAt?: string
  environmentProfile?: EnvironmentProfileInput
}

export type StructuralRuleRow = { type: 'STRUCTURAL_RULE' } & StructuralRule
export type SemanticCriterionRow = { type: 'SEMANTIC_CRITERION' } & SemanticCriterion
export type RubricCheckRow = { type: 'RUBRIC_CHECK' } & RubricCheck

export type NewtonTestCaseRowSpec =
  | SimulatorConfigRow
  | StructuralRuleRow
  | SemanticCriterionRow
  | RubricCheckRow

export interface NewtonTestCaseRow {
  order: number
  title: string
  hidden: false
  output: ''
  spec: NewtonTestCaseRowSpec
}

export interface NewtonQuestionRowInput {
  hash?: string
  title?: string
  hidden?: boolean
  spec?: unknown
}

export interface NewtonQuestionRowsSeed {
  question_title?: unknown
  question_text?: unknown
  rubric?: unknown
}

export interface ParsedNewtonQuestionRows {
  questionPackage: QuestionPackage
  promptHtml?: string
  environmentProfile?: EnvironmentProfileInput
}

export interface CompileNewtonRowsOptions {
  presentationMode?: 'raw-html' | 'structured'
  questionTextHtml?: string
  environmentProfile?: EnvironmentProfileInput
}

export interface CompiledNewtonQuestionRows {
  codecVersion: typeof NEWTON_ROW_CODEC_VERSION
  questionTitle: string
  questionTextHtml: string
  initialGameState: { topology?: TopologyJSON }
  rows: NewtonTestCaseRow[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isQuestionRow(value: unknown): value is NewtonQuestionRowInput {
  return isRecord(value)
}

export function questionIdFromTitle(title: string): string {
  return deriveQuestionIdFromTitle(title)
}

export { deriveQuestionIdFromTitle }
export { buildQuestionTextHtml }

function textFromHtml(html: string | undefined, fallback: string): string {
  if (!html) return fallback

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

export function defaultQuestionPrompt(title: string, questionTextHtml?: string): QuestionPrompt {
  return {
    text: textFromHtml(questionTextHtml, title),
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
  if (!presentation) return defaultQuestionPrompt(title, questionTextHtml)

  const promptText = asNonEmptyString(presentation.prompt)
  const additionalContext = asNonEmptyString(presentation.additionalContext)
  return {
    text: promptText ?? defaultQuestionPrompt(title, questionTextHtml).text,
    functionalRequirements: Array.isArray(presentation.functionalRequirements)
      ? presentation.functionalRequirements.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      : [],
    nonFunctionalRequirements: Array.isArray(presentation.nonFunctionalRequirements)
      ? presentation.nonFunctionalRequirements
      : [],
    scale: isRecord(presentation.scale) ? (presentation.scale as ScaleParameters) : {},
    ...(additionalContext ? { additionalContext } : {})
  }
}

function stripSpecType<T extends Record<string, unknown>>(spec: T): Omit<T, 'type'> {
  const rest = { ...spec }
  delete rest.type
  return rest
}

/** Stable id used only when row authors have not supplied any metric checks yet. */
export const AUTO_PLACEHOLDER_RUBRIC_CHECK_ID = '__auto_placeholder_no_checks__'

export const DEFAULT_NEWTON_RUBRIC_CHECK = {
  id: AUTO_PLACEHOLDER_RUBRIC_CHECK_ID,
  description: 'No invariant violations',
  kind: 'invariant',
  metric: 'invariantViolations.count',
  op: '==',
  value: 0,
  points: 1
} as const

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
  let suffix = 2
  while (used.has(id)) id = `${base}-${suffix++}`
  used.add(id)
  return id
}

function stringField(spec: Record<string, unknown>, key: string): string | undefined {
  return asNonEmptyString(spec[key])
}

function describeStructuralRule(spec: Record<string, unknown>): string {
  const kind = String(spec.kind ?? '')
  const componentType = stringField(spec, 'componentType')
  switch (kind) {
    case 'requires_single_source':
      return 'Exactly one traffic source'
    case 'requires_connected_graph':
      return 'The graph must be fully connected'
    case 'requires_component':
      return `Requires a ${componentType ?? 'component'}`
    case 'forbids_component':
      return `Must not use ${componentType ?? 'component'}`
    case 'requires_category':
      return `Requires a ${stringField(spec, 'category') ?? 'category'} component`
    case 'requires_redundancy':
      return `Requires redundant ${componentType ?? 'component'} instances`
    case 'requires_path':
      return `${stringField(spec, 'fromType') ?? 'source'} must reach ${stringField(spec, 'toType') ?? 'target'}`
    case 'requires_edge':
      return `Requires an edge from ${stringField(spec, 'fromType') ?? '?'} to ${stringField(spec, 'toType') ?? '?'}`
    case 'max_component_count':
      return `At most ${String(spec.maxCount ?? spec.count ?? 'N')} ${componentType ?? 'component'}`
    default:
      return `Structural rule: ${kind}`
  }
}

function describeSemanticCriterion(spec: Record<string, unknown>): string {
  const kind = String(spec.kind ?? '')
  switch (kind) {
    case 'componentPresence':
      return `Include ${String(spec.minCount ?? 1)} ${stringField(spec, 'componentType') ?? 'component'}`
    case 'componentProperty':
      return `${stringField(spec, 'property') ?? 'Configuration'} ${String(spec.operator ?? 'equals')} ${String(spec.expected ?? '')}`.trim()
    case 'guardedPath':
      return `Traffic from ${stringField(spec, 'from') ?? '?'} must pass through ${stringField(spec, 'guard') ?? 'the guard'}${stringField(spec, 'to') ? ` to reach ${stringField(spec, 'to')}` : ''}`
    case 'storageFit':
      return `Store must fit a ${stringField(spec, 'accessPattern') ?? ''} workload`
        .replace(/\s+/g, ' ')
        .trim()
    case 'placement':
      return `Correct placement of ${stringField(spec, 'componentType') ?? 'the component'}`
    case 'fanout':
      return 'Broker must fan out to independent consumers'
    case 'stateTransition':
      return 'Required runtime transition must appear in the request timeline'
    case 'stateSequence':
      return 'Runtime transition sequence must appear in request timelines'
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
  const discriminator =
    stringField(spec, 'componentType') ??
    stringField(spec, 'category') ??
    (stringField(spec, 'fromType') && stringField(spec, 'toType')
      ? `${stringField(spec, 'fromType')}-${stringField(spec, 'toType')}`
      : undefined)
  return slugify(discriminator ? `${kind}-${discriminator}` : kind)
}

function normalizeRowSpec(
  spec: Record<string, unknown>,
  used: Set<string>
): Record<string, unknown> {
  const id = stringField(spec, 'id') ?? reserveUniqueId(idBase(spec), used)
  const output: Record<string, unknown> = { ...spec, id }
  if (spec.type === 'STRUCTURAL_RULE' && stringField(spec, 'description') === undefined) {
    output.description = describeStructuralRule(spec)
  }
  if (spec.type === 'SEMANTIC_CRITERION') {
    if (stringField(spec, 'description') === undefined) {
      output.description = describeSemanticCriterion(spec)
    }
    if (typeof spec.points !== 'number') output.points = 1
  }
  if (spec.type === 'RUBRIC_CHECK' && stringField(spec, 'description') === undefined) {
    output.description =
      `${String(spec.metric ?? '')} ${String(spec.op ?? '')} ${String(spec.value ?? '')}`.trim()
  }
  return output
}

function normalizeWorkload(workload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(workload.requestDistribution)) return workload
  const entries = workload.requestDistribution
  return {
    ...workload,
    requestDistribution: entries.map((entry) => {
      const record = isRecord(entry) ? entry : {}
      return {
        ...record,
        weight: typeof record.weight === 'number' ? record.weight : 1 / entries.length,
        sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 256
      }
    })
  }
}

function normalizeCase(rawCase: unknown, index: number): Record<string, unknown> {
  const testCase = isRecord(rawCase) ? rawCase : {}
  const output: Record<string, unknown> = {
    ...testCase,
    id: asNonEmptyString(testCase.id) ?? (index === 0 ? 'peak' : `case-${index + 1}`)
  }
  if (isRecord(testCase.workload)) output.workload = normalizeWorkload(testCase.workload)
  return output
}

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

function friendlyAuthoringError(rawMessage: string): string {
  const hints: Array<[RegExp, string]> = [
    [
      /constraints\.canRemoveScaffoldNodes|constraints\.canModifyScaffold/,
      'In the SIMULATOR_CONFIG row, "constraints" must include both booleans: { "canModifyScaffold": true, "canRemoveScaffoldNodes": true }.'
    ],
    [
      /rubric\.checks/,
      'Add at least one RUBRIC_CHECK test-case row (each needs id, description, metric, op, value).'
    ],
    [
      /rubric\.passThreshold|passThreshold/,
      'In the SIMULATOR_CONFIG row, "rubric.passThreshold" must be a fraction between 0 and 1 (e.g. 0.71 = 71%), not a point total.'
    ],
    [
      /suite/,
      'The SIMULATOR_CONFIG row needs a "suite" with at least one case, and each case needs a valid workload when it overrides traffic.'
    ],
    [
      /accessPattern/,
      'A storageFit SEMANTIC_CRITERION "accessPattern" must be one of the supported access-pattern values.'
    ],
    [
      /prompt/,
      'The question is missing prompt text — set the Django question_text or add a presentation block to SIMULATOR_CONFIG.'
    ],
    [
      /\.metric\b/,
      'A RUBRIC_CHECK "metric" is not recognized. Use an engine-owned metric selector.'
    ]
  ]

  const matched = hints.find(([pattern]) => pattern.test(rawMessage))
  if (matched) {
    return `Question could not be loaded. ${matched[1]}\n\n(Validator detail: ${rawMessage})`
  }
  return `Question could not be loaded — a test-case row has an invalid field.\n\n(Validator detail: ${rawMessage})`
}

export const NEWTON_AUTHORED_ROW_TYPES = [
  'SIMULATOR_CONFIG',
  'STRUCTURAL_RULE',
  'SEMANTIC_CRITERION',
  'RUBRIC_CHECK'
] as const

const NEWTON_AUTHORED_ROW_TYPE_SET = new Set<string>(NEWTON_AUTHORED_ROW_TYPES)

export function hasNewtonQuestionRows(seed: NewtonQuestionRowsSeed): boolean {
  if (!Array.isArray(seed.rubric)) return false
  return seed.rubric.some(
    (row) =>
      isQuestionRow(row) &&
      isRecord(row.spec) &&
      typeof row.spec.type === 'string' &&
      NEWTON_AUTHORED_ROW_TYPE_SET.has(row.spec.type)
  )
}

export function parseNewtonRowsToQuestionPackage(
  seed: NewtonQuestionRowsSeed
): ParsedNewtonQuestionRows {
  const title = asNonEmptyString(seed.question_title) ?? 'Untitled Question'
  const promptHtml = asNonEmptyString(seed.question_text)
  const rows = Array.isArray(seed.rubric) ? seed.rubric.filter(isQuestionRow) : []
  const specs = rows
    .map((row) => (isRecord(row.spec) ? row.spec : null))
    .filter((spec): spec is Record<string, unknown> => spec !== null)
  const config = (specs.find((spec) => spec.type === 'SIMULATOR_CONFIG') ?? {}) as Record<
    string,
    unknown
  > &
    SimulatorConfigRow

  const questionId = asNonEmptyString(config.questionId) ?? questionIdFromTitle(title)
  const questionVersion = asNonEmptyString(config.questionVersion) ?? QUESTION_PACKAGE_VERSION
  const presentationMode = config.presentationMode ?? 'raw-html'
  // Exported rows always include structured presentation as a lossless backing
  // representation, even when Django renders question_text as raw HTML.
  const prompt = config.presentation
    ? promptFromPresentation(title, config.presentation, promptHtml)
    : presentationMode === 'structured'
      ? promptFromPresentation(title, config.presentation, promptHtml)
      : defaultQuestionPrompt(title, promptHtml)

  const usedIds = new Set<string>(
    specs.map((spec) => stringField(spec, 'id')).filter((id): id is string => id !== undefined)
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
    ...(asNonEmptyString(config.description)
      ? { description: asNonEmptyString(config.description) }
      : {}),
    difficulty: config.difficulty ?? 'intermediate',
    ...(Array.isArray(config.tags) ? { tags: config.tags } : {}),
    ...(typeof config.estimatedTimeMinutes === 'number'
      ? { estimatedTimeMinutes: config.estimatedTimeMinutes }
      : {}),
    type: config.questionType ?? 'open-build',
    ...(config.entryFormat ? { entryFormat: config.entryFormat } : {}),
    prompt,
    scaffold: config.scaffold ?? { type: 'empty' },
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
      ...(isRecord(config.rubric) && asNonEmptyString(config.rubric.version)
        ? { version: asNonEmptyString(config.rubric.version) }
        : {}),
      ...(isRecord(config.rubric) && asNonEmptyString(config.rubric.id)
        ? { id: asNonEmptyString(config.rubric.id) }
        : {}),
      ...(isRecord(config.rubric) && typeof config.rubric.passThreshold === 'number'
        ? { passThreshold: config.rubric.passThreshold }
        : {}),
      checks: rubricChecks.length > 0 ? rubricChecks : [DEFAULT_NEWTON_RUBRIC_CHECK]
    },
    ...(asNonEmptyString(config.author) ? { author: asNonEmptyString(config.author) } : {}),
    ...(asNonEmptyString(config.createdAt) ? { createdAt: asNonEmptyString(config.createdAt) } : {})
  }

  try {
    return {
      questionPackage: parseQuestionPackage(packageInput),
      ...(presentationMode !== 'structured' && promptHtml ? { promptHtml } : {}),
      ...(config.environmentProfile !== undefined
        ? { environmentProfile: config.environmentProfile }
        : {})
    }
  } catch (error) {
    throw new Error(friendlyAuthoringError(error instanceof Error ? error.message : String(error)))
  }
}

function configRow(
  question: QuestionPackage,
  options: CompileNewtonRowsOptions
): SimulatorConfigRow {
  return {
    type: 'SIMULATOR_CONFIG',
    configVersion: NEWTON_ROW_CODEC_VERSION,
    questionId: question.id,
    questionVersion: question.version,
    questionType: question.type,
    ...(question.entryFormat ? { entryFormat: question.entryFormat } : {}),
    difficulty: question.difficulty,
    ...(question.description ? { description: question.description } : {}),
    ...(question.tags ? { tags: question.tags } : {}),
    ...(question.estimatedTimeMinutes
      ? { estimatedTimeMinutes: question.estimatedTimeMinutes }
      : {}),
    ...(question.workloadCategory ? { workloadCategory: question.workloadCategory } : {}),
    presentationMode: options.presentationMode ?? 'raw-html',
    presentation: {
      prompt: question.prompt.text,
      functionalRequirements: question.prompt.functionalRequirements,
      nonFunctionalRequirements: question.prompt.nonFunctionalRequirements,
      scale: question.prompt.scale,
      ...(question.prompt.additionalContext
        ? { additionalContext: question.prompt.additionalContext }
        : {})
    },
    promptSource: 'question_text',
    scaffold: question.scaffold,
    constraints: question.constraints,
    suite: question.suite,
    ...(question.domains ? { domains: question.domains } : {}),
    ...(question.concepts ? { concepts: question.concepts } : {}),
    rubric: {
      ...(question.rubric.version ? { version: question.rubric.version } : {}),
      ...(question.rubric.id ? { id: question.rubric.id } : {}),
      ...(typeof question.rubric.passThreshold === 'number'
        ? { passThreshold: question.rubric.passThreshold }
        : {})
    },
    ...(question.budget ? { budget: question.budget } : {}),
    ...(question.justify ? { justify: question.justify } : {}),
    ...(question.author ? { author: question.author } : {}),
    ...(question.createdAt ? { createdAt: question.createdAt } : {}),
    ...(options.environmentProfile ? { environmentProfile: options.environmentProfile } : {})
  }
}

function titledRow(order: number, spec: NewtonTestCaseRowSpec): NewtonTestCaseRow {
  const suffix = spec.type === 'SIMULATOR_CONFIG' ? spec.questionId : spec.id
  return {
    order,
    title: `${spec.type}: ${suffix ?? 'untitled'}`,
    hidden: false,
    output: '',
    spec
  }
}

export function compileQuestionPackageToNewtonRows(
  input: QuestionPackage,
  options: CompileNewtonRowsOptions = {}
): CompiledNewtonQuestionRows {
  const question = parseQuestionPackage(input)
  const specs: NewtonTestCaseRowSpec[] = [
    configRow(question, options),
    ...(question.structuralRules ?? []).map(
      (rule): StructuralRuleRow => ({ type: 'STRUCTURAL_RULE', ...rule })
    ),
    ...(question.semanticCriteria ?? []).map(
      (criterion): SemanticCriterionRow => ({ type: 'SEMANTIC_CRITERION', ...criterion })
    ),
    ...question.rubric.checks.map((check): RubricCheckRow => ({ type: 'RUBRIC_CHECK', ...check }))
  ]

  const questionTextHtml = options.questionTextHtml ?? buildQuestionTextHtml(question.prompt)
  return {
    codecVersion: NEWTON_ROW_CODEC_VERSION,
    questionTitle: question.title,
    questionTextHtml,
    initialGameState:
      question.scaffold.type === 'partial' && question.scaffold.topology
        ? { topology: question.scaffold.topology }
        : {},
    rows: specs.map((spec, index) => titledRow(index + 1, spec))
  }
}

export function toNewtonRowsSeed(compiled: CompiledNewtonQuestionRows): NewtonQuestionRowsSeed {
  return {
    question_title: compiled.questionTitle,
    question_text: compiled.questionTextHtml,
    rubric: compiled.rows
  }
}
