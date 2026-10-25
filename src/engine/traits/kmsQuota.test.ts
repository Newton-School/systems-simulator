import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode } from '../core/types'
import { msToMicro } from '../core/time'
import { cryptoCostTrait } from './cryptoCost'
import type { TraitStateStore } from './types'

function node(config: Record<string, unknown>): ComponentNode {
  return {
    id: 'kms',
    type: 'kms-security',
    category: 'security-and-identity',
    label: 'kms',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1_000 },
    config
  } as ComponentNode
}

function store(): TraitStateStore {
  const m = new Map<string, unknown>()
  return { get: (k) => m.get(k) as never, set: (k, v) => void m.set(k, v) }
}

const request = (): Request => ({ id: 'r', metadata: {} }) as unknown as Request

describe('KMS request quota', () => {
  it('throttles calls past the per-second quota and recovers as the window slides', () => {
    const state = store()
    const kms = node({ kmsQuotaRps: 3, cryptoMs: 1 })
    const at = (ms: number) =>
      cryptoCostTrait.beforeArrival?.({
        node: kms,
        request: request(),
        clock: msToMicro(ms),
        state
      }) as { action: string; reason?: string }
    expect([at(0), at(100), at(200)].map((d) => d.action)).toEqual([
      'continue',
      'continue',
      'continue'
    ])
    expect(at(300)).toMatchObject({ action: 'rejected', reason: 'kms_throttled' })
    expect(at(999)).toMatchObject({ action: 'rejected' })
    // The first call left the one-second window.
    expect(at(1_001).action).toBe('continue')
  })

  it('has no quota unless one is set', () => {
    const state = store()
    for (let i = 0; i < 50; i++) {
      const d = cryptoCostTrait.beforeArrival?.({
        node: node({ cryptoMs: 1 }),
        request: request(),
        clock: msToMicro(i),
        state
      }) as { action: string }
      expect(d.action).toBe('continue')
    }
  })
})
