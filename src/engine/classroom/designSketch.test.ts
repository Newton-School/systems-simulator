import { describe, expect, it } from 'vitest'
import { classroomSketchToTopology } from './designSketch'

describe('classroomSketchToTopology', () => {
  it('builds deterministic lecture and probe topologies from Classroom terms', () => {
    const topology = classroomSketchToTopology(
      {
        nodes: [
          { ref: 'u', component: 'api-endpoint' },
          { ref: 'lb', component: 'load-balancer' },
          { ref: 's', component: 'microservice', copies: 13 }
        ],
        edges: [
          ['u', 'lb'],
          ['lb', 's']
        ]
      },
      1_000_000,
      'step-13'
    )
    expect(topology.workload).toMatchObject({ sourceNodeId: 'u', baseRps: 1_000_000 })
    expect(topology.nodes.find((node) => node.id === 's')?.resources?.instanceCount).toBe(13)
    expect(topology.edges).toHaveLength(2)
  })
})
