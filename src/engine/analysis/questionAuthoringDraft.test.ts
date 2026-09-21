import { describe, expect, it } from 'vitest'
import { deriveQuestionIdFromTitle } from './questionAuthoringDraft'

describe('deriveQuestionIdFromTitle', () => {
  it('derives the same lowercase hyphenated ID for the same title', () => {
    expect(deriveQuestionIdFromTitle('Design a URL Shortener')).toBe('design-a-url-shortener')
    expect(deriveQuestionIdFromTitle('Design a URL Shortener')).toBe('design-a-url-shortener')
  })

  it('normalizes repeated whitespace and punctuation', () => {
    expect(deriveQuestionIdFromTitle('  Reliable APIs: retries & deadlines!  ')).toBe(
      'reliable-apis-retries-deadlines'
    )
  })

  it('returns a valid visible fallback while the title is blank', () => {
    expect(deriveQuestionIdFromTitle('   ')).toBe('untitled-question')
    expect(deriveQuestionIdFromTitle('---')).toBe('untitled-question')
  })
})
