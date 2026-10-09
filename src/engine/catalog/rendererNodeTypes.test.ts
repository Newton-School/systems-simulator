import { describe, expect, it } from 'vitest'
import {
  LEGACY_RENDERER_NODE_TYPES,
  normalizeCanvasNodeRendererType,
  normalizeCanvasNodeRendererTypes,
  normalizeRendererNodeType
} from './rendererNodeTypes'
import { migrateCanvasNode } from './legacyCanvasMigration'
import { instantiateTemplate } from './paletteTemplates'

describe('legacy renderer names (#219)', () => {
  it('maps every pre-#219 name to its presentation-term successor', () => {
    expect(LEGACY_RENDERER_NODE_TYPES).toEqual({
      serviceNode: 'standardNode',
      computeNode: 'saturationNode',
      vpcNode: 'containerNode'
    })
    expect(normalizeRendererNodeType('serviceNode')).toBe('standardNode')
    expect(normalizeRendererNodeType('computeNode')).toBe('saturationNode')
    expect(normalizeRendererNodeType('vpcNode')).toBe('containerNode')
  })

  it('passes current, unchanged and unknown names through', () => {
    for (const type of ['standardNode', 'saturationNode', 'securityNode', 'containerNode']) {
      expect(normalizeRendererNodeType(type)).toBe(type)
    }
    expect(normalizeRendererNodeType('textLabelNode')).toBe('textLabelNode')
    expect(normalizeRendererNodeType(undefined)).toBeUndefined()
    expect(normalizeRendererNodeType('toString')).toBe('toString')
  })

  it('renames node.type and data.rendererType, leaving everything else intact', () => {
    const node = {
      id: 'region',
      type: 'vpcNode',
      position: { x: 1, y: 2 },
      style: { width: 400 },
      data: { rendererType: 'vpcNode', label: 'Region' }
    }
    const normalized = normalizeCanvasNodeRendererType(node)
    expect(normalized).toEqual({
      ...node,
      type: 'containerNode',
      data: { rendererType: 'containerNode', label: 'Region' }
    })
    expect(node.type).toBe('vpcNode')
  })

  it('returns the same node and array when nothing needs renaming', () => {
    const node = { id: 'a', type: 'standardNode', data: { rendererType: 'standardNode' } }
    expect(normalizeCanvasNodeRendererType(node)).toBe(node)
    const nodes = [node, { id: 'b', type: 'securityNode', data: {} }]
    expect(normalizeCanvasNodeRendererTypes(nodes)).toBe(nodes)
    const mixed = [node, { id: 'c', type: 'computeNode', data: {} }]
    const next = normalizeCanvasNodeRendererTypes(mixed)
    expect(next).not.toBe(mixed)
    expect(next[0]).toBe(node)
    expect(next[1]?.type).toBe('saturationNode')
  })

  it('migrateCanvasNode renames V2 nodes saved with the old names', () => {
    const data = { ...instantiateTemplate('backend-server'), rendererType: 'computeNode' }
    const migrated = migrateCanvasNode({
      id: 'api',
      type: 'computeNode',
      position: { x: 0, y: 0 },
      data
    })
    expect(migrated.type).toBe('saturationNode')
    expect(migrated.data.rendererType).toBe('saturationNode')
  })

  it('migrateCanvasNode still resolves pre-V2 compute nodes saved as computeNode', () => {
    const migrated = migrateCanvasNode({
      id: 'worker',
      type: 'computeNode',
      position: { x: 0, y: 0 },
      data: { computeType: 'WORKER', label: 'Jobs' }
    })
    expect(migrated.type).toBe('saturationNode')
    expect(migrated.data.templateId).toBe('async-worker')
    expect(migrated.data.label).toBe('Jobs')
  })
})
