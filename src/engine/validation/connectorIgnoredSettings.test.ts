import { describe, expect, it } from 'vitest'
import type { EdgeDefinition } from '../core/types'
import {
  connectorModeNotice,
  describeIgnoredEdgeSettings,
  findIgnoredEdgeSettings
} from './connectorIgnoredSettings'

function edge(over: Partial<EdgeDefinition> = {}): EdgeDefinition {
  return {
    id: 'e',
    source: 'a',
    target: 'b',
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 1000,
    packetLossRate: 0,
    errorRate: 0,
    ...over
  }
}

describe('what connector mode ignores', () => {
  it('lists nothing for a connection that already behaves like a wire', () => {
    expect(describeIgnoredEdgeSettings(edge())).toEqual([])
    expect(connectorModeNotice({ edges: [edge()] })).toBeNull()
  })

  it('names each setting that would change a run', () => {
    expect(
      describeIgnoredEdgeSettings(
        edge({
          latency: { distribution: { type: 'constant', value: 50 }, pathType: 'cross-region' },
          errorRate: 0.2,
          packetLossRate: 0.015,
          fanoutFactor: 4
        })
      )
    ).toEqual(['latency 50 ms', '20% errors', '1.5% packet loss', 'fan-out x4'])
  })

  it('treats a non-constant latency distribution as authored latency', () => {
    expect(
      describeIgnoredEdgeSettings(
        edge({
          latency: { distribution: { type: 'exponential', lambda: 0.1 }, pathType: 'same-dc' }
        })
      )
    ).toEqual(['a latency distribution'])
  })

  it('does not count bandwidth or concurrency, which every edge carries a default for', () => {
    expect(describeIgnoredEdgeSettings(edge({ bandwidth: 5, maxConcurrentRequests: 3 }))).toEqual(
      []
    )
  })

  it('writes one notice for the whole document with a count, an example and the way out', () => {
    const edges = [
      edge({ id: 'e1', source: 'client', target: 'api', errorRate: 0.2 }),
      edge({ id: 'e2', source: 'api', target: 'db', packetLossRate: 0.1 }),
      edge({ id: 'e3', source: 'x', target: 'y' })
    ]
    expect(findIgnoredEdgeSettings({ edges }).map((entry) => entry.edgeId)).toEqual(['e1', 'e2'])
    const notice = connectorModeNotice({ edges }, (id) => id.toUpperCase())!
    expect(notice).toContain('2 connections set')
    expect(notice).toContain('CLIENT -> API (20% errors)')
    expect(notice).toContain('Settings > Environments > Edge model to Network')
  })
})
