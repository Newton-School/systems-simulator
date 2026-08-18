import { describe, expect, it } from 'vitest'
import {
  AUTHOR_ENVIRONMENT_PROFILE,
  DEFAULT_ENVIRONMENT_PROFILE,
  ASSIGNMENT_ENVIRONMENT_PROFILE,
  PRACTICE_ENVIRONMENT_PROFILE,
  canEditEdgesForQuestion,
  canEditResourcesForQuestion,
  canTriggerTestRun,
  resolveEdgeModel,
  resolveEnvironmentProfile,
  shouldShowRubricResults
} from './environmentProfile'

describe('environment profile presets', () => {
  it('encodes the three modes distinctly', () => {
    // Deployed/standalone default is the practice sandbox (connector edges).
    expect(DEFAULT_ENVIRONMENT_PROFILE).toBe(PRACTICE_ENVIRONMENT_PROFILE)

    expect(AUTHOR_ENVIRONMENT_PROFILE.graded).toBe(true)
    expect(AUTHOR_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')

    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.graded).toBe(true)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.visibility.gradingSuiteDetails).toBe(false)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.canEditScaffoldNodes).toBe(false)
    expect(ASSIGNMENT_ENVIRONMENT_PROFILE.capabilities.maxTestRuns).toBeUndefined()

    expect(PRACTICE_ENVIRONMENT_PROFILE.graded).toBe(false)
    expect(PRACTICE_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
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
      capabilities: { maxTestRuns: 1 },
      // unknown keys must not break resolution
      somethingExtra: true
    } as unknown)

    expect(resolved.mode).toBe('ASSIGNMENT')
    // overridden field
    expect(resolved.capabilities.maxTestRuns).toBe(1)
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
  it('respects the capability flag and the run limit', () => {
    expect(
      canTriggerTestRun(resolveEnvironmentProfile({ mode: 'ASSIGNMENT' }), { testRunCount: 0 })
    ).toBe(true)
    expect(
      canTriggerTestRun(resolveEnvironmentProfile({ mode: 'ASSIGNMENT' }), { testRunCount: 3 })
    ).toBe(true)
    expect(
      canTriggerTestRun(
        resolveEnvironmentProfile({ mode: 'ASSIGNMENT', capabilities: { maxTestRuns: 3 } }),
        {
          testRunCount: 3
        }
      )
    ).toBe(false)
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

  it('locks resources under ASSIGNMENT for non-cost questions', () => {
    expect(canEditResourcesForQuestion(assignment, { domains: ['compute'] })).toBe(false)
    expect(canEditResourcesForQuestion(assignment, { domains: ['storage', 'compute'] })).toBe(false)
    expect(canEditResourcesForQuestion(assignment, null)).toBe(false)
    expect(canEditResourcesForQuestion(assignment, {})).toBe(false)
  })

  it('unlocks resources when the question lesson is allocation (cost domain)', () => {
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
