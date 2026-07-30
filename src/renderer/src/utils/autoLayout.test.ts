import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { applyAutoLayout } from './autoLayout'

function buildNode(id: string, x = 0, y = 0): Node {
  return {
    id,
    position: { x, y },
    data: { label: id },
    width: 180,
    height: 100
  } as Node
}

function buildEdge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target
  } as Edge
}

describe('applyAutoLayout', () => {
  it('places downstream nodes to the right of their sources', () => {
    const nodes = [buildNode('client'), buildNode('gateway'), buildNode('service'), buildNode('db')]
    const edges = [
      buildEdge('client', 'gateway'),
      buildEdge('gateway', 'service'),
      buildEdge('service', 'db')
    ]

    const laidOut = applyAutoLayout(nodes, edges)
    const byId = new Map(laidOut.map((node) => [node.id, node]))

    expect((byId.get('gateway')?.position.x ?? 0) > (byId.get('client')?.position.x ?? 0)).toBe(
      true
    )
    expect((byId.get('service')?.position.x ?? 0) > (byId.get('gateway')?.position.x ?? 0)).toBe(
      true
    )
    expect((byId.get('db')?.position.x ?? 0) > (byId.get('service')?.position.x ?? 0)).toBe(
      true
    )
  })

  it('stacks sibling nodes vertically in the same layer', () => {
    const nodes = [buildNode('lb'), buildNode('svc-a'), buildNode('svc-b')]
    const edges = [buildEdge('lb', 'svc-a'), buildEdge('lb', 'svc-b')]

    const laidOut = applyAutoLayout(nodes, edges)
    const byId = new Map(laidOut.map((node) => [node.id, node]))

    expect(byId.get('svc-a')?.position.x).toBe(byId.get('svc-b')?.position.x)
    expect(byId.get('svc-a')?.position.y).not.toBe(byId.get('svc-b')?.position.y)
  })

  it('lays out nested child nodes relative to their parent container', () => {
    const nodes = [
      buildNode('vpc', 400, 200),
      { ...buildNode('child-a'), parentNode: 'vpc', position: { x: 300, y: 300 } } as Node,
      { ...buildNode('child-b'), parentNode: 'vpc', position: { x: 600, y: 300 } } as Node
    ]
    const edges = [buildEdge('child-a', 'child-b')]

    const laidOut = applyAutoLayout(nodes, edges)
    const byId = new Map(laidOut.map((node) => [node.id, node]))
    const parentPosition = byId.get('vpc')?.position ?? { x: 0, y: 0 }

    expect((byId.get('child-a')?.position.x ?? 0) >= 0).toBe(true)
    expect((byId.get('child-b')?.position.x ?? 0) > (byId.get('child-a')?.position.x ?? 0)).toBe(
      true
    )
    expect(parentPosition.x).toBeGreaterThanOrEqual(0)
    expect(parentPosition.y).toBeGreaterThanOrEqual(0)
  })
})
