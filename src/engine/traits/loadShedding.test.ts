import { describe, expect, it } from 'vitest'
import type { Request } from '../core/events'
import type { ComponentNode, NodeState } from '../core/types'
import { estimateQueueDelayMs, loadSheddingTrait } from './loadShedding'

function node(config: Record<string, unknown>): ComponentNode {
  return {
    id: 'svc',
    type: 'microservice',
    category: 'compute',
    label: 'svc',
    position: { x: 0, y: 0 },
    queue: { workers: 4, capacity: 100, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 10 }, timeout: 1_000 },
    config
  }
}

function state(queueLength: number, activeWorkers = 4, meanServiceTimeMs = 10): NodeState {
  return {
    id: 'svc',
    status: 'busy',
    activeWorkers,
    queueLength,
    utilization: 1,
    totalInSystem: activeWorkers + queueLength,
    workerCapacity: 4,
    meanServiceTimeMs
  }
}

const request = (priority = 1) => ({ priority, metadata: {} }) as unknown as Request

function decide(config: Record<string, unknown>, nodeState: NodeState, priority = 1) {
  return loadSheddingTrait.beforeArrival!({
    node: node(config),
    request: request(priority),
    clock: 0n,
    nodeState
  })
}

describe('loadSheddingTrait', () => {
  it('is inert without a threshold', () => {
    expect(decide({}, state(1_000))).toEqual({ action: 'continue' })
  })

  it('sheds at the queue-depth threshold, not below it', () => {
    expect(decide({ loadShedQueueDepth: 8 }, state(7)).action).toBe('continue')
    expect(decide({ loadShedQueueDepth: 8 }, state(8))).toMatchObject({
      action: 'rejected',
      reason: 'load_shed',
      payload: { loadShedTrigger: 'queue-depth' }
    })
  })

  it('estimates queueing delay as (queued + 1) / workers x mean service time', () => {
    expect(estimateQueueDelayMs(state(0, 3))).toBe(0) // a worker is free
    expect(estimateQueueDelayMs(state(7))).toBe(20) // (7 + 1) / 4 x 10ms
    expect(estimateQueueDelayMs(state(7, 4, 0))).toBeNull() // no completions yet
    expect(decide({ loadShedMaxQueueDelayMs: 20 }, state(7)).action).toBe('continue')
    expect(decide({ loadShedMaxQueueDelayMs: 20 }, state(8))).toMatchObject({
      action: 'rejected',
      payload: { loadShedTrigger: 'queue-delay' }
    })
  })

  it('exempts high-priority requests only when asked', () => {
    const config = { loadShedQueueDepth: 1, loadShedProtectHighPriority: true }
    expect(decide(config, state(5), 0).action).toBe('continue')
    expect(decide(config, state(5), 1).action).toBe('rejected')
    expect(decide({ loadShedQueueDepth: 1 }, state(5), 0).action).toBe('rejected')
  })
})
