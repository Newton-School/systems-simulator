import { describe, expect, it } from 'vitest'
import { GGcKNode } from './GGcKNode'
import { Distributions } from '../stochastic/distribution'
import { createRandom } from '../stochastic/random'
import type { ComponentNode, EventScheduler, SimulationEvent } from '../core/types'
import type { Request } from '../core/events'

function makeRequest(id: string): Request {
  return {
    id,
    type: 'req',
    sizeBytes: 64,
    priority: 1,
    createdAt: 0n,
    deadline: 60_000_000n,
    path: [],
    spans: [],
    retryCount: 0,
    completionSeq: 0,
    timeoutSeq: 0,
    metadata: {}
  } as Request
}

function makeNode(serviceMs: number, scheduled: SimulationEvent[]): GGcKNode {
  const config: ComponentNode = {
    id: 'api',
    type: 'microservice',
    category: 'compute',
    label: 'API',
    position: { x: 0, y: 0 },
    queue: { workers: 2, capacity: 256, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 60_000 }
  } as ComponentNode
  const scheduler: EventScheduler = { schedule: (e) => scheduled.push(e) }
  return new GGcKNode(config, new Distributions(createRandom('seed')), scheduler)
}

describe('GGcKNode service-time quantization floor', () => {
  it('schedules completion strictly in the future even when service rounds to 0µs', () => {
    // 0.0004ms → 0.4µs → would round to 0µs and complete at the same tick, freeing
    // the worker instantly and bypassing the worker pool / queue.
    const scheduled: SimulationEvent[] = []
    const node = makeNode(0.0004, scheduled)

    const result = node.handleArrival(makeRequest('r1'), 1_000n)
    expect(result.status).toBe('processed')

    const completion = scheduled.find((e) => e.type === 'processing-complete')
    expect(completion).toBeDefined()
    // The floor guarantees the worker is held for real time: >= 1µs after start.
    expect(completion!.timestamp).toBeGreaterThanOrEqual(1_001n)
  })

  it('never runs more concurrent tasks than the worker pool, queueing the rest', () => {
    const scheduled: SimulationEvent[] = []
    const node = makeNode(5, scheduled) // 5ms service, 2 workers

    expect(node.handleArrival(makeRequest('a'), 0n).status).toBe('processed')
    expect(node.handleArrival(makeRequest('b'), 0n).status).toBe('processed')
    // Third arrival: both workers busy → must queue, not process.
    expect(node.handleArrival(makeRequest('c'), 0n).status).toBe('queued')
    expect(node.getState().activeWorkers).toBe(2)
    expect(node.getState().queueLength).toBe(1)
  })

  it('rejects and counts a rejection once in-system reaches capacity K', () => {
    const scheduled: SimulationEvent[] = []
    // Tiny node: 1 worker, K=2 → 1 in service + 1 queued fills it.
    const config = {
      id: 'api',
      type: 'microservice',
      category: 'compute',
      label: 'API',
      position: { x: 0, y: 0 },
      queue: { workers: 1, capacity: 2, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 5 }, timeout: 60_000 }
    } as ComponentNode
    const node = new GGcKNode(config, new Distributions(createRandom('s')), {
      schedule: (e) => scheduled.push(e)
    } as EventScheduler)

    expect(node.handleArrival(makeRequest('a'), 0n).status).toBe('processed') // worker
    expect(node.handleArrival(makeRequest('b'), 0n).status).toBe('queued') // K slot 2
    const rejected = node.handleArrival(makeRequest('c'), 0n) // K exceeded
    expect(rejected.status).toBe('rejected')
    expect(node.getMetrics().totalRejections).toBe(1)
  })
})
