import { inferRubricCheckKind } from './rubric'
import { parseQuestionPackage, type QuestionPackage } from './question'
import {
  compileQuestionPackageToNewtonRows,
  parseNewtonRowsToQuestionPackage,
  toNewtonRowsSeed
} from './newtonQuestionRows'
import { stableSerialize } from './stableHash'

export interface QuestionAuthoringCoverageInput {
  source: string
  raw: unknown
}

export interface QuestionStudioMvpShapeProfile {
  id: string
  questionTypes: readonly QuestionPackage['type'][]
  entryFormats: ReadonlyArray<NonNullable<QuestionPackage['entryFormat']> | 'legacy-unspecified'>
  scaffoldTypes: readonly QuestionPackage['scaffold']['type'][]
  structuralKinds: readonly string[]
  semanticKinds: readonly string[]
  rubricKinds: readonly string[]
  workloadKeys: readonly string[]
  globalKeys: readonly string[]
  maxFaultsPerCase: number
  supportsBudget: boolean
  supportsJustify: boolean
}

/**
 * Provisional shape target for the first visual vertical slice. This is an audit
 * profile, not a claim that UI or row round-tripping already exists.
 */
export const QUESTION_STUDIO_MVP_SHAPE_PROFILE: QuestionStudioMvpShapeProfile = {
  id: 'question-studio-mvp-shape-v1',
  questionTypes: ['open-build'],
  entryFormats: ['legacy-unspecified', 'blank-canvas'],
  scaffoldTypes: ['empty'],
  structuralKinds: ['requires_component', 'requires_single_source', 'requires_path'],
  semanticKinds: [
    'placement',
    'guardedPath',
    'fanout',
    'storageFit',
    'forbidUnjustified',
    'stateTransition'
  ],
  rubricKinds: ['simulation', 'invariant'],
  workloadKeys: [
    'baseRps',
    'requestDistribution',
    'pattern',
    'origins',
    'diurnal',
    'spike',
    'bursty',
    'sawtooth'
  ],
  globalKeys: ['simulationDuration', 'warmupDuration', 'seed', 'defaultTimeout', 'traceSampleRate'],
  maxFaultsPerCase: 1,
  supportsBudget: false,
  supportsJustify: false
}

export interface QuestionAuthoringCoverageRow {
  source: string
  id: string
  parses: boolean
  parseError?: string
  questionType?: string
  entryFormat?: string
  scaffoldType?: string
  structuralKinds: string[]
  semanticKinds: string[]
  rubricKinds: string[]
  rubricMetrics: string[]
  suiteCaseCount: number
  workloadKeys: string[]
  globalKeys: string[]
  maxFaultsInCase: number
  sourceOnlyPaths: string[]
  candidateShapeBlockers: string[]
  candidateShapeEligible: boolean
  exactSourceFidelityEligible: boolean
  normalizedPackageRoundTrip: boolean
}

export interface QuestionAuthoringCoverageReport {
  profileId: string
  proofStatus: {
    shapeInventory: 'measured'
    packageRowRoundTrip: 'measured'
    gradingParity: 'verified-by-fixture-test'
  }
  totals: {
    questions: number
    parseable: number
    candidateShapeEligible: number
    exactSourceFidelityEligible: number
    normalizedPackageRoundTrip: number
  }
  topLevelFieldUsage: Record<string, number>
  sourceOnlyPathUsage: Record<string, number>
  structuralKindUsage: Record<string, number>
  semanticKindUsage: Record<string, number>
  rubricKindUsage: Record<string, number>
  rubricMetricUsage: Record<string, number>
  questions: QuestionAuthoringCoverageRow[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function increment(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

function sortedRecord(counter: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counter.entries()].sort(([left], [right]) => left.localeCompare(right))
  )
}

/**
 * Return the shallowest source paths that disappear during canonical parsing.
 * If an entire object such as `_justify` is stripped, report `_justify` once
 * rather than every nested leaf below it.
 */
export function findSourceOnlyPaths(source: unknown, normalized: unknown, prefix = ''): string[] {
  if (Array.isArray(source)) {
    if (!Array.isArray(normalized)) return prefix ? [prefix] : []
    const missing = source.flatMap((value, index) =>
      findSourceOnlyPaths(value, normalized[index], `${prefix}[]`)
    )
    return sortedUnique(missing)
  }

  if (!isRecord(source)) return []
  if (!isRecord(normalized)) return prefix ? [prefix] : []

  const missing: string[] = []
  for (const key of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
    const path = prefix ? `${prefix}.${key}` : key
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
      missing.push(path)
      continue
    }
    missing.push(...findSourceOnlyPaths(source[key], normalized[key], path))
  }
  return sortedUnique(missing)
}

function rawId(raw: unknown, source: string): string {
  if (isRecord(raw) && typeof raw.id === 'string' && raw.id.trim().length > 0) {
    return raw.id.trim()
  }
  return source
}

function unsupportedValues(
  label: string,
  values: readonly string[],
  supported: readonly string[]
): string[] {
  const allowed = new Set(supported)
  return values.filter((value) => !allowed.has(value)).map((value) => `${label}: ${value}`)
}

function auditParsedQuestion(
  source: string,
  raw: unknown,
  parsed: QuestionPackage,
  profile: QuestionStudioMvpShapeProfile
): QuestionAuthoringCoverageRow {
  // Keep repeated kinds/metrics: the aggregate inventory counts authored rows,
  // while blocker generation is deduplicated separately below.
  const structuralKinds = (parsed.structuralRules ?? [])
    .map((rule) => rule.kind)
    .sort((left, right) => left.localeCompare(right))
  const semanticKinds = (parsed.semanticCriteria ?? [])
    .map((rule) => rule.kind)
    .sort((left, right) => left.localeCompare(right))
  const rubricKinds = parsed.rubric.checks
    .map((check) => inferRubricCheckKind(check))
    .sort((left, right) => left.localeCompare(right))
  const rubricMetrics = parsed.rubric.checks
    .map((check) => check.metric)
    .sort((left, right) => left.localeCompare(right))
  const workloadKeys = sortedUnique(
    parsed.suite.cases.flatMap((testCase) => Object.keys(testCase.workload ?? {}))
  )
  const globalKeys = sortedUnique(
    parsed.suite.cases.flatMap((testCase) => Object.keys(testCase.global ?? {}))
  )
  const maxFaultsInCase = parsed.suite.cases.reduce(
    (maximum, testCase) => Math.max(maximum, testCase.faults?.length ?? 0),
    0
  )
  const entryFormat = parsed.entryFormat ?? 'legacy-unspecified'
  const sourceOnlyPaths = findSourceOnlyPaths(raw, parsed)
  const roundTripped = parseNewtonRowsToQuestionPackage(
    toNewtonRowsSeed(compileQuestionPackageToNewtonRows(parsed))
  ).questionPackage
  const normalizedPackageRoundTrip = stableSerialize(roundTripped) === stableSerialize(parsed)
  const blockers = [
    ...unsupportedValues('question type', [parsed.type], profile.questionTypes),
    ...unsupportedValues('entry format', [entryFormat], profile.entryFormats),
    ...unsupportedValues('scaffold type', [parsed.scaffold.type], profile.scaffoldTypes),
    ...unsupportedValues('structural kind', structuralKinds, profile.structuralKinds),
    ...unsupportedValues('semantic kind', semanticKinds, profile.semanticKinds),
    ...unsupportedValues('rubric kind', rubricKinds, profile.rubricKinds),
    ...unsupportedValues('workload field', workloadKeys, profile.workloadKeys),
    ...unsupportedValues('global field', globalKeys, profile.globalKeys)
  ]

  if (maxFaultsInCase > profile.maxFaultsPerCase) {
    blockers.push(`fault count: ${maxFaultsInCase} in one case exceeds ${profile.maxFaultsPerCase}`)
  }
  if (parsed.budget && !profile.supportsBudget) blockers.push('budget is not in the MVP shape')
  if ((parsed.justify?.length ?? 0) > 0 && !profile.supportsJustify) {
    blockers.push('justification is not in the MVP shape')
  }

  const candidateShapeBlockers = sortedUnique(blockers)
  return {
    source,
    id: parsed.id,
    parses: true,
    questionType: parsed.type,
    entryFormat,
    scaffoldType: parsed.scaffold.type,
    structuralKinds,
    semanticKinds,
    rubricKinds,
    rubricMetrics,
    suiteCaseCount: parsed.suite.cases.length,
    workloadKeys,
    globalKeys,
    maxFaultsInCase,
    sourceOnlyPaths,
    candidateShapeBlockers,
    candidateShapeEligible: candidateShapeBlockers.length === 0,
    exactSourceFidelityEligible: sourceOnlyPaths.length === 0,
    normalizedPackageRoundTrip
  }
}

function auditQuestion(
  input: QuestionAuthoringCoverageInput,
  profile: QuestionStudioMvpShapeProfile
): QuestionAuthoringCoverageRow {
  try {
    return auditParsedQuestion(input.source, input.raw, parseQuestionPackage(input.raw), profile)
  } catch (error) {
    return {
      source: input.source,
      id: rawId(input.raw, input.source),
      parses: false,
      parseError: error instanceof Error ? error.message : String(error),
      structuralKinds: [],
      semanticKinds: [],
      rubricKinds: [],
      rubricMetrics: [],
      suiteCaseCount: 0,
      workloadKeys: [],
      globalKeys: [],
      maxFaultsInCase: 0,
      sourceOnlyPaths: [],
      candidateShapeBlockers: ['question package does not parse'],
      candidateShapeEligible: false,
      exactSourceFidelityEligible: false,
      normalizedPackageRoundTrip: false
    }
  }
}

export function buildQuestionAuthoringCoverageReport(
  inputs: readonly QuestionAuthoringCoverageInput[],
  profile: QuestionStudioMvpShapeProfile = QUESTION_STUDIO_MVP_SHAPE_PROFILE
): QuestionAuthoringCoverageReport {
  const questions = inputs
    .map((input) => auditQuestion(input, profile))
    .sort(
      (left, right) => left.id.localeCompare(right.id) || left.source.localeCompare(right.source)
    )

  const topLevelFieldUsage = new Map<string, number>()
  for (const input of inputs) {
    if (!isRecord(input.raw)) continue
    for (const key of Object.keys(input.raw)) increment(topLevelFieldUsage, key)
  }

  const sourceOnlyPathUsage = new Map<string, number>()
  const structuralKindUsage = new Map<string, number>()
  const semanticKindUsage = new Map<string, number>()
  const rubricKindUsage = new Map<string, number>()
  const rubricMetricUsage = new Map<string, number>()

  for (const question of questions) {
    question.sourceOnlyPaths.forEach((path) => increment(sourceOnlyPathUsage, path))
    question.structuralKinds.forEach((kind) => increment(structuralKindUsage, kind))
    question.semanticKinds.forEach((kind) => increment(semanticKindUsage, kind))
    question.rubricKinds.forEach((kind) => increment(rubricKindUsage, kind))
    question.rubricMetrics.forEach((metric) => increment(rubricMetricUsage, metric))
  }

  return {
    profileId: profile.id,
    proofStatus: {
      shapeInventory: 'measured',
      packageRowRoundTrip: 'measured',
      gradingParity: 'verified-by-fixture-test'
    },
    totals: {
      questions: questions.length,
      parseable: questions.filter((question) => question.parses).length,
      candidateShapeEligible: questions.filter((question) => question.candidateShapeEligible)
        .length,
      exactSourceFidelityEligible: questions.filter(
        (question) => question.exactSourceFidelityEligible
      ).length,
      normalizedPackageRoundTrip: questions.filter(
        (question) => question.normalizedPackageRoundTrip
      ).length
    },
    topLevelFieldUsage: sortedRecord(topLevelFieldUsage),
    sourceOnlyPathUsage: sortedRecord(sourceOnlyPathUsage),
    structuralKindUsage: sortedRecord(structuralKindUsage),
    semanticKindUsage: sortedRecord(semanticKindUsage),
    rubricKindUsage: sortedRecord(rubricKindUsage),
    rubricMetricUsage: sortedRecord(rubricMetricUsage),
    questions
  }
}

function markdownCountList(values: Record<string, number>): string[] {
  const entries = Object.entries(values)
  return entries.length > 0 ? entries.map(([key, count]) => `- \`${key}\`: ${count}`) : ['- None']
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

export function formatQuestionAuthoringCoverageMarkdown(
  report: QuestionAuthoringCoverageReport
): string {
  const lines = [
    '# Question Studio MVP Coverage Audit',
    '',
    `Profile: \`${report.profileId}\``,
    '',
    '> Normalized runtime packages now use the shared Newton row codec. Source-only',
    '> fields remain outside that contract and are reported separately.',
    '',
    '## Summary',
    '',
    `- Questions: ${report.totals.questions}`,
    `- Parseable packages: ${report.totals.parseable}`,
    `- Candidate MVP shape eligible: ${report.totals.candidateShapeEligible}`,
    `- Exact source fidelity eligible: ${report.totals.exactSourceFidelityEligible}`,
    `- Normalized package round-trips: ${report.totals.normalizedPackageRoundTrip}`,
    `- Package↔row round-trip: ${report.proofStatus.packageRowRoundTrip}`,
    `- Grading parity: ${report.proofStatus.gradingParity}`,
    '',
    '## Source-only paths',
    '',
    ...markdownCountList(report.sourceOnlyPathUsage),
    '',
    '## Primitive inventory',
    '',
    '### Structural kinds',
    '',
    ...markdownCountList(report.structuralKindUsage),
    '',
    '### Semantic kinds',
    '',
    ...markdownCountList(report.semanticKindUsage),
    '',
    '### Rubric kinds',
    '',
    ...markdownCountList(report.rubricKindUsage),
    '',
    '### Rubric metrics',
    '',
    ...markdownCountList(report.rubricMetricUsage),
    '',
    '## Per-question matrix',
    '',
    '| Question | Parses | Shape eligible | Row round-trip | Exact fidelity | Cases | Source-only | Blockers |',
    '| --- | --- | --- | --- | --- | ---: | --- | --- |'
  ]

  for (const question of report.questions) {
    lines.push(
      `| ${tableCell(question.id)} | ${question.parses ? 'yes' : 'no'} | ${question.candidateShapeEligible ? 'yes' : 'no'} | ${question.normalizedPackageRoundTrip ? 'yes' : 'no'} | ${question.exactSourceFidelityEligible ? 'yes' : 'no'} | ${question.suiteCaseCount} | ${tableCell(question.sourceOnlyPaths.join(', ') || '—')} | ${tableCell(question.candidateShapeBlockers.join('; ') || question.parseError || '—')} |`
    )
  }

  lines.push(
    '',
    '## Proof and preservation policy',
    '',
    '1. Package → rows → normalized package is measured above for every canonical question.',
    '2. Reference/gamed contract parity is locked by the canonical fixture test.',
    '3. `family` remains auxiliary source metadata outside the runtime package.',
    '4. Legacy `_justify` remains source-only; canonical `justify` is preserved by the codec.',
    ''
  )

  return lines.join('\n')
}
