import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PALETTE_TEMPLATES } from '../catalog/paletteTemplates'
import {
  AUTHORING_COMPONENT_CAPABILITIES,
  AUTHORING_OBLIGATION_CAPABILITIES,
  INVARIANT_RUBRIC_METRICS,
  RUBRIC_METRIC_CAPABILITIES,
  SEMANTIC_AUTHORING_CAPABILITIES,
  SIMULATION_RUBRIC_METRICS,
  STRUCTURAL_AUTHORING_CAPABILITIES
} from './authoringCapabilities'
import { parseQuestionPackage } from './question'

function canonicalPackages() {
  const root = resolve(process.cwd(), 'ns-simulator-docs/examples/question-bank')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      parseQuestionPackage(
        JSON.parse(readFileSync(join(root, entry.name, 'question.json'), 'utf8')) as unknown
      )
    )
}

describe('engine-owned authoring capability registry', () => {
  it('contains each typed structural and semantic discriminator exactly once', () => {
    expect(STRUCTURAL_AUTHORING_CAPABILITIES.map((capability) => capability.id)).toEqual([
      'requires_component',
      'requires_category',
      'requires_edge',
      'max_component_count',
      'requires_redundancy',
      'forbids_component',
      'requires_connected_graph',
      'requires_single_source',
      'min_node_count',
      'max_node_count',
      'requires_path'
    ])
    expect(SEMANTIC_AUTHORING_CAPABILITIES.map((capability) => capability.id)).toEqual([
      'componentPresence',
      'componentProperty',
      'placement',
      'guardedPath',
      'fanout',
      'storageFit',
      'forbidUnjustified',
      'stateTransition',
      'stateSequence'
    ])
    expect(new Set(AUTHORING_OBLIGATION_CAPABILITIES.map((item) => item.id)).size).toBe(
      AUTHORING_OBLIGATION_CAPABILITIES.length
    )
  })

  it('is the metric source used for known simulation and invariant selectors', () => {
    const registered = new Set(RUBRIC_METRIC_CAPABILITIES.map((capability) => capability.id))
    for (const metric of SIMULATION_RUBRIC_METRICS) expect(registered.has(metric)).toBe(true)
    for (const metric of INVARIANT_RUBRIC_METRICS) expect(registered.has(metric)).toBe(true)
  })

  it('derives component selectors and support tiers from the palette and support ledger', () => {
    const paletteTypes = new Set(
      Object.values(PALETTE_TEMPLATES)
        .map((template) => template.componentType)
        .filter((componentType) => componentType !== undefined)
    )
    const registeredTypes = new Set(AUTHORING_COMPONENT_CAPABILITIES.map((item) => item.id))

    expect(registeredTypes).toEqual(paletteTypes)
    expect(
      AUTHORING_COMPONENT_CAPABILITIES.every(
        (item) => item.supportTier.length > 0 && item.supportSummary.length > 0
      )
    ).toBe(true)
  })

  it('covers every obligation and rubric metric currently used by the canonical bank', () => {
    const obligations = new Set(AUTHORING_OBLIGATION_CAPABILITIES.map((item) => item.id))
    const metrics = new Set(RUBRIC_METRIC_CAPABILITIES.map((item) => item.id))

    for (const question of canonicalPackages()) {
      for (const rule of question.structuralRules ?? []) {
        expect(obligations.has(rule.kind), `${question.id}: ${rule.kind}`).toBe(true)
      }
      for (const criterion of question.semanticCriteria ?? []) {
        expect(obligations.has(criterion.kind), `${question.id}: ${criterion.kind}`).toBe(true)
      }
      for (const check of question.rubric.checks) {
        expect(metrics.has(check.metric), `${question.id}: ${check.metric}`).toBe(true)
      }
    }
  })
})
