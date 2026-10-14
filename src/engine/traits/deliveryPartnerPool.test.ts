import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import { deliveryPartnerCapacity, deliveryPartnerPoolTrait } from './deliveryPartnerPool'
import {
  SERVICE_TIME_WAIT_APPLIED_MS_KEY,
  SERVICE_TIME_WAIT_UNTIL_US_KEY
} from './serviceTimeOverride'

function node(config: Record<string, unknown> = {}): ComponentNode {
  return {
    id: 'delivery',
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: 'Delivery Service',
    position: { x: 0, y: 0 },
    queue: { workers: 20, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 5_000 },
    config
  }
}

describe('deliveryPartnerPoolTrait', () => {
  it('uses configured partner capacity only when the pool is enabled', () => {
    expect(deliveryPartnerCapacity({ partnerCapacity: 4 })).toBeNull()
    expect(deliveryPartnerCapacity({ partnerPoolEnabled: true, partnerCapacity: 4 })).toBe(4)
  })

  it('holds an order until partners become available and adds matching time', () => {
    const request = { metadata: {} } as never
    const decision = deliveryPartnerPoolTrait.beforeArrival?.({
      node: node({
        partnerPoolEnabled: true,
        partnerCapacity: 2,
        partnerUnavailableUntilMs: 100,
        partnerMatchMs: 25
      }),
      request,
      clock: 20_000n
    })

    expect(decision).toMatchObject({
      action: 'continue',
      payload: {
        partnerDecision: 'waiting',
        partnerCapacity: 2,
        metricCounters: { partnerRequests: 1, partnerQueuedForAvailability: 1 }
      }
    })
    expect(
      (request as { metadata: Record<string, unknown> }).metadata[SERVICE_TIME_WAIT_UNTIL_US_KEY]
    ).toBe(125_000)
  })

  it('reports successful assignments and the wait actually applied by the queue model', () => {
    const result = deliveryPartnerPoolTrait.afterTerminal?.({
      node: node({ partnerPoolEnabled: true, partnerCapacity: 2 }),
      request: { metadata: { [SERVICE_TIME_WAIT_APPLIED_MS_KEY]: 80 } } as never,
      clock: 100_000n,
      status: 'success'
    })

    expect(result).toEqual({
      metricCounters: {
        partnerAssignments: 1,
        partnerWaits: 1,
        partnerWaitMs: 80
      }
    })
  })
})
