import { describe, expect, it } from 'vitest'
import { shouldShowQuestionSupportDetails } from './supportDetailsVisibility'

describe('QuestionPanel support details visibility', () => {
  it('hides simulator coverage details by default', () => {
    expect(shouldShowQuestionSupportDetails('')).toBe(false)
    expect(shouldShowQuestionSupportDetails('?mode=student')).toBe(false)
  })

  it('shows simulator coverage details only when explicitly requested', () => {
    expect(shouldShowQuestionSupportDetails('?showSupportDetails=1')).toBe(true)
    expect(shouldShowQuestionSupportDetails('?showSupportDetails=true')).toBe(true)
    expect(shouldShowQuestionSupportDetails('?showSupportDetails=false')).toBe(false)
  })
})
