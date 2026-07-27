import { describe, expect, it } from 'vitest'
import {
  classifyRequestOutcome,
  createEmptyRequestOutcomeBreakdown
} from './requestOutcomeSemantics'

describe('request outcome semantics', () => {
  it('classifies rate limits as inferred 4xx outcomes', () => {
    expect(classifyRequestOutcome('rejected', 'rate_limited')).toMatchObject({
      family: 'client_error_4xx',
      statusClass: '4xx',
      statusCodeHint: '429'
    })
  })

  it('classifies connection refusals as network drops', () => {
    expect(classifyRequestOutcome('rejected', 'connection_refused')).toMatchObject({
      family: 'network_drop',
      statusClass: 'dropped'
    })
  })

  it('creates zeroed breakdown buckets for every family', () => {
    const breakdown = createEmptyRequestOutcomeBreakdown()
    expect(Object.values(breakdown).every((value) => value === 0)).toBe(true)
    expect(Object.keys(breakdown)).toHaveLength(7)
  })
})
