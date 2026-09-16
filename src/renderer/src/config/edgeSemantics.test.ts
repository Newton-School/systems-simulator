import { describe, expect, it } from 'vitest'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import {
  getEdgeModePresentation,
  getEdgeProtocolPresentation,
  inferCanvasEdgeMode,
  isPathTypeDrivingLatency
} from './edgeSemantics'

describe('inferCanvasEdgeMode', () => {
  it('preserves an explicit mode override', () => {
    expect(inferCanvasEdgeMode({ mode: 'conditional', protocol: 'https' })).toBe('conditional')
  })

  it('infers streaming for websocket-style targets', () => {
    expect(
      inferCanvasEdgeMode({ protocol: 'websocket' }, {
        componentType: 'websockets-gateway'
      } as CanvasNodeDataV2)
    ).toBe('streaming')
  })

  it('infers asynchronous for async-boundary targets when mode is unset', () => {
    expect(
      inferCanvasEdgeMode({ protocol: 'amqp' }, {
        componentType: 'queue',
        templateId: 'queue'
      } as CanvasNodeDataV2)
    ).toBe('asynchronous')
  })

  it('falls back to synchronous for ordinary request-response edges', () => {
    expect(
      inferCanvasEdgeMode({ protocol: 'grpc' }, {
        componentType: 'microservice',
        templateId: 'microservice'
      } as CanvasNodeDataV2)
    ).toBe('synchronous')
  })
})

describe('edge visual semantics', () => {
  it('uses distinct line patterns for every edge mode', () => {
    const patterns = ['synchronous', 'asynchronous', 'streaming', 'conditional'].map(
      (mode) =>
        getEdgeModePresentation(mode as Parameters<typeof getEdgeModePresentation>[0])
          .strokeDasharray
    )

    expect(new Set(patterns).size).toBe(patterns.length)
  })

  it('provides compact protocol labels and theme-aware direction accents', () => {
    expect(getEdgeProtocolPresentation('grpc')).toEqual({
      shortLabel: 'gRPC',
      accent: 'rgb(var(--nss-info))'
    })
    expect(getEdgeProtocolPresentation('udp').accent).toBe('rgb(var(--nss-warning))')
  })
})

describe('isPathTypeDrivingLatency', () => {
  it('treats fully automatic latency as path-type derived', () => {
    expect(isPathTypeDrivingLatency({})).toBe(true)
    expect(isPathTypeDrivingLatency({ latencyDistributionType: 'log-normal' })).toBe(true)
    expect(isPathTypeDrivingLatency({ latencyDistributionType: 'constant' })).toBe(true)
  })

  it('treats constant latency as an explicit override', () => {
    expect(
      isPathTypeDrivingLatency({
        latencyDistributionType: 'constant',
        latencyValue: 4.5
      })
    ).toBe(false)
  })

  it('treats explicit log-normal parameters as an override', () => {
    expect(
      isPathTypeDrivingLatency({
        latencyDistributionType: 'log-normal',
        latencyMu: 1.2,
        latencySigma: 0.4
      })
    ).toBe(false)
  })
})
