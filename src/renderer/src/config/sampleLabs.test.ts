import { describe, expect, it } from 'vitest'
import { SAMPLE_LABS } from './sampleLabs'

describe('SAMPLE_LABS', () => {
  it('ships locked labs that reuse simulator questions instead of separate mini-apps', () => {
    expect(SAMPLE_LABS).toHaveLength(3)

    for (const lab of SAMPLE_LABS) {
      expect(lab.question.entryFormat).toBe('locked-lab')
      expect(lab.question.tags).toContain('lab')
      expect(lab.question.scaffold.type).toBe('complete')
      expect(lab.question.constraints.canModifyScaffold).toBe(false)
      expect(lab.question.constraints.canRemoveScaffoldNodes).toBe(false)
      expect(lab.question.constraints.allowedNodeTypes).toEqual([])
      expect(lab.question.prompt.additionalContext).toBeTruthy()
      expect(lab.question.scaffold.topology?.nodes.length).toBeGreaterThan(0)
    }
  })
})
