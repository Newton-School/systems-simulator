import { describe, expect, it } from 'vitest'
import { instantiateTemplate, PALETTE_TEMPLATES } from '../../../engine/catalog/paletteTemplates'
import {
  isComponentLibraryItemVisible,
  isInDefaultComponentLibrary
} from './componentLibraryVisibility'

describe('placeholder templates in the default component library', () => {
  it.each(['generic-service', 'my-service', 'custom-node-builder', 'input-source', 'output-sink'])(
    '%s is visible in the default library',
    (templateId) => {
      expect(PALETTE_TEMPLATES[templateId]).toBeDefined()
      expect(isInDefaultComponentLibrary(templateId)).toBe(true)
    }
  )

  it('input-source is a source and output-sink is a sink', () => {
    expect(instantiateTemplate('input-source')).toMatchObject({
      componentType: 'api-endpoint',
      structuralRole: 'source'
    })
    expect(instantiateTemplate('output-sink')).toMatchObject({
      componentType: 'third-party-api-connector',
      structuralRole: 'sink'
    })
  })

  it('output-sink acks quickly instead of inheriting the 150 ms third-party API latency', () => {
    const sink = instantiateTemplate('output-sink').sim?.processing?.distribution
    const external = instantiateTemplate('external-service').sim?.processing?.distribution
    expect(sink).toEqual({ type: 'exponential', lambda: 1 })
    // External Service keeps the slow-dependency default.
    expect(external).toMatchObject({ type: 'exponential' })
    expect(1 / (external as { lambda: number }).lambda).toBeCloseTo(150)
  })

  it('still honours hidden template ids', () => {
    expect(
      isComponentLibraryItemVisible({
        templateId: 'output-sink',
        mode: 'default',
        hiddenTemplateIds: ['output-sink']
      })
    ).toBe(false)
  })

  it('keeps full-library-only templates out of the default library', () => {
    expect(isInDefaultComponentLibrary('external-service')).toBe(false)
  })
})
