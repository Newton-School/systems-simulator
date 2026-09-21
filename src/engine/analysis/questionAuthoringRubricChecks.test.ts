import { describe, expect, it } from 'vitest'
import { RUBRIC_METRIC_CAPABILITIES } from './authoringCapabilities'
import {
  authoringRubricCheckReducer,
  compileAuthoringRubricCheck,
  createAuthoringRubricCheck
} from './questionAuthoringRubricChecks'

describe('Question Studio verdict-metric composer', () => {
  it('can author every metric in the engine-owned registry', () => {
    for (const capability of RUBRIC_METRIC_CAPABILITIES) {
      const compiled = compileAuthoringRubricCheck({
        id: `check-${capability.id}`,
        metric: capability.id,
        op: capability.operators[0],
        value: 0,
        points: 1
      })
      expect(compiled, capability.id).not.toBeNull()
      expect(compiled?.metric).toBe(capability.id)
      expect(compiled?.kind).toBe(capability.kind)
    }
  })

  it('compiles an invariant check with kind and points', () => {
    expect(
      compileAuthoringRubricCheck({
        id: 'no-violations',
        metric: 'invariantViolations.count',
        op: '==',
        value: 0,
        points: 2
      })
    ).toEqual({
      id: 'no-violations',
      description: expect.stringContaining('=='),
      kind: 'invariant',
      metric: 'invariantViolations.count',
      op: '==',
      value: 0,
      points: 2
    })
  })

  it('rejects an unknown metric, an unsupported op, and missing values', () => {
    expect(
      compileAuthoringRubricCheck({ id: 'x', metric: 'not.a.metric', op: '<', value: 1, points: 1 })
    ).toBeNull()
    expect(
      compileAuthoringRubricCheck({
        id: 'x',
        metric: 'summary.throughput',
        op: '<',
        value: null,
        points: 1
      })
    ).toBeNull()
  })

  it('keeps a compatible op when the metric changes, else falls back', () => {
    const created = createAuthoringRubricCheck('perNode.maxUtilization', 'c1')
    const switched = authoringRubricCheckReducer([created], {
      type: 'update-metric',
      id: 'c1',
      metric: 'invariantViolations.count'
    })
    expect(switched[0].metric).toBe('invariantViolations.count')
    // '<' is in the shared operator set, so it is preserved.
    expect(switched[0].op).toBe(created.op)
  })
})
