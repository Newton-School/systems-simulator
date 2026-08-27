import { describe, expect, it } from 'vitest'
import { SAMPLE_BLUEPRINTS } from './sampleBlueprints'

describe('SAMPLE_BLUEPRINTS', () => {
  it('ships requirements-first blueprints with partial scaffolds and prompt briefs', () => {
    expect(SAMPLE_BLUEPRINTS).toHaveLength(3)

    for (const blueprint of SAMPLE_BLUEPRINTS) {
      expect(blueprint.question.entryFormat).toBe('requirements-first')
      expect(blueprint.question.scaffold.type).toBe('partial')
      expect(blueprint.question.prompt.functionalRequirements.length).toBeGreaterThan(0)
      expect(blueprint.question.prompt.nonFunctionalRequirements.length).toBeGreaterThan(0)
      expect(blueprint.question.scaffold.topology?.nodes.length).toBeGreaterThan(0)
    }
  })
})
