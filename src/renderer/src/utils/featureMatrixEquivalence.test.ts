/**
 * The equivalence proof for the feature matrix (docs/feature-visibility-matrix-spec.md §11):
 * for every environment preset x requested abstraction x question shape, `resolveFeatures` must
 * agree with the gates the app uses today. This lives in the renderer because the tab and canvas
 * gates come from `experienceEnvelope.ts`.
 *
 * Out of scope here (see docs/feature-gate-audit.md): host-payload overrides, the Newton host
 * forcing topology files off, attempt-LOCKED state, authored per-node locks, and the quirks
 * called out as KNOWN GAPS below.
 */
import { describe, expect, it } from 'vitest'
import {
  ENVIRONMENT_PROFILE_PRESETS,
  canEditEdgesForQuestion,
  canEditResourcesForQuestion,
  canTriggerTestRun,
  isClassroomActive,
  resolveAbstraction,
  resolveEdgeModel,
  resolveEffectiveProfile,
  shouldShowRubricResults,
  type EnvironmentProfile,
  type EnvironmentProfileMode
} from '../../../engine/analysis/environmentProfile'
import { FEATURES, FEATURE_IDS, type FeatureId } from '../../../engine/analysis/featureRegistry'
import {
  MATRIX,
  isShown,
  isUsable,
  resolveFeatures,
  type FeatureContext,
  type FeatureExperience,
  type ResolvedFeatures
} from '../../../engine/analysis/featureMatrix'
import type { QuestionPackage } from '../../../engine/analysis/question'
import { resolveExperienceEnvelope, type ExperienceKind } from './experienceEnvelope'

const MODES: EnvironmentProfileMode[] = ['AUTHOR', 'ASSIGNMENT', 'PRACTICE']
const REQUESTED = ['architect', 'classroom', 'guided'] as const

interface Shape {
  name: string
  question: Record<string, unknown> | null
}

/** A Classroom-ready question (mirrors the helper in environmentProfile.test.ts). */
function question(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'q',
    title: 'q',
    type: 'open-build',
    tags: [],
    scaffold: { type: 'empty' },
    constraints: {
      allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice'],
      canModifyScaffold: true,
      canRemoveScaffoldNodes: true
    },
    suite: {
      name: 's',
      visibleToStudent: false,
      cases: [{ id: 'peak', workload: { pattern: 'constant', baseRps: 1_000_000 } }]
    },
    prompt: {
      text: '',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: { peakRps: 1_000_000 }
    },
    classroom: {
      givens: { microservice: { capacityRps: 100_000 } },
      targets: { maxUtilization: 0.8 }
    },
    ...overrides
  }
}

const guidedClassroom = {
  abstractions: ['guided', 'architect'],
  givens: { microservice: { capacityRps: 100_000 } },
  guidedKnobs: [{ path: 'queue.workers', label: 'Worker concurrency', objectiveId: 'concurrency' }],
  objectives: [{ id: 'concurrency', statement: 'Tune concurrency.', concept: 'concurrency' }]
}

const SHAPES: Shape[] = [
  { name: 'no question', question: null },
  { name: 'ready question', question: question() },
  { name: 'network domain', question: question({ domains: ['network'] }) },
  { name: 'cost domain', question: question({ domains: ['cost'] }) },
  {
    name: 'classroom design checks on',
    question: question({
      classroom: {
        givens: { microservice: { capacityRps: 100_000 } },
        targets: { maxUtilization: 0.8 },
        designChecks: true
      }
    })
  },
  { name: 'guided question', question: question({ classroom: guidedClassroom }) },
  {
    name: 'architect-only question',
    question: question({ classroom: { abstractions: ['architect'] } })
  },
  { name: 'unready for classroom', question: question({ classroom: undefined }) },
  {
    name: 'lab',
    question: question({
      tags: ['lab'],
      scaffold: { type: 'complete' },
      constraints: { canModifyScaffold: false, canRemoveScaffoldNodes: false }
    })
  }
]

interface Case {
  label: string
  profile: EnvironmentProfile
  question: Record<string, unknown> | null
}

function cases(): Case[] {
  const out: Case[] = []
  for (const mode of MODES) {
    for (const requested of REQUESTED) {
      for (const shape of SHAPES) {
        out.push({
          label: `${mode} / ${requested} / ${shape.name}`,
          profile: { ...ENVIRONMENT_PROFILE_PRESETS[mode], abstraction: requested },
          question: shape.question
        })
      }
    }
  }
  return out
}

/** The pieces `FeatureContext` is built from, derived with the app's own resolvers. */
function contextFor(testCase: Case): { context: FeatureContext; kind: ExperienceKind } {
  const { profile, question: q } = testCase
  const asQuestion = q as unknown as QuestionPackage | null
  const kind = resolveExperienceEnvelope(profile, asQuestion).kind
  return {
    kind,
    context: {
      mode: profile.mode,
      abstraction: resolveAbstraction(profile, q as never),
      experience: kind as FeatureExperience,
      domains: (q?.domains as FeatureContext['domains']) ?? []
    }
  }
}

/** Today's `classroom.designChecks` opt-in, expressed as the question-layer override it becomes. */
function questionOverrides(q: Record<string, unknown> | null) {
  const optIn = (q?.classroom as { designChecks?: boolean } | undefined)?.designChecks === true
  return optIn ? { designChecks: 'visible' as const } : {}
}

function resolveFor(testCase: Case, userSpofBadges = true): ResolvedFeatures {
  const { context } = contextFor(testCase)
  return resolveFeatures(context, {
    question: questionOverrides(testCase.question),
    ...(userSpofBadges ? {} : { user: { spofBadges: 'hidden' } })
  })
}

describe('feature registry', () => {
  it('gives every feature a legal default, surfaces and a label', () => {
    for (const id of FEATURE_IDS) {
      const def = FEATURES[id]
      expect(def.states, id).toContain(def.default)
      expect(def.surfaces.length, id).toBeGreaterThan(0)
      expect(def.label.length, id).toBeGreaterThan(0)
    }
  })

  it('only requires features that exist', () => {
    for (const id of FEATURE_IDS) {
      const requires = (FEATURES[id] as { requires?: Record<string, string> }).requires ?? {}
      for (const needed of Object.keys(requires)) expect(FEATURE_IDS, id).toContain(needed)
    }
  })

  it('has no matrix row that sets an unknown feature or an illegal state', () => {
    for (const row of MATRIX) {
      for (const [id, state] of Object.entries(row.set)) {
        expect(FEATURE_IDS, id).toContain(id)
        expect(FEATURES[id as FeatureId].states as readonly string[], `${id}=${state}`).toContain(
          state
        )
      }
    }
  })
})

describe("feature matrix equivalence with today's gates", () => {
  const all = cases()

  it('covers every preset, requested abstraction and question shape', () => {
    expect(all).toHaveLength(MODES.length * REQUESTED.length * SHAPES.length)
  })

  it.each(all.map((c) => [c.label, c] as const))('%s', (_label, testCase) => {
    const { profile, question: q } = testCase
    const lens = q as never
    const effective = resolveEffectiveProfile(profile, lens)
    const resolved = resolveFor(testCase)
    const { kind } = contextFor(testCase)
    const envelope = resolveExperienceEnvelope(profile, q as unknown as QuestionPackage | null)

    // Capabilities. Some gates read the raw profile and some the Classroom-locked one; the
    // matrix must reproduce whichever the app reads today.
    expect(isUsable(resolved, 'topologyFiles'), 'topologyFiles').toBe(
      profile.capabilities.canUseTopologyFiles
    )
    expect(isUsable(resolved, 'topologyJson'), 'topologyJson').toBe(
      effective.capabilities.canViewTopologyJson
    )
    expect(isUsable(resolved, 'terminal'), 'terminal').toBe(effective.capabilities.canUseTerminal)
    expect(isUsable(resolved, 'settingsModal'), 'settingsModal').toBe(
      profile.capabilities.canUseSettings
    )
    expect(isUsable(resolved, 'annotations'), 'annotations').toBe(profile.capabilities.canAnnotate)
    expect(isUsable(resolved, 'scaffoldNodeEditing'), 'scaffoldNodeEditing').toBe(
      profile.capabilities.canEditScaffoldNodes
    )
    expect(isUsable(resolved, 'testRuns'), 'testRuns').toBe(
      canTriggerTestRun(profile, { testRunCount: 0 })
    )
    expect(isUsable(resolved, 'resourceEditing'), 'resourceEditing').toBe(
      canEditResourcesForQuestion(profile, lens)
    )
    expect(isUsable(resolved, 'executionProfile'), 'executionProfile').toBe(
      effective.capabilities.canEditExecutionProfile
    )

    // Edges: connector < modelled+locked < modelled+editable.
    const edgeModel = resolveEdgeModel(profile, lens)
    const edgesEditable = canEditEdgesForQuestion(profile, lens)
    expect(resolved.edgeProperties, 'edgeProperties').toBe(
      edgeModel === 'connector' ? 'hidden' : edgesEditable ? 'enabled' : 'visible'
    )

    // Visibility.
    expect(isShown(resolved, 'questionPrompt'), 'questionPrompt').toBe(profile.visibility.prompt)
    expect(isShown(resolved, 'scaffoldSourceNodes'), 'scaffoldSourceNodes').toBe(
      profile.visibility.scaffoldSourceNodes
    )
    expect(isShown(resolved, 'suiteDetails'), 'suiteDetails').toBe(
      profile.visibility.gradingSuiteDetails
    )
    expect(isShown(resolved, 'liveMetrics'), 'liveMetrics').toBe(profile.visibility.liveMetrics)
    expect(isShown(resolved, 'rubricChecks'), 'rubricChecks').toBe(
      shouldShowRubricResults(profile, { hasSubmittedGrade: true })
    )

    // Design checks: hidden in Classroom unless the question opts in (useDesignChecksHidden).
    const optIn = (q?.classroom as { designChecks?: boolean } | undefined)?.designChecks === true
    const designChecksHidden = isClassroomActive(profile, lens) && !optIn
    expect(isShown(resolved, 'designChecks'), 'designChecks').toBe(!designChecksHidden)
    expect(isShown(resolved, 'spofBadges'), 'spofBadges').toBe(!designChecksHidden)
    expect(isShown(resolveFor(testCase, false), 'spofBadges'), 'spofBadges, user pref off').toBe(
      false
    )

    // Sidebar tabs and canvas, from the experience envelope (the simple-shell library filter is
    // a layout concern applied on top, not part of the envelope).
    const tabs = new Set(envelope.allowedTabs)
    expect(isUsable(resolved, 'questionTab'), 'questionTab').toBe(tabs.has('question'))
    expect(isUsable(resolved, 'libraryTab'), 'libraryTab').toBe(tabs.has('library'))
    expect(isUsable(resolved, 'labsTab'), 'labsTab').toBe(tabs.has('labs'))
    expect(isUsable(resolved, 'scenariosTab'), 'scenariosTab').toBe(tabs.has('scenarios'))
    expect(isUsable(resolved, 'blueprintsTab'), 'blueprintsTab').toBe(tabs.has('blueprints'))
    expect(isUsable(resolved, 'canvasInteraction'), 'canvasInteraction').toBe(
      !envelope.canvasLocked
    )
    expect(kind).toBe(envelope.kind)
  })
})

describe('resolveFeatures overrides', () => {
  const classroomContext: FeatureContext = {
    mode: 'PRACTICE',
    abstraction: 'classroom',
    experience: 'INTERVIEW'
  }
  const assignmentContext: FeatureContext = {
    mode: 'ASSIGNMENT',
    abstraction: 'architect',
    experience: 'ASSIGNMENT'
  }

  it('lets a question turn design checks on in Classroom (scope: any)', () => {
    expect(resolveFeatures(classroomContext).designChecks).toBe('hidden')
    expect(
      resolveFeatures(classroomContext, { question: { designChecks: 'visible' } }).designChecks
    ).toBe('visible')
  })

  it('never lets a question or host loosen a safety feature (scope: tighten)', () => {
    const resolved = resolveFeatures(assignmentContext, {
      question: { terminal: 'enabled', topologyFiles: 'enabled' },
      host: { topologyJson: 'enabled', settingsModal: 'enabled' }
    })
    expect(resolved.terminal).toBe('hidden')
    expect(resolved.topologyFiles).toBe('hidden')
    expect(resolved.topologyJson).toBe('hidden')
    expect(resolved.settingsModal).toBe('hidden')
  })

  it('lets a question or host tighten a feature', () => {
    const practice: FeatureContext = {
      mode: 'PRACTICE',
      abstraction: 'architect',
      experience: 'INTERVIEW'
    }
    expect(resolveFeatures(practice).terminal).toBe('enabled')
    expect(resolveFeatures(practice, { question: { terminal: 'hidden' } }).terminal).toBe('hidden')
    expect(resolveFeatures(practice, { host: { terminal: 'hidden' } }).terminal).toBe('hidden')
  })

  it('lets a host loosen a tunable feature but not a question', () => {
    expect(resolveFeatures(assignmentContext).scaffoldNodeEditing).toBe('visible')
    expect(
      resolveFeatures(assignmentContext, { host: { scaffoldNodeEditing: 'enabled' } })
        .scaffoldNodeEditing
    ).toBe('enabled')
    expect(
      resolveFeatures(assignmentContext, { question: { scaffoldNodeEditing: 'enabled' } })
        .scaffoldNodeEditing
    ).toBe('visible')
  })

  it('ignores a state the feature cannot take', () => {
    const resolved = resolveFeatures(assignmentContext, { host: { questionPrompt: 'enabled' } })
    expect(resolved.questionPrompt).toBe('visible')
  })

  it('drops SPOF badges when design checks are hidden, whatever asks for them', () => {
    const resolved = resolveFeatures(classroomContext, { user: { spofBadges: 'visible' } })
    expect(resolved.designChecks).toBe('hidden')
    expect(resolved.spofBadges).toBe('hidden')
  })

  it('ignores a user override on a feature the user may not touch', () => {
    const practice: FeatureContext = {
      mode: 'PRACTICE',
      abstraction: 'architect',
      experience: 'INTERVIEW'
    }
    expect(resolveFeatures(practice, { user: { terminal: 'hidden' } }).terminal).toBe('enabled')
  })
})
