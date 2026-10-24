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

  it('reports any changed node setting as an edit, so old results are not shown as current', () => {
    const node = (instanceCount: number, nodeErrorRate = 0) => ({
      id: 'api',
      data: { sim: { resources: { instanceCount }, nodeErrorRate } }
    })
    const before = [{ id: 'client' }, node(1), { id: 'db' }]
    const run = snapshotRunGraph(before, edges)
    expect(compareRunGraph(run, before, edges)).toBe('same')
    expect(compareRunGraph(run, [{ id: 'client' }, node(4), { id: 'db' }], edges)).toBe('edited')
    expect(compareRunGraph(run, [{ id: 'client' }, node(1, 1), { id: 'db' }], edges)).toBe('edited')
    // A new object with the same settings is not an edit.
    expect(compareRunGraph(run, [{ id: 'client' }, node(1), { id: 'db' }], edges)).toBe('same')
  })

  it('ignores a node moving around the canvas', () => {
    const data = { sim: { resources: { instanceCount: 2 } } }
    const run = snapshotRunGraph([{ id: 'api', data }], [])
    expect(compareRunGraph(run, [{ id: 'api', data, position: { x: 9, y: 9 } } as never], [])).toBe(
      'same'
    )
  })

  it('reports a changed workload or failure injection as an edit', () => {
    const scenario = { workloadOverride: { baseRps: 180 }, faults: [] }
    const run = snapshotRunGraph(nodes, edges, scenario)
    expect(compareRunGraph(run, nodes, edges, { ...scenario })).toBe('same')
    expect(
      compareRunGraph(run, nodes, edges, { workloadOverride: { baseRps: 300 }, faults: [] })
    ).toBe('edited')
    expect(compareRunGraph(run, nodes, edges, { ...scenario, faults: [{ targetId: 'api' }] })).toBe(
      'edited'
    )
  })

  it('reports a changed link setting as an edit, but not a purely visual change', () => {
    const link = (data: Record<string, unknown>) => [{ source: 'client', target: 'api', data }]
    const run = snapshotRunGraph(nodes, link({ protocol: 'https', errorRate: 0 }))
    expect(compareRunGraph(run, nodes, link({ protocol: 'https', errorRate: 0 }))).toBe('same')
    expect(compareRunGraph(run, nodes, link({ protocol: 'grpc', errorRate: 0 }))).toBe('edited')
    expect(compareRunGraph(run, nodes, link({ protocol: 'https', errorRate: 0.2 }))).toBe('edited')
    // Auto layout routes and display-only styling do not change what a run does.
    expect(
      compareRunGraph(
        run,
        nodes,
        link({
          protocol: 'https',
          errorRate: 0,
          layoutRoute: { points: [1, 2] },
          routingStyle: 'step',
          displayProtocol: 'grpc'
        })
      )
    ).toBe('same')
  })
})
