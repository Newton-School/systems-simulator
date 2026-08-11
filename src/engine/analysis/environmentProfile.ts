/**
 * The presentation layer of the question platform (spec: Layer 3).
 *
 * An EnvironmentProfile is a *visibility + capability lens* applied over one
 * shared QuestionPackage. The same question runs unchanged in three modes:
 *
 *   - AUTHOR     — full UI; the setter sees and can do everything.
 *   - ASSIGNMENT — graded; authored checks visible, dry-run feedback live,
 *                  scaffold locked.
 *   - PRACTICE   — self-paced practice; live rubric feedback, free editing, not
 *                  graded.
 *
 * The profile never changes *what* a question is or *how* it is graded — only
 * how much of it is shown and what the student may do. It is resolved from a
 * host-supplied input (a mode string or a partial override) onto a preset.
 */
import { z } from 'zod'

export type EnvironmentProfileMode = 'AUTHOR' | 'ASSIGNMENT' | 'PRACTICE'

/** When rubric check results become visible to the student. */
export type RubricCheckVisibility = 'HIDDEN' | 'LIVE_DURING_BUILD' | 'POST_SUBMIT_ONLY'

export interface EnvironmentVisibility {
  /** Show the prompt and FR/NFR/scale brief. */
  prompt: boolean
  /** Show which nodes came from the scaffold. */
  scaffoldSourceNodes: boolean
  /** Show the detailed grading suite scenarios. */
  gradingSuiteDetails: boolean
  /** Show live RPS/metrics while building. */
  liveMetrics: boolean
  /** When rubric check results are revealed. */
  rubricChecks: RubricCheckVisibility
}

export interface EnvironmentCapabilities {
  /** Allowed palette node types (null = all, [] = none). */
  editPaletteList: string[] | null
  /** Whether scaffold-provided nodes can be edited. */
  canEditScaffoldNodes: boolean
  /** Whether the student can trigger test/dry runs before submitting. */
  canTriggerTestRuns: boolean
  /** Maximum test runs allowed (undefined = unlimited). */
  maxTestRuns?: number
}

export interface EnvironmentProfile {
  mode: EnvironmentProfileMode
  visibility: EnvironmentVisibility
  capabilities: EnvironmentCapabilities
  /** Whether Submit produces a graded, archived submission. */
  graded: boolean
  chromeDensity: 'full' | 'minimal'
}

/**
 * AUTHOR is the most permissive preset — "today's full UI" plus the graded
 * flow so setters can exercise grading/archiving. (This intentionally differs
 * from the spec matrix, which lists AUTHOR as ungraded; here AUTHOR doubles as
 * the standalone dev/testing mode where verifying the grade path matters.)
 */
export const AUTHOR_ENVIRONMENT_PROFILE: EnvironmentProfile = {
  mode: 'AUTHOR',
  visibility: {
    prompt: true,
    scaffoldSourceNodes: true,
    gradingSuiteDetails: true,
    liveMetrics: true,
    rubricChecks: 'LIVE_DURING_BUILD'
  },
  capabilities: {
    editPaletteList: null,
    canEditScaffoldNodes: true,
    canTriggerTestRuns: true
  },
  graded: true,
  chromeDensity: 'full'
}

export const ASSIGNMENT_ENVIRONMENT_PROFILE: EnvironmentProfile = {
  mode: 'ASSIGNMENT',
  visibility: {
    prompt: true,
    scaffoldSourceNodes: true,
    gradingSuiteDetails: false,
    liveMetrics: true,
    rubricChecks: 'LIVE_DURING_BUILD'
  },
  capabilities: {
    editPaletteList: null,
    canEditScaffoldNodes: false,
    canTriggerTestRuns: true
  },
  graded: true,
  chromeDensity: 'minimal'
}

export const PRACTICE_ENVIRONMENT_PROFILE: EnvironmentProfile = {
  mode: 'PRACTICE',
  visibility: {
    prompt: true,
    scaffoldSourceNodes: true,
    gradingSuiteDetails: true,
    liveMetrics: true,
    rubricChecks: 'LIVE_DURING_BUILD'
  },
  capabilities: {
    editPaletteList: null,
    canEditScaffoldNodes: true,
    canTriggerTestRuns: true
  },
  graded: false,
  chromeDensity: 'minimal'
}

export const ENVIRONMENT_PROFILE_PRESETS: Record<EnvironmentProfileMode, EnvironmentProfile> = {
  AUTHOR: AUTHOR_ENVIRONMENT_PROFILE,
  ASSIGNMENT: ASSIGNMENT_ENVIRONMENT_PROFILE,
  PRACTICE: PRACTICE_ENVIRONMENT_PROFILE
}

/** The default when a host supplies no profile — full authoring UI. */
export const DEFAULT_ENVIRONMENT_PROFILE = AUTHOR_ENVIRONMENT_PROFILE

const ModeSchema = z.enum(['AUTHOR', 'ASSIGNMENT', 'PRACTICE'])

const InputObjectSchema = z
  .object({
    mode: ModeSchema.optional(),
    visibility: z
      .object({
        prompt: z.boolean().optional(),
        scaffoldSourceNodes: z.boolean().optional(),
        gradingSuiteDetails: z.boolean().optional(),
        liveMetrics: z.boolean().optional(),
        rubricChecks: z.enum(['HIDDEN', 'LIVE_DURING_BUILD', 'POST_SUBMIT_ONLY']).optional()
      })
      .optional(),
    capabilities: z
      .object({
        editPaletteList: z.array(z.string()).nullable().optional(),
        canEditScaffoldNodes: z.boolean().optional(),
        canTriggerTestRuns: z.boolean().optional(),
        maxTestRuns: z.number().int().nonnegative().optional()
      })
      .optional(),
    graded: z.boolean().optional(),
    chromeDensity: z.enum(['full', 'minimal']).optional()
  })
  // Ignore unknown keys rather than rejecting, so a richer host payload still resolves.
  .strip()

const InputSchema = z.union([ModeSchema, InputObjectSchema])

export type EnvironmentProfileInput = z.infer<typeof InputSchema>

/**
 * Resolves any host-supplied input (a mode string, a partial override object,
 * or something unrecognized) into a complete profile. Total and safe: invalid
 * input falls back to the default profile rather than throwing, so a malformed
 * launch payload can never break question mode.
 */
export function resolveEnvironmentProfile(input?: unknown): EnvironmentProfile {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    return DEFAULT_ENVIRONMENT_PROFILE
  }

  const value = parsed.data
  if (typeof value === 'string') {
    return ENVIRONMENT_PROFILE_PRESETS[value]
  }

  const base = ENVIRONMENT_PROFILE_PRESETS[value.mode ?? 'AUTHOR']
  return {
    mode: base.mode,
    visibility: { ...base.visibility, ...value.visibility },
    capabilities: { ...base.capabilities, ...value.capabilities },
    graded: value.graded ?? base.graded,
    chromeDensity: value.chromeDensity ?? base.chromeDensity
  }
}

/**
 * Whether rubric check results should be shown, given the profile and whether a
 * *submitted* grade exists yet.
 */
export function shouldShowRubricResults(
  profile: EnvironmentProfile,
  context: { hasSubmittedGrade: boolean }
): boolean {
  switch (profile.visibility.rubricChecks) {
    case 'HIDDEN':
      return false
    case 'POST_SUBMIT_ONLY':
      return context.hasSubmittedGrade
    case 'LIVE_DURING_BUILD':
      return true
  }
}

/** Whether the student may trigger another test run right now. */
export function canTriggerTestRun(
  profile: EnvironmentProfile,
  context: { testRunCount: number }
): boolean {
  if (!profile.capabilities.canTriggerTestRuns) {
    return false
  }
  const { maxTestRuns } = profile.capabilities
  if (maxTestRuns === undefined) {
    return true
  }
  return context.testRunCount < maxTestRuns
}
