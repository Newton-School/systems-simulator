import { describe, expect, it } from 'vitest'
import { PALETTE_TEMPLATES } from '../../../../../engine/catalog/paletteTemplates'
import { DEFAULT_DISPLAY_SETTINGS } from '@renderer/types/ui'
import { SYMBOL_BY_TEMPLATE, hasNodeSymbol } from './symbolRegistry'

describe('symbol registry', () => {
  it('only maps real palette templates', () => {
    for (const templateId of Object.keys(SYMBOL_BY_TEMPLATE)) {
      expect(PALETTE_TEMPLATES[templateId], templateId).toBeDefined()
    }
  })

  it('covers every palette template', () => {
    const missing = Object.values(PALETTE_TEMPLATES)
      .filter((template) => !hasNodeSymbol(template.id))
      .map((template) => template.id)
    expect(missing).toEqual([])
  })

  it('leaves unmapped templates to the card rendering', () => {
    expect(hasNodeSymbol('primary-db')).toBe(true)
    expect(hasNodeSymbol('not-a-template')).toBe(false)
    expect(hasNodeSymbol(undefined)).toBe(false)
  })

  it('defaults new users to the symbol node style', () => {
    expect(DEFAULT_DISPLAY_SETTINGS.nodeDisplayStyle).toBe('symbol')
  })
})
