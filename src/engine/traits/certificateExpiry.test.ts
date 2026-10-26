import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { msToMicro } from '../core/time'
import { certificateExpiryTrait } from './certificateExpiry'

function node(config: Record<string, unknown>): ComponentNode {
  return {
    id: 'cert',
    type: 'certificate-distro',
    category: 'dns-and-certs',
    label: 'cert',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
    config
  } as ComponentNode
}

const at = (config: Record<string, unknown>, ms: number) =>
  (
    certificateExpiryTrait.beforeArrival?.({
      node: node(config),
      request: { id: 'r', metadata: {} } as unknown as Request,
      clock: msToMicro(ms)
    }) as { action: string; reason?: string }
  ).action

describe('certificate expiry', () => {
  it('fails every request from the expiry instant', () => {
    const config = { certificateValidUntilMs: 10_000 }
    expect(at(config, 9_999)).toBe('continue')
    expect(at(config, 10_000)).toBe('rejected')
    expect(at(config, 60_000)).toBe('rejected')
  })

  it('ends the outage at the renewal time', () => {
    const config = { certificateValidUntilMs: 10_000, certificateRenewedAtMs: 15_000 }
    expect(at(config, 12_000)).toBe('rejected')
    expect(at(config, 15_000)).toBe('continue')
  })

  it('never expires with no valid-until time', () => {
    expect(at({}, 1e9)).toBe('continue')
  })
})
