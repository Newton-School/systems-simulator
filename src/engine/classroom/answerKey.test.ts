import { describe, expect, it } from 'vitest'
import { buildClassroomAnswerKey } from './answerKey'

describe('buildClassroomAnswerKey', () => {
  it('finds the exact smallest passing fleet', () => {
    const answer = buildClassroomAnswerKey({
      peakRps: 1_000_000,
      capacityRps: 100_000,
      maxUtilization: 0.8,
      maxCopies: 20
    })
    expect(answer.rows).toHaveLength(20)
    expect(answer.smallestPassingCopies).toBe(13)
    expect(answer.rows[7]).toMatchObject({ copies: 8, passes: false })
    expect(answer.rows[11]?.utilization).toBeCloseTo(5 / 6)
    expect(answer.rows[12]?.utilization).toBeCloseTo(10 / 13)
  })

  it('reports an unsolved range and rejects invalid givens', () => {
    expect(
      buildClassroomAnswerKey({
        peakRps: 1_000_000,
        capacityRps: 100_000,
        maxUtilization: 0.8,
        maxCopies: 12
      }).smallestPassingCopies
    ).toBeNull()
    expect(
      buildClassroomAnswerKey({ peakRps: 0, capacityRps: 100, maxUtilization: 0.8, maxCopies: 2 })
    ).toEqual({ rows: [], smallestPassingCopies: null })
  })
})
