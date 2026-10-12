import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from '../core/types'
import { budgetBreakdown, evaluateBudget } from './budget'
import { topologyCost } from './cost'

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

  it('cost unit: uses the live USD/hour model and fails closed for unpriced nodes', () => {
    const priced = topo(
      [node('svc', { resources: { instanceType: 'c5.large', instanceCount: 2 } })],
      0
    )
    const live = topologyCost(priced).totalPerHour
    expect(evaluateBudget(priced, { unit: 'cost', cap: live })).toMatchObject({
      actual: live,
      withinBudget: true
    })
    expect(evaluateBudget(priced, { unit: 'cost', cap: live / 2 }).withinBudget).toBe(false)

    const unpriced = evaluateBudget(topo([node('legacy')], 0), { unit: 'cost', cap: 10 })
    expect(unpriced.actual).toBe(0)
    expect(unpriced.withinBudget).toBe(false)
    expect(unpriced.detail).toContain('have no instance price')
  })
})

describe('budgetBreakdown', () => {
  it('cost unit: returns the same USD/hour line items as the live cost model', () => {
    const t = topo(
      [
        node('svc', {
          resources: { instanceType: 'c5.large', instanceCount: 1 }
        } as Partial<ComponentNode>),
        node('store', {
          type: 'kv-store',
          resources: { instanceType: 'm5.xlarge', instanceCount: 2 }
        } as Partial<ComponentNode>)
      ],
      0
    )
    const b = budgetBreakdown(t, { unit: 'cost', cap: 1 })
    expect(b.actual).toBe(b.items.reduce((s, i) => s + i.cost, 0))
    expect(b.actual).toBe(topologyCost(t).totalPerHour)
    expect(b.items[0].id).toBe('store')
    expect(b.items[0].formula).toContain('m5.xlarge')
    expect(b.withinBudget).toBe(true)
  })

  it('nodes unit: one item per node summing to the count', () => {
    const b = budgetBreakdown(topo([node('a'), node('b')], 5), { unit: 'nodes', cap: 3 })
    expect(b.actual).toBe(2)
    expect(b.items).toHaveLength(2)
    expect(b.items.every((i) => i.cost === 1)).toBe(true)
  })
})
