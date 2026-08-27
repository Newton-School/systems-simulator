import { describe, expect, it } from 'vitest'
import { resolveEnvironmentProfile } from '../../../engine/analysis/environmentProfile'
import { resolveExperienceEnvelope } from './experienceEnvelope'

const BASE_QUESTION = {
  type: 'open-build' as const,
  tags: [],
  scaffold: { type: 'empty' as const },
  constraints: {
    canModifyScaffold: true,
    canRemoveScaffoldNodes: true
  }
}

describe('resolveExperienceEnvelope', () => {
  it('uses Sandbox when no question is loaded', () => {
    const envelope = resolveExperienceEnvelope(resolveEnvironmentProfile('PRACTICE'), null)

    expect(envelope.kind).toBe('SANDBOX')
    expect(envelope.allowedTabs).toContain('scenarios')
    expect(envelope.canvasLocked).toBe(false)
  })

  it('uses Assignment when a graded question is active', () => {
    const envelope = resolveExperienceEnvelope(
      resolveEnvironmentProfile('ASSIGNMENT'),
      BASE_QUESTION
    )

    expect(envelope.kind).toBe('ASSIGNMENT')
    expect(envelope.questionTabLabel).toBe('Assignment Brief')
    expect(envelope.allowedTabs).toEqual(['question', 'library'])
  })

  it('uses Interview for an ungraded question wrapper', () => {
    const envelope = resolveExperienceEnvelope(resolveEnvironmentProfile('PRACTICE'), BASE_QUESTION)

    expect(envelope.kind).toBe('INTERVIEW')
    expect(envelope.testActionLabel).toBe('Run & Evaluate')
    expect(envelope.canvasLocked).toBe(false)
  })

  it('detects locked lab questions from their package shape', () => {
    const envelope = resolveExperienceEnvelope(resolveEnvironmentProfile('PRACTICE'), {
      type: 'open-build',
      tags: ['lab'],
      scaffold: { type: 'complete' },
      constraints: {
        allowedNodeTypes: [],
        canModifyScaffold: false,
        canRemoveScaffoldNodes: false
      }
    })

    expect(envelope.kind).toBe('LAB')
    expect(envelope.allowedTabs).toEqual(['question', 'labs'])
    expect(envelope.canvasLocked).toBe(true)
  })

  it('treats explicit locked-lab entryFormat as authoritative', () => {
    const envelope = resolveExperienceEnvelope(resolveEnvironmentProfile('PRACTICE'), {
      type: 'open-build',
      entryFormat: 'locked-lab',
      tags: [],
      scaffold: { type: 'partial' },
      constraints: {
        canModifyScaffold: true,
        canRemoveScaffoldNodes: true
      }
    })

    expect(envelope.kind).toBe('LAB')
    expect(envelope.questionTabLabel).toBe('Lab Guide')
    expect(envelope.canvasLocked).toBe(true)
  })

  it('uses requirements-first copy when the question is authored that way', () => {
    const envelope = resolveExperienceEnvelope(resolveEnvironmentProfile('ASSIGNMENT'), {
      ...BASE_QUESTION,
      entryFormat: 'requirements-first'
    })

    expect(envelope.entryFormat).toBe('requirements-first')
    expect(envelope.entryFormatLabel).toBe('Requirements-First')
    expect(envelope.questionTabLabel).toBe('Requirements Brief')
    expect(envelope.testActionLabel).toBe('Run Against Requirements')
  })

  it('uses optimize-specific comparison labels for baseline-optimize questions', () => {
    const envelope = resolveExperienceEnvelope(resolveEnvironmentProfile('PRACTICE'), {
      ...BASE_QUESTION,
      type: 'optimize',
      entryFormat: 'baseline-optimize'
    })

    expect(envelope.kind).toBe('INTERVIEW')
    expect(envelope.questionTabLabel).toBe('Optimization Brief')
    expect(envelope.testActionLabel).toBe('Run & Compare')
    expect(envelope.resultsButtonLabel).toBe('Open Comparison & Results')
  })
})
