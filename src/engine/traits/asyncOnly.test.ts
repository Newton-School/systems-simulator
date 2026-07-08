import { describe, expect, it } from 'vitest'
import { isObservabilityComponentType } from './asyncOnly'

describe('isObservabilityComponentType', () => {
  it('recognizes observability component types', () => {
    expect(isObservabilityComponentType('metrics-store')).toBe(true)
    expect(isObservabilityComponentType('centralized-logging')).toBe(true)
    expect(isObservabilityComponentType('distributed-tracing')).toBe(true)
  })

  it('does not flag ordinary compute or storage nodes', () => {
    expect(isObservabilityComponentType('microservice')).toBe(false)
    expect(isObservabilityComponentType('relational-db')).toBe(false)
  })
})
