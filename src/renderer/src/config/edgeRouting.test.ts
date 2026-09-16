import { describe, expect, it } from 'vitest'
import {
  EDGE_ROUTING_OPTIONS,
  normalizeEdgeRoutingStyle,
  resolveEdgeRoutingStyle
} from './edgeRouting'

describe('edgeRouting', () => {
  it('offers each supported route exactly once', () => {
    expect(EDGE_ROUTING_OPTIONS.map((option) => option.value)).toEqual([
      'straight',
      'orthogonal',
      'rounded',
      'bezier',
      'octilinear'
    ])
  })

  it('migrates the legacy curved setting to rounded orthogonal', () => {
    expect(normalizeEdgeRoutingStyle('curved', 'straight')).toBe('rounded')
  })

  it('uses a valid per-edge route and safely falls back for malformed data', () => {
    expect(resolveEdgeRoutingStyle('bezier', 'straight')).toBe('bezier')
    expect(resolveEdgeRoutingStyle('unknown-route', 'octilinear')).toBe('octilinear')
  })
})
