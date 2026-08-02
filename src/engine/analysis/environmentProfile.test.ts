import { describe, expect, it } from 'vitest'
import {
  AUTHOR_ENVIRONMENT_PROFILE,
  DEFAULT_ENVIRONMENT_PROFILE,
  INTERVIEW_ENVIRONMENT_PROFILE,
  LEARN_ENVIRONMENT_PROFILE,
  canTriggerTestRun,
  resolveEnvironmentProfile,
  shouldShowRubricResults
} from './environmentProfile'

describe('environment profile presets', () => {
  it('encodes the three modes distinctly', () => {
    expect(DEFAULT_ENVIRONMENT_PROFILE).toBe(AUTHOR_ENVIRONMENT_PROFILE)

    expect(AUTHOR_ENVIRONMENT_PROFILE.graded).toBe(true)
    expect(AUTHOR_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')

    expect(INTERVIEW_ENVIRONMENT_PROFILE.graded).toBe(true)
    expect(INTERVIEW_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('POST_SUBMIT_ONLY')
    expect(INTERVIEW_ENVIRONMENT_PROFILE.visibility.gradingSuiteDetails).toBe(false)
    expect(INTERVIEW_ENVIRONMENT_PROFILE.capabilities.canEditScaffoldNodes).toBe(false)
    expect(INTERVIEW_ENVIRONMENT_PROFILE.capabilities.maxTestRuns).toBe(3)

    expect(LEARN_ENVIRONMENT_PROFILE.graded).toBe(false)
    expect(LEARN_ENVIRONMENT_PROFILE.visibility.rubricChecks).toBe('LIVE_DURING_BUILD')
  })
})

describe('resolveEnvironmentProfile', () => {
  it('defaults to AUTHOR for missing or unrecognized input', () => {
    expect(resolveEnvironmentProfile()).toEqual(AUTHOR_ENVIRONMENT_PROFILE)
    expect(resolveEnvironmentProfile(42)).toEqual(AUTHOR_ENVIRONMENT_PROFILE)
    expect(resolveEnvironmentProfile({ mode: 'NOPE' })).toEqual(AUTHOR_ENVIRONMENT_PROFILE)
  })

  it('resolves a bare mode string to its preset', () => {
    expect(resolveEnvironmentProfile('INTERVIEW')).toEqual(INTERVIEW_ENVIRONMENT_PROFILE)
    expect(resolveEnvironmentProfile('LEARN')).toEqual(LEARN_ENVIRONMENT_PROFILE)
  })

  it('merges a partial override onto the mode preset and ignores unknown keys', () => {
    const resolved = resolveEnvironmentProfile({
      mode: 'INTERVIEW',
      capabilities: { maxTestRuns: 1 },
      // unknown keys must not break resolution
      somethingExtra: true
    } as unknown)

    expect(resolved.mode).toBe('INTERVIEW')
    // overridden field
    expect(resolved.capabilities.maxTestRuns).toBe(1)
    // untouched preset fields survive
    expect(resolved.capabilities.canEditScaffoldNodes).toBe(false)
    expect(resolved.visibility.rubricChecks).toBe('POST_SUBMIT_ONLY')
  })

  it('lets an override flip a single flag (e.g. graded LEARN)', () => {
    const resolved = resolveEnvironmentProfile({ mode: 'LEARN', graded: true })
    expect(resolved.mode).toBe('LEARN')
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
      canTriggerTestRun(resolveEnvironmentProfile({ mode: 'INTERVIEW' }), { testRunCount: 0 })
    ).toBe(true)
    expect(
      canTriggerTestRun(resolveEnvironmentProfile({ mode: 'INTERVIEW' }), { testRunCount: 3 })
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
