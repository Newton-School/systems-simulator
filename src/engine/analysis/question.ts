import { z } from 'zod'
import type { FaultSpec, GlobalConfig, TopologyJSON, WorkloadProfile } from '../core/types'
import type { SimulationOutput } from './output'
import {
  evaluateSuite,
  mergeTopologyWithOverrides,
  type EvaluationBatch,
  type PreparedCase
} from './evaluate'
import {
  EXECUTION_CHECK_ID,
  EXECUTION_SKIPPED_DETAIL,
  gradeQuestionBatch,
  inferRubricCheckKind,
  isInvariantMetric,
  RUBRIC_VERSION,
  type CaseExecutionStatus,
  type CheckResult,
  type CheckResultKind,
  type CheckStatus,
  type GradedCaseResult,
  type GradedEvaluationBatch,
  type Rubric,
  type RubricCheck,
  type RubricResult
} from './rubric'
import {
  evaluateStructuralRules,
  STRUCTURAL_RULES_VERSION,
  type StructuralEvaluation,
  type StructuralRule
} from './structural'
import {
  evaluateSemanticCriteria,
  type SemanticContext,
  type SemanticEvaluation
} from './semanticCriteria'
import {
  buildJustificationContext,
  gradeJustification,
  type JustificationAnswer,
  type JustificationResult
} from './justification'
import { evaluateBudget, type BudgetEvaluation } from './budget'
import { SIMULATION_VERDICT_VERSION, type SimulationVerdict } from './verdict'
import {
  BudgetSchema,
  JustifyPromptSchema,
  SemanticCriterionSchema,
  WorkloadCategorySchema,
  QuestionDomainSchema,
  type Budget,
  type JustifyPrompt,
  type SemanticCriterion,
  type WorkloadCategory,
  type QuestionDomain
} from './gradingCriteria'
import { buildReplayDigest, type ReplayDigest } from './replay'
import { hostSafeToken, stableSerialize } from './stableHash'
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
  /** Extended anti-gaming grading axes (typed contracts; graded in a later phase). */
  semanticCriteria?: SemanticCriterion[]
  justify?: JustifyPrompt[]
  budget?: Budget
  /** The dominant workload character ("the workload is [X]"). */
  workloadCategory?: WorkloadCategory
  /**
   * The bottleneck *domain(s)* the question teaches (compute / storage / network /
   * resilience / correctness / cost). Distinct from `type` and `workloadCategory`;
   * the platform switches palette / edge-lock / grading emphasis off these. A single
   * question may span several (e.g. news-feed = compute + storage).
   * Optional for back-compat; V1 uses `compute` | `storage` only.
   */
  domains?: QuestionDomain[]
  /**
   * The specific concept(s) this question *teaches* — the lesson-level tag, finer-grained
   * than `domains` (e.g. `async-decoupling`, `store-fit`, `read-cache`). Kebab-case slugs.
   * A composed question lists several (url-shortener = `read-cache` + `store-fit`).
   * Free-form (concepts grow per lesson), so not a controlled enum.
   */
  concepts?: string[]
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
  /** Semantic criteria — the topology-meaning axis (absent when none authored). */
  semantic?: SemanticEvaluation
  /** Graph-consistent justification results (absent when no justify prompts). */
  justification?: JustificationResult[]
  /** Budget/cost evaluation — the anti-kitchen-sink axis (absent when no budget authored). */
  budget?: BudgetEvaluation
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

export interface AttemptCheckRow {
  id: string
  name: string
  scope: string
  kind: 'topology' | 'simulation' | 'invariant' | 'execution'
  status: CheckStatus
  passed: boolean
  pointsEarned: number
  pointsPossible: number
  detail?: string
}

export function structuralTestId(structuralId: string): string {
  return `topology.structural.${hostSafeToken(structuralId)}`
}

export function topologyRubricTestId(checkId: string): string {
  return `topology.rubric.${hostSafeToken(checkId)}`
}

export function semanticTestId(criterionId: string): string {
  return `topology.semantic.${hostSafeToken(criterionId)}`
}

export function justifyTestId(promptId: string): string {
  return `topology.justify.${hostSafeToken(promptId)}`
}

export function budgetTestId(): string {
  return 'topology.budget'
}

/** Scale + NFR numbers a question defines, for justification number-citation. */
function collectScaleNumbers(pkg: QuestionPackage): number[] {
  const numbers: number[] = []
  for (const value of Object.values(pkg.prompt.scale)) {
    if (typeof value === 'number') {
      numbers.push(value)
    }
  }
  for (const nfr of pkg.prompt.nonFunctionalRequirements) {
    numbers.push(nfr.value)
  }
  return numbers
}

export function caseRubricTestId(caseId: string, kind: CheckResultKind, checkId: string): string {
  return `case.${hostSafeToken(caseId)}.${kind}.${hostSafeToken(checkId)}`
}

function questionCheckScope(): string {
  return 'question'
}

function normalizeQuestionRowStatus(status: CheckStatus): QuestionTestStatus {
  return status === 'passed' ? 'passed' : 'failed'
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

const RubricCheckSchema: z.ZodType<RubricCheck> = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(['topology', 'simulation', 'invariant']).optional(),
    metric: z.string().min(1),
    op: z.enum(['<', '<=', '>', '>=', '==', '!=']),
    value: z.number().finite(),
    points: z.number().int().positive().optional()
  })
  .superRefine((check, ctx) => {
    const kind = inferRubricCheckKind(check)

    if (kind === 'topology' && !check.metric.startsWith('topology.')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metric'],
        message: "Topology rubric checks must use 'topology.*' metrics."
      })
    }

    if (kind === 'invariant' && !isInvariantMetric(check.metric)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metric'],
        message:
          "Invariant rubric checks must use invariant-derived metrics such as 'invariantViolations.count'."
      })
    }
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

export const StructuralEvaluationSchema: z.ZodType<StructuralEvaluation> = z
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

export const HostTestSchema: z.ZodType<HostTest> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().min(1).optional()
})

export const HostContractSchema: z.ZodType<HostContract> = z
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
  kind: z.enum(['topology', 'simulation', 'invariant', 'execution']),
  metric: z.string().min(1).optional(),
  op: z.enum(['<', '<=', '>', '>=', '==', '!=']).optional(),
  value: z.number().finite().optional(),
  actual: z.union([z.number().finite(), z.null()]),
  status: z.enum(['passed', 'failed', 'skipped']),
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
  executionStatus: z.enum(['completed', 'failed', 'skipped']),
  error: z.string().min(1).optional(),
  rubric: RubricResultSchema.optional()
})

export const GradedEvaluationBatchSchema: z.ZodType<GradedEvaluationBatch> = z
  .object({
    version: z.literal(RUBRIC_VERSION),
    suite: z.string().min(1).optional(),
    rubricId: z.string().min(1).optional(),
    question: RubricResultSchema.optional(),
    cases: z.array(GradedCaseResultSchema),
    score: z.object({
      earned: z.number().finite(),
      possible: z.number().finite(),
      fraction: z.number().finite()
    }),
    passed: z.boolean(),
    summary: z.object({
      total: z.number().int().nonnegative(),
      ran: z.number().int().nonnegative(),
      errored: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      totalChecks: z.number().int().nonnegative(),
      passedChecks: z.number().int().nonnegative(),
      failedChecks: z.number().int().nonnegative(),
      skippedChecks: z.number().int().nonnegative()
    })
  })
  .superRefine((value, ctx) => {
    const total = value.cases.length
    const ran = value.cases.filter((entry) => entry.ran).length
    const errored = total - ran
    const passed = value.cases.filter((entry) => entry.rubric?.passed).length
    const failed = total - passed
    const allChecks = [
      ...(value.question?.checks ?? []),
      ...value.cases.flatMap((entry) => entry.rubric?.checks ?? [])
    ]
    const passedChecks = allChecks.filter((check) => check.status === 'passed').length
    const failedChecks = allChecks.filter((check) => check.status === 'failed').length
    const skippedChecks = allChecks.filter((check) => check.status === 'skipped').length
    const possible =
      (value.question?.score.possible ?? 0) +
      value.cases.reduce((sum, entry) => sum + (entry.rubric?.score.possible ?? 0), 0)
    const earned =
      (value.question?.score.earned ?? 0) +
      value.cases.reduce((sum, entry) => sum + (entry.rubric?.score.earned ?? 0), 0)
    const fraction = possible > 0 ? earned / possible : 1

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

    if (value.summary.totalChecks !== allChecks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'totalChecks'],
        message: 'summary.totalChecks must match the flattened check count.'
      })
    }

    if (value.summary.passedChecks !== passedChecks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'passedChecks'],
        message: 'summary.passedChecks must match the number of passed checks.'
      })
    }

    if (value.summary.failedChecks !== failedChecks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'failedChecks'],
        message: 'summary.failedChecks must match the number of failed checks.'
      })
    }

    if (value.summary.skippedChecks !== skippedChecks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'skippedChecks'],
        message: 'summary.skippedChecks must match the number of skipped checks.'
      })
    }

    if (value.score.earned !== earned) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score', 'earned'],
        message: 'score.earned must match aggregated rubric scores.'
      })
    }

    if (value.score.possible !== possible) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score', 'possible'],
        message: 'score.possible must match aggregated rubric scores.'
      })
    }

    if (value.score.fraction !== fraction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score', 'fraction'],
        message: 'score.fraction must match earned / possible.'
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
    semanticCriteria: z.array(SemanticCriterionSchema).optional(),
    justify: z.array(JustifyPromptSchema).optional(),
    budget: BudgetSchema.optional(),
    workloadCategory: WorkloadCategorySchema.optional(),
    domains: z.array(QuestionDomainSchema).nonempty().optional(),
    concepts: z.array(z.string().min(1)).nonempty().optional(),
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
    if (pkg.semanticCriteria) {
      validateUniqueIds(pkg.semanticCriteria, ['semanticCriteria'], 'Semantic criterion', ctx)
    }
    if (pkg.justify) {
      validateUniqueIds(pkg.justify, ['justify'], 'Justify prompt', ctx)
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

/**
 * Freezes an attempt (host `lock` command): no further autosave, grading, or
 * submission. Preserves the current topology and grade so the frozen state is
 * exactly what the student had.
 */
export function lockAttempt(current: AttemptState | null, now?: string): AttemptState | null {
  if (!current) {
    return null
  }
  return {
    ...current,
    status: 'LOCKED',
    lastSavedAt: stableNow(now)
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

function buildSkippedGradedBatch(
  pkg: QuestionPackage,
  topology: TopologyJSON,
  reason: string
): GradedEvaluationBatch {
  const syntheticBatch: EvaluationBatch = {
    version: '1.0',
    ...(pkg.suite.name ? { suite: pkg.suite.name } : {}),
    results: pkg.suite.cases.map((testCase) => ({
      id: testCase.id,
      ok: false as const,
      error: reason
    })),
    summary: {
      total: pkg.suite.cases.length,
      succeeded: 0,
      failed: pkg.suite.cases.length
    }
  }

  return gradeQuestionBatch(pkg.rubric, topology, syntheticBatch, {
    unresolvedCaseStatus: 'skipped',
    unresolvedCaseDetail: reason || EXECUTION_SKIPPED_DETAIL
  })
}

function flattenStructuralRows(structural: StructuralEvaluation): AttemptCheckRow[] {
  return structural.checks.map((check) => ({
    id: structuralTestId(check.id),
    name: check.description,
    scope: 'topology',
    kind: 'topology',
    status: check.passed ? 'passed' : 'failed',
    passed: check.passed,
    pointsEarned: 0,
    pointsPossible: 0,
    ...(check.detail ? { detail: check.detail } : {})
  }))
}

function flattenQuestionRubricRows(result: RubricResult | undefined): AttemptCheckRow[] {
  if (!result) {
    return []
  }

  return result.checks.map((check) => ({
    id: topologyRubricTestId(check.id),
    name: check.description,
    scope: questionCheckScope(),
    kind: check.kind,
    status: check.status,
    passed: check.passed,
    pointsEarned: check.awarded,
    pointsPossible: check.points,
    ...(check.detail ? { detail: check.detail } : {})
  }))
}

function flattenCaseRubricRows(entry: GradedCaseResult): AttemptCheckRow[] {
  return (entry.rubric?.checks ?? []).map((check) => ({
    id: caseRubricTestId(entry.id, check.kind, check.id),
    name:
      check.id === EXECUTION_CHECK_ID ? `Case ${entry.id} execution completed` : check.description,
    scope: entry.id,
    kind: check.kind,
    status: check.status,
    passed: check.passed,
    pointsEarned: check.awarded,
    pointsPossible: check.points,
    ...(check.detail ? { detail: check.detail } : {})
  }))
}

function flattenSemanticRows(semantic: SemanticEvaluation | undefined): AttemptCheckRow[] {
  if (!semantic) {
    return []
  }
  return semantic.results.map((result) => ({
    id: semanticTestId(result.id),
    name: result.description ?? result.id,
    scope: 'topology',
    kind: 'topology',
    // A partial credit is not a full pass in the boolean collapse.
    status: result.outcome === 'passed' ? 'passed' : 'failed',
    passed: result.outcome === 'passed',
    pointsEarned: result.pointsEarned,
    pointsPossible: result.pointsPossible,
    ...(result.detail ? { detail: result.detail } : {})
  }))
}

function flattenJustificationRows(
  justification: JustificationResult[] | undefined
): AttemptCheckRow[] {
  if (!justification) {
    return []
  }
  return justification.map((result) => ({
    id: justifyTestId(result.promptId),
    name: `Justification: ${result.promptId}`,
    scope: 'topology',
    kind: 'topology',
    // A missing/partial/failed justification is not a full pass in the collapse.
    status: result.outcome === 'passed' ? 'passed' : 'failed',
    passed: result.outcome === 'passed',
    pointsEarned: 0,
    pointsPossible: 0,
    ...(result.detail ? { detail: result.detail } : {})
  }))
}

function flattenBudgetRows(budget: BudgetEvaluation | undefined): AttemptCheckRow[] {
  if (!budget) {
    return []
  }
  return [
    {
      id: budgetTestId(),
      name: `Budget: ${budget.actual} / ${budget.cap} ${budget.unit}`,
      scope: 'budget',
      kind: 'topology',
      status: budget.withinBudget ? 'passed' : 'failed',
      passed: budget.withinBudget,
      pointsEarned: 0,
      pointsPossible: 0,
      ...(budget.detail ? { detail: budget.detail } : {})
    }
  ]
}

export function flattenAttemptCheckRows(grade: AttemptGrade): AttemptCheckRow[] {
  return [
    ...flattenStructuralRows(grade.structural),
    ...flattenSemanticRows(grade.semantic),
    ...flattenJustificationRows(grade.justification),
    ...flattenBudgetRows(grade.budget),
    ...flattenQuestionRubricRows(grade.graded.question),
    ...grade.graded.cases.flatMap((entry) => flattenCaseRubricRows(entry))
  ]
}

/**
 * Collapses a graded batch to the boolean host contract. Every rubric check
 * across topology + question + case scopes becomes one host-visible row.
 * `allPassed` is the question-level gate: every row must be green.
 */
export function toHostContract(
  structural: StructuralEvaluation,
  graded: GradedEvaluationBatch,
  semantic?: SemanticEvaluation,
  justification?: JustificationResult[],
  budget?: BudgetEvaluation
): HostContract {
  const tests: HostTest[] = flattenAttemptCheckRows({
    structural,
    semantic,
    ...(justification ? { justification } : {}),
    ...(budget ? { budget } : {}),
    graded,
    contract: { tests: [], totalTests: 0, passedTests: 0, allPassed: false }
  }).map((row) => ({
    id: row.id,
    name: row.name,
    passed: row.passed,
    ...(row.detail ? { detail: row.detail } : {})
  }))

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
      id: structuralTestId(rule.id),
      name: rule.description,
      scope: 'topology',
      status: 'pending' as const
    })),
    ...(pkg.semanticCriteria ?? []).map((criterion) => ({
      id: semanticTestId(criterion.id),
      name: criterion.description ?? criterion.id,
      scope: 'design',
      status: 'pending' as const
    })),
    ...(pkg.justify ?? []).map((prompt) => ({
      id: justifyTestId(prompt.id),
      name: `Justify: ${prompt.decision}`,
      scope: 'justification',
      status: 'pending' as const
    })),
    ...(pkg.budget
      ? [
          {
            id: budgetTestId(),
            name: `Budget: within ${pkg.budget.cap} ${pkg.budget.unit}`,
            scope: 'budget',
            status: 'pending' as const
          }
        ]
      : []),
    ...pkg.rubric.checks
      .filter((check) => inferRubricCheckKind(check) === 'topology')
      .map((check) => ({
        id: topologyRubricTestId(check.id),
        name: check.description,
        scope: questionCheckScope(),
        status: 'pending' as const
      })),
    ...pkg.suite.cases.flatMap((testCase) =>
      pkg.rubric.checks
        .filter((check) => inferRubricCheckKind(check) !== 'topology')
        .map((check) => ({
          id: caseRubricTestId(testCase.id, inferRubricCheckKind(check), check.id),
          name: check.description,
          scope: testCase.id,
          status: 'pending' as const
        }))
    )
  ]

  if (!grade) {
    return authoredRows
  }

  const byId = new Map(flattenAttemptCheckRows(grade).map((row) => [row.id, row]))

  const rows = authoredRows.map((row) => {
    const gradedRow = byId.get(row.id)
    if (!gradedRow) {
      return row
    }

    return {
      id: gradedRow.id,
      // Keep the authored label (more descriptive than the flattened graded name).
      name: row.name,
      scope: row.scope,
      status: normalizeQuestionRowStatus(gradedRow.status),
      ...(gradedRow.detail ? { detail: gradedRow.detail } : {})
    }
  })
  const authoredIds = new Set(authoredRows.map((row) => row.id))
  for (const extra of flattenAttemptCheckRows(grade)) {
    if (authoredIds.has(extra.id) || extra.status === 'passed') {
      continue
    }
    rows.push({
      id: extra.id,
      name: extra.name,
      scope: extra.scope,
      status: normalizeQuestionRowStatus(extra.status),
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
/** One case's run artifacts, used to seal an EvaluationEnvelope. */
export interface AttemptCaseRun {
  caseId: string
  executionStatus: CaseExecutionStatus
  verdict?: SimulationVerdict
  replayDigest?: ReplayDigest
}

export interface GradedAttempt {
  grade: AttemptGrade
  cases: AttemptCaseRun[]
}

/**
 * Grades an attempt and also surfaces the per-case run artifacts (verdict +
 * bounded replay digest) needed to seal an EvaluationEnvelope at submit time.
 * `gradeAttempt` is the thin wrapper that keeps only the grade — the CLI and
 * existing callers use it and pay nothing for the artifacts they ignore.
 */
/**
 * Evaluates a package's semantic criteria against the student topology, or
 * `undefined` when none are authored.
 *
 * `forbidUnjustified` needs to know whether a bound justification passed; until
 * justification answers are threaded into grading (backend B3), no justification
 * context is available, so a present-but-undefended component conservatively
 * fails. A future overload can pass a real `SemanticContext` built from graded
 * justifications.
 */
function evaluateSemanticCriteriaForPackage(
  pkg: QuestionPackage,
  studentTopology: TopologyJSON,
  ctx: SemanticContext = {}
): SemanticEvaluation | undefined {
  if (!pkg.semanticCriteria || pkg.semanticCriteria.length === 0) {
    return undefined
  }
  return evaluateSemanticCriteria(studentTopology, pkg.semanticCriteria, ctx)
}

/**
 * Grades the package's justify prompts against the student's answers, graph-
 * consistently, or `undefined` when none are authored. Deterministic, no LLM.
 */
function gradeJustificationsForPackage(
  pkg: QuestionPackage,
  studentTopology: TopologyJSON,
  answers: readonly JustificationAnswer[]
): JustificationResult[] | undefined {
  if (!pkg.justify || pkg.justify.length === 0) {
    return undefined
  }
  const ctx = buildJustificationContext(studentTopology, collectScaleNumbers(pkg))
  const answerById = new Map(answers.map((answer) => [answer.promptId, answer]))
  return pkg.justify.map((prompt) => gradeJustification(prompt, answerById.get(prompt.id), ctx))
}

export function gradeAttemptWithArtifacts(
  pkg: QuestionPackage,
  studentTopology: TopologyJSON,
  runTopology: (topology: TopologyJSON) => SimulationOutput,
  justificationAnswers: readonly JustificationAnswer[] = []
): GradedAttempt {
  const structural =
    pkg.structuralRules && pkg.structuralRules.length > 0
      ? evaluateStructuralRules(studentTopology, pkg.structuralRules)
      : { version: STRUCTURAL_RULES_VERSION, checks: [], passed: true }

  if (!structural.passed) {
    const graded = buildSkippedGradedBatch(
      pkg,
      studentTopology,
      'Execution was skipped because topology requirements failed before simulation.'
    )
    return {
      grade: { structural, graded, contract: toHostContract(structural, graded) },
      cases: graded.cases.map((entry) => ({
        caseId: entry.id,
        executionStatus: entry.executionStatus
      }))
    }
  }

  const preparedCases: PreparedCase[] = pkg.suite.cases.map((testCase) => ({
    id: testCase.id,
    topology: mergeTopologyWithOverrides(studentTopology, {
      global: testCase.global,
      workload: testCase.workload,
      faults: testCase.faults
    })
  }))

  // Capture each run's raw output, keyed by the prepared topology object, so a
  // verdict + replay digest can be built per case without changing evaluateSuite
  // (and robust to a case that throws — it simply never enters the map).
  const outputByTopology = new Map<TopologyJSON, SimulationOutput>()
  const capturingRun = (topology: TopologyJSON): SimulationOutput => {
    const output = runTopology(topology)
    outputByTopology.set(topology, output)
    return output
  }

  const batch = evaluateSuite(preparedCases, capturingRun, pkg.suite.name)
  const graded = gradeQuestionBatch(pkg.rubric, studentTopology, batch)
  // Grade justifications first; a passed justification defends a `forbidUnjustified`
  // component via the injected SemanticContext (the anti-cargo-cult unblock).
  const justification = gradeJustificationsForPackage(pkg, studentTopology, justificationAnswers)
  const passedByJustifyId = new Map(
    (justification ?? []).map((result) => [result.promptId, result.outcome === 'passed'])
  )
  const semanticCtx: SemanticContext = justification
    ? { justificationPassed: (id) => passedByJustifyId.get(id) }
    : {}
  const semantic = evaluateSemanticCriteriaForPackage(pkg, studentTopology, semanticCtx)
  const budget = pkg.budget ? evaluateBudget(studentTopology, pkg.budget) : undefined
  const grade: AttemptGrade = {
    structural,
    ...(semantic ? { semantic } : {}),
    ...(justification ? { justification } : {}),
    ...(budget ? { budget } : {}),
    graded,
    contract: toHostContract(structural, graded, semantic, justification, budget)
  }

  const verdictByCaseId = new Map<string, SimulationVerdict>()
  for (const result of batch.results) {
    if (result.ok) {
      verdictByCaseId.set(result.id, result.verdict)
    }
  }
  const topologyByCaseId = new Map<string, TopologyJSON>()
  for (const entry of preparedCases) {
    if ('topology' in entry) {
      topologyByCaseId.set(entry.id, entry.topology)
    }
  }

  const cases: AttemptCaseRun[] = graded.cases.map((entry) => {
    const topology = topologyByCaseId.get(entry.id)
    const output = topology ? outputByTopology.get(topology) : undefined
    const verdict = verdictByCaseId.get(entry.id)
    const eventStream = output?.eventStream
    return {
      caseId: entry.id,
      executionStatus: entry.executionStatus,
      ...(verdict ? { verdict } : {}),
      ...(Array.isArray(eventStream) ? { replayDigest: buildReplayDigest(eventStream) } : {})
    }
  })

  return { grade, cases }
}

export function gradeAttempt(
  pkg: QuestionPackage,
  studentTopology: TopologyJSON,
  runTopology: (topology: TopologyJSON) => SimulationOutput,
  justificationAnswers: readonly JustificationAnswer[] = []
): AttemptGrade {
  return gradeAttemptWithArtifacts(pkg, studentTopology, runTopology, justificationAnswers).grade
}
