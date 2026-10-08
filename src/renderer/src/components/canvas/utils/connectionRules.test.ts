import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { instantiateTemplate } from '../../../../../engine/catalog/paletteTemplates'
import { checkCanvasConnection, reconnectCanvasEdge } from './connectionRules'

function component(id: string, templateId: string, type = 'serviceNode'): Node {
  return { id, type, position: { x: 0, y: 0 }, data: instantiateTemplate(templateId) }
}

const nodes: Node[] = [
  component('client', 'client-user'),
  component('api', 'backend-server', 'computeNode'),
  component('worker', 'backend-server', 'computeNode'),
  component('db', 'primary-db'),
  component('sink', 'output-sink'),
  { id: 'region', type: 'vpcNode', position: { x: 0, y: 0 }, data: { templateId: 'vpc-region' } },
  { id: 'note', type: 'textLabelNode', position: { x: 0, y: 0 }, data: { text: 'Label' } }
]

const edges: Edge[] = [
  { id: 'e-client-api', source: 'client', target: 'api' },
  {
    id: 'e-api-db',
    source: 'api',
    target: 'db',
    sourceHandle: 'right-1-source',
    targetHandle: 'left-1-target',
    label: 'reads',
    data: { protocol: 'tcp', mode: 'synchronous', latencyValue: 7, bandwidth: 500 }
  },
  { id: 'e-api-worker', source: 'api', target: 'worker' }
]

describe('checkCanvasConnection', () => {
  it('accepts an ordinary downstream connection', () => {
    expect(
      checkCanvasConnection({ connection: { source: 'worker', target: 'db' }, nodes, edges })
    ).toEqual({ valid: true, warnings: [] })
  })

  it('refuses self-loops', () => {
    const check = checkCanvasConnection({
      connection: { source: 'api', target: 'api' },
      nodes,
      edges
    })
    expect(check.valid).toBe(false)
    expect(check.error).toMatch(/same component/)
  })

  it('refuses traffic into a source and out of a sink', () => {
    const intoSource = checkCanvasConnection({
      connection: { source: 'api', target: 'client' },
      nodes,
      edges
    })
    expect(intoSource.valid).toBe(false)
    expect(intoSource.error).toMatch(/source/)

    const outOfSink = checkCanvasConnection({
      connection: { source: 'sink', target: 'db' },
      nodes,
      edges
    })
    expect(outOfSink.valid).toBe(false)
    expect(outOfSink.error).toMatch(/only receives traffic/)
  })

  it('refuses containers, labels, and missing components', () => {
    for (const connection of [
      { source: 'api', target: 'region' },
      { source: 'note', target: 'db' },
      { source: 'api', target: 'ghost' },
      { source: 'api', target: null }
    ]) {
      expect(checkCanvasConnection({ connection, nodes, edges }).valid).toBe(false)
    }
  })

  it('refuses a second connection between the same pair unless it is the edge being moved', () => {
    expect(
      checkCanvasConnection({ connection: { source: 'api', target: 'db' }, nodes, edges }).valid
    ).toBe(false)
    expect(
      checkCanvasConnection({
        connection: { source: 'api', target: 'db' },
        nodes,
        edges,
        ignoreEdgeId: 'e-api-db'
      }).valid
    ).toBe(true)
  })

  it('warns, without refusing, when carried settings do not fit the new pair', () => {
    const check = checkCanvasConnection({
      connection: { source: 'worker', target: 'db' },
      nodes,
      edges,
      carriedData: { protocol: 'https', mode: 'synchronous' }
    })
    expect(check.valid).toBe(true)
    expect(check.warnings).toEqual([
      'Kept HTTPS from the original connection. Datastores and caches speak TCP wire protocols, not HTTP, Kafka, or AMQP.'
    ])
  })
})

describe('reconnectCanvasEdge', () => {
  it('moves the end and keeps id, order, label, and settings', () => {
    const result = reconnectCanvasEdge(
      edges[1],
      {
        source: 'api',
        target: 'sink',
        sourceHandle: 'right-1-source',
        targetHandle: 'top-0-target'
      },
      nodes,
      edges
    )
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    expect(result.edges.map((edge) => edge.id)).toEqual([
      'e-client-api',
      'e-api-db',
      'e-api-worker'
    ])
    expect(result.edges[1]).toMatchObject({
      id: 'e-api-db',
      source: 'api',
      target: 'sink',
      targetHandle: 'top-0-target',
      label: 'reads',
      data: { protocol: 'tcp', mode: 'synchronous', latencyValue: 7, bandwidth: 500 }
    })
  })

  it('can move the source end', () => {
    const result = reconnectCanvasEdge(
      edges[1],
      {
        source: 'worker',
        target: 'db',
        sourceHandle: 'right-1-source',
        targetHandle: 'left-1-target'
      },
      nodes,
      edges
    )
    expect(result.ok && result.edges[1].source).toBe('worker')
  })

  it('refuses invalid targets and leaves the edges untouched', () => {
    const result = reconnectCanvasEdge(
      edges[1],
      { source: 'api', target: 'api', sourceHandle: null, targetHandle: null },
      nodes,
      edges
    )
    expect(result.ok).toBe(false)

    const duplicate = reconnectCanvasEdge(
      edges[1],
      { source: 'api', target: 'worker', sourceHandle: null, targetHandle: null },
      nodes,
      edges
    )
    expect(duplicate.ok).toBe(false)
  })

  it('treats dropping back on the same handles as a no-op', () => {
    const result = reconnectCanvasEdge(
      edges[1],
      {
        source: 'api',
        target: 'db',
        sourceHandle: 'right-1-source',
        targetHandle: 'left-1-target'
      },
      nodes,
      edges
    )
    expect(result).toEqual({ ok: true, edges, warnings: [] })
  })
})
