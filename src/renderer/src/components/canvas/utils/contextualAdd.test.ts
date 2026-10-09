import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { instantiateTemplate } from '../../../../../engine/catalog/paletteTemplates'
import { CATALOG_CONFIG } from '@renderer/config/catalogConfig'
import { recomputeContainment } from './canvasUtils'
import { contextualAddModesFor, isTemplateOfferedFor, planContextualAdd } from './contextualAdd'
import { findFreeChildSlot, fitContainersToChild, resolvePlacement } from './nodePlacement'

function container(
  id: string,
  templateId: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  parentNode?: string
): Node {
  return {
    id,
    type: 'containerNode',
    position,
    width: size.width,
    height: size.height,
    parentNode,
    data: instantiateTemplate(templateId)
  }
}

function service(id: string, position: { x: number; y: number }, parentNode?: string): Node {
  return {
    id,
    type: 'saturationNode',
    position,
    width: 256,
    height: 120,
    parentNode,
    data: instantiateTemplate('backend-server')
  }
}

const allTemplateIds = CATALOG_CONFIG.flatMap((category) => category.items.map((item) => item.id))

describe('contextual add actions', () => {
  it('offers "add inside" on containers and "add connected" on components that can send', () => {
    expect(
      contextualAddModesFor(
        container('r', 'vpc-region', { x: 0, y: 0 }, { width: 400, height: 300 })
      )
    ).toEqual(['child'])
    expect(contextualAddModesFor(service('s', { x: 0, y: 0 }))).toEqual(['connected'])
    expect(
      contextualAddModesFor({
        id: 'sink',
        type: 'standardNode',
        position: { x: 0, y: 0 },
        data: instantiateTemplate('output-sink')
      })
    ).toEqual([])
    expect(
      contextualAddModesFor({ id: 'l', type: 'textLabelNode', position: { x: 0, y: 0 }, data: {} })
    ).toEqual([])
  })

  it('offers only children the hierarchy rules allow', () => {
    const region = container('r', 'vpc-region', { x: 0, y: 0 }, { width: 400, height: 300 })
    const zone = container('z', 'availability-zone', { x: 0, y: 0 }, { width: 400, height: 300 })
    const subnet = container('s', 'subnet', { x: 0, y: 0 }, { width: 400, height: 300 })
    const offered = (anchor: Node) =>
      allTemplateIds.filter((templateId) => isTemplateOfferedFor('child', anchor, templateId))

    expect(offered(region)).toEqual(expect.arrayContaining(['availability-zone', 'subnet']))
    expect(offered(region)).not.toContain('vpc-region')
    expect(offered(zone)).toContain('subnet')
    expect(offered(zone)).not.toEqual(expect.arrayContaining(['vpc-region']))
    expect(offered(zone)).not.toContain('availability-zone')
    expect(offered(subnet)).not.toEqual(
      expect.arrayContaining(['vpc-region', 'availability-zone', 'subnet'])
    )
    expect(offered(subnet)).toContain('backend-server')
  })

  it('never offers sources or containers as a connected node', () => {
    const anchor = service('api', { x: 0, y: 0 })
    const offered = allTemplateIds.filter((templateId) =>
      isTemplateOfferedFor('connected', anchor, templateId)
    )
    expect(offered).toContain('primary-db')
    expect(offered).not.toContain('client-user')
    expect(offered).not.toContain('input-source')
    expect(offered).not.toContain('subnet')
  })
})

describe('placement', () => {
  it('finds the first free slot inside a container, below its header', () => {
    const zone = container(
      'z',
      'availability-zone',
      { x: 100, y: 100 },
      { width: 600, height: 400 }
    )
    const first = findFreeChildSlot(zone, [zone], { width: 256, height: 120 })
    expect(first).toEqual({ x: 24, y: 56 })

    const occupied = [zone, service('a', first, 'z')]
    const second = findFreeChildSlot(zone, occupied, { width: 256, height: 120 })
    expect(second).toEqual({ x: 24 + 256 + 24, y: 56 })
  })

  it('validates an explicit container against the hierarchy rules', () => {
    const subnet = container('s', 'subnet', { x: 0, y: 0 }, { width: 400, height: 300 })
    const placement = resolvePlacement([subnet], 'availability-zone', { x: 10, y: 10 }, subnet)
    expect(placement.ok).toBe(false)
  })

  it('grows every ancestor that is too small for the new child', () => {
    const zone = container('z', 'availability-zone', { x: 0, y: 0 }, { width: 300, height: 200 })
    const subnet = container('s', 'subnet', { x: 24, y: 56 }, { width: 200, height: 120 }, 'z')
    const child = service('c', { x: 24, y: 56 }, 's')
    const fitted = fitContainersToChild([zone, subnet, child], 'c')
    const fittedSubnet = fitted.find((node) => node.id === 's')!
    const fittedZone = fitted.find((node) => node.id === 'z')!
    expect(fittedSubnet.style).toMatchObject({ width: 24 + 256 + 24, height: 56 + 120 + 24 })
    expect(fittedZone.style).toMatchObject({
      width: 24 + fittedSubnet.width! + 24,
      height: 56 + fittedSubnet.height! + 24
    })
  })
})

describe('planContextualAdd', () => {
  it('adds a subnet inside an availability zone, then a service inside that subnet', () => {
    const zone = container(
      'z',
      'availability-zone',
      { x: 200, y: 100 },
      { width: 640, height: 360 }
    )
    const first = planContextualAdd({
      request: { mode: 'child', anchorNodeId: 'z' },
      type: 'containerNode',
      templateId: 'subnet',
      nodes: [zone],
      edges: []
    })
    expect(first.ok).toBe(true)
    if (first.ok === false) return
    const subnet = first.nodes.find((node) => node.id === first.nodeId)!
    expect(subnet).toMatchObject({ parentNode: 'z', selected: true, position: { x: 24, y: 56 } })
    expect((subnet.data as { templateId: string }).templateId).toBe('subnet')

    const second = planContextualAdd({
      request: { mode: 'child', anchorNodeId: subnet.id },
      type: 'saturationNode',
      templateId: 'backend-server',
      nodes: first.nodes,
      edges: first.edges
    })
    expect(second.ok).toBe(true)
    if (second.ok === false) return
    const api = second.nodes.find((node) => node.id === second.nodeId)!
    expect(api).toMatchObject({ parentNode: subnet.id, zIndex: 10, selected: true })
    // The new parents are big enough that containment keeps every node where it was put.
    expect(recomputeContainment(second.nodes)).toBe(second.nodes)
    expect(second.nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([api.id])
  })

  it('refuses a child the container cannot hold', () => {
    const subnet = container('s', 'subnet', { x: 0, y: 0 }, { width: 400, height: 300 })
    const result = planContextualAdd({
      request: { mode: 'child', anchorNodeId: 's' },
      type: 'containerNode',
      templateId: 'vpc-region',
      nodes: [subnet],
      edges: []
    })
    expect(result.ok).toBe(false)
  })

  it('adds a connected node to the right, wired from the anchor, in the same container', () => {
    const subnet = container('s', 'subnet', { x: 0, y: 0 }, { width: 400, height: 240 })
    const api = service('api', { x: 24, y: 56 }, 's')
    const edges: Edge[] = []
    const result = planContextualAdd({
      request: { mode: 'connected', anchorNodeId: 'api' },
      type: 'standardNode',
      templateId: 'primary-db',
      nodes: [subnet, api],
      edges
    })
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    const db = result.nodes.find((node) => node.id === result.nodeId)!
    expect(db.parentNode).toBe('s')
    expect(db.position.x).toBeGreaterThan(api.position.x + 256)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toMatchObject({
      id: result.edgeId,
      source: 'api',
      target: db.id,
      sourceHandle: 'right-1-source',
      targetHandle: 'left-1-target'
    })
    // The subnet grew to keep the new node inside it.
    expect(recomputeContainment(result.nodes)).toBe(result.nodes)
  })

  it('steps down past an occupied slot', () => {
    const api = service('api', { x: 0, y: 0 })
    const busy = service('busy', { x: 256 + 140, y: 0 })
    const result = planContextualAdd({
      request: { mode: 'connected', anchorNodeId: 'api' },
      type: 'standardNode',
      templateId: 'primary-db',
      nodes: [api, busy],
      edges: []
    })
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    const db = result.nodes.find((node) => node.id === result.nodeId)!
    expect(db.position).toEqual({ x: 256 + 140, y: 120 + 40 })
    expect(db.parentNode).toBeUndefined()
  })
})
