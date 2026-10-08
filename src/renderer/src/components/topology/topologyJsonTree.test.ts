import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { TopologyJSON } from '../../../../engine/core/types'
import { normalizeScenarioState } from '@renderer/types/ui'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'
import { convertNestedToFlat } from '@renderer/utils/nodeTransformers'
import { deserializeTopology, isImportFailure } from '@renderer/utils/topologyDeserializer'
import {
  buildTopologyTree,
  collectBranchKeys,
  filterTopologyTree,
  getAtPath,
  isEditFailure,
  leafEditor,
  planTopologyEdit,
  type CanvasSnapshot,
  type TreeEntry
} from './topologyJsonTree'

function edge(id: string, source: string, target: string): TopologyJSON['edges'][number] {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 1000,
    packetLossRate: 0,
    errorRate: 0
  }
}

const TOPOLOGY: TopologyJSON = {
  id: 'shop',
  name: 'Shop',
  version: '2.1.0',
  global: {
    simulationDuration: 10_000,
    warmupDuration: 1_000,
    seed: 'seed',
    defaultTimeout: 5_000,
    timeResolution: 'millisecond'
  },
  nodes: [
    {
      id: 'client',
      type: 'api-endpoint',
      category: 'compute',
      label: 'Client',
      position: { x: 0, y: 0 }
    },
    {
      id: 'api',
      type: 'microservice',
      category: 'compute',
      label: 'API',
      position: { x: 300, y: 0 },
      queue: { workers: 8, capacity: 100, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 }
    }
  ],
  edges: [edge('client-api', 'client', 'api')],
  workload: {
    sourceNodeId: 'client',
    pattern: 'constant',
    baseRps: 50,
    requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 512 }]
  },
  faults: [
    {
      targetId: 'api',
      faultType: 'node-failure',
      timing: 'deterministic',
      duration: 'fixed',
      params: { startTime: 2_000, durationMs: 1_000 }
    }
  ]
}

function snapshotFor(topology: TopologyJSON): CanvasSnapshot {
  const result = deserializeTopology(topology)
  if (isImportFailure(result)) throw new Error(JSON.stringify(result.errors))
  return {
    nodes: convertNestedToFlat(result.canvas.nodes),
    edges: result.canvas.edges,
    scenario: normalizeScenarioState(result.canvas.scenario)
  }
}

function exported(snapshot: CanvasSnapshot): TopologyJSON {
  return serializeCanvasToTopology(snapshot, { lenient: true }).topology as TopologyJSON
}

/** Applies a successful plan the way the viewer does (store merge semantics). */
function apply(
  snapshot: CanvasSnapshot,
  path: (string | number)[],
  value: unknown
): CanvasSnapshot {
  const plan = planTopologyEdit(snapshot, exported(snapshot), path, value)
  if (isEditFailure(plan)) throw new Error(plan.message)
  const nodes: Node[] = snapshot.nodes.map((node) =>
    plan.nodePatch && node.id === plan.nodePatch.nodeId
      ? { ...node, data: { ...node.data, ...plan.nodePatch.patch } }
      : node
  )
  const edges: Edge[] = snapshot.edges.map((candidate) =>
    plan.edgePatch && candidate.id === plan.edgePatch.edgeId
      ? {
          ...candidate,
          ...(plan.edgePatch.label !== undefined ? { label: plan.edgePatch.label } : {}),
          data: { ...(candidate.data ?? {}), ...(plan.edgePatch.data ?? {}) }
        }
      : candidate
  )
  return { nodes, edges, scenario: plan.scenario ?? snapshot.scenario }
}

function find(entries: TreeEntry[], key: string): TreeEntry | undefined {
  for (const entry of entries) {
    if (entry.key === key) return entry
    const nested = find(entry.children ?? [], key)
    if (nested) return nested
  }
  return undefined
}

describe('buildTopologyTree', () => {
  const tree = buildTopologyTree(exported(snapshotFor(TOPOLOGY)))

  it('lists the root sections with item counts', () => {
    expect(tree.map((entry) => entry.label)).toEqual([
      'name',
      'id',
      'version',
      'nodes',
      'edges',
      'workload',
      'faults',
      'global'
    ])
    expect(find(tree, 'nodes')?.badge).toBe(2)
    expect(find(tree, 'edges')?.badge).toBe(1)
    expect(find(tree, 'faults')?.badge).toBe(1)
  })

  it('names components and connections and links them to the canvas', () => {
    const api = find(tree, 'nodes.1')
    expect(api?.label).toBe('API')
    expect(api?.ref).toEqual({ kind: 'node', id: 'api' })
    expect(find(tree, 'edges.0')?.label).toBe('Client -> API')
    expect(find(tree, 'edges.0')?.ref).toEqual({ kind: 'edge', id: 'client-api' })
    expect(find(tree, 'nodes.1.queue.workers')?.value).toBe(8)
  })

  it('filters to matching paths and keeps their ancestors expanded', () => {
    const filtered = filterTopologyTree(tree, 'workers')
    expect(filtered.map((entry) => entry.key)).toEqual(['nodes'])
    expect(find(filtered, 'nodes.1.queue.workers')).toBeDefined()
    expect(find(filtered, 'nodes.1.processing')).toBeUndefined()
    expect(collectBranchKeys(filtered)).toEqual(
      expect.arrayContaining(['nodes', 'nodes.1', 'nodes.1.queue'])
    )
    // A matching component keeps all of its fields.
    expect(find(filterTopologyTree(tree, 'api'), 'nodes.1.processing')).toBeDefined()
    expect(filterTopologyTree(tree, 'zzz-nothing')).toEqual([])
  })
})

describe('leafEditor', () => {
  it('chooses an input by value type and dropdowns for enum fields', () => {
    expect(leafEditor(['nodes', 1, 'queue', 'workers'], 8)).toEqual({ kind: 'number' })
    expect(leafEditor(['nodes', 1, 'label'], 'API')).toEqual({ kind: 'text' })
    expect(leafEditor(['edges', 0, 'protocol'], 'https')).toMatchObject({ kind: 'enum' })
    expect(leafEditor(['nodes', 1, 'queue', 'discipline'], 'fifo')).toMatchObject({ kind: 'enum' })
    expect(leafEditor(['nodes', 1, 'config', 'healthCheckEnabled'], true)).toEqual({
      kind: 'boolean'
    })
  })

  it('keeps identity and layout fields read-only', () => {
    expect(leafEditor(['nodes', 1, 'id'], 'api').kind).toBe('readonly')
    expect(leafEditor(['nodes', 1, 'type'], 'microservice').kind).toBe('readonly')
    expect(leafEditor(['edges', 0, 'source'], 'client').kind).toBe('readonly')
    expect(leafEditor(['nodes', 1, 'position', 'x'], 300).kind).toBe('readonly')
    expect(leafEditor(['nodes', 1, 'processing', 'distribution', 'type'], 'constant').kind).toBe(
      'readonly'
    )
  })
})

describe('planTopologyEdit', () => {
  const base = snapshotFor(TOPOLOGY)

  it.each([
    [['nodes', 1, 'label'], 'Orders API'],
    [['nodes', 1, 'processing', 'timeout'], 750],
    [['edges', 0, 'protocol'], 'grpc'],
    [['edges', 0, 'bandwidth'], 250],
    [['edges', 0, 'errorRate'], 0.05],
    [['workload', 'baseRps'], 120],
    [['global', 'seed'], 'another-seed'],
    [['global', 'timeResolution'], 'microsecond'],
    [['faults', 0, 'params', 'startTime'], 3_000],
    [['name'], 'Shop v2']
  ] as const)('%j = %j reaches the canvas and exports back', (path, value) => {
    const next = apply(base, [...path], value)
    expect(getAtPath(exported(next), path)).toBe(value)
  })

  it('refuses derived concurrency fields on an instance-model node', () => {
    // The canvas puts every node on the instance model, so declared workers and
    // queue capacity are derived from the hardware and an edit would do nothing.
    const topology = exported(base)
    for (const field of ['workers', 'capacity'] as const) {
      const path = ['nodes', 1, 'queue', field]
      const result = planTopologyEdit(base, topology, path, 16)
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.message).toMatch(/Derived from the instance/)
      const leaf = find(buildTopologyTree(topology), path.join('.'))
      expect(leafEditor(leaf!.path, leaf!.value, leaf!.readOnlyReason).kind).toBe('readonly')
    }
  })

  it('changes only the edited field', () => {
    const before = exported(base)
    const after = exported(apply(base, ['nodes', 1, 'processing', 'timeout'], 750))
    expect({ ...after.nodes[1], processing: undefined }).toEqual({
      ...before.nodes[1],
      processing: undefined
    })
    expect(after.nodes[1]?.processing).toEqual({ ...before.nodes[1]?.processing, timeout: 750 })
    expect(after.edges).toEqual(before.edges)
    expect(after.workload).toEqual(before.workload)
  })

  it('refuses an edit the canvas cannot represent instead of applying something else', () => {
    const plan = planTopologyEdit(base, exported(base), ['nodes', 0, 'config', 'sourceOnly'], false)
    expect(isEditFailure(plan) && plan.message).toMatch(/cannot be edited here/)
  })

  it('edits a run-settings workload override when one is set', () => {
    const overridden: CanvasSnapshot = {
      ...base,
      scenario: { ...base.scenario, workloadOverride: { baseRps: 80 } }
    }
    const plan = planTopologyEdit(overridden, exported(overridden), ['workload', 'baseRps'], 90)
    if (isEditFailure(plan)) throw new Error(plan.message)
    expect(plan.scenario?.workloadOverride).toEqual({ baseRps: 90 })
    expect(plan.nodePatch).toBeUndefined()
  })
})
