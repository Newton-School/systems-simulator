/**
 * Classroom mode types (spec: ns-simulator-docs/specs/classroom-mode-environment.md).
 *
 * Classroom mode is an *abstraction level*, independent of the access mode
 * (AUTHOR / PRACTICE / ASSIGNMENT). In Classroom mode a student works with
 * concept cards — components described by the numbers the problem gives — and
 * decides only structure and copy counts. Everything else is compiled from the
 * question's givens, so the simulator's answer matches the lecture's napkin math.
 *
 * The card registry now covers the main structural classroom families (front
 * doors, compute, async work, cache, databases and queues); capacity and cost
 * givens plus four checks remain the shared schema. Leaf module (zod + type
 * imports only) so engine, CLI and renderer can share it.
 */
import { z } from 'zod'
import type { ComponentNode } from '../core/types'

/** How much of the simulator a student works with. `architect` is today's full simulator. */
export type Abstraction = 'classroom' | 'guided' | 'architect'

export const ABSTRACTIONS = [
  'classroom',
  'guided',
  'architect'
] as const satisfies readonly Abstraction[]

export const DEFAULT_ABSTRACTION: Abstraction = 'architect'

/** Numbers a problem states about a component, in human units. */
export interface CardGivens {
  /** Requests per second one copy can serve. */
  capacityRps?: number
  /** Dollars per hour one copy costs. */
  costPerHour?: number
  /** Fixed unloaded delay, separate from the capacity queue. */
  latencyMs?: number
  cacheHitRate?: number
  readCapacityRps?: number
  writeCapacityRps?: number
}

/** A question's override for one component: its lecture label and its givens. */
export interface ClassroomComponentGivens extends CardGivens {
  /** Lecture name shown on the palette and node, e.g. "Server". */
  label?: string
}

/** Target lines the results card draws and the classroom checks enforce. */
export interface ClassroomTargets {
  /** Highest utilization any component may reach, 0..1 (e.g. 0.8). */
  maxUtilization?: number
  /** Highest acceptable fraction of dropped requests, 0..1 (e.g. 0.01). */
  maxErrorRate?: number
}

export type ClassroomCheckTemplate =
  | 'traffic-flows-through'
  | 'serves-all-traffic'
  | 'within-target-utilization'
  | 'right-sized'

export const CLASSROOM_CHECK_TEMPLATES = [
  'traffic-flows-through',
  'serves-all-traffic',
  'within-target-utilization',
  'right-sized'
] as const satisfies readonly ClassroomCheckTemplate[]

/** A plain-language check. Compiles to existing structural rules, invariants and rubric checks. */
export interface ClassroomCheck {
  id: string
  template: ClassroomCheckTemplate
  /** What the student reads, e.g. "Every server stays at or below 80%". */
  label: string
  /** `scored` counts toward the grade; `feedback` is shown but never affects it. */
  severity?: 'scored' | 'feedback'
  points?: number
  /** traffic-flows-through: the component traffic must pass through (e.g. 'load-balancer'). */
  via?: string
  /** traffic-flows-through / within-target-utilization / right-sized: the target component. */
  component?: string
  /** right-sized: how far above the smallest passing fleet still counts as right-sized. */
  factor?: number
  /** Learning objective this check evidences. */
  objectiveId?: string
}

export interface ClassroomObjective {
  id: string
  statement: string
  concept: string
}

export interface ClassroomDesignSketch {
  nodes: Array<{
    ref: string
    component: string
    copies?: number
    choices?: Record<string, string>
  }>
  edges: Array<[from: string, to: string]>
}

export type MisconceptionDetector =
  | { kind: 'check-failed' | 'check-passed'; checkId: string }
  | { kind: 'copies'; component: string; op: '<' | '<=' | '>' | '>=' | '=='; value: number }
  | { kind: 'all' | 'any'; of: MisconceptionDetector[] }

export interface ClassroomMisconception {
  id: string
  title: string
  message: string
  nudge?: string
  priority?: number
  objectiveId?: string
  detect: MisconceptionDetector
  probe?: ClassroomDesignSketch
}

export interface ClassroomPredictionPrompt {
  id: string
  question: string
  answer: { kind: 'number' | 'choice'; options?: string[] }
  reveal?: { copiesOf?: string; target?: string }
}

export interface ClassroomLectureScript {
  dials?: Array<{
    id: string
    label: string
    target: `traffic.peak` | `given:${string}.${string}` | `target:${string}`
    values: number[]
  }>
  steps?: Array<{
    id: string
    title: string
    design: ClassroomDesignSketch
    talkingPoint: string
    autoRun?: boolean
  }>
}

export interface ClassroomNamedChoice {
  id: string
  label: string
  explanation: string
  options: Array<{ id: string; label: string; explanation: string; value: string }>
  objectiveId: string
  target: 'routing-strategy' | 'cache-enabled' | 'outgoing-edge-mode'
}

export interface ClassroomGuidedKnob {
  path: string
  label: string
  objectiveId: string
}

export interface ClassroomHardwareMapping {
  instanceType: string
  executionProfile?: string
  description: string
}

/** The optional `classroom` block on a question package. */
export interface ClassroomSettings {
  /** Which abstraction levels this question may launch in. Omitted = no explicit restriction. */
  abstractions?: Abstraction[]
  /** Givens keyed by engine component type (family-aware, e.g. 'load-balancer'). */
  givens?: Record<string, ClassroomComponentGivens>
  targets?: ClassroomTargets
  /**
   * When present and non-empty, these checks are the Classroom grading set: they
   * replace the package's structural rules, case invariants and rubric checks for
   * Classroom launches (Architect launches keep the authored set unchanged).
   */
  checks?: ClassroomCheck[]
  objectives?: ClassroomObjective[]
  misconceptions?: ClassroomMisconception[]
  predictions?: ClassroomPredictionPrompt[]
  lecture?: ClassroomLectureScript
  choices?: Record<string, ClassroomNamedChoice[]>
  guidedKnobs?: ClassroomGuidedKnob[]
  hardware?: Record<string, ClassroomHardwareMapping>
  /**
   * Show the simulator's design checks (e.g. "single point of failure") in
   * Classroom mode. Off by default: they flag things outside most lessons and read
   * as mistakes to a student who did the lesson right. Turn on for a question that
   * teaches redundancy.
   */
  designChecks?: boolean
}

const PositiveNumber = z.number().finite().positive()
const Fraction = z.number().finite().min(0).max(1)

const ClassroomComponentGivensSchema = z
  .object({
    label: z.string().min(1).optional(),
    capacityRps: PositiveNumber.optional(),
    costPerHour: z.number().finite().nonnegative().optional(),
    latencyMs: z.number().finite().nonnegative().optional(),
    cacheHitRate: Fraction.optional(),
    readCapacityRps: PositiveNumber.optional(),
    writeCapacityRps: PositiveNumber.optional()
  })
  .strict()

const ClassroomCheckSchema = z
  .object({
    id: z.string().min(1),
    template: z.enum(CLASSROOM_CHECK_TEMPLATES),
    label: z.string().min(1),
    severity: z.enum(['scored', 'feedback']).optional(),
    points: z.number().finite().nonnegative().optional(),
    via: z.string().min(1).optional(),
    component: z.string().min(1).optional(),
    factor: z.number().finite().min(1).optional(),
    objectiveId: z.string().min(1).optional()
  })
  .strict()
  .superRefine((check, ctx) => {
    const needs: Record<ClassroomCheckTemplate, (keyof ClassroomCheck)[]> = {
      'traffic-flows-through': ['via', 'component'],
      'serves-all-traffic': [],
      'within-target-utilization': ['component'],
      'right-sized': ['component']
    }
    if (check.severity === 'feedback' && check.template !== 'right-sized') {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: `Only 'right-sized' can be a feedback check; '${check.template}' is always scored.`
      })
    }
    for (const field of needs[check.template]) {
      if (check[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `Classroom check '${check.template}' needs '${field}'.`
        })
      }
    }
  })

const ClassroomDesignSketchSchema: z.ZodType<ClassroomDesignSketch> = z
  .object({
    nodes: z.array(
      z
        .object({
          ref: z.string().min(1),
          component: z.string().min(1),
          copies: z.number().int().positive().optional(),
          choices: z.record(z.string(), z.string()).optional()
        })
        .strict()
    ),
    edges: z.array(
      z
        .tuple([z.string().min(1), z.string().min(1)])
        .transform((edge) => [edge[0], edge[1]] as [string, string])
    )
  })
  .strict()

const MisconceptionDetectorSchema: z.ZodType<MisconceptionDetector> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({ kind: z.enum(['check-failed', 'check-passed']), checkId: z.string().min(1) })
      .strict(),
    z
      .object({
        kind: z.literal('copies'),
        component: z.string().min(1),
        op: z.enum(['<', '<=', '>', '>=', '==']),
        value: z.number().finite().nonnegative()
      })
      .strict(),
    z
      .object({ kind: z.enum(['all', 'any']), of: z.array(MisconceptionDetectorSchema).nonempty() })
      .strict()
  ])
)

const ClassroomNamedChoiceSchema: z.ZodType<ClassroomNamedChoice> = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    explanation: z.string().min(1),
    objectiveId: z.string().min(1),
    target: z.enum(['routing-strategy', 'cache-enabled', 'outgoing-edge-mode']),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            explanation: z.string().min(1),
            value: z.string().min(1)
          })
          .strict()
      )
      .min(2)
  })
  .strict()

const ROUTING_CHOICE_VALUES = new Set([
  'round-robin',
  'weighted',
  'random',
  'least-conn',
  'least-response-time',
  'p2c',
  'sticky',
  'ip-hash',
  'broadcast',
  'conditional',
  'passthrough'
])

function validChoiceValues(choice: ClassroomNamedChoice): Set<string> {
  if (choice.target === 'cache-enabled') return new Set(['on', 'off'])
  if (choice.target === 'outgoing-edge-mode') return new Set(['synchronous', 'asynchronous'])
  return ROUTING_CHOICE_VALUES
}

/** Strict: an unknown field is an author error, never a silent no-op. */
export const ClassroomSettingsSchema: z.ZodType<ClassroomSettings> = z
  .object({
    abstractions: z.array(z.enum(ABSTRACTIONS)).nonempty().optional(),
    givens: z.record(z.string().min(1), ClassroomComponentGivensSchema).optional(),
    targets: z
      .object({ maxUtilization: Fraction.optional(), maxErrorRate: Fraction.optional() })
      .strict()
      .optional(),
    checks: z.array(ClassroomCheckSchema).optional(),
    objectives: z
      .array(
        z
          .object({
            id: z.string().min(1),
            statement: z.string().min(1),
            concept: z.string().min(1)
          })
          .strict()
      )
      .optional(),
    misconceptions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            message: z.string().min(1),
            nudge: z.string().min(1).optional(),
            priority: z.number().int().optional(),
            objectiveId: z.string().min(1).optional(),
            detect: MisconceptionDetectorSchema,
            probe: ClassroomDesignSketchSchema.optional()
          })
          .strict()
      )
      .optional(),
    predictions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            question: z.string().min(1),
            answer: z
              .object({
                kind: z.enum(['number', 'choice']),
                options: z.array(z.string()).optional()
              })
              .strict(),
            reveal: z
              .object({ copiesOf: z.string().optional(), target: z.string().optional() })
              .strict()
              .optional()
          })
          .strict()
      )
      .optional(),
    lecture: z
      .object({
        dials: z
          .array(
            z
              .object({
                id: z.string().min(1),
                label: z.string().min(1),
                target: z.custom<NonNullable<ClassroomLectureScript['dials']>[number]['target']>(
                  (value) =>
                    typeof value === 'string' &&
                    /^(traffic\.peak|given:[^.]+\.[^.]+|target:[^.]+)$/.test(value)
                ),
                values: z.array(z.number().finite()).nonempty()
              })
              .strict()
          )
          .optional(),
        steps: z
          .array(
            z
              .object({
                id: z.string().min(1),
                title: z.string().min(1),
                design: ClassroomDesignSketchSchema,
                talkingPoint: z.string().min(1),
                autoRun: z.boolean().optional()
              })
              .strict()
          )
          .optional()
      })
      .strict()
      .optional(),
    choices: z.record(z.string(), z.array(ClassroomNamedChoiceSchema)).optional(),
    guidedKnobs: z
      .array(
        z
          .object({
            path: z.string().min(1),
            label: z.string().min(1),
            objectiveId: z.string().min(1)
          })
          .strict()
      )
      .optional(),
    hardware: z
      .record(
        z.string(),
        z
          .object({
            instanceType: z.string().min(1),
            executionProfile: z.string().min(1).optional(),
            description: z.string().min(1)
          })
          .strict()
      )
      .optional(),
    designChecks: z.boolean().optional()
  })
  .strict()
  .superRefine((settings, ctx) => {
    const seen = new Set<string>()
    for (const [index, check] of (settings.checks ?? []).entries()) {
      if (seen.has(check.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['checks', index, 'id'],
          message: `Duplicate classroom check id '${check.id}'.`
        })
      }
      seen.add(check.id)
    }
    const objectiveIds = new Set((settings.objectives ?? []).map((objective) => objective.id))
    for (const [index, check] of (settings.checks ?? []).entries()) {
      if (objectiveIds.size > 0 && check.severity !== 'feedback' && !check.objectiveId) {
        ctx.addIssue({
          code: 'custom',
          path: ['checks', index, 'objectiveId'],
          message: `Scored check '${check.id}' must point to a Classroom objective.`
        })
      } else if (check.objectiveId && !objectiveIds.has(check.objectiveId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['checks', index, 'objectiveId'],
          message: `Unknown Classroom objective '${check.objectiveId}'.`
        })
      }
    }
    for (const [index, knob] of (settings.guidedKnobs ?? []).entries()) {
      if (!objectiveIds.has(knob.objectiveId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['guidedKnobs', index, 'objectiveId'],
          message: `Unknown Classroom objective '${knob.objectiveId}'.`
        })
      }
    }
    for (const [component, choices] of Object.entries(settings.choices ?? {})) {
      const choiceIds = new Set<string>()
      for (const [choiceIndex, choice] of choices.entries()) {
        const path = ['choices', component, choiceIndex]
        if (choiceIds.has(choice.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'id'],
            message: `Duplicate named choice id '${choice.id}' for '${component}'.`
          })
        }
        choiceIds.add(choice.id)
        if (!objectiveIds.has(choice.objectiveId)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'objectiveId'],
            message: `Unknown Classroom objective '${choice.objectiveId}'.`
          })
        }
        const allowed = validChoiceValues(choice)
        const optionIds = new Set<string>()
        for (const [optionIndex, option] of choice.options.entries()) {
          if (optionIds.has(option.id)) {
            ctx.addIssue({
              code: 'custom',
              path: [...path, 'options', optionIndex, 'id'],
              message: `Duplicate option id '${option.id}' in choice '${choice.id}'.`
            })
          }
          optionIds.add(option.id)
          if (!allowed.has(option.value)) {
            ctx.addIssue({
              code: 'custom',
              path: [...path, 'options', optionIndex, 'value'],
              message: `Value '${option.value}' is not supported for '${choice.target}'.`
            })
          }
        }
      }
    }
    for (const [index, misconception] of (settings.misconceptions ?? []).entries()) {
      if (misconception.objectiveId && !objectiveIds.has(misconception.objectiveId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['misconceptions', index, 'objectiveId'],
          message: `Unknown Classroom objective '${misconception.objectiveId}'.`
        })
      }
    }
  })

function asInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined
}

/**
 * How many copies a node stands for: the compiled Classroom marker, else its
 * instance count, else one. "1 Server ×13" and "13 Servers" both count 13.
 */
export function classroomCopies(node: Pick<ComponentNode, 'config' | 'resources'>): number {
  const marker = node.config?.classroom as { copies?: unknown } | undefined
  return asInteger(marker?.copies) ?? asInteger(node.resources?.instanceCount) ?? 1
}

/** Whether a question may be launched at the given abstraction. */
export function questionAllowsAbstraction(
  settings: ClassroomSettings | undefined,
  abstraction: Abstraction
): boolean {
  return settings?.abstractions?.includes(abstraction) ?? true
}
