import { describe, expect, it } from 'vitest'
import {
  AUTHOR_ENVIRONMENT_PROFILE,
  DEFAULT_ENVIRONMENT_PROFILE,
  ASSIGNMENT_ENVIRONMENT_PROFILE,
  PRACTICE_ENVIRONMENT_PROFILE,
  canEditEdgeLabelsForQuestion,
  canEditEdgesForQuestion,
  canEditResourcesForQuestion,
  canTriggerTestRun,
  classroomUnavailableReason,
  ENFORCE_TEST_RUN_LIMIT,
  isClassroomActive,
  resolveAbstraction,
  resolveEdgeModel,
  resolveEffectiveProfile,
  resolveEnvironmentProfile,
  shouldShowRubricResults
} from './environmentProfile'

describe('environment profile presets', () => {
  it('encodes the three modes distinctly', () => {
    // Deployed/standalone default is the practice sandbox (connector edges).
    expect(DEFAULT_ENVIRONMENT_PROFILE).toBe(PRACTICE_ENVIRONMENT_PROFILE)

    expect(AUTHOR_ENVIRONMENT_PROFILE.graded).toBe(true)
    expect(AUTHOR_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
    expect(AUTHOR_ENVIRONMENT_PROFILE.capabilities.canEditExecutionProfile).toBe(true)
    expect(AUTHOR_ENVIRONMENT_PROFILE.capabilities.canAnnotate).toBe(true)

    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.graded).toBe(true)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.visibility.gradingSuiteDetails).toBe(false)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canEditScaffoldNodes).toBe(false)
    // Graded students may still switch a node's execution profile (compute is
    // io-bound by default; some questions need a cpu-bound override).
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canEditExecutionProfile).toBe(true)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canAnnotate).toBe(false)
    // Test runs are uncapped unless the host passes maxTestRuns.
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.maxTestRuns).toBeUndefined()
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canUseTopologyFiles).toBe(false)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canViewTopologyJson).toBe(false)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canUseTerminal).toBe(false)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canUseSettings).toBe(false)

    expect(PRACTICE_ENVIRONMENT_PROFILE.graded).toBe(false)
    expect(PRACTICE_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
    expect(PRACTICE_ENVIRONMENT_PROFILE.capabilities.canEditExecutionProfile).toBe(true)
    expect(PRACTICE_ENVIRONMENT_PROFILE.capabilities.canAnnotate).toBe(true)
    expect(PRACTICE_ENVIRONMENT_PROFILE.capabilities.canUseTopologyFiles).toBe(true)
    expect(PRACTICE_ENVIRONMENT_PROFILE.capabilities.canViewTopologyJson).toBe(true)
  })
})

describe('resolveEnvironmentProfile', () => {
  it('defaults to the deployed practice sandbox for missing or unrecognized input', () => {
    expect(resolveEnvironmentProfile()).toEqual(DEFAULT_ENVIRONMENT_PROFILE)
    expect(resolveEnvironmentProfile()).toEqual(PRACTICE_ENVIRONMENT_PROFILE)
    expect(resolveEnvironmentProfile(42)).toEqual(PRACTICE_ENVIRONMENT_PROFILE)
    expect(resolveEnvironmentProfile({ mode: 'NOPE' })).toEqual(PRACTICE_ENVIRONMENT_PROFILE)
  })

  it('resolves a bare mode string to its preset', () => {
    expect(resolveEnvironmentProfile('ASSIGNMENT')).toEqual(ASSIGNMENT_ENVIRONMENT_PROFILE)
    expect(resolveEnvironmentProfile('PRACTICE')).toEqual(PRACTICE_ENVIRONMENT_PROFILE)
  })

  it('merges a partial override onto the mode preset and ignores unknown keys', () => {
    const resolved = resolveEnvironmentProfile({
      mode: 'ASSIGNMENT',
      capabilities: { maxTestRuns: 1, canEditExecutionProfile: true, canAnnotate: true },
      // unknown keys must not break resolution
      somethingExtra: true
    } as unknown)

    expect(resolved.mode).toBe('ASSIGNMENT')
    // overridden field
    expect(resolved.capabilities.maxTestRuns).toBe(1)
    expect(resolved.capabilities.canEditExecutionProfile).toBe(true)
    expect(resolved.capabilities.canAnnotate).toBe(true)
    // untouched preset fields survive
    expect(resolved.capabilities.canEditScaffoldNodes).toBe(false)
    expect(resolved.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
  })

  it('lets an override flip a single flag (e.g. graded PRACTICE)', () => {
    const resolved = resolveEnvironmentProfile({ mode: 'PRACTICE', graded: true })
    expect(resolved.mode).toBe('PRACTICE')
    expect(resolved.graded).toBe(true)
    expect(resolved.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
  })

  it('fails closed for sensitive Assignment surfaces even when a host requests them', () => {
    const resolved = resolveEnvironmentProfile({
      mode: 'ASSIGNMENT',
      capabilities: {
        canUseTopologyFiles: true,
        canViewTopologyJson: true,
        canUseTerminal: true,
        canUseSettings: true
      }
    })

    expect(resolved.capabilities.canUseTopologyFiles).toBe(false)
    expect(resolved.capabilities.canViewTopologyJson).toBe(false)
    expect(resolved.capabilities.canUseTerminal).toBe(false)
    expect(resolved.capabilities.canUseSettings).toBe(false)
  })
})

describe('shouldShowRubricResults', () => {
  const profile = (rubricChecks: 'HIDDEN' | 'LIVE_DURING_BUILD' | 'POST_SUBMIT_ONLY') =>
    resolveEnvironmentProfile({ mode: 'AUTHOR', visibility: { rubricChecks } })

  it('applies each visibility rule', () => {
    expect(shouldShowRubricResults(profile('HIDDEN'), { hasSubmittedGrade: true })).toBe(false)
    expect(
      shouldShowRubricResults(profile('LIVE_DURING_BUILD'), { hasSubmittedGrade: false })
    ).toBe(true)
    expect(shouldShowRubricResults(profile('POST_SUBMIT_ONLY'), { hasSubmittedGrade: false })).toBe(
      false
    )
    expect(shouldShowRubricResults(profile('POST_SUBMIT_ONLY'), { hasSubmittedGrade: true })).toBe(
      true
    )
  })
})

describe('canTriggerTestRun', () => {
  it('respects the capability flag and leaves test runs unlimited for now', () => {
    expect(
      canTriggerTestRun(resolveEnvironmentProfile({ mode: 'ASSIGNMENT' }), { testRunCount: 0 })
    ).toBe(true)
    expect(
      canTriggerTestRun(resolveEnvironmentProfile({ mode: 'ASSIGNMENT' }), { testRunCount: 4 })
    ).toBe(true)
    expect(
      canTriggerTestRun(
        resolveEnvironmentProfile({ mode: 'ASSIGNMENT', capabilities: { maxTestRuns: 3 } }),
        {
          testRunCount: 3
        }
      )
    ).toBe(!ENFORCE_TEST_RUN_LIMIT)
    // unlimited when maxTestRuns is undefined
    expect(canTriggerTestRun(AUTHOR_ENVIRONMENT_PROFILE, { testRunCount: 999 })).toBe(true)
    // disabled outright
    expect(
      canTriggerTestRun(
        resolveEnvironmentProfile({ mode: 'AUTHOR', capabilities: { canTriggerTestRuns: false } }),
        { testRunCount: 0 }
      )
    ).toBe(false)
  })
})

describe('canEditEdgesForQuestion', () => {
  const assignment = resolveEnvironmentProfile('ASSIGNMENT')

  it('keeps edges locked for compute/storage questions under a locking profile', () => {
    expect(canEditEdgesForQuestion(assignment, { domains: ['compute'] })).toBe(false)
    expect(canEditEdgesForQuestion(assignment, { domains: ['compute', 'storage'] })).toBe(false)
  })

  it('unlocks edges for a network question even under a locking profile', () => {
    expect(canEditEdgesForQuestion(assignment, { domains: ['network'] })).toBe(true)
    expect(canEditEdgesForQuestion(assignment, { domains: ['storage', 'network'] })).toBe(true)
  })

  it('falls back to the profile default when domains are absent or empty', () => {
    expect(canEditEdgesForQuestion(assignment, null)).toBe(false)
    expect(canEditEdgesForQuestion(assignment, { domains: [] })).toBe(false)
    expect(canEditEdgesForQuestion(assignment, {})).toBe(false)
  })

  it('always allows edges when the profile already models + permits them (AUTHOR)', () => {
    expect(canEditEdgesForQuestion(AUTHOR_ENVIRONMENT_PROFILE, { domains: ['compute'] })).toBe(true)
  })

  it('locks edges in the connector practice sandbox, but unlocks a network question', () => {
    // PRACTICE defaults to connector → no edges to edit for a non-network question…
    expect(canEditEdgesForQuestion(PRACTICE_ENVIRONMENT_PROFILE, { domains: ['storage'] })).toBe(
      false
    )
    // …but a network-domain question upgrades to full, editable network edges.
    expect(canEditEdgesForQuestion(PRACTICE_ENVIRONMENT_PROFILE, { domains: ['network'] })).toBe(
      true
    )
  })
})

describe('canEditEdgeLabelsForQuestion', () => {
  it('allows presentational labels in the connector-mode practice sandbox', () => {
    expect(canEditEdgeLabelsForQuestion(PRACTICE_ENVIRONMENT_PROFILE, null)).toBe(true)
  })

  it('keeps connector labels locked when the base assignment profile forbids edge edits', () => {
    expect(canEditEdgeLabelsForQuestion(ASSIGNMENT_ENVIRONMENT_PROFILE, null)).toBe(false)
  })
})

describe('edgeModel presets', () => {
  it('models edges only in AUTHOR; ASSIGNMENT and PRACTICE default to connector', () => {
    expect(AUTHOR_ENVIRONMENT_PROFILE.capabilities.edgeModel).toBe('network')
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.edgeModel).toBe('connector')
    expect(PRACTICE_ENVIRONMENT_PROFILE.capabilities.edgeModel).toBe('connector')
  })
})

describe('resolveEdgeModel', () => {
  const assignment = resolveEnvironmentProfile('ASSIGNMENT')

  it('is connector for a compute/storage question under a connector profile', () => {
    expect(resolveEdgeModel(assignment, { domains: ['compute'] })).toBe('connector')
    expect(resolveEdgeModel(assignment, { domains: ['storage', 'compute'] })).toBe('connector')
    expect(resolveEdgeModel(assignment, null)).toBe('connector')
  })

  it('forces network for a network-domain question even under a connector profile', () => {
    expect(resolveEdgeModel(assignment, { domains: ['network'] })).toBe('network')
    expect(resolveEdgeModel(assignment, { domains: ['storage', 'network'] })).toBe('network')
  })

  it('is network whenever the profile itself models edges (AUTHOR)', () => {
    expect(resolveEdgeModel(AUTHOR_ENVIRONMENT_PROFILE, { domains: ['compute'] })).toBe('network')
  })

  it('is connector for the practice sandbox unless the question is about the network', () => {
    expect(resolveEdgeModel(PRACTICE_ENVIRONMENT_PROFILE, null)).toBe('connector')
    expect(resolveEdgeModel(PRACTICE_ENVIRONMENT_PROFILE, { domains: ['storage'] })).toBe(
      'connector'
    )
    expect(resolveEdgeModel(PRACTICE_ENVIRONMENT_PROFILE, { domains: ['network'] })).toBe('network')
  })

  it('composes with canEditEdges as a ladder: connector edges are never editable', () => {
    // connector (assignment, non-network) → no edit, even though nothing is locked per se
    expect(canEditEdgesForQuestion(assignment, { domains: ['compute'] })).toBe(false)
    // network + locked (a hypothetical network profile with canEditEdges off) → still not editable
    const networkLocked = resolveEnvironmentProfile({
      mode: 'ASSIGNMENT',
      capabilities: { edgeModel: 'network', canEditEdges: false }
    })
    expect(resolveEdgeModel(networkLocked, { domains: ['compute'] })).toBe('network')
    expect(canEditEdgesForQuestion(networkLocked, { domains: ['compute'] })).toBe(false)
    // network + editable → editable
    const networkOpen = resolveEnvironmentProfile({
      mode: 'ASSIGNMENT',
      capabilities: { edgeModel: 'network', canEditEdges: true }
    })
    expect(canEditEdgesForQuestion(networkOpen, { domains: ['compute'] })).toBe(true)
  })
})

describe('canEditResourcesForQuestion', () => {
  const assignment = resolveEnvironmentProfile('ASSIGNMENT')

  it('allows resource editing under ASSIGNMENT (instance sizing is part of the design surface)', () => {
    expect(canEditResourcesForQuestion(assignment, { domains: ['compute'] })).toBe(true)
    expect(canEditResourcesForQuestion(assignment, { domains: ['storage', 'compute'] })).toBe(true)
    expect(canEditResourcesForQuestion(assignment, null)).toBe(true)
    expect(canEditResourcesForQuestion(assignment, {})).toBe(true)
  })

  it('also allows resources when the question lesson is allocation (cost domain)', () => {
    expect(canEditResourcesForQuestion(assignment, { domains: ['cost'] })).toBe(true)
    expect(canEditResourcesForQuestion(assignment, { domains: ['compute', 'cost'] })).toBe(true)
  })

  it('always allows resources in the deployed sandbox (AUTHOR/PRACTICE)', () => {
    expect(canEditResourcesForQuestion(AUTHOR_ENVIRONMENT_PROFILE, { domains: ['compute'] })).toBe(
      true
    )
    expect(canEditResourcesForQuestion(PRACTICE_ENVIRONMENT_PROFILE, null)).toBe(true)
  })
})

/** A Classroom-ready question: states its peak and its server capacity. */
function classroomQuestion(overrides: Record<string, unknown> = {}) {
  return {
    constraints: {
      allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice'],
      canModifyScaffold: true,
      canRemoveScaffoldNodes: true
    },
    suite: {
      name: 's',
      visibleToStudent: false,
      cases: [{ id: 'peak', workload: { pattern: 'constant' as const, baseRps: 1_000_000 } }]
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

describe('abstraction (Classroom mode)', () => {
  const question = { ...classroomQuestion(), domains: ['network' as const, 'cost' as const] }
  const classroom = resolveEnvironmentProfile({ mode: 'PRACTICE', abstraction: 'classroom' })

  it('defaults the standalone and author workbench to Classroom, graded launches to Architect', () => {
    for (const input of [undefined, 'AUTHOR', 'PRACTICE', { mode: 'PRACTICE' }, 42]) {
      expect(resolveEnvironmentProfile(input).abstraction).toBe('classroom')
    }
    expect(resolveEnvironmentProfile('ASSIGNMENT').abstraction).toBe('architect')
    expect(
      resolveEnvironmentProfile({ mode: 'ASSIGNMENT', abstraction: 'classroom' }).abstraction
    ).toBe('classroom')
  })

  it('leaves the workbench unlocked in Classroom mode while no question is loaded', () => {
    expect(classroom.abstraction).toBe('classroom')
    expect(resolveEffectiveProfile(classroom, null).capabilities).toEqual(
      PRACTICE_ENVIRONMENT_PROFILE.capabilities
    )
    expect(canEditResourcesForQuestion(classroom, null)).toBe(true)
  })

  it('locks engine knobs in Classroom mode even when the host asks for them', () => {
    const requested = resolveEnvironmentProfile({
      mode: 'PRACTICE',
      abstraction: 'classroom',
      capabilities: {
        edgeModel: 'network',
        canEditEdges: true,
        canEditResources: true,
        canEditExecutionProfile: true,
        canUseTerminal: true,
        canViewTopologyJson: true
      }
    })
    const profile = resolveEffectiveProfile(requested, classroomQuestion())
    expect(profile.abstraction).toBe('classroom')
    expect(profile.capabilities).toMatchObject({
      edgeModel: 'connector',
      canEditEdges: false,
      canEditResources: false,
      canEditExecutionProfile: false,
      canUseTerminal: false,
      canViewTopologyJson: false
    })
  })

  it('uses the same safe surface for Guided and preserves the Guided identity', () => {
    const guidedQuestion = classroomQuestion({
      classroom: {
        abstractions: ['guided', 'architect'],
        givens: { microservice: { capacityRps: 100_000 } },
        guidedKnobs: [
          { path: 'queue.workers', label: 'Worker concurrency', objectiveId: 'concurrency' }
        ],
        objectives: [
          {
            id: 'concurrency',
            statement: 'Tune concurrency without exposing unrelated engine controls.',
            concept: 'concurrency'
          }
        ]
      }
    })
    const profile = resolveEffectiveProfile(
      resolveEnvironmentProfile({ mode: 'PRACTICE', abstraction: 'guided' }),
      guidedQuestion
    )
    expect(resolveAbstraction(profile, guidedQuestion)).toBe('guided')
    expect(profile.abstraction).toBe('guided')
    expect(profile.capabilities).toMatchObject({
      edgeModel: 'connector',
      canEditEdges: false,
      canEditResources: false,
      canEditExecutionProfile: false,
      canUseTerminal: false,
      canViewTopologyJson: false
    })
  })

  it('keeps AUTHOR debug views in Classroom mode', () => {
    const profile = resolveEffectiveProfile(
      resolveEnvironmentProfile({ mode: 'AUTHOR', abstraction: 'classroom' }),
      classroomQuestion()
    )
    expect(profile.capabilities.canUseTerminal).toBe(true)
    expect(profile.capabilities.canViewTopologyJson).toBe(true)
    expect(profile.capabilities.canEditResources).toBe(false)
  })

  it('needs a question, and respects the levels a question allows', () => {
    expect(resolveAbstraction(classroom, null)).toBe('architect')
    expect(resolveAbstraction(classroom, classroomQuestion())).toBe('classroom')
    const architectOnly = classroomQuestion({
      classroom: { abstractions: ['architect'], givens: { microservice: { capacityRps: 100_000 } } }
    })
    expect(resolveAbstraction(classroom, architectOnly)).toBe('architect')
    const classroomOnly = classroomQuestion({
      classroom: { abstractions: ['classroom'], givens: { microservice: { capacityRps: 100_000 } } }
    })
    expect(resolveAbstraction(PRACTICE_ENVIRONMENT_PROFILE, classroomOnly)).toBe('classroom')
  })

  it("stays in Architect mode when the question doesn't state a component's capacity", () => {
    const unstated = classroomQuestion({ classroom: undefined })
    expect(resolveAbstraction(classroom, unstated)).toBe('architect')
    expect(classroomUnavailableReason(classroom, unstated)).toBe(
      "The question doesn't state how many requests per second a Server handles."
    )
    expect(canEditResourcesForQuestion(classroom, unstated)).toBe(true)
  })

  it('stays in Architect mode when the question cannot be solved within the instance limit', () => {
    const unsolvable = classroomQuestion({
      classroom: {
        givens: { microservice: { capacityRps: 18_000 } },
        targets: { maxUtilization: 0.8 }
      }
    })
    expect(resolveAbstraction(classroom, unsolvable)).toBe('architect')
    const reason = classroomUnavailableReason(classroom, unsolvable) ?? ''
    expect(reason).toContain("can't be solved with 50 or fewer Server instances")
    // Never names the smallest passing fleet.
    expect(reason).not.toMatch(/70/)
  })

  it('reports no reason when Classroom is in effect or not requested', () => {
    expect(classroomUnavailableReason(classroom, classroomQuestion())).toBeNull()
    expect(
      classroomUnavailableReason(ASSIGNMENT_ENVIRONMENT_PROFILE, classroomQuestion())
    ).toBeNull()
  })

  it('overrides question domains that would unlock edges or resources', () => {
    expect(isClassroomActive(classroom, question)).toBe(true)
    expect(resolveEdgeModel(classroom, question)).toBe('connector')
    expect(canEditEdgesForQuestion(classroom, question)).toBe(false)
    expect(canEditResourcesForQuestion(classroom, question)).toBe(false)
    const architect = resolveEnvironmentProfile({ mode: 'PRACTICE', abstraction: 'architect' })
    expect(resolveEdgeModel(architect, question)).toBe('network')
  })
})
