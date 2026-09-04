import { describe, expect, it } from 'vitest'
import { getComponentSpec } from './componentSpecs'
import { instantiateTemplate } from './paletteTemplates'
import { RUNTIME_TEMPLATES, serviceRecipe } from './customDefinitions'

describe('custom node definitions', () => {
  it('maps each supported runtime template to an existing palette component', () => {
    for (const template of Object.values(RUNTIME_TEMPLATES)) {
      const data = instantiateTemplate(template.paletteTemplateId)
      expect(data.componentType).toBe(template.componentType)
    }
  })

  it('serializes a service contract with its microservice runtime', () => {
    const data = instantiateTemplate('backend-server')
    data.label = 'URL Shortener'
    data.customDefinition = {
      kind: 'service',
      runtimeTemplate: 'long-running-service',
      description: 'Creates and resolves short URLs.',
      operations: serviceRecipe('url-shortener')
    }

    const spec = getComponentSpec('microservice')
    expect(spec).toBeDefined()
    expect(spec?.validateCanvas(data)).toEqual([])

    const serialized = spec?.serializeCanvas(data, {
      nodeId: 'url-shortener',
      position: { x: 0, y: 0 }
    })
    expect(serialized?.type).toBe('microservice')
    expect(serialized?.config?.customDefinition).toEqual(data.customDefinition)
  })

  it('rejects a runtime template attached to the wrong component type', () => {
    const data = instantiateTemplate('backend-server')
    data.customDefinition = {
      kind: 'custom-node',
      runtimeTemplate: 'serverless-function',
      operations: serviceRecipe('blank')
    }

    expect(getComponentSpec('microservice')?.validateCanvas(data)).toContain(
      'Custom definition requires Serverless function, not microservice.'
    )
  })
})
