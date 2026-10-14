import { describe, expect, it } from 'vitest'
import { SAMPLE_QUESTION } from '../../renderer/src/config/sampleQuestion'
import { buildStudentAssignmentPackage } from './studentAssignmentPackage'

describe('buildStudentAssignmentPackage', () => {
  it('keeps learner-visible content and strips private grading inputs', () => {
    const question = {
      ...SAMPLE_QUESTION,
      author: 'private-author',
      createdAt: '2026-01-01T00:00:00.000Z',
      justify: [
        {
          id: 'why-db',
          decision: 'Why this database?',
          requires: { choice: true, tradeoff: true },
          acceptTradeoffTokens: ['secret-answer-token']
        }
      ]
    }

    const student = buildStudentAssignmentPackage(question)
    const raw = student as unknown as Record<string, unknown>

    expect(student.id).toBe(question.id)
    expect(student.prompt).toBe(question.prompt)
    expect(student.scaffold).toBe(question.scaffold)
    expect(student.dryRunCase).toEqual(question.suite.dryRunCase)

    expect(raw).not.toHaveProperty('suite')
    expect(raw).not.toHaveProperty('rubric')
    expect(raw).not.toHaveProperty('structuralRules')
    expect(raw).not.toHaveProperty('semanticCriteria')
    expect(raw).not.toHaveProperty('author')
    expect(raw).not.toHaveProperty('createdAt')
    expect(student.justify?.[0]).not.toHaveProperty('acceptTradeoffTokens')
    expect(JSON.stringify(student)).not.toContain('secret-answer-token')
  })
})
