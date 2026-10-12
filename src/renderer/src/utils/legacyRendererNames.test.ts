import { beforeEach, describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { TopologyJSON } from '../../../engine/core/types'
import { migrateCanvasNodes } from '../../../engine/catalog/legacyCanvasMigration'
import { LEGACY_RENDERER_NODE_TYPES } from '../../../engine/catalog/rendererNodeTypes'
import legacyCanvas from '../../../engine/catalog/__fixtures__/legacy-renderer-names.canvas.json'
import currentCanvas from '../../../engine/__samples__/multi-az-auto-latency.json'
import legacySkillExample from '../../../../skills/simulator-question-author/examples/quickcart/quickcart-flash-sale.solution-topology.json'
import { nodeTypes } from '@renderer/components/canvas/config/flowConfig'
import useStore from '@renderer/store/useStore'
import { normalizeScenarioState } from '@renderer/types/ui'
import { serializeCanvasToTopology } from './canvasTopologySerializer'
import { convertNestedToFlat, type NestedFileData } from './nodeTransformers'
import { topologyToCanvasFileData } from './topologyCanvasAdapter'

/**
 * #219 renamed the renderer types (serviceNode -> standardNode, computeNode ->
 * saturationNode, vpcNode -> containerNode). Files saved before the rename must
 * load and render identically, and nothing renderer-free may change.
 */

const LEGACY_NAMES = new Set(Object.keys(LEGACY_RENDERER_NODE_TYPES))
const REGISTERED = new Set(Object.keys(nodeTypes))

// Question-bank topologies from the docs submodule (left untouched by #219):
// reference / solution topologies plus any non-empty scaffold.
const DOCS_TOPOLOGIES: Array<readonly [string, TopologyJSON]> = [
  ...Object.entries(
    import.meta.glob('../../../../ns-simulator-docs/examples/question-bank/*/*-topology.json', {
      eager: true,
      import: 'default'
    }) as Record<string, TopologyJSON>
  ),
  ...Object.entries(
    import.meta.glob('../../../../ns-simulator-docs/examples/question-bank/*/question.json', {
      eager: true,
      import: 'default'
    }) as Record<string, { scaffold?: { topology?: TopologyJSON } }>
  ).flatMap(([path, question]) =>
    question.scaffold?.topology ? [[`${path} scaffold`, question.scaffold.topology] as const] : []
  )
].map(([path, topology]) => [path.split('/').slice(-2).join('/'), topology] as const)

/** What the app does on file open: nested canvas -> flat, migrated store nodes. */
function load(canvas: unknown): Node[] {
  const file = structuredClone(canvas) as NestedFileData
  return migrateCanvasNodes(convertNestedToFlat(file.nodes))
}

function rawTypes(canvas: unknown): string[] {
  const walk = (nodes: Array<{ type?: string; nodes?: unknown[] }>): string[] =>
    nodes.flatMap((node) => [
      node.type ?? '',
      ...(Array.isArray(node.nodes) ? walk(node.nodes as typeof nodes) : [])
    ])
  return walk((canvas as { nodes: Array<{ type?: string }> }).nodes)
}

function expectCurrentNames(nodes: readonly Node[]): void {
  for (const node of nodes) {
    expect(LEGACY_NAMES.has(node.type ?? '')).toBe(false)
    expect(REGISTERED.has(node.type ?? '')).toBe(true)
    const rendererType = (node.data as { rendererType?: string } | undefined)?.rendererType
    if (rendererType !== undefined) expect(rendererType).toBe(node.type)
  }
}

function exportTopology(canvas: unknown): string {
  const file = structuredClone(canvas) as NestedFileData
  const result = serializeCanvasToTopology({
    nodes: load(file),
    edges: (file.edges ?? []) as Edge[],
    scenario: normalizeScenarioState(file.scenario)
  })
  expect(result.errors).toEqual([])
  return JSON.stringify(result.topology)
}

describe('legacy renderer names (#219)', () => {
  beforeEach(() => {
    useStore.getState().setGraph([], [], { history: 'skip', resetHistory: true })
  })

  it('the legacy fixture really carries the old names', () => {
    const types = new Set(rawTypes(legacyCanvas))
    expect(types.has('vpcNode')).toBe(true)
    expect(types.has('serviceNode')).toBe(true)
    expect(types.has('computeNode')).toBe(true)
  })

  it('an old-name canvas file loads to exactly the nodes of its renamed copy', () => {
    const legacy = load(legacyCanvas)
    expectCurrentNames(legacy)
    expect(legacy).toEqual(load(currentCanvas))
    expect(legacy.filter((node) => node.type === 'containerNode').map((node) => node.id)).toEqual([
      'region-east',
      'az-a',
      'subnet-a',
      'az-b',
      'subnet-b'
    ])
  })

  it('renderer names never reach TopologyJSON: old and new files export byte-identically', () => {
    expect(exportTopology(legacyCanvas)).toBe(exportTopology(currentCanvas))
  })

  it('an old-name skill example (quickcart solution) loads with current names only', () => {
    expect(rawTypes(legacySkillExample).some((type) => LEGACY_NAMES.has(type))).toBe(true)
    expectCurrentNames(load(legacySkillExample))
  })

  it('the store renames old names on every setGraph / setNodes / addNode', () => {
    const raw = convertNestedToFlat((structuredClone(legacyCanvas) as NestedFileData).nodes)
    const store = useStore.getState()

    store.setGraph(raw, [], { history: 'skip', resetHistory: true })
    expectCurrentNames(useStore.getState().nodes)

    store.setNodes(raw)
    expectCurrentNames(useStore.getState().nodes)

    store.setGraph([], [], { history: 'skip', resetHistory: true })
    store.addNode({ ...raw[0]!, id: 'added' })
    expect(useStore.getState().nodes.map((node) => node.type)).toEqual(['containerNode'])
    // Containers still get container z-ordering after the rename.
    expect(useStore.getState().nodes[0]?.zIndex).toBe(-10)
  })

  it('setGraph keeps the caller array when there is nothing to rename', () => {
    const current = load(currentCanvas)
    useStore.getState().setGraph(current, [], { history: 'skip', resetHistory: true })
    expect(useStore.getState().nodes).toBe(current)
  })

  it('finds docs question-bank topologies to open', () => {
    expect(DOCS_TOPOLOGIES.length).toBeGreaterThan(5)
  })

  it.each(DOCS_TOPOLOGIES)('docs topology %s opens with current renderer names', (_, topology) => {
    const canvas = topologyToCanvasFileData(structuredClone(topology))
    const nodes = migrateCanvasNodes(convertNestedToFlat(canvas.nodes))
    expect(nodes.length).toBeGreaterThan(0)
    expectCurrentNames(nodes)
  })
})
