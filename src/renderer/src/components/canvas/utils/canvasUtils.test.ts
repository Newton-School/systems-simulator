import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import { recomputeContainment } from './canvasUtils'

function container(id: string, x: number, y: number, size: number, parentNode?: string): Node {
  return {
    id,
    type: 'vpcNode',
    position: { x, y },
    width: size,
    height: size,
    parentNode,
    data: {}
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
    data: {}
  }
}

describe('recomputeContainment (center-inside)', () => {
  it('captures a node whose center falls inside a container', () => {
    const nodes = [container('vpc', 0, 0, 300), box('n', 140, 140)] // center (160,160) is inside
    const result = recomputeContainment(nodes)
    const n = result.find((x) => x.id === 'n')!
    expect(n.parentNode).toBe('vpc')
    // position becomes relative to the container
    expect(n.position).toEqual({ x: 140, y: 140 })
  })

  it('does not capture a node whose center is outside the container', () => {
    const nodes = [container('vpc', 0, 0, 100), box('n', 400, 400)]
    const result = recomputeContainment(nodes)
    expect(result.find((x) => x.id === 'n')!.parentNode).toBeUndefined()
    // unchanged input returns the same reference
    expect(result).toBe(nodes)
  })

  it('releases a child whose center has been dragged outside its container', () => {
    // child stored relative to a 300x300 container but positioned far outside it
    const nodes = [container('vpc', 0, 0, 300), box('n', 900, 900, 'vpc')]
    const result = recomputeContainment(nodes)
    const n = result.find((x) => x.id === 'n')!
    expect(n.parentNode).toBeUndefined()
    // released back to absolute coordinates
    expect(n.position).toEqual({ x: 900, y: 900 })
  })

  it('picks the deepest (smallest) container when nested', () => {
    const nodes = [
      container('region', 0, 0, 400),
      container('az', 50, 50, 200, 'region'), // abs bounds (50,50)-(250,250)
      box('n', 100, 100) // center (120,120) inside both; az is smaller
    ]
    const result = recomputeContainment(nodes)
    const n = result.find((x) => x.id === 'n')!
    expect(n.parentNode).toBe('az')
    expect(n.position).toEqual({ x: 50, y: 50 })
  })

  it('never parents a container into its own descendant (no cycle)', () => {
    // az currently inside region; even if geometry overlaps, region must not become az's child
    const nodes = [
      container('region', 0, 0, 400),
      container('az', 0, 0, 400, 'region') // same bounds as region
    ]
    const result = recomputeContainment(nodes)
    expect(result.find((x) => x.id === 'region')!.parentNode).toBeUndefined()
  })
})
