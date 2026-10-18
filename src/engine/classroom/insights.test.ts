import { describe, expect, it } from 'vitest'
import type { GamePlaygroundSubmitPayload } from '../analysis/gamePlayground'
import { aggregateClassroomInsights } from './insights'

describe('aggregateClassroomInsights', () => {
  it('counts cohort misconceptions and predictions without double-counting a hit', () => {
    const base = {
      classroomInsights: {
        misconceptionIds: ['headroom', 'headroom'],
        predictions: { servers: 12 }
      }
    }
    const submissions = [
      base,
      { classroomInsights: { misconceptionIds: ['capacity'], predictions: { servers: 13 } } }
    ]
    expect(aggregateClassroomInsights(submissions as GamePlaygroundSubmitPayload[])).toEqual({
      attempts: 2,
      misconceptionCounts: { headroom: 1, capacity: 1 },
      predictionCounts: { servers: { '12': 1, '13': 1 } }
    })
  })
})
