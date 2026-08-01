import { z } from 'zod'
import type { FaultSpec, GlobalConfig, TopologyJSON, WorkloadProfile } from '../core/types'
import type { SimulationOutput } from './output'
import { evaluateSuite, mergeTopologyWithOverrides, type PreparedCase } from './evaluate'
import {
  gradeBatch,
  RUBRIC_VERSION,
  type CheckResult,
  type GradedCaseResult,
  type GradedEvaluationBatch,
  type Rubric,
  type RubricResult
} from './rubric'
import {
  evaluateStructuralRules,
  STRUCTURAL_RULES_VERSION,
  type StructuralEvaluation,
  type StructuralRule
} from './structural'
import { SIMULATION_VERDICT_VERSION, type SimulationVerdict } from './verdict'
import {
  ComponentNodeSchema,
  EdgeDefinitionSchema,
  FaultSpecSchema,
  GlobalConfigSchema,
  TopologyJSONSchema,
  WorkloadProfileSchema
} from '../validation/validator'

/**
 * Gap-4 question-platform schemas (frozen decisions):
 *  1. These types live engine-side and are renderer-free — they depend only on
 *     engine/core/types + the grading modules. Django imports them via the CLI.
 *  2. `gradeAttempt` is pure and takes an injected `runTopology`, mirroring
 *     `evaluateSuite`, so it stays testable without spinning the real engine.
 *  3. `scaffold.topology` and `AttemptState.topology` are canonical engine
 *     TopologyJSON. The app bridges to/from canvas via the anti-corruption layer
 *     (topologyCanvasAdapter to open, useTopologySerializer to autosave/grade).
 *  4. A question's suite cases carry CONDITION overrides only (global/workload/
 *     faults) and NO per-case topology — the topology under test is the student's
 *     submission, which `gradeAttempt` injects as the base for every case.
 *  5. A QuestionPackage is self-contained (portable unit handed to the iframe).
 */

export const QUESTION_PACKAGE_VERSION = '1.0' as const
export const ATTEMPT_STATE_VERSION = '1.0' as const

export type QuestionType =
  | 'fix'
  | 'build-budget'
  | 'optimize'
  | 'open-build'
  | 'scaling'
  | 'ha-chaos'
  | 'tradeoff'

export interface NFRTarget {
  metric: 'latency_p99' | 'latency_p50' | 'availability' | 'error_rate' | 'throughput'
  operator: '<' | '<=' | '>' | '>='
  value: number
  unit: 'ms' | 'percent' | 'req_per_sec' | 'nines'
  description: string
}

export interface ScaleParameters {
  dau?: number
  peakRps?: number
  /** Read-to-write ratio, e.g. 90 means 90% reads. */
  readWriteRatio?: number
  storageGb?: number
  retentionDays?: number
  growthRatePercent?: number
}

export interface QuestionPrompt {
  /** Human-readable problem statement (markdown). */
  text: string
  functionalRequirements: string[]
  nonFunctionalRequirements: NFRTarget[]
  scale: ScaleParameters
  additionalContext?: string
}

export interface QuestionScaffold {
  type: 'empty' | 'partial' | 'complete'
  /** Starting engine topology (omitted for empty scaffolds). */
  topology?: TopologyJSON
  lockedNodeIds?: string[]
  lockedEdgeIds?: string[]
  /** For 'optimize': the baseline verdict the student must beat. */
  baselineVerdict?: SimulationVerdict
}

export interface QuestionConstraints {
  allowedNodeTypes?: string[]
  forbiddenNodeTypes?: string[]
  maxNodeCount?: number
  maxBudget?: number
  maxTotalWorkers?: number
  canModifyScaffold: boolean
  canRemoveScaffoldNodes: boolean
}

/**
 * One grading condition. It carries only overrides — never a topology — because
 * the topology under test is the student's submission (see decision 4).
 */
export interface QuestionSuiteCase {
  id: string
  description?: string
  global?: Partial<GlobalConfig>
  workload?: Partial<WorkloadProfile>
  faults?: FaultSpec[]
}

export interface QuestionSuite {
  name: string
  cases: QuestionSuiteCase[]
  /** Whether the student may see the grading scenarios (false = hidden contest suite). */
  visibleToStudent: boolean
  /** Optional representative case the student CAN dry-run against. */
  dryRunCase?: QuestionSuiteCase
}

export interface QuestionPackage {
  version: typeof QUESTION_PACKAGE_VERSION
  id: string
  title: string
  description?: string
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  tags?: string[]
  estimatedTimeMinutes?: number
  type: QuestionType
  prompt: QuestionPrompt
  scaffold: QuestionScaffold
  constraints: QuestionConstraints
  structuralRules?: StructuralRule[]
  suite: QuestionSuite
  rubric: Rubric
  author?: string
  createdAt?: string
}

export type AttemptStatus = 'DRAFT' | 'AUTOSAVED' | 'SUBMITTED' | 'GRADING' | 'GRADED' | 'LOCKED'

export interface AttemptState {
  version: typeof ATTEMPT_STATE_VERSION
  attemptId: string
  questionId: string
  /** The student's current engine topology (autosaved). */
  topology: TopologyJSON
  status: AttemptStatus
  startedAt: string
  lastSavedAt: string
  submittedAt?: string
  testRunCount: number
  lastDryRun?: {
    timestamp: string
    grade: AttemptGrade
  }
  grade?: {
    gradedAt: string
    result: AttemptGrade
  }
}

/** One flat pass/fail row for the Game Playground host — the collapsed boolean contract. */
export interface HostTest {
  id: string
  name: string
  passed: boolean
  detail?: string
}

export interface HostContract {
  tests: HostTest[]
  totalTests: number
  passedTests: number
  allPassed: boolean
}

export interface AttemptGrade {
  /** Structural rules that can short-circuit grading before simulation. */
  structural: StructuralEvaluation
  /** The full graded batch (rich data — stays inside the simulator). */
  graded: GradedEvaluationBatch
  /** The collapsed boolean contract sent across the iframe seam to the host. */
  contract: HostContract
}

export type QuestionTestStatus = 'pending' | 'passed' | 'failed'

export interface QuestionTestRow {
  id: string
  name: string
  scope: string
  status: QuestionTestStatus
  detail?: string
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

const QuestionTypeSchema = z.enum([
  'fix',
  'build-budget',
  'optimize',
  'open-build',
  'scaling',
  'ha-chaos',
  'tradeoff'
])

const NFRTargetSchema = z.object({
  metric: z.enum(['latency_p99', 'latency_p50', 'availability', 'error_rate', 'throughput']),
  operator: z.enum(['<', '<=', '>', '>=']),
  value: z.number().finite(),
  unit: z.enum(['ms', 'percent', 'req_per_sec', 'nines']),
  description: z.string().min(1)
})

const ScaleParametersSchema = z
  .object({
    dau: z.number().finite().nonnegative().optional(),
    peakRps: z.number().finite().nonnegative().optional(),
    readWriteRatio: z.number().finite().min(0).max(100).optional(),
    storageGb: z.number().finite().nonnegative().optional(),
    retentionDays: z.number().finite().nonnegative().optional(),
    growthRatePercent: z.number().finite().nonnegative().optional()
  })
  .default({})

const QuestionPromptSchema = z.object({
  text: z.string().min(1),
  functionalRequirements: z.array(z.string().min(1)),
  nonFunctionalRequirements: z.array(NFRTargetSchema),
  scale: ScaleParametersSchema,
  additionalContext: z.string().min(1).optional()
})

const SimulationVerdictScaffoldSchema = z.custom<SimulationVerdict>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === SIMULATION_VERDICT_VERSION,
  'baselineVerdict must be a SimulationVerdict'
)

const QuestionScaffoldSchema = z
  .object({
    type: z.enum(['empty', 'partial', 'complete']),
    topology: TopologyJSONSchema.optional(),
    lockedNodeIds: z.array(z.string().min(1)).optional(),
    lockedEdgeIds: z.array(z.string().min(1)).optional(),
    baselineVerdict: SimulationVerdictScaffoldSchema.optional()
  })
  .superRefine((scaffold, ctx) => {
    if (scaffold.type !== 'empty' && !scaffold.topology) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['topology'],
        message: `Scaffold type '${scaffold.type}' requires a topology.`
      })
    }
  })

const ComponentTypeSchema = ComponentNodeSchema.shape.type
const ComponentCategorySchema = ComponentNodeSchema.shape.category
const EdgeModeSchema = EdgeDefinitionSchema.shape.mode

const StructuralRuleSchema: z.ZodType<StructuralRule> = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('requires_component'),
    componentType: ComponentTypeSchema,
    minCount: z.number().int().positive().optional()
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('requires_category'),
    category: ComponentCategorySchema,
    minCount: z.number().int().positive().optional()
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('requires_edge'),
    fromType: ComponentTypeSchema,
    toType: ComponentTypeSchema,
    mode: EdgeModeSchema.optional()
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('max_component_count'),
    componentType: ComponentTypeSchema,
    maxCount: z.number().int().nonnegative()
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('requires_redundancy'),
    componentType: ComponentTypeSchema,
    minReplicas: z.number().int().positive()
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('forbids_component'),
    componentType: ComponentTypeSchema
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('requires_connected_graph')
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('requires_single_source')
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('min_node_count'),
    count: z.number().int().nonnegative()
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('max_node_count'),
    count: z.number().int().nonnegative()
  }),
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.literal('requires_path'),
    fromType: ComponentTypeSchema,
    toType: ComponentTypeSchema
  })
])

const QuestionConstraintsSchema = z.object({
  allowedNodeTypes: z.array(ComponentTypeSchema).optional(),
  forbiddenNodeTypes: z.array(ComponentTypeSchema).optional(),
  maxNodeCount: z.number().int().positive().optional(),
  maxBudget: z.number().finite().nonnegative().optional(),
  maxTotalWorkers: z.number().int().nonnegative().optional(),
  canModifyScaffold: z.boolean(),
  canRemoveScaffoldNodes: z.boolean()
})

const QuestionSuiteCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1).optional(),
  global: GlobalConfigSchema.partial().optional(),
  workload: WorkloadProfileSchema.partial().optional(),
  faults: z.array(FaultSpecSchema).optional()
})

const RubricCheckSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  metric: z.string().min(1),
  op: z.enum(['<', '<=', '>', '>=', '==', '!=']),
  value: z.number().finite(),
  points: z.number().int().positive().optional()
})

const RubricSchema: z.ZodType<Rubric> = z.object({
  version: z.string().optional(),
  id: z.string().min(1).optional(),
  passThreshold: z.number().min(0).max(1).optional(),
  checks: z.array(RubricCheckSchema).min(1)
})

const QuestionSuiteSchema = z.object({
  name: z.string().min(1),
  cases: z.array(QuestionSuiteCaseSchema).min(1),
  visibleToStudent: z.boolean(),
  dryRunCase: QuestionSuiteCaseSchema.optional()
})

function validateUniqueIds(
  entries: readonly { id: string }[],
  path: (string | number)[],
  label: string,
  ctx: z.RefinementCtx
): void {
  const seen = new Map<string, number>()
  for (const [index, entry] of entries.entries()) {
    const previous = seen.get(entry.id)
    if (previous !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'id'],
        message: `${label} ids must be unique; duplicate '${entry.id}' also appears at index ${previous}.`
      })
      continue
    }

    seen.set(entry.id, index)
  }
}

const StructuralCheckResultSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().min(1).optional()
})

const StructuralEvaluationSchema: z.ZodType<StructuralEvaluation> = z
  .object({
    version: z.literal(STRUCTURAL_RULES_VERSION),
    checks: z.array(StructuralCheckResultSchema),
    passed: z.boolean()
  })
  .superRefine((value, ctx) => {
    const computedPassed = value.checks.every((check) => check.passed)
    if (value.passed !== computedPassed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passed'],
        message: 'Structural evaluation passed flag must match its checks.'
      })
    }
  })

const HostTestSchema: z.ZodType<HostTest> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().min(1).optional()
})

const HostContractSchema: z.ZodType<HostContract> = z
  .object({
    tests: z.array(HostTestSchema),
    totalTests: z.number().int().nonnegative(),
    passedTests: z.number().int().nonnegative(),
    allPassed: z.boolean()
  })
  .superRefine((value, ctx) => {
    const totalTests = value.tests.length
    const passedTests = value.tests.filter((test) => test.passed).length
    const allPassed = totalTests > 0 && passedTests === totalTests

    if (value.totalTests !== totalTests) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalTests'],
        message: 'totalTests must match tests.length.'
      })
    }

    if (value.passedTests !== passedTests) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passedTests'],
        message: 'passedTests must match the number of passed tests.'
      })
    }

    if (value.allPassed !== allPassed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allPassed'],
        message: 'allPassed must match the test results.'
      })
    }
  })

const RubricCheckResultSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  metric: z.string().min(1),
  op: z.enum(['<', '<=', '>', '>=', '==', '!=']),
  value: z.number().finite(),
  actual: z.union([z.number().finite(), z.null()]),
  passed: z.boolean(),
  points: z.number().int().nonnegative(),
  awarded: z.number().int().nonnegative(),
  detail: z.string().min(1).optional()
}) as z.ZodType<CheckResult>

const RubricResultSchema: z.ZodType<RubricResult> = z.object({
  version: z.literal(RUBRIC_VERSION),
  rubricId: z.string().min(1).optional(),
  checks: z.array(RubricCheckResultSchema),
  score: z.object({
    earned: z.number().finite(),
    possible: z.number().finite(),
    fraction: z.number().finite()
  }),
  passed: z.boolean()
})

const GradedCaseResultSchema: z.ZodType<GradedCaseResult> = z.object({
  id: z.string().min(1),
  ran: z.boolean(),
  error: z.string().min(1).optional(),
  rubric: RubricResultSchema.optional()
})

const GradedEvaluationBatchSchema: z.ZodType<GradedEvaluationBatch> = z
  .object({
    version: z.literal(RUBRIC_VERSION),
    suite: z.string().min(1).optional(),
    rubricId: z.string().min(1).optional(),
    cases: z.array(GradedCaseResultSchema),
    summary: z.object({
      total: z.number().int().nonnegative(),
      ran: z.number().int().nonnegative(),
      errored: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative()
    })
  })
  .superRefine((value, ctx) => {
    const total = value.cases.length
    const ran = value.cases.filter((entry) => entry.ran).length
    const errored = total - ran
    const passed = value.cases.filter((entry) => entry.rubric?.passed).length
    const failed = total - passed

    if (value.summary.total !== total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'total'],
        message: 'summary.total must match cases.length.'
      })
    }

    if (value.summary.ran !== ran) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'ran'],
        message: 'summary.ran must match the number of ran cases.'
      })
    }

    if (value.summary.errored !== errored) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'errored'],
        message: 'summary.errored must match the number of unran cases.'
      })
    }

    if (value.summary.passed !== passed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'passed'],
        message: 'summary.passed must match the number of passed rubric results.'
      })
    }

    if (value.summary.failed !== failed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'failed'],
        message: 'summary.failed must match total - passed.'
      })
    }
  })

const AttemptGradeSchema: z.ZodType<AttemptGrade> = z.object({
  structural: StructuralEvaluationSchema,
  graded: GradedEvaluationBatchSchema,
  contract: HostContractSchema
})

const IsoTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO timestamp.')

const AttemptStatusSchema = z.enum([
  'DRAFT',
  'AUTOSAVED',
  'SUBMITTED',
  'GRADING',
  'GRADED',
  'LOCKED'
])

const LastDryRunSchema = z.object({
  timestamp: IsoTimestampSchema,
  grade: AttemptGradeSchema
})

const GradeSnapshotSchema = z.object({
  gradedAt: IsoTimestampSchema,
  result: AttemptGradeSchema
})

export const QuestionPackageSchema: z.ZodType<QuestionPackage> = z
  .object({
    version: z.literal(QUESTION_PACKAGE_VERSION).default(QUESTION_PACKAGE_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    tags: z.array(z.string().min(1)).optional(),
    estimatedTimeMinutes: z.number().int().positive().optional(),
    type: QuestionTypeSchema,
    prompt: QuestionPromptSchema,
    scaffold: QuestionScaffoldSchema,
    constraints: QuestionConstraintsSchema,
    structuralRules: z.array(StructuralRuleSchema).optional(),
    suite: QuestionSuiteSchema,
    rubric: RubricSchema,
    author: z.string().min(1).optional(),
    createdAt: IsoTimestampSchema.optional()
  })
  .superRefine((pkg, ctx) => {
    validateUniqueIds(pkg.suite.cases, ['suite', 'cases'], 'Question suite case', ctx)
    validateUniqueIds(pkg.rubric.checks, ['rubric', 'checks'], 'Rubric check', ctx)
    if (pkg.structuralRules) {
      validateUniqueIds(pkg.structuralRules, ['structuralRules'], 'Structural rule', ctx)
    }
  })

export const AttemptStateSchema: z.ZodType<AttemptState> = z
  .object({
    version: z.literal(ATTEMPT_STATE_VERSION).default(ATTEMPT_STATE_VERSION),
    attemptId: z.string().min(1),
    questionId: z.string().min(1),
    topology: TopologyJSONSchema,
    status: AttemptStatusSchema,
    startedAt: IsoTimestampSchema,
    lastSavedAt: IsoTimestampSchema,
    submittedAt: IsoTimestampSchema.optional(),
    testRunCount: z.number().int().nonnegative(),
    lastDryRun: LastDryRunSchema.optional(),
    grade: GradeSnapshotSchema.optional()
  })
  .superRefine((attempt, ctx) => {
    if (
      (attempt.status === 'SUBMITTED' ||
        attempt.status === 'GRADED' ||
        attempt.status === 'LOCKED') &&
      !attempt.submittedAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['submittedAt'],
        message: `Attempt status '${attempt.status}' requires submittedAt.`
      })
    }

    if ((attempt.status === 'GRADED' || attempt.status === 'LOCKED') && !attempt.grade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grade'],
        message: `Attempt status '${attempt.status}' requires a persisted grade.`
      })
    }
  })

function formatSchemaIssues(label: string, issues: z.ZodIssue[]): string {
  const [first, ...rest] = issues
  const firstMessage = first
    ? `${first.path.length > 0 ? `${first.path.join('.')}: ` : ''}${first.message}`
    : 'unknown validation error'
  return `${label} validation failed: ${firstMessage}${rest.length > 0 ? ` (+${rest.length} more)` : ''}`
}

export function parseQuestionPackage(input: unknown): QuestionPackage {
  const parsed = QuestionPackageSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(formatSchemaIssues('Question package', parsed.error.issues))
  }

  return parsed.data
}

export function parseAttemptState(input: unknown, expectedQuestionId?: string): AttemptState {
  const parsed = AttemptStateSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(formatSchemaIssues('Attempt state', parsed.error.issues))
  }

  if (expectedQuestionId && parsed.data.questionId !== expectedQuestionId) {
    throw new Error(
      `Attempt state validation failed: questionId '${parsed.data.questionId}' does not match expected '${expectedQuestionId}'.`
    )
  }

  return parsed.data
}

function buildAttemptId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `attempt-${Date.now()}`
}

function stableNow(now?: string): string {
  return now ?? new Date().toISOString()
}

export function createAttemptState({
  questionId,
  topology,
  now,
  attemptId
}: {
  questionId: string
  topology: TopologyJSON
  now?: string
  attemptId?: string
}): AttemptState {
  const timestamp = stableNow(now)
  return {
    version: ATTEMPT_STATE_VERSION,
    attemptId: attemptId ?? buildAttemptId(),
    questionId,
    topology,
    status: 'DRAFT',
    startedAt: timestamp,
    lastSavedAt: timestamp,
    testRunCount: 0
  }
}

function baseAttemptForQuestion(
  current: AttemptState | null,
  questionId: string,
  topology: TopologyJSON,
  now?: string
): AttemptState {
  if (!current || current.questionId !== questionId) {
    return createAttemptState({ questionId, topology, now })
  }

  return current
}

export function markAttemptGrading(
  current: AttemptState | null,
  {
    questionId,
    topology,
    now
  }: {
    questionId: string
    topology: TopologyJSON
    now?: string
  }
): AttemptState {
  const timestamp = stableNow(now)
  const base = baseAttemptForQuestion(current, questionId, topology, timestamp)

  return {
    ...base,
    topology,
    status: 'GRADING',
    lastSavedAt: timestamp
  }
}

export function autosaveAttempt(
  current: AttemptState | null,
  {
    questionId,
    topology,
    now
  }: {
    questionId: string
    topology: TopologyJSON
    now?: string
  }
): AttemptState {
  const timestamp = stableNow(now)
  const base = baseAttemptForQuestion(current, questionId, topology, timestamp)

  if (isAttemptCurrentForTopology(base, topology) || base.status === 'LOCKED') {
    return base
  }

  return {
    ...base,
    topology,
    status: 'AUTOSAVED',
    lastSavedAt: timestamp,
    submittedAt: undefined,
    lastDryRun: undefined,
    grade: undefined
  }
}

export function recordDryRunGrade(
  current: AttemptState,
  {
    topology,
    grade,
    now
  }: {
    topology: TopologyJSON
    grade: AttemptGrade
    now?: string
  }
): AttemptState {
  const timestamp = stableNow(now)
  return {
    ...current,
    topology,
    status: 'DRAFT',
    lastSavedAt: timestamp,
    testRunCount: current.testRunCount + 1,
    lastDryRun: {
      timestamp,
      grade
    }
  }
}

export function recordSubmittedGrade(
  current: AttemptState,
  {
    topology,
    grade,
    now
  }: {
    topology: TopologyJSON
    grade: AttemptGrade
    now?: string
  }
): AttemptState {
  const timestamp = stableNow(now)
  return {
    ...current,
    topology,
    status: 'GRADED',
    lastSavedAt: timestamp,
    submittedAt: current.submittedAt ?? timestamp,
    grade: {
      gradedAt: timestamp,
      result: grade
    }
  }
}

export function recoverAttemptAfterGradingError(
  current: AttemptState | null,
  now?: string
): AttemptState | null {
  if (!current) {
    return null
  }

  return {
    ...current,
    status: current.grade ? 'GRADED' : 'DRAFT',
    lastSavedAt: stableNow(now)
  }
}

export function resumePersistedAttempt(
  current: AttemptState | null,
  now?: string
): AttemptState | null {
  if (!current) {
    return null
  }

  if (current.status !== 'GRADING' && current.status !== 'SUBMITTED') {
    return current
  }

  return {
    ...current,
    status: current.grade ? 'GRADED' : 'AUTOSAVED',
    lastSavedAt: stableNow(now),
    submittedAt: current.grade ? current.submittedAt : undefined
  }
}

function buildSkippedGradedBatch(pkg: QuestionPackage, reason: string): GradedEvaluationBatch {
  return {
    version: RUBRIC_VERSION,
    ...(pkg.suite.name ? { suite: pkg.suite.name } : {}),
    ...(pkg.rubric.id ? { rubricId: pkg.rubric.id } : {}),
    cases: pkg.suite.cases.map((testCase) => ({
      id: testCase.id,
      ran: false,
      error: reason
    })),
    summary: {
      total: pkg.suite.cases.length,
      ran: 0,
      errored: pkg.suite.cases.length,
      passed: 0,
      failed: pkg.suite.cases.length
    }
  }
}

/**
 * Collapses a graded batch to the boolean host contract. Every rubric check
 * across every ran case becomes one test row; a case that could not run becomes
 * a single failed row. `allPassed` is the question-level gate: all rows green.
 */
export function toHostContract(
  structural: StructuralEvaluation,
  graded: GradedEvaluationBatch
): HostContract {
  const tests: HostTest[] = structural.checks.map((check) => ({
    id: `structural:${check.id}`,
    name: check.description,
    passed: check.passed,
    ...(check.detail ? { detail: check.detail } : {})
  }))

  for (const entry of graded.cases) {
    if (entry.rubric) {
      for (const check of entry.rubric.checks) {
        tests.push({
          id: `${entry.id}:${check.id}`,
          name: check.description,
          passed: check.passed,
          ...(check.detail
            ? { detail: check.detail }
            : !check.passed && check.actual !== null
              ? {
                  detail: `actual ${check.actual} does not satisfy ${check.metric} ${check.op} ${check.value}`
                }
              : {})
        })
      }
    } else {
      tests.push({
        id: `${entry.id}:did-not-run`,
        name: `Case ${entry.id} could not run`,
        passed: false,
        ...(entry.error ? { detail: entry.error } : {})
      })
    }
  }
  const passedTests = tests.filter((test) => test.passed).length
  return {
    tests,
    totalTests: tests.length,
    passedTests,
    allPassed: tests.length > 0 && passedTests === tests.length
  }
}

/**
 * Builds the question-facing tests list shown in the simulator or a host embed.
 * Before grading, it renders the authored checks as pending rows. After grading,
 * it overlays the actual contract results while preserving authored ordering.
 */
export function buildQuestionTestRows(
  pkg: QuestionPackage,
  grade?: AttemptGrade | null
): QuestionTestRow[] {
  const authoredRows: QuestionTestRow[] = [
    ...(pkg.structuralRules ?? []).map((rule) => ({
      id: `structural:${rule.id}`,
      name: rule.description,
      scope: 'structure',
      status: 'pending' as const
    })),
    ...pkg.suite.cases.flatMap((testCase) =>
      pkg.rubric.checks.map((check) => ({
        id: `${testCase.id}:${check.id}`,
        name: check.description,
        scope: testCase.id,
        status: 'pending' as const
      }))
    )
  ]

  if (!grade) {
    return authoredRows
  }

  const byId = new Map(
    grade.contract.tests.map((test) => [
      test.id,
      {
        id: test.id,
        name: test.name,
        scope: test.id.split(':')[0] ?? 'grade',
        status: test.passed ? ('passed' as const) : ('failed' as const),
        ...(test.detail ? { detail: test.detail } : {})
      }
    ])
  )

  const rows = authoredRows.map((row) => byId.get(row.id) ?? row)
  const authoredIds = new Set(authoredRows.map((row) => row.id))
  for (const extra of grade.contract.tests) {
    if (authoredIds.has(extra.id)) {
      continue
    }
    rows.push({
      id: extra.id,
      name: extra.name,
      scope: extra.id.split(':')[0] ?? 'grade',
      status: extra.passed ? 'passed' : 'failed',
      ...(extra.detail ? { detail: extra.detail } : {})
    })
  }

  return rows
}

export function topologySnapshotSignature(topology: TopologyJSON): string {
  return stableSerialize(topology)
}

export function isAttemptCurrentForTopology(
  attempt: AttemptState | null | undefined,
  topology: TopologyJSON | null | undefined
): boolean {
  if (!attempt || !topology) {
    return false
  }

  return topologySnapshotSignature(attempt.topology) === topologySnapshotSignature(topology)
}

export function resolveVisibleAttemptGrade(
  attempt: AttemptState | null | undefined,
  topology: TopologyJSON | null | undefined
): AttemptGrade | null {
  if (!isAttemptCurrentForTopology(attempt, topology)) {
    return null
  }

  return attempt?.grade?.result ?? attempt?.lastDryRun?.grade ?? null
}

export function resolveVisibleAttemptStatus(
  attempt: AttemptState | null | undefined,
  topology: TopologyJSON | null | undefined
): AttemptStatus | 'DRAFT' {
  if (!attempt) {
    return 'DRAFT'
  }

  return isAttemptCurrentForTopology(attempt, topology) ? attempt.status : 'DRAFT'
}

/**
 * Grades a student's submitted topology against a question package: injects the
 * topology as the base for every suite case, applies each case's condition
 * overrides, runs the batch, grades with the package rubric, and collapses to the
 * host contract. Pure — the engine run is injected as `runTopology`.
 */
export function gradeAttempt(
  pkg: QuestionPackage,
  studentTopology: TopologyJSON,
  runTopology: (topology: TopologyJSON) => SimulationOutput
): AttemptGrade {
  const structural =
    pkg.structuralRules && pkg.structuralRules.length > 0
      ? evaluateStructuralRules(studentTopology, pkg.structuralRules)
      : { version: STRUCTURAL_RULES_VERSION, checks: [], passed: true }

  if (!structural.passed) {
    const graded = buildSkippedGradedBatch(pkg, 'Skipped because structural rules failed.')
    return { structural, graded, contract: toHostContract(structural, graded) }
  }

  const cases: PreparedCase[] = pkg.suite.cases.map((testCase) => ({
    id: testCase.id,
    topology: mergeTopologyWithOverrides(studentTopology, {
      global: testCase.global,
      workload: testCase.workload,
      faults: testCase.faults
    })
  }))

  const batch = evaluateSuite(cases, runTopology, pkg.suite.name)
  const graded = gradeBatch(pkg.rubric, batch)
  return { structural, graded, contract: toHostContract(structural, graded) }
}
