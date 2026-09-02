import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { protocolSessionTrait } from './protocolSession'

function node(type: ComponentNode['type'], config: Record<string, unknown>): ComponentNode {
  return {
    id: type,
    type,
    category: 'network-and-edge',
    role: 'router',
    label: type,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1000 },
    config
  }
}

function request(metadata: Record<string, unknown>): Request {
  return {
    id: 'req-1',
    type: 'GET',
    sizeBytes: 100,
    priority: 1,
    createdAt: 0n,
    deadline: 1000n,
    path: [],
    spans: [],
    retryCount: 0,
    metadata
  }
}

describe('protocolSessionTrait', () => {
  it('distinguishes L4 connection forwarding from L7 path policy', () => {
    const l4 = protocolSessionTrait.beforeArrival?.({
      node: node('load-balancer-l4', { allowedPaths: '/ok' }),
      request: request({ path: '/blocked' }),
      clock: 0n
    })
    const l7 = protocolSessionTrait.beforeArrival?.({
      node: node('load-balancer-l7', { allowedPaths: '/ok' }),
      request: request({ path: '/blocked' }),
      clock: 0n
    })

    expect(l4).toMatchObject({
      action: 'continue',
      payload: {
        protocolSessionOpen: true,
        protocolHttpAcknowledgement: 'on-response'
      }
    })
    expect(l7).toMatchObject({
      action: 'rejected',
      reason: 'protocol_policy_rejected',
      payload: { protocolL7Rejected: true }
    })
  })

  it('reports closed sessions and streaming flow control', () => {
    expect(
      protocolSessionTrait.beforeArrival?.({
        node: node('api-gateway', { sessionOpen: false }),
        request: request({ path: '/ok' }),
        clock: 0n
      })
    ).toMatchObject({
      action: 'rejected',
      payload: {
        protocolSessionClosed: true,
        metricCounters: { protocolSessionsClosed: 1 }
      }
    })

    expect(
      protocolSessionTrait.beforeArrival?.({
        node: node('load-balancer-l4', {
          sessionProtocol: 'websocket',
          streamWindow: 0
        }),
        request: request({}),
        clock: 0n
      })
    ).toMatchObject({
      action: 'rejected',
      reason: 'stream_flow_controlled',
      payload: { protocolFlowControlled: true }
    })
  })
})
