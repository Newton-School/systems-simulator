import { describe, expect, it } from 'vitest'
import { deriveConnectionCapacity } from './connectionCapacity'
import { instantiateTemplate } from './paletteTemplates'

describe('deriveConnectionCapacity', () => {
  it('sizes a fleet and refuses overflow when saturated', () => {
    const r = deriveConnectionCapacity(
      {
        maxConnectionsPerInstance: 65000,
        offeredConnections: 10_000_000,
        heartbeatIntervalMs: 30000
      },
      1
    )
    expect(r.fleetCapacity).toBe(65000)
    expect(r.connectionsHeld).toBe(65000)
    expect(r.connectionsRefused).toBe(10_000_000 - 65000)
    expect(r.saturated).toBe(true)
    expect(r.requiredInstances).toBe(Math.ceil(10_000_000 / 65000)) // 154
    expect(r.heartbeatRps).toBeCloseTo(10_000_000 / 30)
  })

  it('is healthy when instanceCount covers offered connections', () => {
    const r = deriveConnectionCapacity(
      { maxConnectionsPerInstance: 65000, offeredConnections: 100_000 },
      2
    )
    expect(r.fleetCapacity).toBe(130_000)
    expect(r.connectionsRefused).toBe(0)
    expect(r.saturated).toBe(false)
    expect(r.utilization).toBeCloseTo(100_000 / 130_000)
    expect(r.heartbeatRps).toBe(0) // no heartbeat interval
  })
})

describe('connection-server palette node', () => {
  it('seeds a websocket connection capacity block on api-gateway', () => {
    const data = instantiateTemplate('connection-server')
    expect(data.componentType).toBe('api-gateway')
    expect(data.sim?.connection).toEqual({
      maxConnectionsPerInstance: 65000,
      offeredConnections: 100000,
      heartbeatIntervalMs: 30000,
      sessionProtocol: 'websocket'
    })
  })
})
