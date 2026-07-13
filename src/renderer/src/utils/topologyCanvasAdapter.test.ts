import { describe, expect, it } from 'vitest'
import { CURATED_SCENARIOS } from '../../../scenarios/curatedScenarios'
import { isTopologyJsonLike, topologyToCanvasFileData } from './topologyCanvasAdapter'

describe('topologyCanvasAdapter', () => {
  it('recognizes topology-json shaped inputs', () => {
    expect(isTopologyJsonLike(CURATED_SCENARIOS[0].topology)).toBe(true)
    expect(isTopologyJsonLike({ nodes: [], edges: [] })).toBe(false)
  })

  it('converts a curated topology into canvas file data', () => {
    const topology = CURATED_SCENARIOS.find((scenario) => scenario.id === 'serverless-cold-start')!
      .topology
    const canvas = topologyToCanvasFileData(topology)

    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.scenario).toMatchObject({
      selectedSourceNodeId: 'client',
      global: {
        simulationDuration: topology.global.simulationDuration,
        warmupDuration: topology.global.warmupDuration,
        seed: topology.global.seed
      }
    })

    const lambda = canvas.nodes.find((node) => node.id === 'lambda')
    expect(lambda?.data).toMatchObject({
      componentType: 'serverless-function',
      label: 'Checkout Function',
      sim: expect.objectContaining({
        maxConcurrency: 2,
        idleTimeoutMs: 4_000
      })
    })
  })
})
