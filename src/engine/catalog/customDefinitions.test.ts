import { describe, expect, it } from 'vitest'
import { getComponentSpec } from './componentSpecs'
import { instantiateTemplate } from './paletteTemplates'
import {
  applyDefinitionTraits,
  defaultCustomNodeOperations,
  defaultServiceOperations,
  RUNTIME_TEMPLATES,
  type CustomNodeDefinition
} from './customDefinitions'

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
      name: 'URL Shortener',
      description: 'Creates and resolves short URLs.',
      operations: defaultServiceOperations()
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

  it('projects request-source operations into the source request mix with normalized weights', () => {
    const data = instantiateTemplate('input-source')
    expect(data.source).toBeDefined()

    const definition: CustomNodeDefinition = {
      kind: 'custom-node',
      runtimeTemplate: 'request-source',
      nodeClass: 'network',
      operations: [
        { id: 'read', requestType: 'resolve', responseType: 'ok', weight: 3, dependencies: [] },
        { id: 'write', requestType: 'create', responseType: 'ok', weight: 1, dependencies: [] }
      ]
    }

    applyDefinitionTraits(data, definition)
    const mix = data.source?.requestDistribution ?? []
    expect(mix.map((entry) => entry.type)).toEqual(['resolve', 'create'])
    expect(mix.map((entry) => entry.weight)).toEqual([0.75, 0.25])
    expect(mix.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1)
  })

  it('leaves non-source nodes untouched by the request-mix projection', () => {
    const data = instantiateTemplate('backend-server')
    expect(data.source).toBeUndefined()
    applyDefinitionTraits(data, {
      kind: 'service',
      runtimeTemplate: 'long-running-service',
      operations: defaultServiceOperations()
    })
    expect(data.source).toBeUndefined()
  })

  it('defaults to an equal split when operation weights are omitted', () => {
    const data = instantiateTemplate('input-source')
    applyDefinitionTraits(data, {
      kind: 'custom-node',
      runtimeTemplate: 'request-source',
      operations: [
        { id: 'a', requestType: 'a', responseType: 'ok', dependencies: [] },
        { id: 'b', requestType: 'b', responseType: 'ok', dependencies: [] },
        { id: 'c', requestType: 'c', responseType: 'ok', dependencies: [] }
      ]
    })
    const weights = (data.source?.requestDistribution ?? []).map((entry) => entry.weight)
    expect(weights).toHaveLength(3)
    weights.forEach((weight) => expect(weight).toBeCloseTo(1 / 3))
  })

  it('maps the cache trait pack onto sim.cacheHitRate / cacheHitLatencyMs', () => {
    const data = instantiateTemplate('redis-cache')
    applyDefinitionTraits(data, {
      kind: 'custom-node',
      runtimeTemplate: 'distributed-cache',
      nodeClass: 'storage',
      operations: [],
      traits: [
        {
          traitId: 'cache',
          enabled: true,
          values: { cacheHitRate: 0.95, cacheHitLatencyMs: 0.2 }
        }
      ]
    })
    expect(data.sim?.cacheHitRate).toBeCloseTo(0.95)
    expect(data.sim?.cacheHitLatencyMs).toBeCloseTo(0.2)
  })

  it('does not apply a disabled cache trait', () => {
    const data = instantiateTemplate('redis-cache')
    const before = data.sim?.cacheHitRate
    applyDefinitionTraits(data, {
      kind: 'custom-node',
      runtimeTemplate: 'distributed-cache',
      nodeClass: 'storage',
      operations: [],
      traits: [{ traitId: 'cache', enabled: false, values: { cacheHitRate: 0.1 } }]
    })
    expect(data.sim?.cacheHitRate).toBe(before)
  })

  it('rejects a runtime template attached to the wrong component type', () => {
    const data = instantiateTemplate('backend-server')
    data.customDefinition = {
      kind: 'custom-node',
      runtimeTemplate: 'serverless-function',
      operations: defaultCustomNodeOperations()
    }

    expect(getComponentSpec('microservice')?.validateCanvas(data)).toContain(
      'Custom definition requires Serverless function, not microservice.'
    )
  })
})
