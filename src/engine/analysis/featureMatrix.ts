/**
 * The feature matrix and its resolver (docs/feature-visibility-matrix-spec.md §4.2, §5).
 *
 * `MATRIX` says, per context, which features are hidden / visible / enabled. `resolveFeatures`
 * applies registry defaults, then matching rows in order (a later row wins), then scoped
 * overrides, then the `requires` closure. Pure and renderer-free, so the CLI and exports can use it.
 *
 * Step 1 of the rollout: nothing consumes this yet. `featureMatrix.test.ts` is the equivalence
 * proof against the gates that exist today.
 */
import type { Abstraction } from '../classroom/types'
import type { EnvironmentProfileMode } from './environmentProfile'
import type { QuestionDomain } from './gradingCriteria'
import {
  FEATURES,
  FEATURE_IDS,
  FEATURE_STATE_RANK,
  type FeatureId,
  type FeatureState,
  type OverrideScope
} from './featureRegistry'

/**
 * The experience kind `resolveExperienceEnvelope` derives from the profile and question. It is
 * an input here, not recomputed, so the derivation stays in one place.
 */
export type FeatureExperience = 'SANDBOX' | 'ASSIGNMENT' | 'INTERVIEW' | 'LAB'

export interface FeatureContext {
  mode: EnvironmentProfileMode
  /** The abstraction in EFFECT (after Classroom readiness), not the one requested. */
  abstraction: Abstraction
  experience: FeatureExperience
  /** The loaded question's bottleneck domains; empty when none. */
  domains?: readonly QuestionDomain[]
}

export interface MatrixRow {
  /** Every axis listed must match; an omitted axis matches anything. `domains` matches if ANY listed domain is present. */
  when: {
    mode?: readonly EnvironmentProfileMode[]
    abstraction?: readonly Abstraction[]
    experience?: readonly FeatureExperience[]
    domains?: readonly QuestionDomain[]
  }
  set: Partial<Record<FeatureId, FeatureState>>
  /** Why this row exists; shown in the generated matrix doc. */
  note?: string
}

const STUDENT_MODES = ['ASSIGNMENT', 'PRACTICE'] as const
const CLASSROOM_LEVELS = ['classroom', 'guided'] as const

/**
 * Later rows win. Order: mode, then abstraction, then experience, so Classroom locks (which the
 * app applies after the access profile) override the mode and a Lab overrides both.
 */
export const MATRIX: readonly MatrixRow[] = [
  {
    when: {},
    set: { blueprintsTab: 'hidden' },
    note: 'Blueprints are still being prepared (withVisibleTabs in experienceEnvelope.ts).'
  },

  // ── Mode ────────────────────────────────────────────────────────────────────────────────────
  {
    when: { mode: ['ASSIGNMENT'] },
    set: {
      topologyFiles: 'hidden',
      topologyJson: 'hidden',
      terminal: 'hidden',
      settingsModal: 'hidden',
      annotations: 'hidden',
      scaffoldNodeEditing: 'visible',
      suiteDetails: 'hidden'
    },
    note: 'ASSIGNMENT_ENVIRONMENT_PROFILE. Files, JSON, terminal and settings also fail closed against host payloads.'
  },
  {
    when: { mode: [...STUDENT_MODES] },
    set: { edgeProperties: 'hidden' },
    note: 'Student modes default to edges as dumb connectors so learners focus on the HLD.'
  },
  {
    when: { mode: [...STUDENT_MODES], domains: ['network'] },
    set: { edgeProperties: 'enabled' },
    note: 'A network-domain question forces modelled, editable edges: sizing the network is the lesson.'
  },

  // ── Classroom / guided abstraction (withClassroomLocks) ─────────────────────────────────────
  {
    when: { abstraction: [...CLASSROOM_LEVELS] },
    set: {
      edgeProperties: 'hidden',
      resourceEditing: 'visible',
      executionProfile: 'hidden',
      designChecks: 'hidden'
    },
    note: 'Classroom compiles resources from the question givens and hides every engine knob.'
  },
  {
    when: { abstraction: [...CLASSROOM_LEVELS], mode: [...STUDENT_MODES] },
    set: { terminal: 'hidden', topologyJson: 'hidden' },
    note: 'AUTHOR keeps its debug views; other modes lose the terminal and raw JSON, which expose the compiled config.'
  },

  // ── Experience (sidebar tabs and canvas) ────────────────────────────────────────────────────
  {
    when: { experience: ['ASSIGNMENT', 'INTERVIEW'] },
    set: { labsTab: 'hidden', scenariosTab: 'hidden' }
  },
  {
    when: { experience: ['LAB'] },
    set: { libraryTab: 'hidden', scenariosTab: 'hidden', canvasInteraction: 'visible' },
    note: 'A Lab is a locked topology with guided parameter changes.'
  }
]

export type ResolvedFeatures = Readonly<Record<FeatureId, FeatureState>>

export type OverrideLayer = 'question' | 'host' | 'user'
export type FeatureOverrides = Partial<
  Record<OverrideLayer, Partial<Record<FeatureId, FeatureState>>>
>

function rowMatches(row: MatrixRow, context: FeatureContext): boolean {
  const { mode, abstraction, experience, domains } = row.when
  if (mode && !mode.includes(context.mode)) return false
  if (abstraction && !abstraction.includes(context.abstraction)) return false
  if (experience && !experience.includes(context.experience)) return false
  if (domains && !domains.some((domain) => context.domains?.includes(domain))) return false
  return true
}

function overrideAllowed(scope: OverrideScope, current: FeatureState, next: FeatureState): boolean {
  if (scope === 'none') return false
  if (scope === 'any') return true
  return FEATURE_STATE_RANK[next] < FEATURE_STATE_RANK[current]
}

/**
 * Resolves every feature for a context: registry default, then matrix rows in order, then the
 * question, host and user overrides in that order, each honoured only as far as the registry's
 * `overridable` scope and the feature's legal `states` allow, then the `requires` closure.
 */
export function resolveFeatures(
  context: FeatureContext,
  overrides: FeatureOverrides = {}
): ResolvedFeatures {
  const state = {} as Record<FeatureId, FeatureState>
  for (const id of FEATURE_IDS) state[id] = FEATURES[id].default

  for (const row of MATRIX) {
    if (!rowMatches(row, context)) continue
    for (const [id, next] of Object.entries(row.set) as Array<[FeatureId, FeatureState]>) {
      state[id] = next
    }
  }

  const layers: Array<[OverrideLayer, 'byQuestion' | 'byHost' | 'byUser']> = [
    ['question', 'byQuestion'],
    ['host', 'byHost'],
    ['user', 'byUser']
  ]
  for (const [layer, scopeKey] of layers) {
    const requested = overrides[layer]
    if (!requested) continue
    for (const [id, next] of Object.entries(requested) as Array<[FeatureId, FeatureState]>) {
      const def = FEATURES[id]
      if (!def || !(def.states as readonly FeatureState[]).includes(next)) continue
      if (overrideAllowed(def.overridable[scopeKey], state[id], next)) state[id] = next
    }
  }

  // `requires` closure: a feature below what it needs drops to hidden. Repeat until stable so a
  // chain (A needs B needs C) resolves regardless of declaration order.
  let changed = true
  while (changed) {
    changed = false
    for (const id of FEATURE_IDS) {
      const requires = (FEATURES[id] as { requires?: Record<string, FeatureState> }).requires
      if (!requires || state[id] === 'hidden') continue
      const unmet = Object.entries(requires).some(
        ([needed, atLeast]) =>
          FEATURE_STATE_RANK[state[needed as FeatureId]] < FEATURE_STATE_RANK[atLeast]
      )
      if (unmet) {
        state[id] = 'hidden'
        changed = true
      }
    }
  }

  return state
}

/** Not hidden. */
export function isShown(resolved: ResolvedFeatures, id: FeatureId): boolean {
  return resolved[id] !== 'hidden'
}

/** Fully usable. */
export function isUsable(resolved: ResolvedFeatures, id: FeatureId): boolean {
  return resolved[id] === 'enabled'
}
