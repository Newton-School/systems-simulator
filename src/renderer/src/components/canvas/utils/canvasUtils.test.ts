import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import { findTargetContainer, recomputeContainment } from './canvasUtils'

function container(
  id: string,
  x: number,
  y: number,
  size: number,
  templateId = 'vpc-region',
  parentNode?: string
): Node {
  return {
    id,
    type: 'vpcNode',
    position: { x, y },
    width: size,
    height: size,
    parentNode,
    data: { templateId }
  }
}

function box(id: string, x: number, y: number, parentNode?: string): Node {
  return {
    id,
    type: 'serviceNode',
    position: { x, y },
    width: 40,
    height: 40,
    parentNode,
    data: { templateId: 'backend-server' }
  }
}

describe('findTargetContainer', () => {
  it('uses absolute positions for nested containers', () => {
    const nodes = [
      container('region', 0, 0, 400, 'vpc-region'),
      container('az', 50, 50, 200, 'availability-zone', 'region')
    ]

    expect(findTargetContainer(nodes, { x: 120, y: 120 })?.id).toBe('az')
  })

  it('falls back to the nearest valid ancestor for the child template', () => {
    const nodes = [
      container('region', 0, 0, 400, 'vpc-region'),
      container('subnet', 50, 50, 200, 'subnet', 'region')
    ]

    expect(findTargetContainer(nodes, { x: 120, y: 120 }, undefined, 'availability-zone')?.id).toBe(
      'region'
    )
  })
})

describe('recomputeContainment (center-inside)', () => {
  it('captures a node whose center falls inside a container', () => {
    const nodes = [container('vpc', 0, 0, 300), box('n', 140, 140)]
    const result = recomputeContainment(nodes)
    const node = result.find((candidate) => candidate.id === 'n')!
    expect(node.parentNode).toBe('vpc')
    expect(node.position).toEqual({ x: 140, y: 140 })
  })

  it('does not capture a node whose center is outside the container', () => {
    const nodes = [container('vpc', 0, 0, 100), box('n', 400, 400)]
    const result = recomputeContainment(nodes)
    expect(result.find((candidate) => candidate.id === 'n')!.parentNode).toBeUndefined()
    expect(result).toBe(nodes)
  })

  it('releases a child whose center has been dragged outside its container', () => {
    const nodes = [container('vpc', 0, 0, 300), box('n', 900, 900, 'vpc')]
    const result = recomputeContainment(nodes)
    const node = result.find((candidate) => candidate.id === 'n')!
    expect(node.parentNode).toBeUndefined()
    expect(node.position).toEqual({ x: 900, y: 900 })
  })

  it('picks the deepest valid container when nested', () => {
    const nodes = [
      container('region', 0, 0, 400, 'vpc-region'),
      container('az', 50, 50, 200, 'availability-zone', 'region'),
      box('n', 100, 100)
    ]
    const result = recomputeContainment(nodes)
    const node = result.find((candidate) => candidate.id === 'n')!
    expect(node.parentNode).toBe('az')
    expect(node.position).toEqual({ x: 50, y: 50 })
  })

  it('skips invalid container matches and uses the next valid ancestor', () => {
    const nodes = [
      container('region', 0, 0, 400, 'vpc-region'),
      container('subnet', 50, 50, 200, 'subnet', 'region'),
      container('az', 100, 100, 80, 'availability-zone')
    ]

    const result = recomputeContainment(nodes)
    expect(result.find((candidate) => candidate.id === 'az')!.parentNode).toBe('region')
  })

  it('never parents a container into its own descendant', () => {
    const nodes = [
      container('region', 0, 0, 400, 'vpc-region'),
      container('az', 0, 0, 400, 'availability-zone', 'region')
    ]
    const result = recomputeContainment(nodes)
    expect(result.find((candidate) => candidate.id === 'region')!.parentNode).toBeUndefined()
  })
})
