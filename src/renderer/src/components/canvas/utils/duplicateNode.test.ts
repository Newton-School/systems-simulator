import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { duplicateSelectedNode } from './duplicateNode'

const node = (id: string, selected: boolean, x = 100, y = 50): Node => ({
  id,
  type: 'service',
  position: { x, y },
  selected,
  data: { label: id, sim: { resources: { instanceCount: 3 } } }
})

describe('duplicateSelectedNode', () => {
  it('copies one selected node beside itself with a new id and the same settings', () => {
    const copy = duplicateSelectedNode([node('a', true), node('b', false)], [])
    expect(copy?.nodes).toHaveLength(1)
    const [copied] = copy!.nodes
    expect(copied.id).not.toBe('a')
    expect(copied.position).toEqual({ x: 148, y: 98 })
    expect(copied.data).toEqual(node('a', true).data)
  })

  it('does not carry connections over', () => {
    const edges: Edge[] = [{ id: 'e', source: 'a', target: 'b' }]
    expect(duplicateSelectedNode([node('a', true), node('b', false)], edges)?.edges).toEqual([])
  })

  it('does nothing without exactly one selected node', () => {
    expect(duplicateSelectedNode([node('a', false)], [])).toBeNull()
    expect(duplicateSelectedNode([node('a', true), node('b', true)], [])).toBeNull()
  })
})
