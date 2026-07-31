import { describe, expect, it } from 'vitest'
import { getComponentSpec } from './componentSpecs'
import type { CanvasNodeDataV2 } from './nodeSpecTypes'

function makeRelationalDbData(sim: CanvasNodeDataV2['sim']): CanvasNodeDataV2 {
  return {
    schemaVersion: 2,
    templateId: 'primary-db',
    componentType: 'relational-db',
    structuralRole: 'storage',
    profile: 'datastore',
    rendererType: 'serviceNode',
    label: 'Primary DB',
    iconKey: 'database',
    sim
  }
}

describe('relational-db serializeCanvas readLatencyMs/writeLatencyMs', () => {
  it('converts mean-latency inputs into exponential distributions', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        readLatencyMs: 4,
        writeLatencyMs: 10
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.config?.readLatency).toEqual({ type: 'exponential', lambda: 1 / 4 })
    expect(node?.config?.writeLatency).toEqual({ type: 'exponential', lambda: 1 / 10 })
  })

  it('lets an explicit distribution config win over the mean-latency shortcut', () => {
    const spec = getComponentSpec('relational-db')!
    const explicit = { type: 'log-normal' as const, mu: 1, sigma: 0.2 }
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        readLatency: explicit,
        readLatencyMs: 4
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.config?.readLatency).toEqual(explicit)
  })

  it('omits readLatency/writeLatency entirely when neither is configured', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 }
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.config?.readLatency).toBeUndefined()
    expect(node?.config?.writeLatency).toBeUndefined()
  })

  it('serializes partial SLO targets without requiring the full object', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        slo: { latencyP99: 99 }
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.slo).toEqual({ latencyP99: 99 })
  })

  it('derives error budget from availability target when only availability is configured', () => {
    const spec = getComponentSpec('relational-db')!
    const node = spec.serializeCanvas(
      makeRelationalDbData({
        queue: { workers: 8, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 },
        slo: { availabilityTarget: 0.999 }
      }),
      { nodeId: 'db', position: { x: 0, y: 0 } }
    )

    expect(node?.slo?.availabilityTarget).toBe(0.999)
    expect(node?.slo?.errorBudget).toBeCloseTo(0.001, 9)
  })
})
