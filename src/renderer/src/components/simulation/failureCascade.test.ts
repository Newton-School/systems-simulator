import { describe, expect, it } from 'vitest'
import type { CausalGraph } from '../../../../engine/analysis/output'
import { buildCascadeTrees, cascadeEffectLabel } from './failureCascade'

const graph: CausalGraph = {
  rootCauses: [
    { nodeId: 'queue', event: 'blackhole', time: 30 },
    { nodeId: 'db', event: 'hang', time: 10 }
  ],
  propagation: [
    { from: 'api', to: 'gw', effect: 'queue_saturation', time: 25 },
    { from: 'db', to: 'api', effect: 'timeout_cascade', time: 20 },
    { from: 'queue', to: 'worker', effect: 'timeout_cascade', time: 40 }
  ],
  impactSummary: { totalNodesAffected: 5, cascadeDepth: 2, timeToFullCascade: 30 },
  nodes: [
    {
      nodeId: 'db',
      severity: 'failed',
      firstAffectedMs: 10,
      faultMode: 'hang',
      rejected: 0,
      timedOut: 4,
      circuitOpens: 0,
      dominantReason: null
    }
  ]
}

describe('buildCascadeTrees', () => {
  it('renders one tree per root cause, earliest first, depth-first', () => {
    const trees = buildCascadeTrees(graph)
    expect(trees.map((tree) => tree.rootNodeId)).toEqual(['db', 'queue'])
    expect(trees[0].rows.map((row) => [row.nodeId, row.fromNodeId, row.depth, row.timeMs])).toEqual(
      [
        ['db', null, 0, 10],
        ['api', 'db', 1, 20],
        ['gw', 'api', 2, 25]
      ]
    )
    expect(trees[0].rows[0].detail?.timedOut).toBe(4)
    expect(trees[0].rows[0].severity).toBe('failed')
    expect(trees[0].rows[1].severity).toBe('degraded')
    expect(trees[1].rows.map((row) => row.nodeId)).toEqual(['queue', 'worker'])
  })

  it('returns no trees for an empty graph', () => {
    expect(
      buildCascadeTrees({
        rootCauses: [],
        propagation: [],
        impactSummary: { totalNodesAffected: 0, cascadeDepth: 0, timeToFullCascade: 0 }
      })
    ).toEqual([])
  })
})

describe('cascadeEffectLabel', () => {
  it('uses plain language for faults and effects', () => {
    expect(cascadeEffectLabel('hang')).toBe('fault: hung (accepts, never answers)')
    expect(cascadeEffectLabel('timeout_cascade')).toBe('timeouts')
    expect(cascadeEffectLabel('rate_limited')).toBe('rate limited')
  })
})
