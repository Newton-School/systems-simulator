import { describe, expect, it } from 'vitest'
import { parseEmbeddedIframeQuestion } from './embeddedIframeQuestionSchema'

describe('parseEmbeddedIframeQuestion', () => {
  it('parses a valid embedded-iframe question payload', () => {
    const result = parseEmbeddedIframeQuestion(
      JSON.stringify({
        type: 'embedded-iframe',
        url: 'https://example.com/embed',
        title: 'Assignment',
        prompt: 'Inspect the embedded app.'
      })
    )

    expect(result.error).toBeNull()
    expect(result.question).toMatchObject({
      type: 'embedded-iframe',
      url: 'https://example.com/embed',
      title: 'Assignment',
      prompt: 'Inspect the embedded app.',
      allowedOrigins: ['https://example.com']
    })
  })

  it('rejects embedded-iframe payloads with invalid urls', () => {
    const result = parseEmbeddedIframeQuestion(
      JSON.stringify({
        type: 'embedded-iframe',
        url: '/relative/path'
      })
    )

    expect(result.question).toBeNull()
    expect(result.error).toContain('valid absolute URL')
  })

  it('parses real embedded question launch context when questionPackage is provided', () => {
    const result = parseEmbeddedIframeQuestion(
      JSON.stringify({
        type: 'embedded-iframe',
        url: 'https://example.com/embed',
        questionPackage: {
          id: 'q1',
          title: 'Assignment',
          difficulty: 'intermediate',
          type: 'open-build',
          prompt: {
            text: 'Build the system.',
            functionalRequirements: [],
            nonFunctionalRequirements: [],
            scale: {}
          },
          scaffold: { type: 'empty' },
          constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
          suite: {
            name: 'suite',
            visibleToStudent: false,
            cases: [{ id: 'baseline' }]
          },
          rubric: {
            checks: [
              {
                id: 'err',
                description: 'error rate < 10%',
                metric: 'summary.errorRate',
                op: '<',
                value: 0.1
              }
            ]
          }
        }
      })
    )

    expect(result.error).toBeNull()
    expect(result.question?.questionPackage?.version).toBe('1.0')
    expect(result.question?.questionPackage?.id).toBe('q1')
  })

  it('rejects priorAttempt when no questionPackage is provided', () => {
    const result = parseEmbeddedIframeQuestion(
      JSON.stringify({
        type: 'embedded-iframe',
        url: 'https://example.com/embed',
        priorAttempt: {
          attemptId: 'attempt-1'
        }
      })
    )

    expect(result.question).toBeNull()
    expect(result.error).toContain('priorAttempt requires a questionPackage')
  })
})
