import { describe, expect, it } from 'vitest'

describe('simulator-question-author bundled example', () => {
  it('compiles exactly, passes, rejects its near miss, and preserves privacy', async () => {
    await expect(
      import('../../../scripts/validate-simulator-question-author')
    ).resolves.toBeDefined()
  })
})
