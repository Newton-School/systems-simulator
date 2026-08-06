import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from '../core/types'
import { budgetBreakdown, estimateNodeCost, evaluateBudget } from './budget'

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

describe('budgetBreakdown', () => {
  it('cost unit: returns per-node items (biggest driver first) + an edges row', () => {
    const t = topo(
      [
        node('svc', {
          queue: { workers: 80, capacity: 1, discipline: 'fifo' }
        } as Partial<ComponentNode>),
        node('store', {
          type: 'kv-store',
          queue: { workers: 1000, capacity: 1, discipline: 'fifo' }
        } as Partial<ComponentNode>)
      ],
      3
    )
    const b = budgetBreakdown(t, { unit: 'cost', cap: 600 })
    expect(b.actual).toBe(b.items.reduce((s, i) => s + i.cost, 0))
    // store (1+1+⌈1000/50⌉=20 = 22) drives more than svc (1+1+⌈80/50⌉=2 = 4)
    expect(b.items[0].id).toBe('store')
    expect(b.items[0].cost).toBe(22)
    const edges = b.items.find((i) => i.id === 'edges')
    expect(edges?.cost).toBe(3)
    expect(b.withinBudget).toBe(true)
  })

  it('nodes unit: one item per node summing to the count', () => {
    const b = budgetBreakdown(topo([node('a'), node('b')], 5), { unit: 'nodes', cap: 3 })
    expect(b.actual).toBe(2)
    expect(b.items).toHaveLength(2)
    expect(b.items.every((i) => i.cost === 1)).toBe(true)
  })
})
