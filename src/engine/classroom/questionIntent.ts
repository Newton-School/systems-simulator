import { z } from 'zod'
import { conceptCardForType } from './conceptCards'
import {
  ClassroomSettingsSchema,
  type ClassroomCheckTemplate,
  type ClassroomDesignSketch,
  type ClassroomSettings,
  type ClassroomStudentControl
} from './types'
import {
  resolveSystemDesignConcepts,
  systemDesignConceptSupports,
  systemDesignConceptSupportsClassroomAuthoring,
  type SystemDesignTeachingSurface
} from './systemDesignConceptRegistry'

export const CLASSROOM_INTENT_OUTCOMES = [
  'classroom-direct',
  'classroom-structural',
  'guided',
  'architect-handoff',
  'external-lab'
] as const

export type ClassroomIntentOutcome = (typeof CLASSROOM_INTENT_OUTCOMES)[number]

export interface ClassroomQuestionIntent {
  version: '1'
  outcome: ClassroomIntentOutcome
  conceptIds: string[]
  peakRps?: number
  allowedNodeTypes: string[]
  settings: ClassroomSettings
  /** Author-only answer material. Never copied into the runtime question package. */
  solution?: ClassroomDesignSketch
  handoffReason?: string
}

export interface ClassroomQuestionIntentSource {
  conceptIds: string[]
  peakRps?: number
  allowedNodeTypes?: string[]
  settings?: ClassroomSettings
}

const DesignSketchSchema: z.ZodType<ClassroomDesignSketch> = z
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

const ACTIVE_OUTCOMES = new Set<ClassroomIntentOutcome>([
  'classroom-direct',
  'classroom-structural',
  'guided'
])

function expectedSurface(outcome: ClassroomIntentOutcome): SystemDesignTeachingSurface | null {
  if (outcome === 'classroom-direct' || outcome === 'classroom-structural') return 'C'
  if (outcome === 'guided') return 'G'
  return null
}

export const ClassroomQuestionIntentSchema: z.ZodType<ClassroomQuestionIntent> = z
  .object({
    version: z.literal('1'),
    outcome: z.enum(CLASSROOM_INTENT_OUTCOMES),
    conceptIds: z.array(z.string().min(1)),
    peakRps: z.number().finite().positive().optional(),
    allowedNodeTypes: z.array(z.string().min(1)),
    settings: ClassroomSettingsSchema,
    solution: DesignSketchSchema.optional(),
    handoffReason: z.string().min(1).optional()
  })

  .strict()
  .superRefine((intent, ctx) => {
    const active = ACTIVE_OUTCOMES.has(intent.outcome)
    const resolved = resolveSystemDesignConcepts(intent.conceptIds)
    for (const unknown of resolved.unknownIds) {
      ctx.addIssue({
        code: 'custom',
        path: ['conceptIds'],
        message: `Unknown system-design concept '${unknown}'.`
      })
    }

    const surface = expectedSurface(intent.outcome)
    if (surface) {
      for (const concept of resolved.concepts) {
        if (!systemDesignConceptSupports(concept, surface)) {
          ctx.addIssue({
            code: 'custom',
            path: ['conceptIds'],
            message: `${concept.id} (${concept.title}) is not registered for the ${surface} teaching surface.`
          })
        }
      }
    }

    if (!active) {
      if (!intent.handoffReason) {
        ctx.addIssue({
          code: 'custom',
          path: ['handoffReason'],
          message: 'A handoff outcome needs a specific reason.'
        })
      }
      return
    }

    if (
      (intent.outcome === 'classroom-direct' || intent.outcome === 'classroom-structural') &&
      resolved.concepts.some((concept) => !systemDesignConceptSupportsClassroomAuthoring(concept))
    ) {
      const unsupported = resolved.concepts
        .filter((concept) => !systemDesignConceptSupportsClassroomAuthoring(concept))
        .map((concept) => `${concept.id} (${concept.title})`)
      ctx.addIssue({
        code: 'custom',
        path: ['conceptIds'],
        message: `${unsupported.join(', ')} has no honest Classroom recipe; use its recommended authoring outcome instead.`
      })
    }

    if (intent.conceptIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['conceptIds'],
        message: 'An active Classroom intent needs at least one curriculum concept.'
      })
    }
    if (intent.peakRps === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['peakRps'],
        message: 'An active Classroom intent needs a stated peak traffic value.'
      })
    }
    if (intent.allowedNodeTypes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedNodeTypes'],
        message: 'An active Classroom intent needs an explicit component kit.'
      })
    }

    const allowedTypes = new Set(intent.allowedNodeTypes)
    for (const [index, component] of intent.allowedNodeTypes.entries()) {
      const card = conceptCardForType(component)
      if (!card) {
        ctx.addIssue({
          code: 'custom',
          path: ['allowedNodeTypes', index],
          message: `Component '${component}' has no Classroom concept card.`
        })
      } else if (
        card.role === 'compute' &&
        intent.settings.givens?.[component]?.capacityRps === undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'givens', component, 'capacityRps'],
          message: `Compute component '${component}' needs an explicit capacity given.`
        })
      }
    }

    const objectives = intent.settings.objectives ?? []
    const controls = intent.settings.controls ?? []
    const checks = intent.settings.checks ?? []
    const allowedDecisionKinds = new Set<ClassroomStudentControl['kind']>(
      resolved.concepts.flatMap((concept) => [
        ...concept.authoring.allowedDecisionKinds
      ]) as ClassroomStudentControl['kind'][]
    )
    const compatibleChecks = new Set<ClassroomCheckTemplate>(
      resolved.concepts.flatMap((concept) => [
        ...concept.authoring.compatibleChecks
      ]) as ClassroomCheckTemplate[]
    )
    if (objectives.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', 'objectives'],
        message: 'An active Classroom intent needs at least one learning objective.'
      })
    }
    if (controls.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', 'controls'],
        message: 'Declare what students may configure and why.'
      })
    }

    for (const [index, control] of controls.entries()) {
      if (
        (intent.outcome === 'classroom-direct' || intent.outcome === 'classroom-structural') &&
        !allowedDecisionKinds.has(control.kind)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'controls', index, 'kind'],
          message: `Decision '${control.kind}' is not part of the selected concepts' Classroom recipes.`
        })
      }
      if ('component' in control && !allowedTypes.has(control.component)) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'controls', index, 'component'],
          message: `Control '${control.id}' targets '${control.component}', which is not in the component kit.`
        })
      }
    }

    for (const [index, objective] of objectives.entries()) {
      if (!objective.statement.trim().toLowerCase().startsWith('the student can')) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'objectives', index, 'statement'],
          message: `Objective '${objective.id}' must be an observable “The student can…” statement.`
        })
      }
      if (!intent.conceptIds.some((conceptId) => conceptId === objective.concept)) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'objectives', index, 'concept'],
          message: `Objective '${objective.id}' refers to '${objective.concept}', which is not selected for this lesson.`
        })
      }
      if (!controls.some((control) => control.objectiveId === objective.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'objectives', index],
          message: `Objective '${objective.id}' has no student-configurable decision.`
        })
      }
      if (
        !checks.some((check) => check.severity !== 'feedback' && check.objectiveId === objective.id)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'objectives', index],
          message: `Objective '${objective.id}' has no scored evidence.`
        })
      }
    }

    const scoredChecksByObjective = new Map<string, ClassroomSettings['checks']>()
    const seenEvidence = new Set<string>()
    for (const [index, check] of checks.entries()) {
      if (check.severity === 'feedback') continue
      if (!check.objectiveId) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'checks', index, 'objectiveId'],
          message: `Scored check '${check.id}' must point to a learning objective.`
        })
        continue
      }
      if (
        (intent.outcome === 'classroom-direct' || intent.outcome === 'classroom-structural') &&
        !compatibleChecks.has(check.template)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'checks', index, 'template'],
          message: `Check '${check.template}' is not supported evidence for the selected concepts' Classroom recipes.`
        })
      }
      const evidenceKey = [check.objectiveId, check.template, check.via, check.component].join('|')
      if (seenEvidence.has(evidenceKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'checks', index],
          message: `Check '${check.id}' duplicates evidence already collected for objective '${check.objectiveId}'.`
        })
      }
      seenEvidence.add(evidenceKey)
      const objectiveChecks = scoredChecksByObjective.get(check.objectiveId) ?? []
      objectiveChecks.push(check)
      scoredChecksByObjective.set(check.objectiveId, objectiveChecks)
    }
    for (const [objectiveId, objectiveChecks] of scoredChecksByObjective) {
      if ((objectiveChecks?.length ?? 0) > 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'checks'],
          message: `Objective '${objectiveId}' has more than two scored checks; keep only the minimum evidence needed.`
        })
      }
    }

    for (const [component, choices] of Object.entries(intent.settings.choices ?? {})) {
      for (const choice of choices) {
        const declared = controls.some(
          (control) =>
            control.kind === 'named-choice' &&
            control.component === component &&
            control.choiceId === choice.id &&
            control.objectiveId === choice.objectiveId
        )
        if (!declared) {
          ctx.addIssue({
            code: 'custom',
            path: ['settings', 'choices', component],
            message: `Named choice '${choice.id}' is configurable but has no matching objective-backed control.`
          })
        }
        // A hit rate decides how much traffic reaches the next component; Classroom
        // never invents one.
        if (
          choice.target === 'cache-enabled' &&
          intent.settings.givens?.[component]?.cacheHitRate === undefined
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['settings', 'givens', component, 'cacheHitRate'],
            message: `Named choice '${choice.id}' turns caching on for '${component}' but the question doesn't state its hit rate.`
          })
        }
      }
    }

    for (const knob of intent.settings.guidedKnobs ?? []) {
      const declared = controls.some(
        (control) =>
          control.kind === 'guided-knob' &&
          control.path === knob.path &&
          control.objectiveId === knob.objectiveId
      )
      if (!declared) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'guidedKnobs'],
          message: `Guided knob '${knob.path}' has no matching objective-backed control.`
        })
      }
    }
  })

/**
 * Lift the ordinary Classroom fields already edited in Question Studio into the
 * same strict intent contract used by the authoring skill. Incomplete drafts
 * return null and remain saveable; once the objective, control, evidence,
 * traffic, kit, and concept boundary agree, Studio can synthesize the runtime
 * scenario and grading package without asking for duplicate low-level rows.
 */
export function inferClassroomQuestionIntent(
  source: ClassroomQuestionIntentSource
): ClassroomQuestionIntent | null {
  const abstractions = source.settings?.abstractions ?? []
  const outcome: ClassroomIntentOutcome | null = abstractions.includes('classroom')
    ? 'classroom-structural'
    : abstractions.includes('guided')
      ? 'guided'
      : null
  if (!outcome || !source.settings) return null

  const parsed = ClassroomQuestionIntentSchema.safeParse({
    version: '1',
    outcome,
    conceptIds: source.conceptIds,
    peakRps: source.peakRps,
    allowedNodeTypes: source.allowedNodeTypes ?? [],
    settings: source.settings
  })
  return parsed.success ? parsed.data : null
}

/** Human-readable reasons an enabled objective-first draft cannot compile yet. */
export function classroomQuestionIntentIssues(source: ClassroomQuestionIntentSource): string[] {
  const abstractions = source.settings?.abstractions ?? []
  const outcome: ClassroomIntentOutcome | null = abstractions.includes('classroom')
    ? 'classroom-structural'
    : abstractions.includes('guided')
      ? 'guided'
      : null
  if (!outcome || !source.settings) return []
  const parsed = ClassroomQuestionIntentSchema.safeParse({
    version: '1',
    outcome,
    conceptIds: source.conceptIds,
    peakRps: source.peakRps,
    allowedNodeTypes: source.allowedNodeTypes ?? [],
    settings: source.settings
  })
  return parsed.success
    ? []
    : uniqueIssueMessages(parsed.error.issues.map((issue) => issue.message))
}

function uniqueIssueMessages(messages: readonly string[]): string[] {
  return [...new Set(messages)]
}

export type CompiledClassroomIntent =
  | {
      status: 'ready'
      settings: ClassroomSettings
      allowedNodeTypes: string[]
      peakRps: number
      conceptIds: string[]
    }
  | {
      status: 'handoff'
      outcome: Extract<ClassroomIntentOutcome, 'architect-handoff' | 'external-lab'>
      reason: string
      conceptIds: string[]
    }

/** Compile author-only intent into learner-safe runtime settings. */
export function compileClassroomQuestionIntent(
  input: ClassroomQuestionIntent
): CompiledClassroomIntent {
  const intent = ClassroomQuestionIntentSchema.parse(input)
  if (intent.outcome === 'architect-handoff' || intent.outcome === 'external-lab') {
    return {
      status: 'handoff',
      outcome: intent.outcome,
      reason: intent.handoffReason!,
      conceptIds: intent.conceptIds
    }
  }
  const abstractions =
    intent.outcome === 'guided'
      ? (['guided', 'architect'] as const)
      : (['classroom', 'guided', 'architect'] as const)
  return {
    status: 'ready',
    settings: { ...structuredClone(intent.settings), abstractions: [...abstractions] },
    allowedNodeTypes: [...intent.allowedNodeTypes],
    peakRps: intent.peakRps!,
    conceptIds: intent.conceptIds.map((id) => id.toUpperCase())
  }
}
