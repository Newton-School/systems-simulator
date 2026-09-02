import { describe, expect, it } from 'vitest'
import type { ComponentNode, ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait } from './types'
import { geoLatencyTrait } from './geoLatency'
import { externalLatencyTrait } from './externalLatency'
import { tieredRetrievalTrait } from './tieredRetrieval'
import { cryptoCostTrait } from './cryptoCost'
import { tokenCostTrait } from './tokenCost'
import { inspectionCostTrait } from './inspectionCost'

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

function makeReq(): { metadata: Record<string, unknown> } {
  return { metadata: {} }
}

function penalty(req: { metadata: Record<string, unknown> }): number {
  return (req.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number) ?? 0
}

function runLatency(
  trait: NodeBehaviourTrait,
  type: ComponentType,
  config: Record<string, unknown>
): { req: { metadata: Record<string, unknown> }; counters: Record<string, number> } {
  const req = makeReq()
  const decision = trait.beforeArrival?.({
    node: makeNode(type, config),
    request: req as never,
    clock: 0n,
    random: () => 0.999
  })
  const payload = decision && 'payload' in decision ? decision.payload : undefined
  const counters = (payload?.['metricCounters'] as Record<string, number>) ?? {}
  return { req, counters }
}

describe('latency-adder traits', () => {
  it('geoLatency adds the configured region latency and counts a hop', () => {
    const { req, counters } = runLatency(geoLatencyTrait, 'cdn', { regionLatencyMs: 40 })
    expect(penalty(req)).toBe(40)
    expect(counters.geoHops).toBe(1)
  })

  it('geoLatency is a no-op with no config', () => {
    const { req } = runLatency(geoLatencyTrait, 'cdn', {})
    expect(penalty(req)).toBe(0)
  })

  it('externalLatency adds the provider round-trip', () => {
    const { req, counters } = runLatency(externalLatencyTrait, 'payment-gateway', {
      externalLatencyMs: 120
    })
    expect(penalty(req)).toBe(120)
    expect(counters.externalCalls).toBe(1)
  })

  it('tieredRetrieval adds cold-tier retrieval latency', () => {
    const { req, counters } = runLatency(tieredRetrievalTrait, 'archive-storage', {
      retrievalMs: 3000
    })
    expect(penalty(req)).toBe(3000)
    expect(counters.coldRetrievals).toBe(1)
  })

  it('cryptoCost adds per-op crypto latency', () => {
    const { req, counters } = runLatency(cryptoCostTrait, 'kms-storage', { cryptoMs: 5 })
    expect(penalty(req)).toBe(5)
    expect(counters.cryptoOps).toBe(1)
  })

  it('tokenCost scales latency with output tokens', () => {
    const { req, counters } = runLatency(tokenCostTrait, 'llm-gateway', {
      msPerToken: 8,
      outputTokens: 100
    })
    expect(penalty(req)).toBe(800)
    expect(counters.tokensGenerated).toBe(100)
    expect(counters.llmCompletions).toBe(1)
  })
})

describe('inspectionCost trait', () => {
  it('adds scan latency and passes when not blocked', () => {
    const req = makeReq()
    const decision = inspectionCostTrait.beforeArrival?.({
      node: makeNode('network-policy', { inspectionMs: 2, blockRate: 0.1 }),
      request: req as never,
      clock: 0n,
      random: () => 0.9 // above blockRate ⇒ passes
    })
    expect(decision).toMatchObject({ action: 'continue' })
    expect(penalty(req)).toBe(2)
  })

  it('blocks a request when the RNG falls under blockRate', () => {
    const decision = inspectionCostTrait.beforeArrival?.({
      node: makeNode('network-policy', { inspectionMs: 2, blockRate: 0.5 }),
      request: makeReq() as never,
      clock: 0n,
      random: () => 0.1 // below blockRate ⇒ blocked
    })
    expect(decision).toMatchObject({ action: 'rejected', reason: 'inspection_blocked' })
  })
})
