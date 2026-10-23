import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from '../../../engine/core/types'
import { runSimulation } from '../../../engine/runSimulation'
import { resolveCapacityModel } from '../../../engine/catalog/capacityModel'
import { normalizeScenarioState } from '@renderer/types/ui'
import { serializeCanvasToTopology } from './canvasTopologySerializer'
import { convertNestedToFlat } from './nodeTransformers'
import { deserializeTopology, isImportFailure } from './topologyDeserializer'

/**
 * The same file must give the same answer wherever it runs. "Directly" is what the CLI, the grader
 * and `runSimulation` do with the document. "Through the canvas" is what the UI does: import it,
 * export it, run the export. Before capacity had a single owner (catalog/capacityModel.ts) a document
 * that sized a node with a raw queue ran with 1 worker directly and 64 through the canvas.
 *
 * Documents deliberately omit fields: authored queue only, instance only, and neither.
 */

type NodeSpec = { queue?: { workers: number; capacity: number }; resources?: object }

function doc(srv: NodeSpec, opts: { processing?: boolean } = {}): TopologyJSON {
  const node: Record<string, unknown> = {
    id: 'srv',
    type: 'microservice',
    category: 'compute',
    label: 'srv',
    position: { x: 300, y: 0 }
  }
  if (srv.queue) node.queue = { ...srv.queue, discipline: 'fifo' }
  if (srv.resources) node.resources = srv.resources
  if (opts.processing !== false) {
    node.processing = { distribution: { type: 'constant', value: 10 }, timeout: 60_000 }
  }
  return {
    id: 'parity',
    name: 'parity',
    version: '1.0.0',
    global: {
      simulationDuration: 30_000,
      seed: 'parity',
      warmupDuration: 3_000,
      timeResolution: 'microsecond',
      defaultTimeout: 60_000,
      traceSampleRate: 0
    },
    nodes: [
      {
        id: 'source',
        type: 'api-endpoint',
        category: 'compute',
        label: 'source',
        position: { x: 0, y: 0 }
      },
      node
    ],
    edges: [
      {
        id: 'e',
        source: 'source',
        target: 'srv',
        mode: 'synchronous',
        protocol: 'grpc',
        latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
        bandwidth: 1000,
        maxConcurrentRequests: 100_000,
        packetLossRate: 0,
        errorRate: 0
      }
    ],
    workload: {
      sourceNodeId: 'source',
      pattern: 'poisson',
      baseRps: 80,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
}

function throughCanvas(topology: TopologyJSON): TopologyJSON {
  const imported = deserializeTopology(structuredClone(topology))
  if (isImportFailure(imported)) throw new Error(JSON.stringify(imported.errors))
  const exported = serializeCanvasToTopology(
    {
      nodes: convertNestedToFlat(imported.canvas.nodes),
      edges: imported.canvas.edges,
      scenario: normalizeScenarioState(imported.canvas.scenario)
    },
    { lenient: true }
  )
  return exported.topology as TopologyJSON
}

function measure(topology: TopologyJSON) {
  const out = runSimulation(structuredClone(topology))
  const node = out.perNode.srv
  return {
    utilization: node.utilization,
    queueWait: node.avgQueueWait,
    throughput: out.summary.throughput
  }
}

describe('capacity model has one owner', () => {
  it('classifies what a document authored', () => {
    const base: Pick<ComponentNode, 'id'> = { id: 'x' }
    expect(resolveCapacityModel({ ...base, resources: { instanceType: 'm5.large' } })).toBe(
      'instance'
    )
    expect(
      resolveCapacityModel({ ...base, queue: { workers: 1, capacity: 5, discipline: 'fifo' } })
    ).toBe('raw-queue')
    expect(resolveCapacityModel(base)).toBe('engine-default')
    expect(resolveCapacityModel({ ...base, role: 'source' })).toBe('not-applicable')
  })
})

describe('the same file gives the same answer directly and through the canvas', () => {
  const cases: [string, TopologyJSON][] = [
    ['raw queue, 1 worker (M/D/1 at rho 0.8)', doc({ queue: { workers: 1, capacity: 100_000 } })],
    ['raw queue, 4 workers', doc({ queue: { workers: 4, capacity: 200 } })],
    ['raw queue, tiny buffer (overloaded)', doc({ queue: { workers: 1, capacity: 5 } })],
    [
      'instance model only',
      doc({ resources: { instanceType: 'm5.large', instanceCount: 1, workloadKind: 'cpu-bound' } })
    ],
    [
      'instance model with a leftover queue',
      doc({
        queue: { workers: 1, capacity: 5 },
        resources: { instanceType: 'm5.large', instanceCount: 1, workloadKind: 'cpu-bound' }
      })
    ]
  ]

  it.each(cases)('%s', (_name, topology) => {
    const direct = measure(topology)
    const canvas = measure(throughCanvas(topology))
    expect(canvas.utilization).toBeCloseTo(direct.utilization, 6)
    expect(canvas.queueWait).toBeCloseTo(direct.queueWait, 6)
    expect(canvas.throughput).toBeCloseTo(direct.throughput, 6)
  })

  it('a raw-queue node is not given an instance model it never authored', () => {
    const exported = throughCanvas(doc({ queue: { workers: 1, capacity: 100_000 } }))
    const srv = exported.nodes.find((node) => node.id === 'srv')!
    expect(srv.resources).toBeUndefined()
    expect(srv.queue?.workers).toBe(1)
  })

  // Tracked, not yet fixed: a node that authors neither a queue nor resources is sized by the engine's
  // built-in default when run directly (1 worker, 1 ms service) but by the palette template
  // (an instance plus a category service time) when imported. Fixing it needs the engine and the
  // palette to share one default profile.
  it.fails('a node with neither queue nor resources also agrees', () => {
    const topology = doc({}, { processing: false })
    const direct = measure(topology)
    const canvas = measure(throughCanvas(topology))
    expect(canvas.utilization).toBeCloseTo(direct.utilization, 6)
  })
})
