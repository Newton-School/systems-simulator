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
import type { QuestionDomain } from './gradingCriteria'

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
  /**
   * How much of an *edge* is a modeled thing in this environment — the top-level
   * switch instructors asked for so students can focus on the HLD and not get
   * tangled in edges.
   *
   *   - `'network'`  — edges are a first-class modeled layer: they carry latency /
   *                    bandwidth into the simulation, expose a properties panel, and
   *                    project the edge metric lenses. Whether the student may *edit*
   *                    those properties is then gated by `canEditEdges`.
   *   - `'connector'`— edges are dumb wires that only express topology: zero sim
   *                    physics, no properties panel, no edge lenses, no egress bill.
   *                    `canEditEdges` is moot here (there is nothing to edit).
   *
   * Composes with `canEditEdges` as a ladder: connector < network+read-only <
   * network+editable. Resolved per loaded question by `resolveEdgeModel` (a
   * `'network'`-domain question forces `'network'`, since the network *is* the lesson).
   */
  edgeModel: 'network' | 'connector'
  /**
   * Whether edge configuration is editable — only meaningful when `edgeModel` is
   * `'network'` (in `'connector'` mode edges have no properties to edit). V1: false
   * for student modes (editing bandwidth/concurrency invites brute-forcing); edge
   * *results* stay inspectable. AUTHOR keeps full edge editing.
   */
  canEditEdges: boolean
  /**
   * Whether the student may change a node's resource allocation (instance type,
   * count). Base policy: mutable in AUTHOR/PRACTICE (the deployed sandbox), locked
   * in ASSIGNMENT — but a question whose lesson *is* allocation unlocks it (see
   * `canEditResourcesForQuestion`). Cost/derived read-outs stay visible either way;
   * this only gates editing.
   */
  canEditResources: boolean
  /**
   * Whether the student may change the advanced execution profile
   * (`cpu-bound`/`io-bound`). Keep this off in introductory HLD so generic
   * services don't become a game of flipping concurrency heuristics; turn it on
   * only when service behavior itself is the lesson.
   */
  canEditExecutionProfile: boolean
  /** Maximum test runs allowed (undefined = unlimited). */
  maxTestRuns?: number
  /**
   * Per-environment hardware quota — total vCPU / RAM the whole topology may
   * provision across all nodes. Absent = unbounded (no gate). The topology's cost
   * and resource totals are always *displayed* regardless; this only gates.
   */
  resourceBudget?: { totalVcpu: number; totalRamGb: number }
  /**
   * Per-environment money cap — max provisioned spend for the whole topology, in
   * USD/hour. Independent of `resourceBudget`: a design can pass the vCPU/RAM quota
   * yet exceed the cost cap, and vice versa. Absent = unbounded.
   */
  costBudget?: { maxPerHour: number }
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
    canTriggerTestRuns: true,
    edgeModel: 'network',
    canEditEdges: true,
    canEditResources: true,
    canEditExecutionProfile: true
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
    canTriggerTestRuns: true,
    edgeModel: 'connector',
    canEditEdges: false,
    canEditResources: false,
    canEditExecutionProfile: false
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
    canTriggerTestRuns: true,
    // Deployed default: edges are dumb connectors so learners focus on the HLD.
    // A `network`-domain question still upgrades to full network edges per question.
    edgeModel: 'connector',
    canEditEdges: true,
    canEditResources: true,
    canEditExecutionProfile: false
  },
  graded: false,
  chromeDensity: 'minimal'
}

export const ENVIRONMENT_PROFILE_PRESETS: Record<EnvironmentProfileMode, EnvironmentProfile> = {
  AUTHOR: AUTHOR_ENVIRONMENT_PROFILE,
  ASSIGNMENT: ASSIGNMENT_ENVIRONMENT_PROFILE,
  PRACTICE: PRACTICE_ENVIRONMENT_PROFILE
}

/**
 * The default when a host supplies no profile — the online deployed / standalone
 * experience. This is the student-facing practice sandbox (ungraded, free editing)
 * with edges as dumb connectors, so a learner lands focused on the high-level
 * design rather than edge physics. Authors switch to AUTHOR from Settings →
 * Environments. (The Newton assignment host forces ASSIGNMENT on its own path, so
 * this default never overrides a graded launch.)
 */
export const DEFAULT_ENVIRONMENT_PROFILE = PRACTICE_ENVIRONMENT_PROFILE

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
        edgeModel: z.enum(['network', 'connector']).optional(),
        canEditEdges: z.boolean().optional(),
        canEditResources: z.boolean().optional(),
        canEditExecutionProfile: z.boolean().optional(),
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

export type EdgeModel = 'network' | 'connector'

/**
 * Effective edge model for the *loaded question* — the top-level "are edges a
 * modeled thing here?" switch, layering the question's `domains` over the profile's
 * base `edgeModel` capability.
 *
 *   - `'network'`  — edges carry latency/bandwidth into the sim, have a properties
 *                    panel, and project the edge lenses. Editing is then gated by
 *                    `canEditEdgesForQuestion` (locked edges still affect the calc).
 *   - `'connector'`— dumb wires: they express topology only, with zero effect on the
 *                    simulation, no properties, no edge lenses, no egress bill.
 *
 * A `'network'`-domain question forces `'network'` even under a connector profile,
 * because sizing the network *is* the lesson there. Everything else keeps the base
 * policy (student modes default to `'connector'`). Single consumption point, so every
 * load path (Newton seed, launch-context, local dev) gets the same behavior for free.
 */
export function resolveEdgeModel(
  profile: EnvironmentProfile,
  question?: { domains?: readonly QuestionDomain[] } | null
): EdgeModel {
  if (profile.capabilities.edgeModel === 'network') {
    return 'network'
  }
  return question?.domains?.includes('network') ? 'network' : 'connector'
}

/**
 * Effective edge-*editability* for the loaded question. Only meaningful in `'network'`
 * mode — in `'connector'` mode edges have no properties to edit, so this is always
 * false. Within network mode, editing follows the base `canEditEdges` capability, and
 * a `'network'`-domain question unlocks it (the student must size the network).
 *
 * The ladder: connector (no edit, no calc) < network + locked (no edit, affects calc)
 * < network + editable (edit + affects calc).
 */
export function canEditEdgesForQuestion(
  profile: EnvironmentProfile,
  question?: { domains?: readonly QuestionDomain[] } | null
): boolean {
  if (resolveEdgeModel(profile, question) === 'connector') {
    return false
  }
  if (profile.capabilities.canEditEdges) {
    return true
  }
  return question?.domains?.includes('network') ?? false
}

/**
 * Effective resource-editability for the *loaded question*, layering the question's
 * bottleneck `domains` over the profile's base `canEditResources` capability.
 *
 * Mutable by default in AUTHOR/PRACTICE (the deployed sandbox). Locked in ASSIGNMENT
 * so a graded student can't brute-force by cranking instances — UNLESS the question's
 * lesson *is* resource allocation (`domains` include `'cost'`: fix a bottleneck within
 * a budget), in which case picking instances is the exercise and editing is unlocked.
 * Single consumption point, so every load path gets the same behavior.
 */
export function canEditResourcesForQuestion(
  profile: EnvironmentProfile,
  question?: { domains?: readonly QuestionDomain[] } | null
): boolean {
  if (profile.capabilities.canEditResources) {
    return true
  }
  return question?.domains?.includes('cost') ?? false
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
