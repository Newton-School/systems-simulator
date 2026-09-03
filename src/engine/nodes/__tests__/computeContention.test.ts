import { describe, expect, it } from 'vitest'
import { GGcKNode } from '../GGcKNode'
import { Distributions } from '../../stochastic/distribution'
import { createRandom } from '../../stochastic/random'
import type { ComponentNode, EventScheduler, ComponentType } from '../../core/types'
import type { Request, SimulationEvent } from '../../core/events'

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

/** A scheduler that records each scheduled completion's timestamp. */
function capturingScheduler(): { scheduler: EventScheduler; completions: Map<string, bigint> } {
  const completions = new Map<string, bigint>()
  const scheduler: EventScheduler = {
    schedule: (event: SimulationEvent) => {
      if (event.type === 'processing-complete') {
        completions.set(event.requestId, event.timestamp)
      }
      return undefined
    }
  }
  return { scheduler, completions }
}

/** Instance-model node of a given type; constant 10ms service so inflation is visible. */
function makeNode(
  type: ComponentType,
  workloadKind: 'io-bound' | 'cpu-bound',
  scheduler: EventScheduler,
  instanceType = 'r5.xlarge'
): GGcKNode {
  const config = {
    id: 'n',
    type,
    category: 'compute',
    label: type,
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 4096, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 10 }, timeout: 600_000 },
    resources: { instanceType, instanceCount: 1, workloadKind }
  } as unknown as ComponentNode
  return new GGcKNode(config, new Distributions(createRandom('seed')), scheduler)
}

describe('two-tier compute contention', () => {
  it('io-bound compute-heavy node: service time inflates as concurrency exceeds cores', () => {
    // vector-db: cpuBoundFraction 0.8, r5.xlarge = 4 vCPU → 4 cores, 128 io workers.
    const { scheduler, completions } = capturingScheduler()
    const node = makeNode('vector-db', 'io-bound', scheduler)

    // First request: 1 worker busy, cpuDemand 0.8 < 4 cores → no inflation → 10ms.
    node.handleArrival(makeRequest('r1'), 0n)
    expect(completions.get('r1')).toBe(10_000n) // 10ms in µs

    // Drive concurrency up to 40 in flight (well under the 128 worker pool but
    // 10× the 4 cores). The 40th request sees cpuDemand = 40×0.8 = 32, slowdown
    // = 32/4 = 8 → service = 10×(0.2 + 0.8×8) = 66ms.
    for (let i = 2; i <= 40; i++) node.handleArrival(makeRequest(`r${i}`), 0n)
    expect(completions.get('r40')).toBe(66_000n)
    // Monotonic: a mid-load request is between the two.
    expect(completions.get('r20')! > 10_000n && completions.get('r20')! < 66_000n).toBe(true)
  })

  it('io-bound headline utilization reports CPU occupancy even while the worker pool looks idle', () => {
    const { scheduler } = capturingScheduler()
    const node = makeNode('vector-db', 'io-bound', scheduler)
    for (let i = 1; i <= 40; i++) node.handleArrival(makeRequest(`r${i}`), 0n)

    const state = node.getState()
    // 40 of 128 workers busy → worker occupancy only 31%…
    expect(state.activeWorkers).toBe(40)
    expect(40 / 128).toBeCloseTo(0.3125, 3)
    // …but CPU is pinned (demand 32 ≥ 4 cores) → headline = 100%.
    expect(state.utilization).toBe(1)
  })

  it('cpu-bound node is a no-op: c = cores, so demand never exceeds cores', () => {
    // microservice on c5.large (2 vCPU), cpu-bound → 2 workers = 2 cores, fraction 1.0.
    const { scheduler, completions } = capturingScheduler()
    const node = makeNode('microservice', 'cpu-bound', scheduler, 'c5.large')
    node.handleArrival(makeRequest('a'), 0n)
    node.handleArrival(makeRequest('b'), 0n) // both workers busy, demand 2 = 2 cores
    // Contention is a no-op: the 2nd concurrent request is NOT slower than the 1st
    // (the two are equal). Their absolute value reflects only the pre-existing
    // instance compute-speed multiplier (c5.large perfFactor > 1 → < 10ms), which
    // this change does not touch.
    expect(completions.get('b')).toBe(completions.get('a'))
    expect(completions.get('a')! < 10_000n).toBe(true)
  })

  it('an io-bound override on a microservice does not inherit cpu-bound saturation', () => {
    const { scheduler, completions } = capturingScheduler()
    const node = makeNode('microservice', 'io-bound', scheduler, 'c5.large')
    for (let i = 1; i <= 4; i++) node.handleArrival(makeRequest(`m${i}`), 0n)

    const state = node.getState()
    expect(state.activeWorkers).toBe(4)
    // 4 requests × 10% CPU on 2 cores = 20% CPU utilization.
    expect(state.utilization).toBeCloseTo(0.2)
    expect(completions.get('m4')! < 15_000n).toBe(true)
  })

  it('legacy node (no resources) is a no-op: fraction 0, plain worker occupancy', () => {
    const { scheduler, completions } = capturingScheduler()
    const config = {
      id: 'legacy',
      type: 'microservice',
      category: 'compute',
      label: 'legacy',
      position: { x: 0, y: 0 },
      queue: { workers: 8, capacity: 64, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 10 }, timeout: 600_000 }
    } as ComponentNode
    const node = new GGcKNode(config, new Distributions(createRandom('seed')), scheduler)
    for (let i = 1; i <= 8; i++) node.handleArrival(makeRequest(`r${i}`), 0n)
    // All 8 at plain 10ms, and utilization is plain worker occupancy (8/8 = 1).
    expect(completions.get('r8')).toBe(10_000n)
    expect(node.getState().utilization).toBe(1)
    expect(node.getCoreAreaUs()).toBe(0) // CPU integral untouched for legacy nodes
  })

  it('updates CPU capacity on scale-down even while excess workers drain', () => {
    const { scheduler } = capturingScheduler()
    const node = makeNode('vector-db', 'io-bound', scheduler)
    for (let i = 1; i <= 8; i++) node.handleArrival(makeRequest(`r${i}`), 0n)

    // The node begins with 4 cores: 8 × 0.8 CPU demand pins it.
    expect(node.getState().utilization).toBe(1)
    // The worker pool drains gracefully at 8, but one r5.large has only 2 cores.
    node.resizeConcurrency(4, 4096, 1_000n, 2)
    expect(node.getMaxWorkers()).toBe(8)
    expect(node.getState().utilization).toBe(1)

    // Scale-out restores the physical core ceiling without relying on worker count.
    node.resizeConcurrency(128, 4096, 2_000n, 8)
    expect(node.getState().utilization).toBeCloseTo(0.8)
  })
})
