import { describe, expect, it } from 'vitest'
import type { ComponentNode, ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import { fanoutQueryTrait } from './fanoutQuery'

function makeNode(
  config: Record<string, unknown>,
  type: ComponentType = 'search-service'
): ComponentNode {
  return {
    id: 'n',
    type,
    category: 'compute',
    label: type,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 1000 },
    config
  }
}

function tail(config: Record<string, unknown>, random: () => number): number {
  const req = { metadata: {} }
  fanoutQueryTrait.beforeArrival?.({
    node: makeNode(config),
    request: req as never,
    clock: 0n,
    random
  })
  return (req.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number) ?? 0
}

describe('fanoutQuery trait', () => {
  it('is a no-op with a single shard (no scatter-gather tail)', () => {
    expect(tail({ shardCount: 1, perShardLatencyMs: 10 }, () => 0.5)).toBe(0)
    expect(tail({}, () => 0.5)).toBe(0)
  })

  it('adds a tail latency = max of N per-shard samples', () => {
    // With a fixed RNG all draws are equal, so max == that single sample.
    const t = tail({ shardCount: 4, perShardLatencyMs: 10 }, () => 0.5)
    // -10 * ln(1 - 0.5) = 6.93ms
    expect(t).toBeCloseTo(-10 * Math.log(0.5), 3)
  })

  it('tail grows with shard count under the same latency draws', () => {
    // Deterministic ascending draws so more shards ⇒ a larger max sample.
    const draws = [0.1, 0.4, 0.7, 0.9, 0.95, 0.99]
    let i = 0
    const seq = (): number => draws[i++ % draws.length]
    const small = tail({ shardCount: 2, perShardLatencyMs: 10 }, seq)
    i = 0
    const large = tail({ shardCount: 6, perShardLatencyMs: 10 }, seq)
    expect(large).toBeGreaterThan(small)
  })

  it('emits fanout metrics', () => {
    const req = { metadata: {} }
    const decision = fanoutQueryTrait.beforeArrival?.({
      node: makeNode({ shardCount: 5, perShardLatencyMs: 8 }),
      request: req as never,
      clock: 0n,
      random: () => 0.5
    })
    const counters =
      decision && 'payload' in decision
        ? ((decision.payload?.['metricCounters'] as Record<string, number>) ?? {})
        : {}
    expect(counters.fanoutQueries).toBe(1)
    expect(counters.shardsQueried).toBe(5)
  })
})
