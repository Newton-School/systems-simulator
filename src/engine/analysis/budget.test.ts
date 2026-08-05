import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from '../core/types'
import { estimateNodeCost, evaluateBudget } from './budget'

function node(id: string, extra: Partial<ComponentNode> = {}): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    ...extra
  } as unknown as ComponentNode
}

function topo(nodes: ComponentNode[], edgeCount: number): TopologyJSON {
  return {
    id: 't',
    name: 't',
    version: '2.0.0',
    nodes,
    edges: Array.from({ length: edgeCount }, (_, i) => ({ id: `e${i}`, source: 'a', target: 'b' }))
  } as unknown as TopologyJSON
}

describe('evaluateBudget', () => {
  it('nodes unit: counts nodes vs cap', () => {
    const t = topo([node('a'), node('b'), node('c')], 2)
    expect(evaluateBudget(t, { unit: 'nodes', cap: 5 })).toMatchObject({
      actual: 3,
      withinBudget: true
    })
    const over = evaluateBudget(t, { unit: 'nodes', cap: 2 })
    expect(over.withinBudget).toBe(false)
    expect(over.detail).toMatch(/nodes budget exceeded: 3 > cap 2/)
  })

  it('edges unit: counts edges vs cap', () => {
    const t = topo([node('a')], 4)
    expect(evaluateBudget(t, { unit: 'edges', cap: 4 })).toMatchObject({
      actual: 4,
      withinBudget: true
    })
    expect(evaluateBudget(t, { unit: 'edges', cap: 3 }).withinBudget).toBe(false)
  })

  it('cost unit: penalizes over-provisioned capacity (replicas + workers)', () => {
    const lean = estimateNodeCost(node('a')) // 1 base + 1 replica default + 0 workers = 2
    const heavy = estimateNodeCost(
      node('b', {
        resources: { replicas: 10 },
        queue: { workers: 500, capacity: 1, discipline: 'fifo' }
      } as Partial<ComponentNode>)
    )
    expect(lean).toBe(2)
    expect(heavy).toBeGreaterThan(lean) // 1 + 10 + ceil(500/50)=10 = 21
    // a big over-provisioned design blows the cost cap; a lean one fits
    const heavyTopo = topo(
      [
        node('b', {
          resources: { replicas: 10 },
          queue: { workers: 500, capacity: 1, discipline: 'fifo' }
        } as Partial<ComponentNode>)
      ],
      0
    )
    expect(evaluateBudget(heavyTopo, { unit: 'cost', cap: 10 }).withinBudget).toBe(false)
    expect(evaluateBudget(topo([node('a')], 0), { unit: 'cost', cap: 10 }).withinBudget).toBe(true)
  })
})
