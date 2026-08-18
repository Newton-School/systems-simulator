import { describe, expect, it } from 'vitest'
import {
  nodeCostPerHour,
  topologyCost,
  formatCostPerHour,
  topologyResources,
  evaluateBudgets
} from './cost'
import type { ComponentNode, TopologyJSON } from '../core/types'

function node(id: string, resources?: ComponentNode['resources']): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    resources
  }
}

function topo(nodes: ComponentNode[], workload?: unknown): TopologyJSON {
  return { nodes, edges: [], workload } as unknown as TopologyJSON
}

function cdnNode(id: string): ComponentNode {
  return { id, type: 'cdn', category: 'network-and-edge', label: id, position: { x: 0, y: 0 } }
}

function sourceNode(id: string): ComponentNode {
  return { id, type: 'api-endpoint', category: 'compute', label: id, position: { x: 0, y: 0 } }
}

function serverlessNode(id: string): ComponentNode {
  return {
    id,
    type: 'serverless-function',
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 }
  }
}

const WORKLOAD_1K = { baseRps: 1000, requestDistribution: [{ weight: 1, sizeBytes: 1000 }] }

function topoWithEdge(pathType: string, workload: unknown = WORKLOAD_1K): TopologyJSON {
  return {
    nodes: [node('a'), node('b')],
    edges: [{ id: 'e', source: 'a', target: 'b', latency: { pathType } }],
    workload
  } as unknown as TopologyJSON
}

describe('nodeCostPerHour', () => {
  it('multiplies the instance price by the count', () => {
    // c5.xlarge = $0.170/hr, × 3 = 0.51
    expect(nodeCostPerHour(node('a', { instanceType: 'c5.xlarge', instanceCount: 3 }))).toBeCloseTo(
      0.51
    )
  })

  it('treats a node with no instance model as unpriced ($0)', () => {
    expect(nodeCostPerHour(node('a'))).toBe(0)
    expect(nodeCostPerHour(node('a', { cpu: 4, memory: 2048, replicas: 2 }))).toBe(0)
  })

  it('defaults the count to 1 when instanceCount is omitted', () => {
    // m5.large = $0.096/hr
    expect(nodeCostPerHour(node('a', { instanceType: 'm5.large' }))).toBeCloseTo(0.096)
  })

  it('applies the pricing model multiplier (reserved ~40% off, spot ~70% off)', () => {
    // c5.large = $0.085/hr on-demand
    expect(
      nodeCostPerHour(node('a', { instanceType: 'c5.large', pricingModel: 'on-demand' }))
    ).toBeCloseTo(0.085)
    expect(
      nodeCostPerHour(node('a', { instanceType: 'c5.large', pricingModel: 'reserved' }))
    ).toBeCloseTo(0.051)
    expect(
      nodeCostPerHour(node('a', { instanceType: 'c5.large', pricingModel: 'spot' }))
    ).toBeCloseTo(0.0255)
  })
})

describe('topologyCost', () => {
  it('sums per-node cost and sorts most-expensive first', () => {
    const t = topo([
      node('cheap', { instanceType: 'm5.large', instanceCount: 1 }), // 0.096
      node('pricey', { instanceType: 'r5.2xlarge', instanceCount: 2 }) // 0.504 × 2 = 1.008
    ])
    const c = topologyCost(t)
    expect(c.totalPerHour).toBeCloseTo(1.104)
    expect(c.items[0].id).toBe('pricey')
    expect(c.items[0].formula).toBe('2 × r5.2xlarge @ $0.504')
  })

  it('flags unpriced nodes but still totals the priced ones', () => {
    const c = topologyCost(topo([node('legacy'), node('new', { instanceType: 'c5.large' })]))
    expect(c.hasUnpricedNodes).toBe(true)
    expect(c.totalPerHour).toBeCloseTo(0.085) // c5.large only
  })

  it('prices a CDN by estimated egress volume, not instance-hours', () => {
    // workload: 1000 rps × 1000 bytes → 1000 * 1000 * 3600 = 3.6e9 bytes/hr = 3.6 GB/hr
    // cdn egress $0.085/GB → 0.306/hr
    const workload = { baseRps: 1000, requestDistribution: [{ weight: 1, sizeBytes: 1000 }] }
    const c = topologyCost(topo([cdnNode('cdn')], workload))
    const item = c.items.find((i) => i.id === 'cdn')!
    expect(item.basis).toBe('volume')
    expect(item.isEstimate).toBe(true)
    expect(item.costPerHour).toBeCloseTo(0.306)
    expect(c.hasEstimates).toBe(true)
    expect(item.formula).toContain('/GB egress')
  })

  it('shows a CDN as run-to-measure when no workload is configured', () => {
    const c = topologyCost(topo([cdnNode('cdn')]))
    const item = c.items.find((i) => i.id === 'cdn')!
    expect(item.basis).toBe('volume')
    expect(item.costPerHour).toBe(0)
    expect(item.formula).toContain('run to measure')
  })

  it('treats a traffic source as not billable ($0)', () => {
    const c = topologyCost(topo([sourceNode('client')]))
    const item = c.items.find((i) => i.id === 'client')!
    expect(item.basis).toBe('none')
    expect(item.costPerHour).toBe(0)
    expect(item.priced).toBe(false)
    expect(item.formula).toContain('not billable')
  })

  it('prices a serverless function per request (consumption), not instance-hours', () => {
    // 1000 rps → 3.6M req/hr; $0.20/M → $0.72/hr
    const c = topologyCost(topo([serverlessNode('fn')], WORKLOAD_1K))
    const item = c.items.find((i) => i.id === 'fn')!
    expect(item.basis).toBe('consumption')
    expect(item.isEstimate).toBe(true)
    expect(item.costPerHour).toBeCloseTo(0.72)
    expect(item.formula).toContain('/M req')
  })

  it('serverless with no workload shows run-to-measure', () => {
    const c = topologyCost(topo([serverlessNode('fn')]))
    const item = c.items.find((i) => i.id === 'fn')!
    expect(item.costPerHour).toBe(0)
    expect(item.formula).toContain('run to measure')
  })

  it('charges inter-region egress on a cross-region edge', () => {
    // 1000 rps × 1000 B × 3600 = 3.6 GB/hr; cross-region $0.02/GB → $0.072/hr
    const c = topologyCost(topoWithEdge('cross-region'))
    const item = c.items.find((i) => i.id === 'edge:e')!
    expect(item.costPerHour).toBeCloseTo(0.072)
    expect(item.kind).toContain('cross-region')
    expect(item.formula).toContain('cross-region egress')
  })

  it('cross-zone egress is cheaper than cross-region; same-dc is free', () => {
    const zone = topologyCost(topoWithEdge('cross-zone')).items.find((i) => i.id === 'edge:e')!
    expect(zone.costPerHour).toBeCloseTo(0.036) // $0.01/GB × 3.6
    expect(
      topologyCost(topoWithEdge('same-dc')).items.find((i) => i.id === 'edge:e')
    ).toBeUndefined()
  })
})

describe('topologyCost — measured post-run (exact)', () => {
  it('consumption uses measured node throughput (not the estimate)', () => {
    // measured 500 rps → 1.8M req/hr; $0.20/M → $0.36/hr (vs $0.72 estimate at 1000)
    const run = { nodeThroughput: { fn: 500 }, edgeBytes: {}, durationSec: 60 }
    const c = topologyCost(topo([serverlessNode('fn')], WORKLOAD_1K), run)
    const item = c.items.find((i) => i.id === 'fn')!
    expect(item.costPerHour).toBeCloseTo(0.36)
    expect(item.isEstimate).toBe(false)
    expect(item.formula).toContain('500 rps measured')
  })

  it('edge egress uses measured bytes (not the workload estimate)', () => {
    // 1.8 GB transited over 60s → 108 GB/hr; cross-region $0.02/GB → $2.16/hr
    const run = { nodeThroughput: {}, edgeBytes: { e: 1.8e9 }, durationSec: 60 }
    const c = topologyCost(topoWithEdge('cross-region'), run)
    const item = c.items.find((i) => i.id === 'edge:e')!
    expect(item.costPerHour).toBeCloseTo(2.16)
    expect(item.isEstimate).toBe(false)
    expect(item.formula).toContain('measured')
  })

  it('falls back to estimate for nodes/edges absent from the run (edited topology)', () => {
    const run = { nodeThroughput: {}, edgeBytes: {}, durationSec: 60 }
    const c = topologyCost(topo([serverlessNode('fn')], WORKLOAD_1K), run)
    const item = c.items.find((i) => i.id === 'fn')!
    expect(item.isEstimate).toBe(true) // no measured throughput for 'fn' → estimate
    expect(item.costPerHour).toBeCloseTo(0.72)
  })
})

describe('formatCostPerHour', () => {
  it('formats to 4 dp with a /hr suffix', () => {
    expect(formatCostPerHour(0.51)).toBe('$0.5100/hr')
  })
})

describe('topologyResources', () => {
  it('sums vCPU and RAM across instance-backed nodes', () => {
    // c5.2xlarge = 8 vCPU / 16 GB × 2 = 16 / 32; m5.large = 2 / 8 × 1
    const c = topologyResources(
      topo([
        node('a', { instanceType: 'c5.2xlarge', instanceCount: 2 }),
        node('b', { instanceType: 'm5.large', instanceCount: 1 })
      ])
    )
    expect(c.totalVcpu).toBe(18)
    expect(c.totalRamGb).toBe(40)
  })

  it('ignores nodes with no instance', () => {
    expect(topologyResources(topo([node('a'), sourceNode('s')]))).toEqual({
      totalVcpu: 0,
      totalRamGb: 0
    })
  })
})

describe('evaluateBudgets', () => {
  const t = topo([node('a', { instanceType: 'c5.large', instanceCount: 2 })]) // 4 vCPU/8GB, $0.17

  it('returns no dimensions when no caps are set (unbounded)', () => {
    const e = evaluateBudgets(t, {})
    expect(e.vcpu).toBeUndefined()
    expect(e.cost).toBeUndefined()
    expect(e.allWithin).toBe(true)
  })

  it('flags a quota breach independently of cost', () => {
    const e = evaluateBudgets(t, { resourceBudget: { totalVcpu: 2, totalRamGb: 64 } })
    expect(e.vcpu!.used).toBe(4)
    expect(e.vcpu!.within).toBe(false) // 4 > 2
    expect(e.ramGb!.within).toBe(true) // 8 <= 64
    expect(e.allWithin).toBe(false)
  })

  it('flags a cost breach independently of quota', () => {
    // cost 2 × $0.085 = $0.17; cap $0.10 → over
    const e = evaluateBudgets(t, { costBudget: { maxPerHour: 0.1 } })
    expect(e.cost!.used).toBeCloseTo(0.17)
    expect(e.cost!.within).toBe(false)
    expect(e.allWithin).toBe(false)
  })

  it('passes when within both caps', () => {
    const e = evaluateBudgets(t, {
      resourceBudget: { totalVcpu: 8, totalRamGb: 16 },
      costBudget: { maxPerHour: 1 }
    })
    expect(e.allWithin).toBe(true)
  })
})
