import { describe, expect, it } from 'vitest'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import { inferCanvasEdgeMode, isPathTypeDrivingLatency } from './edgeSemantics'

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

describe('isPathTypeDrivingLatency', () => {
  it('treats implicit log-normal latency as path-type derived', () => {
    expect(isPathTypeDrivingLatency({})).toBe(true)
    expect(isPathTypeDrivingLatency({ latencyDistributionType: 'log-normal' })).toBe(true)
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
