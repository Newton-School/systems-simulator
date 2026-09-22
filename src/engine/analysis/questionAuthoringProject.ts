import { z } from 'zod'
import type { TopologyJSON, TrafficOrigin } from '../core/types'
import { InvariantCheckSchema, TopologyJSONSchema } from '../validation/validator'
import { deriveQuestionIdFromTitle } from './questionAuthoringDraft'
import {
  JustifyPromptSchema,
  type Budget,
  type JustifyPrompt,
  type QuestionDomain,
  type WorkloadCategory
} from './gradingCriteria'
import type {
  QuestionConstraints,
  QuestionEntryFormat,
  QuestionSuiteCase,
  QuestionType,
  ScaleParameters
} from './question'
import type { SimulationVerdict } from './verdict'
import {
  isAuthoringNfrMetric,
  isAuthoringNfrOperator,
  isAuthoringNfrUnit,
  isValidAuthoringNfrCombination,
  type AuthoringNonFunctionalRequirement
} from './questionAuthoringNfr'
import {
  isAuthoringMetricRuleMetric,
  isValidAuthoringMetricRuleCombination,
  type AuthoringMetricRuleDraft
} from './questionAuthoringMetricRules'
import {
  isAuthoringRubricMetric,
  type AuthoringRubricCheckDraft
} from './questionAuthoringRubricChecks'
import type { AuthoringFunctionalRequirement } from './questionAuthoringRequirements'
import type { AuthoringScenarioDraft } from './questionAuthoringScenario'
import {
  AUTHORING_STORAGE_FIT_ACCESS_PATTERNS,
  isAuthoringSemanticRuleKind,
  type AuthoringSemanticRuleDraft
} from './questionAuthoringSemanticRules'
import {
  AUTHORING_STRUCTURAL_CATEGORIES,
  AUTHORING_STRUCTURAL_EDGE_MODES,
  isAuthoringStructuralRuleKind,
  type AuthoringStructuralRuleDraft
} from './questionAuthoringStructuralRules'

export const QUESTION_AUTHORING_PROJECT_ARTIFACT = 'dsds-question-project' as const
export const QUESTION_AUTHORING_PROJECT_VERSION = '1.0' as const
export const QUESTION_AUTHORING_PROJECT_FILE_SUFFIX = '.simulator-question-project.json' as const

export const QUESTION_AUTHORING_STAGE_IDS = [
  'frame',
  'brief',
  'start',
  'scenarios',
  'grading',
  'prove',
  'preview',
  'export'
] as const

export type AuthoringStageId = (typeof QUESTION_AUTHORING_STAGE_IDS)[number]

export interface QuestionAuthoringSetupDraft {
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  type: QuestionType
  entryFormat?: QuestionEntryFormat
  domains: QuestionDomain[]
  concepts: string[]
  workloadCategory?: WorkloadCategory
  estimatedTimeMinutes?: number
  passThreshold: number
  suiteVisibleToStudent: boolean
  budget?: Budget
  constraints: QuestionConstraints
}

export const DEFAULT_QUESTION_AUTHORING_SETUP: QuestionAuthoringSetupDraft = {
  difficulty: 'intermediate',
  type: 'open-build',
  domains: [],
  concepts: [],
  passThreshold: 1,
  suiteVisibleToStudent: false,
  constraints: {
    canModifyScaffold: true,
    canRemoveScaffoldNodes: true
  }
}

/**
 * The first deliberately small draft contract. Runtime QuestionPackage fields
 * are added here checkpoint-by-checkpoint; incomplete projects remain saveable.
 */
export interface QuestionDraftV1 {
  id: string
  title: string
  description?: string
  tags: string[]
  author?: string
  createdAt?: string
  setup?: QuestionAuthoringSetupDraft
  prompt: {
    text: string
    additionalContext?: string
    scale: ScaleParameters
    functionalRequirements: AuthoringFunctionalRequirement[]
    nonFunctionalRequirements: AuthoringNonFunctionalRequirement[]
  }
  dryRunScenarioId?: string
  dryRunCase?: QuestionSuiteCase
  justify: JustifyPrompt[]
  scenarios: AuthoringScenarioDraft[]
  structuralRules: AuthoringStructuralRuleDraft[]
  semanticRules: AuthoringSemanticRuleDraft[]
  metricRules: AuthoringMetricRuleDraft[]
  rubricChecks: AuthoringRubricCheckDraft[]
}

export interface QuestionAuthoringProject {
  artifact: typeof QUESTION_AUTHORING_PROJECT_ARTIFACT
  artifactVersion: typeof QUESTION_AUTHORING_PROJECT_VERSION
  projectId: string
  updatedAt: string
  question: QuestionDraftV1
  assets: {
    scaffoldTopology?: TopologyJSON
    lockedNodeIds?: string[]
    lockedEdgeIds?: string[]
    baselineVerdict?: SimulationVerdict
    referenceTopology?: TopologyJSON
    gamedTopologies: GamedTopologyDraft[]
  }
  verification?: QuestionAuthoringVerificationProof
  ui: {
    activeStage: AuthoringStageId
  }
}

export interface QuestionAuthoringVerificationProof {
  signature: string
  ready: boolean
  blockers: string[]
  generatedAt: string
}

/** A plausible wrong design plus the misconception it embodies and the check meant to catch it. */
export interface GamedTopologyDraft {
  id: string
  label: string
  misconception: string
  expectedObligationId?: string
  topology?: TopologyJSON
}

const IsoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO timestamp'
})

const DraftFiniteNumberSchema = z.custom<number | null>(
  (value) => value === null || (typeof value === 'number' && Number.isFinite(value)),
  'Expected a finite number or null'
)

const AuthoringNonFunctionalRequirementSchema: z.ZodType<AuthoringNonFunctionalRequirement> = z
  .object({
    id: z.string().min(1),
    metric: z.custom<AuthoringNonFunctionalRequirement['metric']>(isAuthoringNfrMetric),
    operator: z.custom<AuthoringNonFunctionalRequirement['operator']>(isAuthoringNfrOperator),
    value: DraftFiniteNumberSchema,
    unit: z.custom<AuthoringNonFunctionalRequirement['unit']>(isAuthoringNfrUnit)
  })
  .strict()
  .refine(isValidAuthoringNfrCombination, {
    message: 'Metric, operator, and unit must be a supported combination'
  })

const AuthoringScenarioDraftSchema: z.ZodType<AuthoringScenarioDraft> = z
  .object({
    id: z.string().min(1),
    description: z.string(),
    seed: z.string(),
    pattern: z.enum(['constant', 'poisson', 'bursty', 'diurnal', 'spike', 'sawtooth', 'replay']),
    durationSeconds: DraftFiniteNumberSchema,
    warmupSeconds: DraftFiniteNumberSchema,
    timeResolution: z.enum(['microsecond', 'millisecond']).optional(),
    defaultTimeoutMs: DraftFiniteNumberSchema.optional(),
    traceSampleRatePercent: DraftFiniteNumberSchema.optional(),
    baseRps: DraftFiniteNumberSchema,
    readPercent: DraftFiniteNumberSchema,
    requestSizeBytes: DraftFiniteNumberSchema,
    sourceNodeId: z.string().optional(),
    requestDistribution: z
      .array(
        z
          .object({
            type: z.string(),
            weight: z.number(),
            sizeBytes: z.number(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            keyspace: z
              .object({
                field: z.string(),
                size: z.number(),
                skew: z.number().optional()
              })
              .strict()
              .optional()
          })
          .strict()
      )
      .optional(),
    origins: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            weight: z.number(),
            location: z.custom<TrafficOrigin['location']>((value) => {
              if (typeof value !== 'object' || value === null || !('kind' in value)) return false
              if (value.kind === 'region')
                return 'regionId' in value && typeof value.regionId === 'string'
              return (
                value.kind === 'coordinates' &&
                'latitude' in value &&
                'longitude' in value &&
                typeof value.latitude === 'number' &&
                typeof value.longitude === 'number'
              )
            })
          })
          .strict()
      )
      .optional(),
    stopCondition: z
      .object({
        mode: z.enum(['duration', 'requestBudget']),
        maxRequests: z.number().optional(),
        haltOnSaturation: z
          .object({ utilization: z.number().optional(), errorRate: z.number().optional() })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    burstRps: DraftFiniteNumberSchema.optional(),
    burstDurationSeconds: DraftFiniteNumberSchema.optional(),
    normalDurationSeconds: DraftFiniteNumberSchema.optional(),
    spikeTimeSeconds: DraftFiniteNumberSchema.optional(),
    spikeRps: DraftFiniteNumberSchema.optional(),
    spikeDurationSeconds: DraftFiniteNumberSchema.optional(),
    sawtoothPeakRps: DraftFiniteNumberSchema.optional(),
    rampDurationSeconds: DraftFiniteNumberSchema.optional(),
    diurnalPeakMultiplier: DraftFiniteNumberSchema.optional(),
    keyspaceField: z.string().optional(),
    keyspaceSize: DraftFiniteNumberSchema.optional(),
    keyspaceSkew: DraftFiniteNumberSchema.optional(),
    faults: z
      .array(
        z
          .object({
            id: z.string().min(1),
            targetId: z.string(),
            faultType: z.string().default('crash'),
            timing: z
              .enum(['deterministic', 'probabilistic', 'conditional'])
              .default('deterministic'),
            mode: z.string(),
            atSeconds: DraftFiniteNumberSchema,
            duration: z.enum(['fixed', 'until', 'permanent']),
            durationSeconds: DraftFiniteNumberSchema,
            extraParams: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    key: z.string(),
                    valueType: z.enum(['string', 'number', 'boolean', 'json']),
                    value: z.string()
                  })
                  .strict()
              )
              .default([])
          })
          .strict()
      )
      .optional(),
    invariants: z.array(InvariantCheckSchema).optional()
  })
  .strict()

const AuthoringStructuralRuleDraftSchema: z.ZodType<AuthoringStructuralRuleDraft> = z
  .object({
    id: z.string().min(1),
    kind: z.custom<AuthoringStructuralRuleDraft['kind']>(isAuthoringStructuralRuleKind),
    description: z.string().optional(),
    componentType: z.string().optional(),
    justifyId: z.string().optional(),
    category: z.enum(AUTHORING_STRUCTURAL_CATEGORIES).optional(),
    fromType: z.string().optional(),
    toType: z.string().optional(),
    mode: z.enum(AUTHORING_STRUCTURAL_EDGE_MODES).optional(),
    minCount: DraftFiniteNumberSchema.optional(),
    maxCount: DraftFiniteNumberSchema.optional(),
    count: DraftFiniteNumberSchema.optional(),
    minReplicas: DraftFiniteNumberSchema.optional()
  })
  .strict()

const AuthoringSemanticRuleDraftSchema: z.ZodType<AuthoringSemanticRuleDraft> = z
  .object({
    id: z.string().min(1),
    kind: z.custom<AuthoringSemanticRuleDraft['kind']>(isAuthoringSemanticRuleKind),
    points: DraftFiniteNumberSchema,
    description: z.string().optional(),
    hardFail: z.boolean().optional(),
    parentId: z.string().optional(),
    property: z.string().optional(),
    propertyOperator: z.enum(['equals', 'notEquals', 'atLeast', 'atMost']).optional(),
    expected: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
    componentType: z.string().optional(),
    betweenFrom: z.string().optional(),
    betweenTo: z.string().optional(),
    notBefore: z.string().optional(),
    orderedPipeline: z.array(z.string()).optional(),
    from: z.string().optional(),
    guard: z.string().optional(),
    to: z.string().optional(),
    broker: z.string().optional(),
    minConsumers: DraftFiniteNumberSchema.optional(),
    forbiddenBroker: z.string().optional(),
    accessPattern: z.enum(AUTHORING_STORAGE_FIT_ACCESS_PATTERNS).optional(),
    accept: z.array(z.string()).optional(),
    partial: z.array(z.string()).optional(),
    antiPattern: z.array(z.string()).optional(),
    runtimeScope: z
      .enum([
        'request',
        'delivery',
        'broker',
        'replication',
        'protocol',
        'idempotency',
        'commit-outcome',
        'lock',
        'reservation'
      ])
      .optional(),
    runtimeState: z.string().optional(),
    runtimeSource: z.enum(['event', 'engine', 'trait']).optional(),
    runtimeNodeId: z.string().optional(),
    runtimeNodeType: z.string().optional(),
    runtimeReasonCode: z.string().optional(),
    whereCaseId: z.string().optional(),
    whereOutcomeStatus: z
      .custom<NonNullable<AuthoringSemanticRuleDraft['whereOutcomeStatus']>>()
      .optional(),
    whereTerminalNodeId: z.string().optional(),
    whereTerminalNodeType: z.string().optional(),
    minCount: DraftFiniteNumberSchema.optional(),
    maxCount: DraftFiniteNumberSchema.optional(),
    sequence: z
      .array(
        z
          .object({
            scope: z.enum([
              'request',
              'delivery',
              'broker',
              'replication',
              'protocol',
              'idempotency',
              'commit-outcome',
              'lock',
              'reservation'
            ]),
            state: z.string(),
            source: z.enum(['event', 'engine', 'trait']).optional(),
            nodeId: z.string().optional(),
            nodeType: z.string().optional(),
            reasonCode: z.string().optional()
          })
          .strict()
      )
      .optional(),
    minMatches: DraftFiniteNumberSchema.optional()
  })
  .strict()

const AuthoringMetricRuleDraftSchema: z.ZodType<AuthoringMetricRuleDraft> = z
  .object({
    id: z.string().min(1),
    metric: z.custom<AuthoringMetricRuleDraft['metric']>(isAuthoringMetricRuleMetric),
    operator: z.custom<AuthoringMetricRuleDraft['operator']>(isAuthoringNfrOperator),
    value: DraftFiniteNumberSchema,
    unit: z.custom<AuthoringMetricRuleDraft['unit']>(isAuthoringNfrUnit),
    description: z.string().optional()
  })
  .strict()
  .refine(isValidAuthoringMetricRuleCombination, {
    message: 'Metric, operator, and unit must be a supported grading combination'
  })

const AuthoringRubricCheckDraftSchema: z.ZodType<AuthoringRubricCheckDraft> = z
  .object({
    id: z.string().min(1),
    metric: z.string().refine(isAuthoringRubricMetric, 'Unknown verdict metric'),
    op: z.enum(['<', '<=', '>', '>=', '==', '!=']),
    value: DraftFiniteNumberSchema,
    points: DraftFiniteNumberSchema,
    description: z.string().optional()
  })
  .strict()

const QuestionAuthoringSetupDraftSchema: z.ZodType<QuestionAuthoringSetupDraft> = z
  .object({
    difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    type: z.enum([
      'fix',
      'build-budget',
      'optimize',
      'open-build',
      'scaling',
      'ha-chaos',
      'tradeoff'
    ]),
    entryFormat: z
      .enum([
        'blank-canvas',
        'requirements-first',
        'partial-scaffold',
        'broken-scaffold',
        'baseline-optimize',
        'locked-lab'
      ])
      .optional(),
    domains: z.array(
      z.enum(['compute', 'storage', 'network', 'resilience', 'correctness', 'cost'])
    ),
    concepts: z.array(z.string().min(1)),
    workloadCategory: z
      .enum(['read-heavy', 'write-heavy', 'connection-heavy', 'correctness-heavy', 'batch-heavy'])
      .optional(),
    estimatedTimeMinutes: z.number().int().positive().optional(),
    passThreshold: z.number().nonnegative(),
    suiteVisibleToStudent: z.boolean(),
    budget: z
      .object({
        unit: z.enum(['cost', 'nodes', 'edges']),
        cap: z.number().positive()
      })
      .strict()
      .optional(),
    constraints: z
      .object({
        allowedNodeTypes: z.array(z.string().min(1)).optional(),
        forbiddenNodeTypes: z.array(z.string().min(1)).optional(),
        maxNodeCount: z.number().int().positive().optional(),
        maxBudget: z.number().positive().optional(),
        maxTotalWorkers: z.number().int().positive().optional(),
        canModifyScaffold: z.boolean(),
        canRemoveScaffoldNodes: z.boolean()
      })
      .strict()
  })
  .strict()

const DraftScaleSchema: z.ZodType<ScaleParameters> = z
  .object({
    dau: z.number().finite().nonnegative().optional(),
    peakRps: z.number().finite().nonnegative().optional(),
    readWriteRatio: z.number().finite().min(0).max(100).optional(),
    storageGb: z.number().finite().nonnegative().optional(),
    retentionDays: z.number().finite().nonnegative().optional(),
    growthRatePercent: z.number().finite().nonnegative().optional()
  })
  .strict()

const DraftSimulationVerdictSchema = z.custom<SimulationVerdict>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === '1.0',
  'Expected a simulation verdict 1.0'
)

export const QuestionAuthoringProjectSchema: z.ZodType<QuestionAuthoringProject> = z
  .object({
    artifact: z.literal(QUESTION_AUTHORING_PROJECT_ARTIFACT),
    artifactVersion: z.literal(QUESTION_AUTHORING_PROJECT_VERSION),
    projectId: z.string().min(1),
    updatedAt: IsoTimestampSchema,
    question: z
      .object({
        id: z.string().min(1),
        title: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string().min(1)).default([]),
        author: z.string().optional(),
        createdAt: IsoTimestampSchema.optional(),
        setup: QuestionAuthoringSetupDraftSchema.optional(),
        prompt: z
          .object({
            text: z.string(),
            additionalContext: z.string().optional(),
            scale: DraftScaleSchema.default({}),
            functionalRequirements: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    text: z.string()
                  })
                  .strict()
              )
              .default([]),
            nonFunctionalRequirements: z.array(AuthoringNonFunctionalRequirementSchema).default([])
          })
          .strict()
          .default({
            text: '',
            scale: {},
            functionalRequirements: [],
            nonFunctionalRequirements: []
          }),
        dryRunScenarioId: z.string().min(1).optional(),
        dryRunCase: z
          .custom<QuestionSuiteCase>(
            (value) =>
              typeof value === 'object' &&
              value !== null &&
              typeof (value as { id?: unknown }).id === 'string',
            'Expected a question suite case'
          )
          .optional(),
        justify: z.array(JustifyPromptSchema).default([]),
        scenarios: z.array(AuthoringScenarioDraftSchema).default([]),
        structuralRules: z.array(AuthoringStructuralRuleDraftSchema).default([]),
        semanticRules: z.array(AuthoringSemanticRuleDraftSchema).default([]),
        metricRules: z.array(AuthoringMetricRuleDraftSchema).default([]),
        rubricChecks: z.array(AuthoringRubricCheckDraftSchema).default([])
      })
      .strict(),
    assets: z
      .object({
        scaffoldTopology: TopologyJSONSchema.optional(),
        lockedNodeIds: z.array(z.string().min(1)).optional(),
        lockedEdgeIds: z.array(z.string().min(1)).optional(),
        baselineVerdict: DraftSimulationVerdictSchema.optional(),
        referenceTopology: TopologyJSONSchema.optional(),
        gamedTopologies: z
          .array(
            z
              .object({
                id: z.string().min(1),
                label: z.string(),
                misconception: z.string(),
                expectedObligationId: z.string().optional(),
                topology: TopologyJSONSchema.optional()
              })
              .strict()
          )
          .default([])
      })
      .strict()
      .default({ gamedTopologies: [] }),
    verification: z
      .object({
        signature: z.string().min(1),
        ready: z.boolean(),
        blockers: z.array(z.string()),
        generatedAt: IsoTimestampSchema
      })
      .strict()
      .optional(),
    ui: z
      .object({
        activeStage: z.enum(QUESTION_AUTHORING_STAGE_IDS)
      })
      .strict()
  })
  .strict()
  .superRefine((project, context) => {
    const expectedId = deriveQuestionIdFromTitle(project.question.title)
    if (project.question.id !== expectedId) {
      context.addIssue({
        code: 'custom',
        path: ['question', 'id'],
        message: `Expected derived question ID "${expectedId}"`
      })
    }

    const seenRequirementIds = new Set<string>()
    project.question.prompt.functionalRequirements.forEach((requirement, index) => {
      if (seenRequirementIds.has(requirement.id)) {
        context.addIssue({
          code: 'custom',
          path: ['question', 'prompt', 'functionalRequirements', index, 'id'],
          message: `Duplicate functional requirement ID "${requirement.id}"`
        })
      }
      seenRequirementIds.add(requirement.id)
    })

    const seenNfrIds = new Set<string>()
    project.question.prompt.nonFunctionalRequirements.forEach((requirement, index) => {
      if (seenNfrIds.has(requirement.id)) {
        context.addIssue({
          code: 'custom',
          path: ['question', 'prompt', 'nonFunctionalRequirements', index, 'id'],
          message: `Duplicate non-functional requirement ID "${requirement.id}"`
        })
      }
      seenNfrIds.add(requirement.id)
    })

    const seenScenarioIds = new Set<string>()
    project.question.scenarios.forEach((scenario, index) => {
      if (seenScenarioIds.has(scenario.id)) {
        context.addIssue({
          code: 'custom',
          path: ['question', 'scenarios', index, 'id'],
          message: `Duplicate scenario ID "${scenario.id}"`
        })
      }
      seenScenarioIds.add(scenario.id)
    })

    const seenStructuralRuleIds = new Set<string>()
    project.question.structuralRules.forEach((rule, index) => {
      if (seenStructuralRuleIds.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['question', 'structuralRules', index, 'id'],
          message: `Duplicate structural rule ID "${rule.id}"`
        })
      }
      seenStructuralRuleIds.add(rule.id)
    })

    const seenSemanticRuleIds = new Set<string>()
    project.question.semanticRules.forEach((rule, index) => {
      if (seenSemanticRuleIds.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['question', 'semanticRules', index, 'id'],
          message: `Duplicate semantic rule ID "${rule.id}"`
        })
      }
      seenSemanticRuleIds.add(rule.id)
    })

    const seenMetricRuleIds = new Set<string>()
    project.question.metricRules.forEach((rule, index) => {
      if (seenMetricRuleIds.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['question', 'metricRules', index, 'id'],
          message: `Duplicate metric rule ID "${rule.id}"`
        })
      }
      seenMetricRuleIds.add(rule.id)
    })

    const seenRubricCheckIds = new Set<string>()
    project.question.rubricChecks.forEach((check, index) => {
      if (seenRubricCheckIds.has(check.id)) {
        context.addIssue({
          code: 'custom',
          path: ['question', 'rubricChecks', index, 'id'],
          message: `Duplicate rubric check ID "${check.id}"`
        })
      }
      seenRubricCheckIds.add(check.id)
    })

    const seenGamedIds = new Set<string>()
    project.assets.gamedTopologies.forEach((design, index) => {
      if (seenGamedIds.has(design.id)) {
        context.addIssue({
          code: 'custom',
          path: ['assets', 'gamedTopologies', index, 'id'],
          message: `Duplicate gamed design ID "${design.id}"`
        })
      }
      seenGamedIds.add(design.id)
    })
  })

export interface CreateQuestionAuthoringProjectOptions {
  projectId?: string
  updatedAt?: string
  title?: string
  description?: string
  tags?: string[]
  author?: string
  createdAt?: string
  setup?: QuestionAuthoringSetupDraft
  problemStatement?: string
  additionalContext?: string
  scale?: ScaleParameters
  functionalRequirements?: AuthoringFunctionalRequirement[]
  nonFunctionalRequirements?: AuthoringNonFunctionalRequirement[]
  scenarios?: AuthoringScenarioDraft[]
  structuralRules?: AuthoringStructuralRuleDraft[]
  semanticRules?: AuthoringSemanticRuleDraft[]
  metricRules?: AuthoringMetricRuleDraft[]
  rubricChecks?: AuthoringRubricCheckDraft[]
  justify?: JustifyPrompt[]
  dryRunScenarioId?: string
  dryRunCase?: QuestionSuiteCase
  scaffoldTopology?: TopologyJSON
  referenceTopology?: TopologyJSON
  gamedTopologies?: GamedTopologyDraft[]
  activeStage?: AuthoringStageId
}

function createProjectId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `question-project-${Date.now()}`
}

function currentTimestamp(): string {
  return new Date().toISOString()
}

export function createQuestionAuthoringProject(
  options: CreateQuestionAuthoringProjectOptions = {}
): QuestionAuthoringProject {
  const title = options.title ?? ''
  return {
    artifact: QUESTION_AUTHORING_PROJECT_ARTIFACT,
    artifactVersion: QUESTION_AUTHORING_PROJECT_VERSION,
    projectId: options.projectId ?? createProjectId(),
    updatedAt: options.updatedAt ?? currentTimestamp(),
    question: {
      id: deriveQuestionIdFromTitle(title),
      title,
      ...(options.description ? { description: options.description } : {}),
      tags: options.tags ? [...options.tags] : [],
      ...(options.author ? { author: options.author } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.setup ? { setup: QuestionAuthoringSetupDraftSchema.parse(options.setup) } : {}),
      prompt: {
        text: options.problemStatement ?? '',
        ...(options.additionalContext ? { additionalContext: options.additionalContext } : {}),
        scale: { ...(options.scale ?? {}) },
        functionalRequirements:
          options.functionalRequirements?.map((requirement) => ({ ...requirement })) ?? [],
        nonFunctionalRequirements:
          options.nonFunctionalRequirements?.map((requirement) => ({ ...requirement })) ?? []
      },
      ...(options.dryRunScenarioId ? { dryRunScenarioId: options.dryRunScenarioId } : {}),
      ...(options.dryRunCase ? { dryRunCase: structuredClone(options.dryRunCase) } : {}),
      justify: options.justify?.map((prompt) => structuredClone(prompt)) ?? [],
      scenarios: options.scenarios?.map((scenario) => ({ ...scenario })) ?? [],
      structuralRules: options.structuralRules?.map((rule) => ({ ...rule })) ?? [],
      semanticRules: options.semanticRules?.map((rule) => ({ ...rule })) ?? [],
      metricRules: options.metricRules?.map((rule) => ({ ...rule })) ?? [],
      rubricChecks: options.rubricChecks?.map((check) => ({ ...check })) ?? []
    },
    assets: {
      ...(options.scaffoldTopology
        ? { scaffoldTopology: TopologyJSONSchema.parse(options.scaffoldTopology) }
        : {}),
      ...(options.referenceTopology
        ? { referenceTopology: TopologyJSONSchema.parse(options.referenceTopology) }
        : {}),
      gamedTopologies: options.gamedTopologies?.map((design) => ({ ...design })) ?? []
    },
    ui: {
      activeStage: options.activeStage ?? 'frame'
    }
  }
}

export function updateQuestionAuthoringMetadata(
  project: QuestionAuthoringProject,
  metadata: Pick<QuestionDraftV1, 'description' | 'tags' | 'author' | 'createdAt'>,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      description: metadata.description,
      tags: [...metadata.tags],
      author: metadata.author,
      createdAt: metadata.createdAt
    }
  }
}

export function updateQuestionAuthoringPromptDetails(
  project: QuestionAuthoringProject,
  details: { additionalContext?: string; scale: ScaleParameters },
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      prompt: {
        ...project.question.prompt,
        additionalContext: details.additionalContext,
        scale: { ...details.scale }
      }
    }
  }
}

export function updateQuestionAuthoringDryRunScenario(
  project: QuestionAuthoringProject,
  dryRunScenarioId: string | undefined,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: { ...project.question, dryRunScenarioId, dryRunCase: undefined }
  }
}

export function updateQuestionAuthoringJustifyPrompts(
  project: QuestionAuthoringProject,
  justify: readonly JustifyPrompt[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: { ...project.question, justify: justify.map((prompt) => structuredClone(prompt)) }
  }
}

export function updateQuestionAuthoringScaffoldContract(
  project: QuestionAuthoringProject,
  contract: {
    lockedNodeIds?: string[]
    lockedEdgeIds?: string[]
    baselineVerdict?: SimulationVerdict
  },
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    assets: {
      ...project.assets,
      lockedNodeIds: contract.lockedNodeIds ? [...contract.lockedNodeIds] : undefined,
      lockedEdgeIds: contract.lockedEdgeIds ? [...contract.lockedEdgeIds] : undefined,
      baselineVerdict: contract.baselineVerdict
    }
  }
}

export function resolveQuestionAuthoringSetup(
  setup: QuestionAuthoringSetupDraft | undefined
): QuestionAuthoringSetupDraft {
  if (!setup) return structuredClone(DEFAULT_QUESTION_AUTHORING_SETUP)
  return QuestionAuthoringSetupDraftSchema.parse(setup)
}

export function updateQuestionAuthoringSetup(
  project: QuestionAuthoringProject,
  setup: QuestionAuthoringSetupDraft,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      setup: QuestionAuthoringSetupDraftSchema.parse(setup)
    }
  }
}

export function updateQuestionAuthoringTitle(
  project: QuestionAuthoringProject,
  title: string,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  const id = deriveQuestionIdFromTitle(title)
  const scaffoldTopology = project.assets.scaffoldTopology
  const oldDefaultScaffoldId = `${project.question.id}-scaffold`
  const oldDefaultScaffoldName = `${project.question.title.trim() || 'Untitled question'} scaffold`
  const renamedScaffold = scaffoldTopology
    ? {
        ...scaffoldTopology,
        id: scaffoldTopology.id === oldDefaultScaffoldId ? `${id}-scaffold` : scaffoldTopology.id,
        name:
          scaffoldTopology.name === oldDefaultScaffoldName
            ? `${title.trim() || 'Untitled question'} scaffold`
            : scaffoldTopology.name
      }
    : undefined

  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      id,
      title
    },
    assets: renamedScaffold
      ? { ...project.assets, scaffoldTopology: renamedScaffold }
      : project.assets
  }
}

export function updateQuestionAuthoringProblemStatement(
  project: QuestionAuthoringProject,
  text: string,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      prompt: { ...project.question.prompt, text }
    }
  }
}

export function updateQuestionAuthoringFunctionalRequirements(
  project: QuestionAuthoringProject,
  functionalRequirements: readonly AuthoringFunctionalRequirement[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      prompt: {
        ...project.question.prompt,
        functionalRequirements: functionalRequirements.map((requirement) => ({ ...requirement }))
      }
    }
  }
}

export function updateQuestionAuthoringNonFunctionalRequirements(
  project: QuestionAuthoringProject,
  nonFunctionalRequirements: readonly AuthoringNonFunctionalRequirement[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      prompt: {
        ...project.question.prompt,
        nonFunctionalRequirements: nonFunctionalRequirements.map((requirement) => ({
          ...requirement
        }))
      }
    }
  }
}

export function updateQuestionAuthoringScenarios(
  project: QuestionAuthoringProject,
  scenarios: readonly AuthoringScenarioDraft[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      scenarios: scenarios.map((scenario) => ({ ...scenario }))
    }
  }
}

export function updateQuestionAuthoringStructuralRules(
  project: QuestionAuthoringProject,
  structuralRules: readonly AuthoringStructuralRuleDraft[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      structuralRules: structuralRules.map((rule) => ({ ...rule }))
    }
  }
}

export function updateQuestionAuthoringSemanticRules(
  project: QuestionAuthoringProject,
  semanticRules: readonly AuthoringSemanticRuleDraft[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      semanticRules: semanticRules.map((rule) => ({ ...rule }))
    }
  }
}

export function updateQuestionAuthoringMetricRules(
  project: QuestionAuthoringProject,
  metricRules: readonly AuthoringMetricRuleDraft[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      metricRules: metricRules.map((rule) => ({ ...rule }))
    }
  }
}

export function updateQuestionAuthoringScaffoldTopology(
  project: QuestionAuthoringProject,
  scaffoldTopology: TopologyJSON | undefined,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  if (!scaffoldTopology) {
    const restAssets = { ...project.assets }
    delete restAssets.scaffoldTopology
    return { ...project, updatedAt, assets: restAssets }
  }
  return {
    ...project,
    updatedAt,
    assets: { ...project.assets, scaffoldTopology: TopologyJSONSchema.parse(scaffoldTopology) }
  }
}

export function updateQuestionAuthoringRubricChecks(
  project: QuestionAuthoringProject,
  rubricChecks: readonly AuthoringRubricCheckDraft[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      rubricChecks: rubricChecks.map((check) => ({ ...check }))
    }
  }
}

export function updateQuestionAuthoringReferenceTopology(
  project: QuestionAuthoringProject,
  referenceTopology: TopologyJSON | undefined,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  if (!referenceTopology) {
    const restAssets = { ...project.assets }
    delete restAssets.referenceTopology
    return { ...project, updatedAt, assets: restAssets }
  }
  return {
    ...project,
    updatedAt,
    assets: { ...project.assets, referenceTopology: TopologyJSONSchema.parse(referenceTopology) }
  }
}

export function updateQuestionAuthoringGamedTopologies(
  project: QuestionAuthoringProject,
  gamedTopologies: readonly GamedTopologyDraft[],
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    assets: {
      ...project.assets,
      gamedTopologies: gamedTopologies.map((design) => ({ ...design }))
    }
  }
}

export function updateQuestionAuthoringVerification(
  project: QuestionAuthoringProject,
  verification: QuestionAuthoringVerificationProof,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    verification: {
      ...verification,
      blockers: [...verification.blockers]
    }
  }
}

export function updateQuestionAuthoringStage(
  project: QuestionAuthoringProject,
  activeStage: AuthoringStageId,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return {
    ...project,
    updatedAt,
    ui: { activeStage }
  }
}

export function touchQuestionAuthoringProject(
  project: QuestionAuthoringProject,
  updatedAt = currentTimestamp()
): QuestionAuthoringProject {
  return { ...project, updatedAt }
}

export function parseQuestionAuthoringProject(input: unknown): QuestionAuthoringProject {
  return QuestionAuthoringProjectSchema.parse(input)
}

export function serializeQuestionAuthoringProject(project: QuestionAuthoringProject): string {
  return `${JSON.stringify(parseQuestionAuthoringProject(project), null, 2)}\n`
}

export function deserializeQuestionAuthoringProject(content: string): QuestionAuthoringProject {
  return parseQuestionAuthoringProject(JSON.parse(content) as unknown)
}

export function questionAuthoringProjectFileName(title: string): string {
  return `${deriveQuestionIdFromTitle(title)}${QUESTION_AUTHORING_PROJECT_FILE_SUFFIX}`
}
