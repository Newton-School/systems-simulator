import { describe, expect, it } from 'vitest'
import { QUESTION_OWNED_CONFIG_REASON, questionOwnedConfigReason } from './questionConfigPolicy'

const question = {
  constraints: { questionOwnedConfigPaths: ['sim.replicationLagMs', 'sim.consistencyModel'] }
}

describe('questionOwnedConfigReason', () => {
  it('locks listed paths with the learner-facing reason', () => {
    expect(questionOwnedConfigReason(question, 'sim.replicationLagMs')).toBe(
      QUESTION_OWNED_CONFIG_REASON
    )
    expect(questionOwnedConfigReason(question, 'sim.consistencyModel')).toBe(
      QUESTION_OWNED_CONFIG_REASON
    )
  })

  it('leaves unlisted paths editable', () => {
    expect(questionOwnedConfigReason(question, 'sim.replicationRole')).toBeNull()
  })

  it('does nothing without a question or without declared paths', () => {
    expect(questionOwnedConfigReason(null, 'sim.replicationLagMs')).toBeNull()
    expect(questionOwnedConfigReason(undefined, 'sim.replicationLagMs')).toBeNull()
    expect(questionOwnedConfigReason({ constraints: {} }, 'sim.replicationLagMs')).toBeNull()
    expect(questionOwnedConfigReason({}, 'sim.replicationLagMs')).toBeNull()
  })
})
