import { describe, expect, it } from 'vitest'
import { resolveEdgeLensProjection } from './edgeLensPresentation'
import type { EdgeDefaults } from '../../../../engine/defaults/edgeDefaults'
import type { MetricLens } from '@renderer/types/ui'

const defaults: EdgeDefaults = {
  protocol: 'https',
  mode: 'synchronous',
  pathType: 'same-dc',
  bandwidth: 1000,
  maxConcurrentRequests: 256,
  packetLossRatePercent: 0,
  errorRatePercent: 0,
  latencyDistribution: { type: 'log-normal', mu: 1, sigma: 0.3 }
} as unknown as EdgeDefaults

const ALL_LENSES: MetricLens[] = [
  'instance',
  'concurrency',
  'queueCapacity',
  'timeout',
  'cost',
  'traffic',
  'saturation',
  'latency',
  'errors',
  'throughput'
]

describe('resolveEdgeLensProjection — connector mode', () => {
  it('recedes to a neutral link under every lens, carrying no headline or severity', () => {
    for (const lens of ALL_LENSES) {
      const projection = resolveEdgeLensProjection({
        lens,
        flow: undefined,
        config: {},
        defaults,
        connectorOnly: true
      })
      expect(projection.recedes).toBe(true)
      expect(projection.headline).toBe('')
      expect(projection.severity).toBe('ok')
      expect(projection.why).toContain('simple links')
    }
  })

  it('still projects a real value in network mode (connectorOnly false)', () => {
    const projection = resolveEdgeLensProjection({
      lens: 'concurrency',
      flow: undefined,
      config: { maxConcurrentRequests: 64 },
      defaults
    })
    expect(projection.recedes).toBe(false)
    expect(projection.headline).toBe('64 max')
  })
})
