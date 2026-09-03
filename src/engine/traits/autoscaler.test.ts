import { describe, expect, it } from 'vitest'
import { GGcKNode } from '../nodes/GGcKNode'
import { Distributions } from '../stochastic/distribution'
import { createRandom } from '../stochastic/random'
import type { ComponentNode, EventScheduler, NodeState, TopologyJSON } from '../core/types'
import type { Request } from '../core/events'
import { SimulationEngine } from '../engine'
import type { NodeBehaviourTrait } from './types'
import { autoscalerTrait } from './autoscaler'

function makeRequest(id: string): Request {
  return {
    id,
    type: 'req',
    sizeBytes: 64,
    priority: 1,
    createdAt: 0n,
    deadline: 600_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    completionSeq: 0,
    timeoutSeq: 0,
    metadata: {}
  } as Request
}

function makeQueueNode(): GGcKNode {
  const config = {
    id: 'api',
    type: 'microservice',
    category: 'compute',
    label: 'API',
    position: { x: 0, y: 0 },
    queue: { workers: 2, capacity: 256, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 5 }, timeout: 600_000 }
  } as ComponentNode
  const scheduler: EventScheduler = { schedule: () => undefined }
  return new GGcKNode(config, new Distributions(createRandom('seed')), scheduler)
}

describe('GGcKNode.resizeConcurrency', () => {
  it('utilization denominator is the piecewise capacity integral, not final×duration', () => {
    const node = makeQueueNode() // c = 2
    node.handleArrival(makeRequest('a'), 0n)
    node.handleArrival(makeRequest('b'), 0n) // both busy, activeWorkers = 2, never completed in-test

    node.resizeConcurrency(4, 256, 1_000_000n) // accrues 2 workers × 1e6, then c → 4
    node.finalizeUtilization(3_000_000n) // accrues 2 workers × 2e6 at the new ceiling window

    // capacityArea = 2×1e6 (before resize) + 4×2e6 (after) = 10e6, NOT 4×3e6 = 12e6.
    expect(node.getCapacityAreaUs()).toBe(10_000_000n)
    expect(node.getMaxWorkers()).toBe(4)
  })

  it('scaling up immediately pumps queued work into the new workers', () => {
    const node = makeQueueNode() // c = 2
    node.handleArrival(makeRequest('a'), 0n)
    node.handleArrival(makeRequest('b'), 0n)
    node.handleArrival(makeRequest('c'), 0n) // queued (c=2 full)
    expect(node.getState().queueLength).toBe(1)

    const { started } = node.resizeConcurrency(4, 256, 0n)
    expect(started.map((r) => r.id)).toEqual(['c'])
    expect(node.getState().activeWorkers).toBe(3)
    expect(node.getState().queueLength).toBe(0)
  })

  it('never drops the worker ceiling below in-flight work (graceful drain)', () => {
    const node = makeQueueNode() // c = 2
    node.handleArrival(makeRequest('a'), 0n)
    node.handleArrival(makeRequest('b'), 0n) // activeWorkers = 2
    node.resizeConcurrency(1, 256, 0n) // target 1, but 2 in flight
    expect(node.getMaxWorkers()).toBe(2) // clamped to activeWorkers, no eviction
  })
})

function nodeWith(config: Record<string, unknown>): ComponentNode {
  return {
    id: 'svc',
    type: 'microservice',
    category: 'compute',
    label: 'svc',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 5 }, timeout: 1000 },
    resources: { instanceCount: 1 } as never,
    config
  } as ComponentNode
}

function tick(
  node: ComponentNode,
  state: Map<string, unknown>,
  utilization: number
): Record<string, unknown> | void {
  const store = {
    get: <T>(k: string) => state.get(k) as T | undefined,
    set: <T>(k: string, v: T) => void state.set(k, v)
  }
  const nodeState: NodeState = {
    id: 'svc',
    status: 'busy',
    activeWorkers: 1,
    queueLength: 0,
    utilization,
    totalInSystem: 1
  }
  return autoscalerTrait.onTick?.({ node, clock: 0n, state: store, nodeState })
}

describe('autoscaler control loop (onTick)', () => {
  it('does not tick unless a max-instance bound is configured', () => {
    expect(autoscalerTrait.tickIntervalMs?.(nodeWith({}))).toBeNull()
    expect(
      autoscalerTrait.tickIntervalMs?.(
        nodeWith({ autoscaleMaxInstances: 4, autoscaleCooldownMs: 2000 })
      )
    ).toBe(2000)
  })

  it('scales up toward max when utilization exceeds target', () => {
    const node = nodeWith({ autoscaleMaxInstances: 3, autoscaleTargetUtilization: 0.5 })
    const state = new Map<string, unknown>()
    expect(tick(node, state, 0.9)?.scaleInstancesTo).toBe(2)
    expect(tick(node, state, 0.9)?.scaleInstancesTo).toBe(3)
    // capped at max
    expect(tick(node, state, 0.9)?.scaleInstancesTo).toBe(3)
  })

  it('scales down well below target, bounded by min', () => {
    const node = nodeWith({
      autoscaleMaxInstances: 4,
      autoscaleMinInstances: 1,
      autoscaleTargetUtilization: 0.6
    })
    const state = new Map<string, unknown>([['autoscaler.currentInstances', 3]])
    expect(tick(node, state, 0.05)?.scaleInstancesTo).toBe(2) // 0.05 < 0.6*0.5
    expect(tick(node, state, 0.05)?.scaleInstancesTo).toBe(1)
    expect(tick(node, state, 0.05)?.scaleInstancesTo).toBe(1) // floored at min
  })

  it('holds steady inside the target band (no flapping)', () => {
    const node = nodeWith({ autoscaleMaxInstances: 4, autoscaleTargetUtilization: 0.6 })
    const state = new Map<string, unknown>([['autoscaler.currentInstances', 2]])
    // 0.4 is below target but above target*0.5=0.3 → no change.
    const r = tick(node, state, 0.4)
    expect(r?.scaleInstancesTo).toBe(2)
    expect((r?.metricCounters as Record<string, number>) ?? {}).toEqual({})
  })
})

describe('scaleInstancesTo drives an engine resize end-to-end', () => {
  it('applies a tick that requests a resize without breaking the run', () => {
    const topology: TopologyJSON = {
      id: 't',
      name: 'autoscale-smoke',
      version: '1.0.0',
      global: {
        simulationDuration: 500,
        seed: 's',
        warmupDuration: 0,
        timeResolution: 'microsecond',
        defaultTimeout: 30_000
      },
      nodes: [
        {
          id: 'svc',
          type: 'microservice',
          category: 'compute',
          label: 'svc',
          position: { x: 0, y: 0 },
          queue: { workers: 2, capacity: 64, discipline: 'fifo' },
          processing: { distribution: { type: 'constant', value: 1 }, timeout: 30_000 }
        }
      ],
      edges: []
    }
    // A tick that unconditionally asks to scale to 4 every 100ms.
    const scaler: NodeBehaviourTrait = {
      name: 'test.scaler',
      tickIntervalMs: () => 100,
      onTick: () => ({ scaleInstancesTo: 4 })
    }
    const output = new SimulationEngine(topology, { resolveTraits: () => [scaler] }).run()
    // The run completes and produces node metrics (the resize path executed without throwing).
    expect(output.perNode['svc']).toBeDefined()
    expect(output.reproducible).toBe(true)
  })
})
