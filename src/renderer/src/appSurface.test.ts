import { describe, expect, it } from 'vitest'
import { resolveAppSurface, simulatorHrefFromLocation } from './appSurface'

describe('application surface routing', () => {
  it('keeps normal and Newton-hosted URLs on the existing simulator workspace', () => {
    expect(resolveAppSurface({ pathname: '/', search: '' })).toBe('simulator')
    expect(resolveAppSurface({ pathname: '/', search: '?host=newton' })).toBe('simulator')
  })

  it('opens Question Studio only through its explicit deep links', () => {
    expect(resolveAppSurface({ pathname: '/question-studio', search: '' })).toBe('question-studio')
    expect(resolveAppSurface({ pathname: '/', search: '?studio=question' })).toBe('question-studio')
    expect(resolveAppSurface({ pathname: '/', search: '?surface=question-studio' })).toBe(
      'question-studio'
    )
  })

  it('builds a simulator return URL without dropping unrelated query state', () => {
    expect(
      simulatorHrefFromLocation({
        pathname: '/question-studio',
        search: '?studio=question&theme=dark'
      })
    ).toBe('/?theme=dark')
  })
})
