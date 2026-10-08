import { describe, expect, it } from 'vitest'
import type { Edge } from 'reactflow'
import type { TopologyJSON } from '../../../engine/core/types'
import { migrateCanvasNodes } from '../../../engine/catalog/legacyCanvasMigration'
import { normalizeScenarioState } from '@renderer/types/ui'
import { serializeCanvasToTopology } from './canvasTopologySerializer'
import { convertNestedToFlat, type NestedFileData } from './nodeTransformers'
import { deserializeTopology, isImportFailure } from './topologyDeserializer'

/**
 * TopologyJSON is the canonical view of the canvas (#86): every sample canvas
 * and every question-bank topology must survive export -> import -> export
 * byte-for-byte, and importing an authored TopologyJSON must not lose or change
 * anything it set (the canvas may only fill in defaults it leaves out).
 */

const SAMPLE_CANVASES = import.meta.glob('../../../engine/__samples__/*.json', {
  eager: true,
  import: 'default'
}) as Record<string, NestedFileData>

const QUESTION_BANK_TOPOLOGIES = import.meta.glob(
  '../../../../ns-simulator-docs/examples/question-bank/*/*-topology.json',
  { eager: true, import: 'default' }
) as Record<string, TopologyJSON>

const QUESTION_SCAFFOLDS = Object.entries({
  ...import.meta.glob('../../../../ns-simulator-docs/examples/question-bank/*/question.json', {
    eager: true,
    import: 'default'
  }),
  ...import.meta.glob('../../../engine/analysis/fixtures/*.question.json', {
    eager: true,
    import: 'default'
  })
} as Record<string, { scaffold?: { topology?: TopologyJSON } }>).flatMap(([path, question]) =>
  question.scaffold?.topology ? [[`${path} scaffold`, question.scaffold.topology] as const] : []
)

function shortName(path: string): string {
  return path.split('/').slice(-2).join('/')
}

/** What the app does on load: nested canvas file -> flat, migrated store nodes. */
function exportCanvas(canvas: NestedFileData): TopologyJSON {
  const result = serializeCanvasToTopology({
    nodes: migrateCanvasNodes(convertNestedToFlat(structuredClone(canvas.nodes))),
    edges: structuredClone(canvas.edges ?? []) as Edge[],
    scenario: normalizeScenarioState(canvas.scenario)
  })
  expect(result.errors).toEqual([])
  expect(result.topology).not.toBeNull()
  return result.topology as TopologyJSON
}

function importTopology(topology: unknown): NestedFileData {
  const result = deserializeTopology(topology)
  if (isImportFailure(result)) {
    throw new Error(result.errors.map((error) => error.message).join('\n'))
  }
  return result.canvas
}

/** Node and edge order follows the canvas tree, which is not semantic. */
function byId(topology: TopologyJSON): TopologyJSON {
  return {
    ...topology,
    nodes: [...topology.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...topology.edges].sort((a, b) => a.id.localeCompare(b.id)),
    ...(topology.locations
      ? { locations: [...topology.locations].sort((a, b) => a.id.localeCompare(b.id)) }
      : {})
  }
}

/**
 * Every value `authored` sets, present and equal in `exported`. Equivalent
 * spellings are accepted: an empty list is the same as no list, and an unset
 * `derivedFromPathType` is the same as `false`.
 */
function missingOrChanged(authored: unknown, exported: unknown, path = ''): string[] {
  if (Array.isArray(authored)) {
    if (authored.length === 0 && (exported === undefined || Array.isArray(exported))) {
      return Array.isArray(exported) && exported.length > 0 ? [`${path}: [] became non-empty`] : []
    }
    if (!Array.isArray(exported) || exported.length !== authored.length) {
      return [`${path}: ${JSON.stringify(authored)} -> ${JSON.stringify(exported)}`]
    }
    return authored.flatMap((item, index) =>
      missingOrChanged(item, exported[index], `${path}[${index}]`)
    )
  }
  if (typeof authored === 'object' && authored !== null) {
    if (typeof exported !== 'object' || exported === null) {
      return [`${path}: ${JSON.stringify(authored)} -> ${JSON.stringify(exported)}`]
    }
    return Object.entries(authored).flatMap(([key, value]) => {
      const next = (exported as Record<string, unknown>)[key]
      if (key === 'derivedFromPathType' && !value && !next) return []
      if (value === undefined) return []
      return missingOrChanged(value, next, `${path}.${key}`)
    })
  }
  return Object.is(authored, exported)
    ? []
    : [`${path}: ${JSON.stringify(authored)} -> ${JSON.stringify(exported)}`]
}

describe('TopologyJSON round-trip: sample canvases', () => {
  const samples = Object.entries(SAMPLE_CANVASES)

  it('covers every engine sample', () => {
    expect(samples.length).toBeGreaterThanOrEqual(19)
  })

  it.each(samples.map(([path, canvas]) => [shortName(path), canvas] as const))(
    '%s: export -> import -> export is identical',
    (_name, canvas) => {
      const first = exportCanvas(canvas)
      const second = exportCanvas(importTopology(first))
      const third = exportCanvas(importTopology(second))
      expect(byId(second)).toEqual(byId(first))
      expect(byId(third)).toEqual(byId(second))
    }
  )
})

describe('TopologyJSON round-trip: question-bank topologies', () => {
  const topologies = [
    ...Object.entries(QUESTION_BANK_TOPOLOGIES).map(
      ([path, topology]) => [shortName(path), topology] as const
    ),
    ...QUESTION_SCAFFOLDS.map(([path, topology]) => [shortName(path), topology] as const)
  ]

  it('covers the question bank', () => {
    expect(topologies.length).toBeGreaterThanOrEqual(28)
  })

  it.each(topologies)('%s: import -> export keeps every authored engine field', (_n, authored) => {
    const parsed = deserializeTopology(structuredClone(authored))
    if (isImportFailure(parsed)) throw new Error(JSON.stringify(parsed.errors))
    const exported = exportCanvas(parsed.canvas)
    expect(missingOrChanged(byId(parsed.topology), byId(exported))).toEqual([])
  })

  it.each(topologies)('%s: export -> import -> export is identical', (_name, authored) => {
    const first = exportCanvas(importTopology(structuredClone(authored)))
    const second = exportCanvas(importTopology(first))
    expect(byId(second)).toEqual(byId(first))
  })
})
