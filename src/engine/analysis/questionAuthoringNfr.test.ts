import { describe, expect, it } from 'vitest'
import {
  AUTHORING_NFR_CAPABILITIES,
  compileAuthoringNfr,
  convertAvailabilityValue,
  createAuthoringNonFunctionalRequirement,
  nonFunctionalRequirementReducer,
  type AuthoringNonFunctionalRequirement
} from './questionAuthoringNfr'

describe('Question Studio NFR authoring', () => {
  it('covers every runtime NFR metric with engine-owned choices', () => {
    expect(AUTHORING_NFR_CAPABILITIES.map(({ metric }) => metric)).toEqual([
      'latency_p99',
      'latency_p50',
      'availability',
      'error_rate',
      'throughput'
    ])
  })

  it('converts availability percentage and nines display units', () => {
    expect(convertAvailabilityValue(99.9, 'percent', 'nines')).toBe(3)
    expect(convertAvailabilityValue(4, 'nines', 'percent')).toBe(99.99)
    expect(convertAvailabilityValue(100, 'percent', 'nines')).toBeNull()
  })

  it('normalizes dependent operator, unit, and value choices when the metric changes', () => {
    const errorRate: AuthoringNonFunctionalRequirement = {
      id: 'nfr-1',
      metric: 'error_rate',
      operator: '<=',
      value: 2,
      unit: 'percent'
    }

    const [throughput] = nonFunctionalRequirementReducer([errorRate], {
      type: 'update-metric',
      id: 'nfr-1',
      metric: 'throughput'
    })

    expect(throughput).toEqual({
      id: 'nfr-1',
      metric: 'throughput',
      operator: '>=',
      value: 1000,
      unit: 'req_per_sec'
    })
  })

  it('compiles a valid card into the existing runtime NFR contract', () => {
    expect(
      compileAuthoringNfr({
        id: 'nfr-throughput',
        metric: 'throughput',
        operator: '>=',
        value: 2500,
        unit: 'req_per_sec'
      })
    ).toEqual({
      metric: 'throughput',
      operator: '>=',
      value: 2500,
      unit: 'req_per_sec',
      description: 'Throughput must be at least 2,500 req/s.'
    })
  })

  it('keeps stable IDs and rejects duplicate additions', () => {
    const original = createAuthoringNonFunctionalRequirement('latency_p99', 'nfr-stable')
    const duplicate = nonFunctionalRequirementReducer([original], {
      type: 'add',
      requirement: { ...original, value: 200 }
    })
    const removed = nonFunctionalRequirementReducer(duplicate, {
      type: 'remove',
      id: 'nfr-stable'
    })

    expect(duplicate).toEqual([original])
    expect(removed).toEqual([])
  })
})
