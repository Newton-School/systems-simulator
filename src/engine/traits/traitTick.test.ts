import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from '../core/types'
import { SimulationEngine } from '../engine'
import type { NodeBehaviourTrait, TraitStateStore } from './types'
import { windowingTrait } from './windowing'

function node(id: string, type: ComponentNode['type'] = 'microservice'): ComponentNode {
  return {
    id,
    type,
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 30_000 }
  }
}

function topology(durationMs: number): TopologyJSON {
  return {
    id: 't',
    name: 'tick-test',
    version: '1.0.0',
    global: {
      simulationDuration: durationMs,
      seed: 'tick-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000
    },
    nodes: [node('node-a')],
    edges: []
  }
}

function makeStore(): TraitStateStore {
  const m = new Map<string, unknown>()
  return {
    get: <T>(k: string) => m.get(k) as T | undefined,
    set: <T>(k: string, v: T) => void m.set(k, v)
  }
}

describe('onTick recurring-timer primitive', () => {
  it('fires every interval for the whole run, then terminates at the sim-end bound', () => {
    let fires = 0
    const ticks: bigint[] = []
    const tickTrait: NodeBehaviourTrait = {
      name: 'test.tick',
      tickIntervalMs: () => 100,
      onTick: ({ clock }) => {
        fires += 1
        ticks.push(clock)
        return {}
      }
    }
    const engine = new SimulationEngine(topology(1000), { resolveTraits: () => [tickTrait] })
    engine.run()

    // Ticks at 100..1000ms → 10 fires; the 1100ms re-arm is past the end and halts it.
    expect(fires).toBe(10)
    expect(ticks[0]).toBe(100_000n)
    expect(ticks[ticks.length - 1]).toBe(1_000_000n)
  })

  it('does not tick a trait that returns no interval', () => {
    let fires = 0
    const noTick: NodeBehaviourTrait = {
      name: 'test.no-tick',
      tickIntervalMs: () => null,
      onTick: () => {
        fires += 1
      }
    }
    const engine = new SimulationEngine(topology(1000), { resolveTraits: () => [noTick] })
    engine.run()
    expect(fires).toBe(0)
  })

  it('surfaces onTick metricCounters on the node (windowsEmitted via the timer)', () => {
    const engine = new SimulationEngine(topology(1000), {
      resolveTraits: () => [windowingTrait]
    })
    const output = engine.run()
    // windowMs unset here ⇒ tickIntervalMs returns null ⇒ no windows emitted.
    const counters = output.perNode['node-a']?.traitCounters ?? {}
    expect(counters.windowsEmitted ?? 0).toBe(0)
  })
})

describe('windowing trait (onTick consumer)', () => {
  it('accumulates arrivals and emits + resets the count on each window close', () => {
    const state = makeStore()
    const req = { metadata: {} } as never

    // Three events arrive into the open window.
    windowingTrait.beforeArrival?.({ node: node('sa'), request: req, clock: 0n, state })
    windowingTrait.beforeArrival?.({ node: node('sa'), request: req, clock: 0n, state })
    windowingTrait.beforeArrival?.({ node: node('sa'), request: req, clock: 0n, state })

    const first = windowingTrait.onTick?.({ node: node('sa'), clock: 1_000_000n, state })
    expect(first?.eventsInWindow).toBe(3)
    expect((first?.metricCounters as Record<string, number>).eventsAggregated).toBe(3)

    // Window reset: a close with no new arrivals emits 0.
    const second = windowingTrait.onTick?.({ node: node('sa'), clock: 2_000_000n, state })
    expect(second?.eventsInWindow).toBe(0)
  })

  it('reads its window size from node config for the timer interval', () => {
    const withWindow = { ...node('sa'), config: { windowMs: 500 } }
    expect(windowingTrait.tickIntervalMs?.(withWindow)).toBe(500)
    expect(windowingTrait.tickIntervalMs?.(node('sa'))).toBeNull()
  })
})
