import { describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { buildClipboardSelection, materializeClipboardSelection } from './useCopyPaste'

function makeNode(
  id: string,
  position: { x: number; y: number },
  options: Partial<Node> = {}
): Node {
  return {
    id,
    type: 'serviceNode',
    position,
    data: {},
    selected: false,
    ...options
  }
}

function makeEdge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    selected: false
  }
}

describe('useCopyPaste helpers', () => {
  it('preserves relative positions when a nested parent and child are copied together', () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000001')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000002')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000003')

    const parent = makeNode('parent', { x: 100, y: 100 }, { type: 'vpcNode', selected: true })
    const child = makeNode('child', { x: 20, y: 30 }, { parentNode: 'parent', selected: true })
    const edge = makeEdge('edge-1', 'parent', 'child')
    edge.selected = true

    const clipboard = buildClipboardSelection([parent, child], [edge])
    const pasted = materializeClipboardSelection(clipboard, { x: 300, y: 400 })

    const pastedParent = pasted.nodes.find(
      (node) => node.id === '00000000-0000-0000-0000-000000000001'
    )
    const pastedChild = pasted.nodes.find(
      (node) => node.id === '00000000-0000-0000-0000-000000000002'
    )

    expect(pastedParent?.parentNode).toBeUndefined()
    expect(pastedParent?.position).toEqual({ x: 300, y: 400 })
    expect(pastedChild?.parentNode).toBe('00000000-0000-0000-0000-000000000001')
    expect(pastedChild?.position).toEqual({ x: 20, y: 30 })
    expect(pasted.edges).toEqual([
      expect.objectContaining({
        id: '00000000-0000-0000-0000-000000000003',
        source: '00000000-0000-0000-0000-000000000001',
        target: '00000000-0000-0000-0000-000000000002',
        selected: true
      })
    ])
  })

  it('detaches a copied child from an uncopied parent and pastes it in absolute space', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-0000-0000-000000000004')

    const parent = makeNode('parent', { x: 100, y: 100 }, { type: 'vpcNode' })
    const child = makeNode('child', { x: 20, y: 30 }, { parentNode: 'parent', selected: true })

    const clipboard = buildClipboardSelection([parent, child], [])
    const pasted = materializeClipboardSelection(clipboard, { x: 500, y: 600 })
    const pastedChild = pasted.nodes[0]

    expect(pastedChild.parentNode).toBeUndefined()
    expect(pastedChild.extent).toBeUndefined()
    expect(pastedChild.position).toEqual({ x: 500, y: 600 })
  })
})
