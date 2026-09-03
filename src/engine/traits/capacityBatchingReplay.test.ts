import { describe, expect, it } from 'vitest'
import type { ComponentNode, ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { BeforeArrivalDecision, TraitStateStore } from './types'
import { capacityLimitTrait } from './capacityLimit'
import { batchingTrait } from './batching'
import { logReplayTrait } from './logReplay'

function makeStateStore(): TraitStateStore {
  const store = new Map<string, unknown>()
  return {
    get: <T>(k: string) => store.get(k) as T | undefined,
    set: <T>(k: string, v: T) => {
      store.set(k, v)
    }
  }
}

function makeNode(type: ComponentType, config: Record<string, unknown>): ComponentNode {
  return {
    id: 'n',
    type,
    category: 'network-and-edge',
    label: type,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1000 },
    config
  }
}

function penalty(req: { metadata: Record<string, unknown> }): number {
  return (req.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number) ?? 0
}

describe('capacityLimit trait', () => {
  it('admits up to the ops/sec ceiling in the window, then rejects', () => {
    const state = makeStateStore()
    const node = makeNode('nat-gateway', { maxOpsPerSecond: 2, capacityWindowMs: 1000 })
    const run = (clock: bigint): BeforeArrivalDecision | undefined =>
      capacityLimitTrait.beforeArrival?.({ node, request: { metadata: {} } as never, clock, state })

    expect(run(0n)).toMatchObject({ action: 'continue' })
    expect(run(1000n)).toMatchObject({ action: 'continue' })
    expect(run(2000n)).toMatchObject({ action: 'rejected', reason: 'capacity_exceeded' })
  })

  it('frees capacity once earlier admits age out of the window', () => {
    const state = makeStateStore()
    const node = makeNode('block-storage', { maxOpsPerSecond: 1, capacityWindowMs: 1000 })
    const run = (clock: bigint): BeforeArrivalDecision | undefined =>
      capacityLimitTrait.beforeArrival?.({ node, request: { metadata: {} } as never, clock, state })

    expect(run(0n)).toMatchObject({ action: 'continue' })
    expect(run(500_000n)).toMatchObject({ action: 'rejected' }) // still within 1s window
    expect(run(1_500_000n)).toMatchObject({ action: 'continue' }) // first admit aged out
  })
})

describe('batching trait', () => {
  it('adds formation wait + amortized fixed cost, and is cheaper per item at larger batches', () => {
    const small = { metadata: {} }
    batchingTrait.beforeArrival?.({
      node: makeNode('gpu-node', { batchSize: 2, batchWindowMs: 50, fixedCostMs: 20 }),
      request: small as never,
      clock: 0n
    })
    // wait 50/2=25 + fixed 20/2=10 => 35
    expect(penalty(small)).toBeCloseTo(35)

    const large = { metadata: {} }
    batchingTrait.beforeArrival?.({
      node: makeNode('gpu-node', { batchSize: 20, batchWindowMs: 50, fixedCostMs: 20 }),
      request: large as never,
      clock: 0n
    })
    // wait 25 + fixed 20/20=1 => 26  (amortized cost falls with batch size)
    expect(penalty(large)).toBeLessThan(penalty(small))
  })

  it('is a no-op when batch size is 1 or unset', () => {
    const req = { metadata: {} }
    batchingTrait.beforeArrival?.({
      node: makeNode('batch-worker', { batchSize: 1 }),
      request: req as never,
      clock: 0n
    })
    expect(penalty(req)).toBe(0)
  })
})

describe('logReplay trait', () => {
  it('replay cost grows as writes append to the log', () => {
    const state = makeStateStore()
    const node = makeNode('event-sourcing-store', { replayCostPerEventMs: 1 })
    const append = (): void => {
      logReplayTrait.beforeArrival?.({
        node,
        request: { type: 'write', metadata: {} } as never,
        clock: 0n,
        state
      })
    }
    const read = (): { metadata: Record<string, unknown> } => {
      const req = { type: 'read', metadata: {} }
      logReplayTrait.beforeArrival?.({ node, request: req as never, clock: 0n, state })
      return req
    }

    append()
    append()
    append()
    expect(penalty(read())).toBe(3) // 3 events × 1ms
  })

  it('a snapshot bounds how far a read replays', () => {
    const state = makeStateStore()
    const node = makeNode('event-sourcing-store', { replayCostPerEventMs: 1, snapshotEvery: 2 })
    for (let i = 0; i < 5; i++) {
      logReplayTrait.beforeArrival?.({
        node,
        request: { type: 'write', metadata: {} } as never,
        clock: 0n,
        state
      })
    }
    const req = { type: 'read', metadata: {} }
    logReplayTrait.beforeArrival?.({ node, request: req as never, clock: 0n, state })
    // 5 events, snapshot every 2 ⇒ replay 5 % 2 = 1 event ⇒ 1ms (bounded, not 5)
    expect(penalty(req)).toBe(1)
  })
})
