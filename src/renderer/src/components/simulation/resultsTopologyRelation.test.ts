import { describe, expect, it } from 'vitest'
import { compareRunGraph, snapshotRunGraph } from './resultsTopologyRelation'

const nodes = [{ id: 'client' }, { id: 'api' }, { id: 'db' }]
const edges = [
  { source: 'client', target: 'api' },
  { source: 'api', target: 'db' }
]

describe('compareRunGraph', () => {
  const run = snapshotRunGraph(nodes, edges)

  it('is the same graph regardless of order', () => {
    expect(compareRunGraph(run, [...nodes].reverse(), [...edges].reverse())).toBe('same')
  })

  it('reports an empty canvas', () => {
    expect(compareRunGraph(run, [], [])).toBe('empty')
  })

  it('reports a replaced graph when no run node is left', () => {
    expect(compareRunGraph(run, [{ id: 'web' }], [])).toBe('replaced')
  })

  it('reports edits to nodes or connections', () => {
    expect(compareRunGraph(run, nodes.slice(0, 2), edges.slice(0, 1))).toBe('edited')
    expect(compareRunGraph(run, nodes, [...edges, { source: 'client', target: 'db' }])).toBe(
      'edited'
    )
  })

  it('reports a changed failure setting as an edit, so old results are not shown as current', () => {
    const healthy = [
      { id: 'client' },
      { id: 'api', data: { sim: { nodeErrorRate: 0 } } },
      { id: 'db' }
    ]
    const downed = [
      { id: 'client' },
      { id: 'api', data: { sim: { nodeErrorRate: 1 } } },
      { id: 'db' }
    ]
    const healthyRun = snapshotRunGraph(healthy, edges)
    expect(compareRunGraph(healthyRun, healthy, edges)).toBe('same')
    expect(compareRunGraph(healthyRun, downed, edges)).toBe('edited')
    const downedRun = snapshotRunGraph(downed, edges)
    expect(compareRunGraph(downedRun, healthy, edges)).toBe('edited')
    expect(compareRunGraph(downedRun, downed, edges)).toBe('same')
  })
})
